/**
 * TakeoutMetadata.js - Google Takeout 附带元数据（*.supplemental-metadata.json）解析
 *
 * 解决两个现实问题：
 * 1. Takeout 把 json 文件名截断到 51 字符（含 .json），且重复文件的序号会从媒体文件名
 *    挪到 json 文件名末尾：IMG_3705(1).JPG -> IMG_3705.JPG.supplemental-metadata(1).json
 * 2. Takeout 按体积切分压缩包时，媒体文件和它的 json 可能落在不同的分卷目录里
 *    （实测该用户库中约 23% 的媒体文件需要跨目录才能找到 json），因此不能只在同目录查找。
 */

const fs = require('fs');
const path = require('path');

// json 文件名词干上限：Takeout 总长限制 51 字符，减去 '.json'
const MAX_STEM = 46;
const SUFFIX = '.supplemental-metadata';

/**
 * 拆出文件名里的重复序号：'IMG_3705(1).JPG' -> { canonical: 'IMG_3705.JPG', dup: '1' }
 */
function splitDupMarker(filename) {
    const m = /^(.*)\((\d+)\)(\.[^.]*)$/.exec(filename);
    if (m) return { canonical: m[1] + m[3], dup: m[2] };
    return { canonical: filename, dup: null };
}

/**
 * 生成某个媒体文件所有可能的 json 文件名，按可信度从高到低排列
 */
function sidecarCandidates(filename) {
    const { canonical, dup } = splitDupMarker(filename);
    const tail = dup ? `(${dup}).json` : '.json';

    const names = [
        (canonical + SUFFIX).slice(0, MAX_STEM) + tail,  // 标准（含截断）
        canonical + tail,                                 // 旧版 Takeout：<文件名>.json
        canonical.slice(0, MAX_STEM) + tail               // 文件名本身超长被截断
    ];

    // 媒体文件带 (N) 但 json 没有的情况
    if (dup) names.push((canonical + SUFFIX).slice(0, MAX_STEM) + '.json');

    return [...new Set(names)];
}

/**
 * 判断是否为 Takeout 元数据 json（用于扫描时建立索引，排除相册说明等其它 json）
 */
function isSidecarJson(filename) {
    return /\.json$/i.test(filename);
}

function validLat(v) {
    return typeof v === 'number' && isFinite(v) && v >= -90 && v <= 90;
}

function validLng(v) {
    return typeof v === 'number' && isFinite(v) && v >= -180 && v <= 180;
}

/**
 * 解析一个 json，取出拍摄时间与坐标
 * @returns {{time: string|null, lat: number|null, lng: number|null, title: string|null}|null}
 */
function parseSidecar(fullPath) {
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (_) {
        return null;
    }
    if (!raw || typeof raw !== 'object') return null;

    let time = null;
    const ts = raw.photoTakenTime && raw.photoTakenTime.timestamp;
    if (ts) {
        const seconds = parseInt(ts, 10);
        if (!isNaN(seconds) && seconds > 0) time = new Date(seconds * 1000).toISOString();
    }

    let lat = null;
    let lng = null;
    for (const geo of [raw.geoData, raw.geoDataExif]) {
        if (!geo) continue;
        // Takeout 无定位时填 0/0，不能当作真实坐标
        if (validLat(geo.latitude) && validLng(geo.longitude) && (geo.latitude !== 0 || geo.longitude !== 0)) {
            lat = geo.latitude;
            lng = geo.longitude;
            break;
        }
    }

    if (time === null && lat === null) return null;
    return { time, lat, lng, title: typeof raw.title === 'string' ? raw.title : null };
}

function sameMeta(a, b) {
    return a.time === b.time && a.lat === b.lat && a.lng === b.lng;
}

/**
 * Takeout json 索引：json 文件名 -> 所在的相对目录列表
 */
class TakeoutIndex {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.byName = new Map();
        this.parseCache = new Map();
        this.stats = { sameDir: 0, crossDir: 0, ambiguous: 0, missing: 0 };
    }

    /**
     * 扫描目录时逐个登记发现的 json（与媒体文件同一趟遍历，无额外 IO）
     */
    add(relativeDir, filename) {
        const dirs = this.byName.get(filename);
        if (dirs) dirs.push(relativeDir);
        else this.byName.set(filename, [relativeDir]);
    }

    get size() {
        return this.byName.size;
    }

    _read(relativeDir, name) {
        const full = path.join(this.baseDir, relativeDir, name);
        if (this.parseCache.has(full)) return this.parseCache.get(full);
        const meta = parseSidecar(full);
        this.parseCache.set(full, meta);
        return meta;
    }

    /**
     * 查出某个媒体文件对应的元数据
     * 优先级：同目录 > 跨目录唯一命中 > 跨目录多个候选且内容一致
     * 多个候选内容不一致时放弃（宁可不改，也不写错数据）
     * @returns {{time: string|null, lat: number|null, lng: number|null}|null}
     */
    lookup(relativeDir, filename) {
        const candidates = sidecarCandidates(filename);

        // 1. 同目录
        for (const name of candidates) {
            const dirs = this.byName.get(name);
            if (dirs && dirs.includes(relativeDir)) {
                const meta = this._read(relativeDir, name);
                if (meta) {
                    this.stats.sameDir++;
                    return meta;
                }
            }
        }

        // 2/3. 跨目录
        for (const name of candidates) {
            const dirs = this.byName.get(name);
            if (!dirs || dirs.length === 0) continue;

            if (dirs.length === 1) {
                const meta = this._read(dirs[0], name);
                if (meta) {
                    this.stats.crossDir++;
                    return meta;
                }
                continue;
            }

            const metas = dirs.map(d => this._read(d, name)).filter(Boolean);
            if (metas.length === 0) continue;
            if (metas.every(m => sameMeta(m, metas[0]))) {
                this.stats.crossDir++;
                return metas[0];
            }
            this.stats.ambiguous++;
            return null;
        }

        this.stats.missing++;
        return null;
    }
}

module.exports = { TakeoutIndex, parseSidecar, sidecarCandidates, splitDupMarker, isSidecarJson };
