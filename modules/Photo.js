/**
 * Photo.js - 单张照片/视频类
 * 封装照片的属性和方法
 */

class Photo {
    constructor(data = {}) {
        this.id = data.id || null;
        this.directory = data.directory || '';
        this.filename = data.filename || '';
        this.time = data.time || null;
        this.lat = data.lat || null;
        this.lng = data.lng || null;
        this.remark = data.remark || '';
        this.tags = data.tags || '';
        this.type = data.type || 'photo';
        this.geoSource = data.geoSource || null; // 'original' 或 'inferred'
    }

    /**
     * 获取完整文件路径
     */
    get fullPath() {
        if (this.directory && this.filename) {
            return `${this.directory}/${this.filename}`;
        }
        return '';
    }

    /**
     * 获取文件URL（用于渲染器显示）
     */
    get fileUrl() {
        const filePath = this.fullPath;
        return `file://${filePath.replace(/\\/g, '/')}`;
    }

    /**
     * 是否为视频
     */
    get isVideo() {
        return this.type === 'video';
    }

    /**
     * 是否有地理位置信息
     */
    get hasLocation() {
        return this.lat !== null && this.lng !== null;
    }

    /**
     * 是否有时间信息
     */
    get hasTime() {
        return this.time !== null;
    }

    /**
     * 获取格式化的日期时间
     */
    getFormattedDateTime() {
        if (!this.time) return { date: '未知日期', time: '' };
        
        const d = new Date(this.time);
        if (isNaN(d.getTime())) return { date: '未知日期', time: '' };
        
        const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
        const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        return { date, time };
    }

    /**
     * 获取日期时间字符串
     */
    getDateTimeString() {
        const { date, time } = this.getFormattedDateTime();
        return time ? `${date} ${time}` : date;
    }

    /**
     * 获取本地化日期字符串
     */
    getLocaleDateString() {
        if (!this.time) return '未知时间';
        const d = new Date(this.time);
        if (isNaN(d.getTime())) return '未知时间';
        return d.toLocaleString();
    }

    /**
     * 获取类型显示字符串
     */
    getTypeString() {
        return this.isVideo ? '🎬 视频' : '📷 照片';
    }

    /**
     * 转换为普通对象
     */
    toObject() {
        return {
            id: this.id,
            directory: this.directory,
            filename: this.filename,
            time: this.time,
            lat: this.lat,
            lng: this.lng,
            remark: this.remark,
            tags: this.tags,
            type: this.type,
            geoSource: this.geoSource
        };
    }

    /**
     * 从数据库记录创建Photo实例
     */
    static fromDbRecord(record) {
        return new Photo(record);
    }

    /**
     * 克隆照片对象
     */
    clone() {
        return new Photo(this.toObject());
    }

    /**
     * 检查文件扩展名是否为照片
     */
    static isPhotoExtension(filename) {
        return /\.(jpg|jpeg|heic|png|gif|bmp|webp)$/i.test(filename);
    }

    /**
     * 检查文件扩展名是否为视频
     */
    static isVideoExtension(filename) {
        // mpg/mpeg/vob(MPEG-1/2)、mts/m2ts(AVCHD)、asf 等 Chromium 不能直接播放，
        // 照片窗口会回退到「用系统播放器打开」
        return /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp|3g2|mpg|mpeg|mts|m2ts|vob|asf)$/i.test(filename);
    }

    /**
     * 检查文件扩展名是否为支持的媒体文件
     */
    static isMediaFile(filename) {
        return Photo.isPhotoExtension(filename) || Photo.isVideoExtension(filename);
    }
}

module.exports = Photo;
