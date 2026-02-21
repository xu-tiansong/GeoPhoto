/**
 * Tag.js - 标签类体系
 *
 * 基类 Tag + 四个子类：
 *   FaceTag     - 人物/宠物标记（人脸特征识别）
 *   EventTag    - 事件标记（旅行、聚会、会议等，含时间区间）
 *   LandmarkTag - 地标标记（具体地理位置）
 *   CommonTag   - 其他/通用标记
 *
 * 对应数据库表：
 *   tags（基础）+ tag_faces / tag_events / tag_locations（扩展）
 *
 * 所有 Tag 均支持层级结构（parent_id / children）。
 */

// ─────────────────────────────────────────────────
// 基类
// ─────────────────────────────────────────────────

class Tag {
    /**
     * @param {object} data - 来自 tags 表的字段
     * @param {number|null} data.id
     * @param {string}      data.name
     * @param {string}      data.category  - 'face' | 'event' | 'location' | 'common'
     * @param {number|null} data.parent_id
     * @param {string}      data.remark
     * @param {string}      data.color
     */
    constructor(data = {}) {
        this.id       = data.id        ?? null;
        this.name     = data.name      ?? '';
        this.category = data.category  ?? 'common';
        this.parentId = data.parent_id ?? null;
        this.remark   = data.remark    ?? '';
        this.color    = data.color     ?? '#3498db';

        /** 由 getTreeByCategory 等方法填充的子节点数组 */
        this.children = Array.isArray(data.children)
            ? data.children
            : [];
    }

    /** 是否为叶子节点（无子标签） */
    get isLeaf() {
        return this.children.length === 0;
    }

    /** 是否为根节点（无父标签） */
    get isRoot() {
        return this.parentId === null;
    }

    /**
     * 序列化为普通对象，方便存入 IPC / JSON。
     * 子类应 super.toObject() 后追加自身字段。
     */
    toObject() {
        return {
            id:        this.id,
            name:      this.name,
            category:  this.category,
            parent_id: this.parentId,
            remark:    this.remark,
            color:     this.color,
            children:  this.children.map(c =>
                c instanceof Tag ? c.toObject() : c
            )
        };
    }

    /**
     * 根据 category 字段自动选择正确子类并实例化。
     * @param {object} record    - tags 表记录
     * @param {object} [extra]   - 对应扩展表记录（tag_faces / tag_events / tag_locations）
     * @returns {Tag}
     */
    static fromDbRecord(record, extra = {}) {
        const merged = { ...record, ...extra };
        switch (record.category) {
            case 'face':     return new FaceTag(merged);
            case 'event':    return new EventTag(merged);
            case 'location': return new LandmarkTag(merged);
            default:         return new CommonTag(merged);
        }
    }
}

// ─────────────────────────────────────────────────
// FaceTag - 人物 / 宠物标记
// ─────────────────────────────────────────────────

class FaceTag extends Tag {
    /**
     * @param {object}   data
     * @param {object[]} data.descriptors  - 人脸特征样本列表，每项结构为：
     *                                       { id, descriptor: number[], photoId, createdAt }
     *                                       对应 tag_face_descriptors 表的行
     * @param {string}   data.preview_path - tag_faces.preview_path（代表性头像路径）
     * @param {number}   data.is_pet       - tag_faces.is_pet（0: 人, 1: 宠物）
     */
    constructor(data = {}) {
        super({ ...data, category: 'face' });

        this.previewPath = data.preview_path ?? null;
        this.isPet       = Boolean(data.is_pet);

        // descriptors: 来自 _mergeTagExtension 时已是解析后的数组；
        // 也允许直接传入 { descriptor: number[], photoId? } 形式的待插入样本。
        this.descriptors = Array.isArray(data.descriptors)
            ? data.descriptors.map(s => ({
                id:          s.id          ?? null,
                descriptor:  typeof s.descriptor === 'string'
                                 ? JSON.parse(s.descriptor)
                                 : (s.descriptor ?? []),
                photoId:     s.photo_id    ?? s.photoId    ?? null,
                createdAt:   s.created_at  ?? s.createdAt  ?? null
            }))
            : [];
    }

