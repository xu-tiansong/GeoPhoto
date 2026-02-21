/**
 * MapManager.js - 地图管理类 (渲染器端)
 * 管理Leaflet地图、标记、聚合、绘图工具等
 */

const ThumbnailGenerator = require('./ThumbnailGenerator');
const i18n = require('./i18n');

class MapManager {
    constructor(ipcRenderer, mapElementId = 'map') {
        this.ipcRenderer = ipcRenderer;
        this.mapElementId = mapElementId;
        
        // 状态标志
        this.isRestoringState = false;
        this.isLoadingMarkers = false;
        this.currentPhotosCache = [];
        this.cityCache = new Map();
        
        // 逆地理编码请求队列和速率限制
        this.geocodeQueue = [];
        this.isProcessingQueue = false;
        this.lastGeocodingTime = 0;
        this.geocodingInterval = 1500; // Nominatim 要求每秒最多1次请求，设1.5秒更安全
        
        // 防抖定时器
        this.saveMapStateTimeout = null;
        
        // 初始化地图
        this.initMap();
        this.initTileLayers();
        this.initDrawTools();
        this.initMarkerCluster();
        this.initEvents();
    }

    /**
     * 初始化地图
     */
    initMap() {
        this.map = L.map(this.mapElementId, { center: [20, 0], zoom: 2 });
        // 自定义 pane，使地标小红旗始终在最上层（高于 markerPane 的 z-index 600）
        this.map.createPane('landmarkPane').style.zIndex = 650;
    }

