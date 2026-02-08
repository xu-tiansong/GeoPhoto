/**
 * Database.js - 数据库管理类
 * 负责所有数据库操作，包括照片、设置的读写
 */

const Database = require('better-sqlite3');
const path = require('path');

class DatabaseManager {
    constructor(dbPath = 'photos.db') {
        this.db = new Database(dbPath);
        this.initTables();
        this.createIndexes();
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
                tags TEXT,
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
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE,
                category TEXT, -- 'person', 'scene', 'event'
                parent_id INTEGER,
                color TEXT
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

        // 检查并迁移旧数据
        this.migrateColumns();

        console.log('数据库表结构已初始化');
    }

    /**
     * 迁移旧数据库结构
     */
    migrateColumns() {
        try {
            const tableInfo = this.db.prepare("PRAGMA table_info(photos)").all();
            const hasTypeColumn = tableInfo.some(col => col.name === 'type');
            const hasDirectoryColumn = tableInfo.some(col => col.name === 'directory');
            const hasFilenameColumn = tableInfo.some(col => col.name === 'filename');
            const hasPathColumn = tableInfo.some(col => col.name === 'path');
            
            if (!hasTypeColumn) {
                this.db.exec("ALTER TABLE photos ADD COLUMN type TEXT DEFAULT 'photo'");
                console.log('已添加 type 列到 photos 表');
            }
            if (!hasDirectoryColumn) {
                this.db.exec("ALTER TABLE photos ADD COLUMN directory TEXT");
                console.log('已添加 directory 列到 photos 表');
            }
            if (!hasFilenameColumn) {
                this.db.exec("ALTER TABLE photos ADD COLUMN filename TEXT");
                console.log('已添加 filename 列到 photos 表');
            }
            
            // 仅在存在旧的 path 列时才进行迁移
            if (hasPathColumn) {
                const oldRecords = this.db.prepare(
                    "SELECT id, path FROM photos WHERE path IS NOT NULL AND (directory IS NULL OR filename IS NULL)"
                ).all();
                
                const updateStmt = this.db.prepare("UPDATE photos SET directory = ?, filename = ? WHERE id = ?");
                for (const record of oldRecords) {
                    if (record.path) {
                        const dir = path.dirname(record.path);
                        const file = path.basename(record.path);
                        updateStmt.run(dir, file, record.id);
                    }
                }
                if (oldRecords.length > 0) {
                    console.log(`已迁移 ${oldRecords.length} 条旧记录`);
                }
            }
        } catch (err) {
            console.log('检查/添加列时出错:', err);
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

    addTag(name, category = 'scene', color = '#3498db') {
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
     * 获取所有照片
     */
    getAllPhotos() {
        return this.db.prepare('SELECT * FROM photos').all();
    }

    /**
     * 根据目录和文件名查询单个照片
     */
    getPhotoByPath(directory, filename) {
        const sql = 'SELECT * FROM photos WHERE directory = ? AND filename = ?';
        return this.db.prepare(sql).get(directory, filename);
    }

    /**
     * 根据时间范围查询照片
     */
    queryPhotosByTimeRange(startTime, endTime) {
        const sql = `
            SELECT * FROM photos 
            WHERE time >= ? AND time <= ?
        `;
        return this.db.prepare(sql).all(startTime, endTime);
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
        return this.db.prepare(sql).all(north, south, east, west);
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
            try {
                return JSON.parse(row.value);
            } catch (e) {
                return row.value;
            }
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
