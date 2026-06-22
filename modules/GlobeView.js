/**
 * GlobeView.js - 缩小时显示的 3D 旋转地球（原生 Three.js，从 CDN 加载 window.THREE）
 *
 * 平面地图 → 地球：地球用一张「经纬网格」网面，顶点在「平面(等距矩形)」与
 * 「球面」两套坐标之间插值（morph 0→1）。进入时从平面顺滑卷成球体并转到目标
 * 经纬度；退出时反向。容器同时做淡入淡出，与下方 Leaflet 平面地图衔接。
 *
 * 交互：拖动旋转；滚轮放大（拉近到阈值/点击球面/「返回地图」都会退出到 2D 地图
 * 并定位到对应经纬度）。照片位置以光点显示在地球上。
 *
 * 依赖：index.html 通过 CDN 引入 three.min.js（暴露全局 THREE）。
 */

const GLOBE_RADIUS = 100;
const PLANE_W = 2 * Math.PI * GLOBE_RADIUS;   // 等距矩形展开宽 = 球周长
const PLANE_H = Math.PI * GLOBE_RADIUS;       // 高 = 半周长
const SEG_X = 128, SEG_Y = 64;                 // 网格细分
const EARTH_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const CAM_START = 300;
const CAM_MIN = 150;
const CAM_MAX = 600;
const MORPH_IN_MS = 1100;
const MORPH_OUT_MS = 850;

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