    /**
     * 初始化地图图层
     */
    initTileLayers() {
        // 卫星底图
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        }).addTo(this.map);

        // 标签图层
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
            subdomains: 'abcd',
            pane: 'overlayPane'
        }).addTo(this.map);
    }

    /**
     * 初始化绘图工具
     */
    initDrawTools() {
        this.drawnItems = new L.FeatureGroup();
        this.map.addLayer(this.drawnItems);

        this.drawControl = new L.Control.Draw({
            draw: {
                polyline: false,
                polygon: false,
                circle: false,
                marker: false,
                circlemarker: false,
                rectangle: {
                    shapeOptions: {
                        color: '#ff7800',
                        weight: 2
                    }
                }
            },
            edit: false // 禁用编辑和删除按钮
        });
        this.map.addControl(this.drawControl);
    }

    /**
     * 初始化标记聚合
     */
    initMarkerCluster() {
        this.markersLayer = L.markerClusterGroup({
            chunkedLoading: true,
            chunkInterval: 100,
            chunkDelay: 50,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 50,
            disableClusteringAtZoom: 18,
            animate: false
        });
        this.map.addLayer(this.markersLayer);
    }

    /**
     * 初始化事件监听
     */
    initEvents() {
        // 地图移动和缩放事件
        this.map.on('moveend', () => {
            this.saveMapState();
            this._updateLandmarkCircleOpacity();
        });
        this.map.on('zoomend', () => {
            this.saveMapState();
            this._updateLandmarkCircleOpacity();
        });

        // 矩形选框事件
        this.map.on(L.Draw.Event.CREATED, (e) => this.onRectangleCreated(e));
    }

    /**
     * 判断地图当前可视范围的四个角是否都在圆形内部
     */
    _isBoundsInsideCircle(bounds, centerLatLng, radiusMeters) {
        return [
            bounds.getNorthWest(),
            bounds.getNorthEast(),
            bounds.getSouthEast(),
            bounds.getSouthWest()
        ].every(corner => centerLatLng.distanceTo(corner) < radiusMeters);
    }

    /**
     * 根据当前地图视野更新地标圆形透明度：
     * 当整个可视区域在圆形内部（看不到边框）时，圆形全透明
     */
    _updateLandmarkCircleOpacity() {
        if (!this._landmarkCircles || this._landmarkCircles.length === 0) return;
        const bounds = this.map.getBounds();
        for (const { circle, centerLatLng, radius, color } of this._landmarkCircles) {
            if (this._isBoundsInsideCircle(bounds, centerLatLng, radius)) {
                circle.setStyle({ opacity: 0, fillOpacity: 0 });
            } else {
                circle.setStyle({ opacity: 0.6, fillOpacity: 0.15, color, fillColor: color });
            }
        }
    }

    /**
     * 保存地图状态（防抖）
     */
    saveMapState() {
        if (this.isRestoringState) return;
        
        if (this.saveMapStateTimeout) clearTimeout(this.saveMapStateTimeout);
        this.saveMapStateTimeout = setTimeout(async () => {
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            try {
                await this.ipcRenderer.invoke('save-map-state', {
                    lat: center.lat,
                    lng: center.lng,
                    zoom: zoom
                });
                console.log('地图状态已保存:', { lat: center.lat, lng: center.lng, zoom });
            } catch (error) {
                console.error('保存地图状态失败:', error);
            }
        }, 500);
    }

    /**
     * 恢复地图状态
     */
    async restoreState() {
        this.isRestoringState = true;
        try {
            const mapState = await this.ipcRenderer.invoke('load-map-state');
            if (mapState && typeof mapState.lat === 'number' && 
                typeof mapState.lng === 'number' && typeof mapState.zoom === 'number') {
                this.map.setView([mapState.lat, mapState.lng], mapState.zoom);
                console.log('地图状态已恢复:', mapState);
            } else {
                console.log('没有保存的地图状态，使用默认视图');
            }
        } catch (error) {
            console.error('恢复地图状态失败:', error);
        }
        
        setTimeout(() => {
            this.isRestoringState = false;
            console.log('地图状态恢复完成，开始监听变化');
        }, 1000);
    }

    /**
     * 逆地理编码获取城市名称（带速率限制）
     */
    async getCityName(lat, lng) {
        const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
        
        // 已有缓存直接返回
        if (this.cityCache.has(cacheKey)) {
            return this.cityCache.get(cacheKey);
        }
        
        // 加入队列等待处理
        return new Promise((resolve) => {
            this.geocodeQueue.push({ lat, lng, cacheKey, resolve });
            this.processGeocodeQueue();
        });
    }

    /**
     * 处理逆地理编码队列（速率限制：每秒最多1次）
     */
    async processGeocodeQueue() {
        if (this.isProcessingQueue || this.geocodeQueue.length === 0) {
            return;
        }
        
        this.isProcessingQueue = true;
        
        while (this.geocodeQueue.length > 0) {
            const { lat, lng, cacheKey, resolve } = this.geocodeQueue.shift();
            
            // 如果已有缓存，直接返回
            if (this.cityCache.has(cacheKey)) {
                resolve(this.cityCache.get(cacheKey));
                continue;
            }
            
            // 计算需要等待的时间
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastGeocodingTime;
            if (timeSinceLastRequest < this.geocodingInterval) {
                await new Promise(r => setTimeout(r, this.geocodingInterval - timeSinceLastRequest));
            }
            
            try {
                this.lastGeocodingTime = Date.now();
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&accept-language=zh`,
                    { headers: { 'User-Agent': 'GeoPhoto/1.0' } }
                );
                
                // 检查响应状态
                if (!response.ok) {
                    if (response.status === 429) {
                        // 遇到429错误，加大等待时间并重试
                        console.log('Nominatim API 限流，等待重试...');
                        this.geocodeQueue.unshift({ lat, lng, cacheKey, resolve });
                        await new Promise(r => setTimeout(r, 5000));
                        continue;
                    }
                    // 其他错误状态
                    console.log(`逆地理编码HTTP错误: ${response.status}`);
                    resolve(i18n.t('map.unknownLocation'));
                    continue;
                }
                
                // 检查content-type是否为JSON
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    console.log('逆地理编码返回非JSON响应');
                    resolve(i18n.t('map.unknownLocation'));
                    continue;
                }
                
                const data = await response.json();
                
                // 检查是否有错误信息
                if (data.error) {
                    console.log('逆地理编码API错误:', data.error);
                    resolve(i18n.t('map.unknownLocation'));
                    continue;
                }
                
                const address = data.address || {};
                const cityName = address.city || address.town || address.county || 
                                 address.state || address.country || i18n.t('map.unknownLocation');
                
                this.cityCache.set(cacheKey, cityName);
                resolve(cityName);
            } catch (error) {
                console.log('逆地理编码失败:', error);
                resolve(i18n.t('map.unknownLocation'));
            }
        }
        
        this.isProcessingQueue = false;
    }

    /**
     * 格式化日期时间
     */
    formatDateTime(timeStr) {
        if (!timeStr) return { date: i18n.t('map.unknownDate'), time: '' };
        const d = new Date(timeStr);
        if (isNaN(d.getTime())) return { date: i18n.t('map.unknownDate'), time: '' };

        const date = i18n.t('date.format', {
            year: d.getFullYear(),
            month: d.getMonth() + 1,
            day: d.getDate()
        });
        const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        return { date, time };
    }

    /**
     * 创建缩略图 Tooltip HTML
     */
    createThumbnailTooltip(photo) {
        const uniqueId = `thumb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const cityId = `city-${uniqueId}`;
        
        // 获取缩略图路径
        const filePath = photo.fullPath || `${photo.directory}/${photo.filename}`;
        const isVideo = photo.type === 'video';
        const thumbnailInfo = ThumbnailGenerator.getThumbnailPath(filePath);
        const displayPath = thumbnailInfo.path;
        const fileUrl = ThumbnailGenerator.toFileUrl(displayPath);
        
        const { date, time } = this.formatDateTime(photo.time);
        const dateTimeStr = time ? `${date} ${time}` : date;
        
        // Like图标
        const likeIcon = photo.like ? '<span style="color:#ff6b6b;margin-left:6px;">♥</span>' : '';
        
        if (photo.lat && photo.lng) {
            setTimeout(async () => {
                const cityName = await this.getCityName(photo.lat, photo.lng);
                const cityEl = document.getElementById(cityId);
                if (cityEl) {
                    cityEl.textContent = cityName;
                }
            }, 0);
        }
        
        const infoHtml = `
            <div class="tooltip-info">
                <div class="tooltip-datetime">${dateTimeStr}${likeIcon}</div>
                <div class="tooltip-city" id="${cityId}">${photo.lat && photo.lng ? i18n.t('map.loading') : i18n.t('map.noLocation')}</div>
            </div>
        `;
        
        if (isVideo) {
            // 如果有缩略图，直接显示图片
            if (thumbnailInfo.isThumbnail) {
                return `
                    <div class="photo-tooltip">
                        <div class="thumbnail-wrapper" id="${uniqueId}" style="width:224px;height:224px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#000;position:relative;">
                            <img src="${fileUrl}" 
                                 style="width:224px;height:224px;object-fit:cover;"
                                 onload="generateImageThumbnail(this)"
                                 onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:224px;height:224px;background:#333;display:flex;align-items:center;justify-content:center;\\'><div class=\\'video-play-icon\\'></div></div>';" />
                            <div class="video-play-icon"></div>
                        </div>
                        ${infoHtml}
                    </div>
                `;
            } else {
                return `
                    <div class="photo-tooltip">
                        <div class="thumbnail-wrapper" id="${uniqueId}" style="width:224px;height:224px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#000;position:relative;">
                            <video src="${fileUrl}" 
                                   style="width:224px;height:224px;object-fit:cover;"
                                   data-original-path="${filePath}"
                                   onloadedmetadata="generateVideoThumbnail(this);"
                                   onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:224px;height:224px;background:#333;display:flex;align-items:center;justify-content:center;\\'><div class=\\'video-play-icon\\'></div></div>';" 
                                   muted preload="metadata">
                            </video>
                            <div class="video-play-icon"></div>
                        </div>
                        ${infoHtml}
                    </div>
                `;
            }
        } else {
            return `
                <div class="photo-tooltip">
                    <div class="thumbnail-wrapper" style="width:224px;height:224px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#000;">
                        <img src="${fileUrl}" 
                             data-original-path="${filePath}"
                             data-is-thumbnail="${thumbnailInfo.isThumbnail}"
                             style="width:224px;height:224px;object-fit:cover;"
                             onload="generateImageThumbnail(this);"
                             onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:224px;height:224px;background:#333;display:flex;align-items:center;justify-content:center;color:#999;\\'>无法加载</div>';">
                    </div>
                    ${infoHtml}
                </div>
            `;
        }
    }

    /**
     * 根据时间范围加载照片标记
     */
    async loadMarkersByTimeRange(startTime, endTime) {
        if (this.isLoadingMarkers) return;
        this.isLoadingMarkers = true;
        
        try {
            // 确保是有效的Date对象
            const start = startTime instanceof Date ? startTime : new Date(startTime);
            const end = endTime instanceof Date ? endTime : new Date(endTime);
            
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                console.error('Invalid time range:', startTime, endTime);
                this.isLoadingMarkers = false;
                return;
            }
            
            const photos = await this.ipcRenderer.invoke('query-photos-by-time', {
                startTime: start.toISOString(),
                endTime: end.toISOString()
            });
            
            console.log(`加载照片: ${photos.length} 张 (${start.toISOString()} - ${end.toISOString()})`);
            
            this.currentPhotosCache = photos;
            this.markersLayer.clearLayers();
            
            const locationCount = new Map();
            const markers = [];
            
            // 默认坐标：54°24′25″S 3°17′16″E
            const DEFAULT_LAT = -54.406944;
            const DEFAULT_LNG = 3.287778;
            
            photos.forEach((photo, index) => {
                // 如果没有有效的经纬度，使用默认坐标
                let photoLat = (photo.lat && typeof photo.lat === 'number') ? photo.lat : DEFAULT_LAT;
                let photoLng = (photo.lng && typeof photo.lng === 'number') ? photo.lng : DEFAULT_LNG;
                
                const locKey = `${photoLat.toFixed(5)},${photoLng.toFixed(5)}`;
                const count = locationCount.get(locKey) || 0;
                locationCount.set(locKey, count + 1);
                
                let lat = photoLat;
                let lng = photoLng;
                if (count > 0) {
                    const angle = count * 0.5;
                    const offset = 0.00002 * count;
                    lat += offset * Math.cos(angle);
                    lng += offset * Math.sin(angle);
                }
                
                const marker = L.marker([lat, lng]);
                    const markerId = `marker-${photo.id || index}-${Date.now()}`;
                    marker._markerId = markerId;
                    marker.photoData = JSON.parse(JSON.stringify(photo));
                    
                    marker.on('mouseover', function() {
                        if (!this._tooltipBound) {
                            const photoInfo = this.photoData;
                            this.bindTooltip(this._mapManager.createThumbnailTooltip(photoInfo), {
                                direction: 'top',
                                offset: [0, -10],
                                opacity: 1,
                                className: 'photo-tooltip-container'
                            });
                            this._tooltipBound = true;
                            this.openTooltip();
                        }
                    });
                    
                    // 点击事件：打开照片窗口（支持照片和视频）
                    marker.on('click', async function() {
                        const photoData = this.photoData;
                        await this._mapManager.ipcRenderer.invoke('open-photo-window', photoData);
                    });
                    
                    marker._mapManager = this;
                    markers.push(marker);
                });
            
            this.markersLayer.addLayers(markers);
            
            console.log(`已加载 ${photos.length} 个标记 (${startTime.toLocaleDateString()} - ${endTime.toLocaleDateString()})`);
        } catch (error) {
            console.error('加载标记出错:', error);
        } finally {
            this.isLoadingMarkers = false;
        }
    }

    /**
     * 加载所有照片标记
     */
    async loadAllMarkers() {
        try {
            const photos = await this.ipcRenderer.invoke('get-all-photos');
            this.currentPhotosCache = photos;
            this.markersLayer.clearLayers();
            
            const locationCount = new Map();
            const markers = [];
            
            // 默认坐标：54°24′25″S 3°17′16″E
            const DEFAULT_LAT = -54.406944;
            const DEFAULT_LNG = 3.287778;
            
            photos.forEach((photo, index) => {
                // 如果没有有效的经纬度，使用默认坐标
                let photoLat = (photo.lat && typeof photo.lat === 'number') ? photo.lat : DEFAULT_LAT;
                let photoLng = (photo.lng && typeof photo.lng === 'number') ? photo.lng : DEFAULT_LNG;
                
                const locKey = `${photoLat.toFixed(5)},${photoLng.toFixed(5)}`;
                const count = locationCount.get(locKey) || 0;
                locationCount.set(locKey, count + 1);
                
                let lat = photoLat;
                let lng = photoLng;
                if (count > 0) {
                    const angle = count * 0.5;
                    const offset = 0.00002 * count;
                    lat += offset * Math.cos(angle);
                    lng += offset * Math.sin(angle);
                }
                
                const marker = L.marker([lat, lng]);
                    const markerId = `marker-${photo.id || index}-${Date.now()}`;
                    marker._markerId = markerId;
                    marker.photoData = JSON.parse(JSON.stringify(photo));
                    
                    marker.on('mouseover', function() {
                        if (!this._tooltipBound) {
                            const photoInfo = this.photoData;
                            this.bindTooltip(this._mapManager.createThumbnailTooltip(photoInfo), {
                                direction: 'top',
                                offset: [0, -10],
                                opacity: 1,
                                className: 'photo-tooltip-container'
                            });
                            this._tooltipBound = true;
                            this.openTooltip();
                        }
                    });
                    
                    // 点击事件：打开照片窗口（支持照片和视频）
                    marker.on('click', async function() {
                        const photoData = this.photoData;
                        await this._mapManager.ipcRenderer.invoke('open-photo-window', photoData);
                    });
                    
                    marker._mapManager = this;
                    markers.push(marker);
            });
            
            this.markersLayer.addLayers(markers);
        } catch (error) {
            console.error('加载标记出错:', error);
        }
    }

    /**
     * 矩形选框创建事件处理
     */
    async onRectangleCreated(e) {
        const layer = e.layer;
        this.drawnItems.clearLayers();
        this.drawnItems.addLayer(layer);

        const bounds = layer.getBounds();
        
        const range = {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        };

        const areaPhotos = await this.ipcRenderer.invoke('query-area', range);
        
        console.log("区域内照片列表:", areaPhotos);
        
        // 如果有照片，打开照片管理窗口
        if (areaPhotos && areaPhotos.length > 0) {
            await this.ipcRenderer.invoke('open-photos-manage-window', {
                tab: 'selected',
                photos: areaPhotos,
                bounds: range
            });
        } else {
            alert(i18n.t('map.noPhotosInArea'));
        }
    }

    /**
     * 设置地图视图
     */
    setView(lat, lng, zoom) {
        this.map.setView([lat, lng], zoom);
    }

    /**
     * 获取当前地图视图中心
     */
    getCenter() {
        return this.map.getCenter();
    }

    /**
     * 获取当前缩放级别
     */
    getZoom() {
        return this.map.getZoom();
    }

    /**
     * 清除所有标记
     */
    clearMarkers() {
        this.markersLayer.clearLayers();
    }

    /**
     * 获取当前缓存的照片数据
     */
    getCachedPhotos() {
        return this.currentPhotosCache;
    }

    /**
     * 更新指定照片在地图上的标记位置
     * 当照片通过地标 tag 获得坐标时调用
     * @param {number} photoId
     * @param {number} newLat
     * @param {number} newLng
     */
    updatePhotoMarkerLocation(photoId, newLat, newLng) {
        // 在 markersLayer 中找到对应标记并移除
        let photoData = null;
        for (const layer of this.markersLayer.getLayers()) {
            if (layer.photoData && layer.photoData.id === photoId) {
                photoData = layer.photoData;
                this.markersLayer.removeLayer(layer);
                break;
            }
        }

        // 同步更新缓存
        const cached = this.currentPhotosCache.find(p => p.id === photoId);
        if (cached) {
            cached.lat = newLat;
            cached.lng = newLng;
        }

        // 若找不到该照片的标记（不在当前显示范围）则不需要创建新标记
        if (!photoData) return;

        photoData.lat = newLat;
        photoData.lng = newLng;

        const marker = L.marker([newLat, newLng]);
        marker.photoData = JSON.parse(JSON.stringify(photoData));
        marker.on('mouseover', function() {
            if (!this._tooltipBound) {
                this.bindTooltip(this._mapManager.createThumbnailTooltip(this.photoData), {
                    direction: 'top',
                    offset: [0, -10],
                    opacity: 1,
                    className: 'photo-tooltip-container'
                });
                this._tooltipBound = true;
                this.openTooltip();
            }
        });
        marker.on('click', async function() {
            await this._mapManager.ipcRenderer.invoke('open-photo-window', this.photoData);
        });
        marker._mapManager = this;
        this.markersLayer.addLayer(marker);
    }

    /**
     * 清除地图上的矩形选框
     */
    clearRectangle() {
        if (this.drawnItems) {
            this.drawnItems.clearLayers();
            console.log('矩形选框已清除');
        }
    }

    /**
     * 加载地标标签并在地图上显示圆形覆盖区域
     */
    async loadLocationTags() {
        try {
            const tags = await this.ipcRenderer.invoke('get-location-tags');
            if (!tags || tags.length === 0) return;

            if (this._locationTagsLayer) {
                this.map.removeLayer(this._locationTagsLayer);
            }
            this._locationTagsLayer = L.layerGroup().addTo(this.map);

            const flagIcon = L.divIcon({
                html: '<span style="font-size:18px;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))">&#x1F6A9;</span>',
                className: '',
                iconSize: [18, 18],
                iconAnchor: [4, 18]
            });

            this._landmarkCircles = [];
            for (const tag of tags) {
                const color = tag.color || '#e53935';
                const radius = tag.radius || 10;
                const centerLatLng = L.latLng(tag.lat, tag.lng);
                const circle = L.circle(centerLatLng, {
                    radius,
                    color: color,
                    weight: 1.5,
                    fillColor: color,
                    fillOpacity: 0.15,
                    opacity: 0.6
                });
                circle.bindTooltip(tag.name, { direction: 'top', offset: [0, -4] });
                circle.addTo(this._locationTagsLayer);
                this._landmarkCircles.push({ circle, centerLatLng, radius, color });

                const flag = L.marker(centerLatLng, { icon: flagIcon, interactive: false, pane: 'landmarkPane' });
                flag.addTo(this._locationTagsLayer);
            }
            this._updateLandmarkCircleOpacity();
            console.log(`已加载 ${tags.length} 个地标标签到地图`);
        } catch (e) {
            console.error('加载地标标签失败:', e);
        }
    }
}

// 全局辅助函数（用于 HTML 内联事件）
// 缩略图已使用固定正方形尺寸和 object-fit:cover，不再需要动态调整

// 生成图片缩略图
window.generateImageThumbnail = function(img) {
    const isThumbnail = img.dataset.isThumbnail === 'true';
    const originalPath = img.dataset.originalPath;

    if (!isThumbnail && originalPath) {
        // 异步生成缩略图
        ThumbnailGenerator.generateAndSaveThumbnail(img, originalPath).catch(err => {
            console.error('生成缩略图失败:', err);
        });
    }
};

// 生成视频缩略图
window.generateVideoThumbnail = function(video) {
    const originalPath = video.dataset.originalPath;

    if (originalPath) {
        video.addEventListener('seeked', () => {
            ThumbnailGenerator.generateAndSaveThumbnail(video, originalPath).catch(err => {
                console.error('生成视频缩略图失败:', err);
            });
        }, { once: true });
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapManager;
}