    /** 是否已有至少一条人脸特征样本 */
    get hasDescriptor() {
        return this.descriptors.length > 0;
    }

    /** 获取所有特征向量（不含元信息，方便直接送入识别算法） */
    get vectors() {
        return this.descriptors.map(s => s.descriptor);
    }

    toObject() {
        return {
            ...super.toObject(),
            preview_path: this.previewPath,
            is_pet:       this.isPet ? 1 : 0,
            descriptors:  this.descriptors
        };
    }
}

// ─────────────────────────────────────────────────
// EventTag - 事件标记
// ─────────────────────────────────────────────────

class EventTag extends Tag {
    /**
     * @param {object}           data
     * @param {string|Date|null} data.start_time - tag_events.start_time
     * @param {string|Date|null} data.end_time   - tag_events.end_time
     */
    constructor(data = {}) {
        super({ ...data, category: 'event' });

        this.startTime     = data.start_time      ? new Date(data.start_time) : null;
        this.endTime       = data.end_time         ? new Date(data.end_time)   : null;
        this.locationTagId = data.location_tag_id  ?? null;
    }

    /** 是否有时间区间 */
    get hasDuration() {
        return this.startTime !== null && this.endTime !== null;
    }

    /**
     * 判断给定时间是否在事件范围内
     * @param {Date|string} time
     */
    containsTime(time) {
        if (!this.hasDuration) return false;
        const t = new Date(time);
        return t >= this.startTime && t <= this.endTime;
    }

    toObject() {
        return {
            ...super.toObject(),
            start_time:      this.startTime ? this.startTime.toISOString() : null,
            end_time:        this.endTime   ? this.endTime.toISOString()   : null,
            location_tag_id: this.locationTagId,
        };
    }
}

// ─────────────────────────────────────────────────
// LandmarkTag - 地标标记
// ─────────────────────────────────────────────────

class LandmarkTag extends Tag {
    /**
     * @param {object} data
     * @param {number} data.lat     - tag_locations.lat（中心点纬度）
     * @param {number} data.lng     - tag_locations.lng（中心点经度）
     * @param {number} data.radius  - tag_locations.radius（覆盖半径，米）
     * @param {string} data.address - tag_locations.address（详细地址）
     */
    constructor(data = {}) {
        super({ ...data, category: 'location' });

        this.lat     = data.lat     ?? null;
        this.lng     = data.lng     ?? null;
        this.radius  = data.radius  ?? 0;
        this.address = data.address ?? '';
    }

    /** 是否有坐标 */
    get hasCoordinates() {
        return this.lat !== null && this.lng !== null;
    }

    /**
     * 判断某坐标是否在地标覆盖范围内（Haversine 近似）
     * @param {number} lat
     * @param {number} lng
     * @returns {boolean}
     */
    containsPoint(lat, lng) {
        if (!this.hasCoordinates || this.radius <= 0) return false;
        return LandmarkTag.haversineDistance(this.lat, this.lng, lat, lng) <= this.radius;
    }

    /**
     * Haversine 公式计算两点间距离（米）
     */
    static haversineDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // 地球半径（米）
        const toRad = deg => deg * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    toObject() {
        return {
            ...super.toObject(),
            lat:     this.lat,
            lng:     this.lng,
            radius:  this.radius,
            address: this.address
        };
    }
}

// ─────────────────────────────────────────────────
// CommonTag - 其他 / 通用标记
// ─────────────────────────────────────────────────

class CommonTag extends Tag {
    constructor(data = {}) {
        super({ ...data, category: 'common' });
    }

    toObject() {
        return super.toObject();
    }
}

// ─────────────────────────────────────────────────

module.exports = { Tag, FaceTag, EventTag, LandmarkTag, CommonTag };