class GlobeView {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.onExit = options.onExit || (() => {});
        this.active = false;
        this.photos = [];
        this._inited = false;
        this._raf = null;
        this._trans = null;          // 进行中的过渡动画
        this._morph = 1;             // 当前形态：0=平面 1=球面
        this._dragging = false;
        this._moved = false;
        this._last = { x: 0, y: 0 };
        this._autoRotate = true;
        this._onResize = this._onResize.bind(this);
        this._tick = this._tick.bind(this);
    }

    get available() { return typeof window.THREE !== 'undefined'; }
    isActive() { return this.active; }
    get transitioning() { return !!this._trans; }

    _init() {
        if (this._inited) return;
        const THREE = window.THREE;
        const w = this.container.clientWidth || 800;
        const h = this.container.clientHeight || 600;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000);
        this.camera.position.set(0, 0, CAM_START);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(w, h);
        this.container.appendChild(this.renderer.domElement);

        this._addStars(THREE);

        // 地球组（拖动旋转的是这个组）
        this.earth = new THREE.Group();
        this.scene.add(this.earth);

        this._buildEarthMesh(THREE);

        // 大气辉光（随 morph 渐显）
        this.atmo = new THREE.Mesh(
            new THREE.SphereGeometry(GLOBE_RADIUS * 1.02, 48, 48),
            new THREE.MeshBasicMaterial({ color: 0x3a7bd5, transparent: true, opacity: 0, side: THREE.BackSide })
        );
        this.earth.add(this.atmo);

        this.pointsGroup = new THREE.Group();
        this.earth.add(this.pointsGroup);
        this._raycaster = new THREE.Raycaster();

        this._bindEvents();
        this._buildPoints();
        this._inited = true;
    }

    /** 构建可形变的经纬网格：保存平面与球面两套顶点坐标 */
    _buildEarthMesh(THREE) {
        const nv = (SEG_X + 1) * (SEG_Y + 1);
        this._flat = new Float32Array(nv * 3);
        this._sph = new Float32Array(nv * 3);
        const pos = new Float32Array(nv * 3);
        const uv = new Float32Array(nv * 2);
        let k = 0, t = 0;
        for (let j = 0; j <= SEG_Y; j++) {
            const fy = j / SEG_Y;          // 0(顶,北极)→1(底,南极)
            const lat = 90 - fy * 180;
            for (let i = 0; i <= SEG_X; i++) {
                const fx = i / SEG_X;      // 0(左,-180)→1(右,180)
                const lng = -180 + fx * 360;
                // 平面坐标（等距矩形）
                this._flat[k] = (lng / 360) * PLANE_W;
                this._flat[k + 1] = (lat / 180) * PLANE_H;
                this._flat[k + 2] = 0;
                // 球面坐标
                const v = this._latLngToVec(lat, lng, GLOBE_RADIUS);
                this._sph[k] = v.x; this._sph[k + 1] = v.y; this._sph[k + 2] = v.z;
                pos[k] = this._sph[k]; pos[k + 1] = this._sph[k + 1]; pos[k + 2] = this._sph[k + 2];
                uv[t] = fx; uv[t + 1] = 1 - fy;   // 纹理 v 翻转，使北极对纹理顶部
                k += 3; t += 2;
            }
        }
        const idx = [];
        for (let j = 0; j < SEG_Y; j++) {
            for (let i = 0; i < SEG_X; i++) {
                const a = j * (SEG_X + 1) + i, b = a + 1, c = a + (SEG_X + 1), d = c + 1;
                idx.push(a, c, b, b, c, d);
            }
        }
        const g = new THREE.BufferGeometry();
        this._posAttr = new THREE.BufferAttribute(pos, 3);
        g.setAttribute('position', this._posAttr);
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeBoundingSphere();

        const tex = new THREE.TextureLoader().load(EARTH_TEXTURE);
        if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
        this.earthMesh = new THREE.Mesh(g, mat);
        this.earth.add(this.earthMesh);
    }

    /** 设置形态：0=平面，1=球面（顶点在两套坐标间插值） */
    _setMorph(t) {
        this._morph = t;
        const f = this._flat, s = this._sph, p = this._posAttr.array;
        for (let i = 0; i < p.length; i++) p[i] = f[i] + (s[i] - f[i]) * t;
        this._posAttr.needsUpdate = true;
        this.earthMesh.geometry.computeBoundingSphere();
        if (this.atmo) this.atmo.material.opacity = 0.12 * t;
        if (this.pointsGroup) this.pointsGroup.visible = t > 0.92;
    }

    _addStars(THREE) {
        const g = new THREE.BufferGeometry();
        const n = 1500, pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const r = 2000 + Math.random() * 2000;
            const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1);
            pos[i * 3] = r * Math.sin(b) * Math.cos(a);
            pos[i * 3 + 1] = r * Math.sin(b) * Math.sin(a);
            pos[i * 3 + 2] = r * Math.cos(b);
        }
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false })));
    }

    _latLngToVec(lat, lng, radius) {
        const THREE = window.THREE;
        const phi = (90 - lat) * Math.PI / 180;
        const theta = (lng + 180) * Math.PI / 180;
        return new THREE.Vector3(
            -radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        );
    }

    _vecToLatLng(v) {
        const r = v.length();
        const lat = 90 - Math.acos(v.y / r) * 180 / Math.PI;
        let lng = Math.atan2(v.z, -v.x) * 180 / Math.PI - 180;
        while (lng < -180) lng += 360;
        while (lng > 180) lng -= 360;
        return { lat, lng };
    }

    _faceRotation(lat, lng) {
        return { x: lat * Math.PI / 180, y: -((lng + 90) * Math.PI / 180) };
    }

    _buildPoints() {
        const THREE = window.THREE;
        while (this.pointsGroup.children.length) this.pointsGroup.remove(this.pointsGroup.children[0]);
        const pts = this.photos.filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number'
            && !(p.lat === 0 && p.lng === 0));
        if (!pts.length) return;
        const positions = new Float32Array(pts.length * 3);
        pts.forEach((p, i) => {
            const v = this._latLngToVec(p.lat, p.lng, GLOBE_RADIUS * 1.01);
            positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.pointsGroup.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff5a3c, size: 3.5, sizeAttenuation: false })));
    }

    _bindEvents() {
        const el = this.renderer.domElement;
        el.style.cursor = 'grab';
        el.addEventListener('mousedown', (e) => {
            if (this._trans) return;
            this._dragging = true; this._moved = false; this._autoRotate = false;
            this._last = { x: e.clientX, y: e.clientY }; el.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (!this._dragging) return;
            const dx = e.clientX - this._last.x, dy = e.clientY - this._last.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) this._moved = true;
            this._last = { x: e.clientX, y: e.clientY };
            this.earth.rotation.y += dx * 0.005;
            this.earth.rotation.x += dy * 0.005;
            this.earth.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.earth.rotation.x));
        });
        window.addEventListener('mouseup', () => {
            if (!this._dragging) return;
            this._dragging = false; el.style.cursor = 'grab';
        });
        el.addEventListener('click', (e) => {
            if (this._trans || this._moved) return;
            const ll = this._pickLatLng(e.offsetX, e.offsetY);
            if (ll) this._exit(ll);
        });
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (this._trans) return;
            this._autoRotate = false;
            this.camera.position.z += (e.deltaY > 0 ? 1 : -1) * 25;
            if (this.camera.position.z <= CAM_MIN) { this._exit(this._centerLatLng()); return; }
            this.camera.position.z = Math.min(CAM_MAX, this.camera.position.z);
        }, { passive: false });
        window.addEventListener('resize', this._onResize);

        const back = document.getElementById('globe-back-btn');
        if (back) back.addEventListener('click', () => { if (!this._trans) this._exit(this._centerLatLng()); });
    }

    _pickLatLng(px, py) {
        const THREE = window.THREE;
        const rect = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
        this._raycaster.setFromCamera(ndc, this.camera);
        const hit = this._raycaster.intersectObject(this.earthMesh, false)[0];
        if (!hit) return null;
        const local = this.earth.worldToLocal(hit.point.clone());
        local.setLength(GLOBE_RADIUS);
        return this._vecToLatLng(local);
    }

    _centerLatLng() {
        return this._pickLatLng(this.renderer.domElement.clientWidth / 2, this.renderer.domElement.clientHeight / 2)
            || { lat: 20, lng: 0 };
    }

    _onResize() {
        if (!this.active || !this._inited) return;
        const w = this.container.clientWidth, h = this.container.clientHeight;
        this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    _tick(now) {
        if (!this.active) return;
        if (this._trans) {
            const tr = this._trans;
            const raw = Math.min(1, (now - tr.start) / tr.dur);
            const e = easeInOut(raw);
            this._setMorph(tr.from + (tr.to - tr.from) * e);
            this.earth.rotation.x = tr.rotFrom.x + (tr.rotTo.x - tr.rotFrom.x) * e;
            this.earth.rotation.y = tr.rotFrom.y + (tr.rotTo.y - tr.rotFrom.y) * e;
            this.earth.rotation.z = 0;
            if (this.container.style.opacity !== '' && tr.fadeIn) {
                this.container.style.opacity = String(Math.min(1, raw / 0.4));
            }
            if (raw >= 1) { this._trans = null; if (tr.onDone) tr.onDone(); }
        } else if (this._autoRotate && !this._dragging) {
            this.earth.rotation.y += 0.0015;
        }
        this.renderer.render(this.scene, this.camera);
        this._raf = requestAnimationFrame(this._tick);
    }

    setPhotos(photos) {
        this.photos = Array.isArray(photos) ? photos : [];
        if (this._inited) this._buildPoints();
    }

    /** 进入：从平面顺滑卷成地球并转到 (focusLat,focusLng) */
    show(photos, focusLat = 20, focusLng = 0) {
        if (!this.available) { console.warn('[GlobeView] THREE 未加载'); return false; }
        if (photos) this.photos = photos;
        this.container.classList.remove('hidden');
        this.container.style.opacity = '0';
        this._init();
        this._buildPoints();
        this.active = true;
        this._onResize();
        this.camera.position.z = CAM_START;
        this._autoRotate = false;
        // 起始：平面、无旋转；结束：球面、正对目标
        this._setMorph(0);
        this.earth.rotation.set(0, 0, 0);
        const rotTo = this._faceRotation(focusLat, focusLng);
        this._trans = {
            from: 0, to: 1, dur: MORPH_IN_MS, start: performance.now(),
            rotFrom: { x: 0, y: 0 }, rotTo, fadeIn: true,
            onDone: () => { this.container.style.opacity = '1'; this._autoRotate = true; }
        };
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = requestAnimationFrame(this._tick);
        return true;
    }

    /** 退出：地球摊平回平面后回到 2D 地图（定位到 ll） */
    _exit(ll) {
        if (this._trans) return;
        this._autoRotate = false;
        this._trans = {
            from: this._morph, to: 0, dur: MORPH_OUT_MS, start: performance.now(),
            rotFrom: { x: this.earth.rotation.x, y: this.earth.rotation.y },
            rotTo: { x: 0, y: 0 }, fadeIn: false,
            onDone: () => { this.hide(); this.onExit(ll.lat, ll.lng); }
        };
    }

    hide() {
        this.active = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        this._trans = null;
        if (this.container) { this.container.classList.add('hidden'); this.container.style.opacity = '1'; }
    }
}

module.exports = GlobeView;
