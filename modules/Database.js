/**
 * Database.js - 数据库管理类
 * 负责所有数据库操作，包括照片、设置的读写
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseManager {
    constructor(dbPath = 'photos.db') {
        // 检查数据库文件是否存在
        const dbExists = fs.existsSync(dbPath);
        
        this.db = new Database(dbPath);
        this.pathExistsCache = new Map();
        this.initTables();
        this.createIndexes();
        
        // 仅在数据库文件不存在（新创建）时插入默认数据
        if (!dbExists) {
            this.insertDefaultData();
        }
    }

    /**
     * 初始化数据库表结构
     */
    initTables() {
        // 1. 照片表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                directory TEXT,
                filename TEXT,
                time DATETIME,
                lat REAL,
                lng REAL,
                remark TEXT,
                like INTEGER DEFAULT 0,
                type TEXT DEFAULT 'photo',
                UNIQUE(directory, filename)
            )
        `);

        // 2. 目录管理表 (对应菜单 1.2)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS directories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE,
                added_time DATETIME,
                last_scan_time DATETIME,
                is_active INTEGER DEFAULT 1
            )
        `);

        // 3. 标签定义表 (对应菜单 1.3)
        // 3.1. 基础标签表：支撑所有分类和层级
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                category TEXT CHECK(category IN ('face', 'event', 'common')), 
                parent_id INTEGER,
                remark TEXT,           -- 简单描述
                color TEXT,            -- UI显示的标签颜色
                FOREIGN KEY (parent_id) REFERENCES tags(id)
            )
        `);

        // 3.2. 扩展：人物/宠物特征表 (解决识别持久化)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tag_faces (
                tag_id INTEGER PRIMARY KEY,
                descriptor TEXT,       -- 存储 128维/更多维度的特征向量 (JSON字符串)
                preview_path TEXT,     -- 代表性头像的路径
                is_pet INTEGER DEFAULT 0, -- 0:人, 1:宠物
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )
        `);

        // 3.3. 扩展：事件属性表 (解决时间属性)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tag_events (
                tag_id INTEGER PRIMARY KEY,
                start_time DATETIME,
                end_time DATETIME,
                location_name TEXT,    -- 事件发生的大致地点名称
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )
        `);

        // 3.4. 扩展：地点属性表 (解决地理位置属性)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tag_locations (
                tag_id INTEGER PRIMARY KEY,
                lat REAL,              -- 中心点纬度
                lng REAL,              -- 中心点经度
                radius REAL,           -- 覆盖半径（米），用于自动打标签
                address TEXT,          -- 详细地址描述
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )
        `);

        // 4. 照片-标签关联表 (多对多)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS photo_tags (
                photo_id INTEGER,
                tag_id INTEGER,
                PRIMARY KEY (photo_id, tag_id),
                FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )
        `);

        // 5. 旅行轨迹表 (对应菜单 3.4)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                start_time DATETIME,
                end_time DATETIME,
                geojson TEXT, -- 存储整个轨迹的线段数据
                distance REAL,
                file_path TEXT
            )
        `);

        // 6. 设置表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        `);

        console.log('数据库表结构已初始化');
    }


    /**
     * 默认初始数据添加
     */
    insertDefaultData() {

        // 插入默认face标签
        const defaultFaces = ['Family', 'Friends', 'Work Related', 'Pets'];
        const stmt = this.db.prepare('INSERT OR IGNORE INTO tags (name, category, color) VALUES (?, ?, ?)');
        for (const name of defaultFaces) {
            stmt.run(name, 'face', '#e74c3c');
        }

        // 插入默认event标签
        const defaultEvents = ['Travel', 'Ceremony', 'Meeting', 'Sports'];
        const stmtEvent = this.db.prepare('INSERT OR IGNORE INTO tags (name, category, color) VALUES (?, ?, ?)');
        for (const name of defaultEvents) {
            stmtEvent.run(name, 'event', '#3498db');
        }   

        // 插入默认Common标签
        const defaultCommons = ['Scenery', 'Food', 'Architecture'];
        const stmtCommon = this.db.prepare('INSERT OR IGNORE INTO tags (name, category, color) VALUES (?, ?, ?)');
        for (const name of defaultCommons) {
            stmtCommon.run(name, 'common', '#2ecc71');
        }   
    }



    /**
     * 创建数据库索引
     */
    createIndexes() {
        try {
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_time ON photos(time)`);
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_lat_lng ON photos(lat, lng)`);
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_time_geo ON photos(time, lat, lng)`);
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_directories_path ON directories(path)`);
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category)`);
            console.log('数据库索引已创建/验证');
        } catch (err) {
            console.log('创建索引时出错:', err);
        }
    }

    // ==================== 新增：目录管理 (1.2) ====================

    addDirectory(dirPath) {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO directories (path, added_time, last_scan_time) 
            VALUES (?, ?, ?)
        `);
        return stmt.run(dirPath, new Date().toISOString(), null);
    }

    hasDirectory(dirPath) {
        const row = this.db.prepare('SELECT 1 FROM directories WHERE path = ?').get(dirPath);
        return !!row;
    }

    getAllDirectories() {
        return this.db.prepare('SELECT * FROM directories').all();
    }

    updateScanTime(dirPath) {
        return this.db.prepare('UPDATE directories SET last_scan_time = ? WHERE path = ?')
            .run(new Date().toISOString(), dirPath);
    }

    isDirectoryScanned(dirPath) {
        const row = this.db.prepare('SELECT last_scan_time FROM directories WHERE path = ?').get(dirPath);
        return row && row.last_scan_time !== null;
    }

    // ==================== 新增：标签管理 (1.3/1.7) ====================

    /**
     * 获取某个分类下的完整树结构
     */
    getTreeByCategory(category) {
        const allTags = this.db.prepare('SELECT * FROM tags WHERE category = ?').all(category);
        
        const buildTree = (parentId = null) => {
            return allTags
                .filter(tag => tag.parent_id === parentId)
                .map(tag => ({
                    ...tag,
                    children: buildTree(tag.id)
                }));
        };
        
        return buildTree();
    }

    addTag(name, category = 'common', color = '#3498db') {
        const stmt = this.db.prepare('INSERT OR IGNORE INTO tags (name, category, color) VALUES (?, ?, ?)');
        return stmt.run(name, category, color);
    }

    linkTagToPhoto(photoId, tagId) {
        const stmt = this.db.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, ?)');
        return stmt.run(photoId, tagId);
    }

    getPhotoTags(photoId) {
        const sql = `
            SELECT t.* FROM tags t
            JOIN photo_tags pt ON t.id = pt.tag_id
            WHERE pt.photo_id = ?
        `;
        return this.db.prepare(sql).all(photoId);
    }

    // ==================== 新增：轨迹管理 (3.4) ====================

    saveTrack(trackData) {
        const stmt = this.db.prepare(`
            INSERT INTO tracks (name, start_time, end_time, geojson, distance, file_path)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            trackData.name,
            trackData.startTime,
            trackData.endTime,
            trackData.geojson,
            trackData.distance,
            trackData.filePath
        );
    }

    getAllTracks() {
        return this.db.prepare('SELECT * FROM tracks ORDER BY start_time DESC').all();
    }

    // ==================== 照片操作 ====================

    /**
     * 检查文件是否已存在
     */
    isFileExists(directory, filename) {
        const row = this.db.prepare('SELECT id FROM photos WHERE directory = ? AND filename = ?').get(directory, filename);
        return !!row;
    }

    /**
     * 插入或更新照片记录
     */
    upsertPhoto(photo) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO photos (directory, filename, time, lat, lng, type) 
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            photo.directory,
            photo.filename,
            photo.time ? (photo.time instanceof Date ? photo.time.toISOString() : photo.time) : null,
            photo.lat || null,
            photo.lng || null,
            photo.type || 'photo'
        );
    }

    /**
     * 批量插入照片
     */
    batchInsertPhotos(photos) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO photos (directory, filename, time, lat, lng, type) 
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const insertMany = this.db.transaction((items) => {
            for (const photo of items) {
                stmt.run(
                    photo.directory,
                    photo.filename,
                    photo.time ? (photo.time instanceof Date ? photo.time.toISOString() : photo.time) : null,
                    photo.lat || null,
                    photo.lng || null,
                    photo.type || 'photo'
                );
            }
        });
        
        insertMany(photos);
    }

    /**
     * 给照片数据添加完整路径
     */
    addFullPathToPhoto(photo) {
        if (!photo) return photo;
        const photoDir = this.getPhotoDirectory();

        const directory = photo.directory || '';
        const filename = photo.filename || '';
        const candidates = [];

        if (directory) {
            if (path.isAbsolute(directory)) {
                if (filename && path.basename(directory) !== filename) {
                    candidates.push(path.join(directory, filename));
                }
                candidates.push(directory);
            } else {
                if (photoDir) {
                    candidates.push(path.join(photoDir, directory, filename));
                }
                if (filename) {
                    candidates.push(path.join(directory, filename));
                } else {
                    candidates.push(directory);
                }
            }
        }

        if (photoDir && filename) {
            candidates.push(path.join(photoDir, filename));
        }

        const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
        const existingPath = uniqueCandidates.find(candidate => this.fileExistsCached(candidate));

        photo.fullPath = existingPath || null;
        photo.isMissing = !existingPath;
        return photo;
    }

    fileExistsCached(filePath) {
        if (!filePath) return false;
        if (this.pathExistsCache.has(filePath)) {
            return this.pathExistsCache.get(filePath);
        }

        let exists = false;
        try {
            exists = fs.existsSync(filePath);
        } catch (err) {
            exists = false;
        }

        this.pathExistsCache.set(filePath, exists);
        return exists;
    }

    /**
     * 给照片数组添加完整路径
     */
    addFullPathToPhotos(photos) {
        return photos.map(photo => this.addFullPathToPhoto(photo));
    }

    filterExistingPhotos(photos) {
        return photos.filter(photo => photo && photo.fullPath && !photo.isMissing);
    }

    /**
     * 获取所有照片
     */
    getAllPhotos() {
        const photos = this.db.prepare('SELECT * FROM photos').all();
        return this.filterExistingPhotos(this.addFullPathToPhotos(photos));
    }

    /**
     * 根据目录和文件名查询单个照片
     */
    getPhotoByPath(directory, filename) {
        const sql = 'SELECT * FROM photos WHERE directory = ? AND filename = ?';
        const photo = this.db.prepare(sql).get(directory, filename);
        const enriched = this.addFullPathToPhoto(photo);
        return enriched && !enriched.isMissing ? enriched : null;
    }

    /**
     * 根据时间范围查询照片
     */
    queryPhotosByTimeRange(startTime, endTime) {
        const sql = `
            SELECT * FROM photos 
            WHERE time >= ? AND time <= ?
        `;
        const photos = this.db.prepare(sql).all(startTime, endTime);
        return this.filterExistingPhotos(this.addFullPathToPhotos(photos));
    }

    /**
     * 根据区域查询照片
     */
    queryPhotosByArea(north, south, east, west) {
        const sql = `
            SELECT * FROM photos 
            WHERE lat <= ? AND lat >= ? 
            AND lng <= ? AND lng >= ?
        `;
        const photos = this.db.prepare(sql).all(north, south, east, west);
        return this.filterExistingPhotos(this.addFullPathToPhotos(photos));
    }

    /**
     * 保存照片备注
     */
    savePhotoRemark(directory, filename, remark) {
        const stmt = this.db.prepare(`
            UPDATE photos SET remark = ? 
            WHERE directory = ? AND filename = ?
        `);
        return stmt.run(remark, directory, filename);
    }

    /**
     * 更新照片Like状态
     */
    updatePhotoLike(directory, filename, like) {
        const stmt = this.db.prepare(`
            UPDATE photos SET like = ? 
            WHERE directory = ? AND filename = ?
        `);
        return stmt.run(like ? 1 : 0, directory, filename);
    }

    // ==================== 设置操作 ====================

    /**
     * 保存设置
     */
    saveSetting(key, value) {
        const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        if (typeof value === 'object') {
            stmt.run(key, JSON.stringify(value));
        } else {
            stmt.run(key, value);
        }
    }

    /**
     * 读取设置
     */
    getSetting(key) {
        const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        if (row) {
            // 只尝试解析看起来像JSON的字符串（以 { 或 [ 开头）
            const value = row.value;
            if (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('['))) {
                try {
                    return JSON.parse(value);
                } catch (e) {
                    // JSON解析失败，返回原始值
                    return value;
                }
            }
            // 对于非JSON字符串，直接返回
            return value;
        }
        return null;
    }

    /**
     * 保存照片目录
     */
    savePhotoDirectory(dirPath) {
        this.saveSetting('photoDirectory', dirPath);
    }

    /**
     * 读取照片目录
     */
    getPhotoDirectory() {
        return this.getSetting('photoDirectory');
    }

    /**
     * 保存地图状态
     */
    saveMapState(state) {
        this.saveSetting('mapState', state);
    }

    /**
     * 读取地图状态
     */
    getMapState() {
        return this.getSetting('mapState');
    }

    /**
     * 保存时间轴状态
     */
    saveTimelineState(state) {
        this.saveSetting('timelineState', state);
    }

    /**
     * 读取时间轴状态
     */
    getTimelineState() {
        return this.getSetting('timelineState');
    }

    /**
     * 保存窗口状态
     */
    saveWindowState(state) {
        this.saveSetting('windowState', state);
    }

    /**
     * 读取窗口状态
     */
    getWindowState() {
        return this.getSetting('windowState');
    }

    /**
     * 关闭数据库连接
     */
    close() {
        this.db.close();
    }
}

module.exports = DatabaseManager;
