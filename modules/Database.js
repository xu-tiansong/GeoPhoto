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
                category TEXT CHECK(category IN ('face', 'event', 'location', 'common')),
                parent_id INTEGER,
                remark TEXT,           -- 简单描述
                color TEXT,            -- UI显示的标签颜色
                FOREIGN KEY (parent_id) REFERENCES tags(id)
            )
        `);

        // 3.2. 扩展：人物/宠物元信息表
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tag_faces (
                tag_id INTEGER PRIMARY KEY,
                preview_path TEXT,     -- 代表性头像的路径
                is_pet INTEGER DEFAULT 0, -- 0:人, 1:宠物
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            )
        `);

        // 3.2.1. 人脸特征样本表：每行一条特征向量，一个人物可有多条样本
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tag_face_descriptors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tag_id INTEGER NOT NULL,
                descriptor TEXT NOT NULL,  -- 单条特征向量（JSON数组，128维或更多维）
                photo_id INTEGER,          -- 样本来源照片（可为空）
                created_at DATETIME DEFAULT (datetime('now')),
                FOREIGN KEY (tag_id) REFERENCES tag_faces(tag_id) ON DELETE CASCADE,
                FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE SET NULL
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

        // 3.3.1 迁移：为 tag_events 添加 location_tag_id 列
        try {
            this.db.exec(`ALTER TABLE tag_events ADD COLUMN location_tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL`);
        } catch (_) { /* 列已存在则忽略 */ }

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
            this.db.exec(`CREATE INDEX IF NOT EXISTS idx_face_descriptors_tag ON tag_face_descriptors(tag_id)`);
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

    addTag(name, category = 'common', color = '#3498db', parentId = null) {
        const stmt = this.db.prepare(
            'INSERT OR IGNORE INTO tags (name, category, color, parent_id) VALUES (?, ?, ?, ?)'
        );
        return stmt.run(name, category, color, parentId);
    }

    /**
     * 完整保存一个 Tag 实例（基础表 + 对应扩展表）
     * @param {import('./Tag').Tag} tag
     */
    saveTag(tag) {
        const upsertBase = this.db.prepare(`
            INSERT INTO tags (name, category, color, parent_id, remark)
            VALUES (@name, @category, @color, @parent_id, @remark)
            ON CONFLICT(name) DO UPDATE SET
                category  = excluded.category,
                color     = excluded.color,
                parent_id = excluded.parent_id,
                remark    = excluded.remark
        `);

        const saveAll = this.db.transaction(() => {
            const result = upsertBase.run({
                name:      tag.name,
                category:  tag.category,
                color:     tag.color,
                parent_id: tag.parentId,
                remark:    tag.remark
            });
            const id = result.lastInsertRowid
                || this.db.prepare('SELECT id FROM tags WHERE name = ?').get(tag.name).id;

            switch (tag.category) {
                case 'face':
                    // 写入人物元信息
                    this.db.prepare(`
                        INSERT INTO tag_faces (tag_id, preview_path, is_pet)
                        VALUES (?, ?, ?)
                        ON CONFLICT(tag_id) DO UPDATE SET
                            preview_path = excluded.preview_path,
                            is_pet       = excluded.is_pet
                    `).run(id, tag.previewPath, tag.isPet ? 1 : 0);
                    // 写入新增的特征向量样本（不覆盖已有样本）
                    if (Array.isArray(tag.descriptors) && tag.descriptors.length > 0) {
                        const insertDesc = this.db.prepare(`
                            INSERT INTO tag_face_descriptors (tag_id, descriptor, photo_id)
                            VALUES (?, ?, ?)
                        `);
                        for (const sample of tag.descriptors) {
                            // sample 可以是 { descriptor, photoId } 或直接是向量数组
                            const vec = Array.isArray(sample) ? sample : sample.descriptor;
                            const photoId = sample.photoId ?? null;
                            if (vec) insertDesc.run(id, JSON.stringify(vec), photoId);
                        }
                    }
                    break;
                case 'event':
                    this.db.prepare(`
                        INSERT INTO tag_events (tag_id, start_time, end_time)
                        VALUES (?, ?, ?)
                        ON CONFLICT(tag_id) DO UPDATE SET
                            start_time = excluded.start_time,
                            end_time   = excluded.end_time
                    `).run(id,
                           tag.startTime ? tag.startTime.toISOString() : null,
                           tag.endTime   ? tag.endTime.toISOString()   : null);
                    break;
                case 'location':
                    this.db.prepare(`
                        INSERT INTO tag_locations (tag_id, lat, lng, radius, address)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(tag_id) DO UPDATE SET
                            lat     = excluded.lat,
                            lng     = excluded.lng,
                            radius  = excluded.radius,
                            address = excluded.address
                    `).run(id, tag.lat, tag.lng, tag.radius, tag.address);
                    break;
            }
            return id;
        });

        return saveAll();
    }

    /**
     * 查询单个 Tag（含扩展字段），返回合并后的原始行对象
     * @param {number} id
     */
    getTagById(id) {
        const base = this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
        if (!base) return null;
        return this._mergeTagExtension(base);
    }

    /**
     * 查询某分类下所有 Tag（含扩展字段），构建树结构
     * @param {string} category
     * @returns {object[]}
     */
    getTagsByCategory(category) {
        const rows = this.db.prepare('SELECT * FROM tags WHERE category = ?').all(category);
        const extended = rows.map(r => this._mergeTagExtension(r));
        return this._buildTree(extended);
    }

    /**
     * 更新标签基础字段（name / remark / color）
     * @param {number} id
     * @param {{ name: string, remark: string, color: string }} fields
     */
    updateTagBase(id, { name, remark, color }) {
        return this.db.prepare(
            'UPDATE tags SET name = ?, remark = ?, color = ? WHERE id = ?'
        ).run(name, remark ?? '', color ?? '#3498db', id);
    }

    /**
     * 移动标签：变更父节点
     * @param {number}      id       - 要移动的标签 id
     * @param {number|null} parentId - 新父节点 id，null 表示升为根节点
     */
    moveTag(id, parentId) {
        return this.db.prepare(
            'UPDATE tags SET parent_id = ? WHERE id = ?'
        ).run(parentId ?? null, id);
    }

    /**
     * 删除标签及其所有后代（深度优先，从叶节点开始删除）
     * 注意：parent_id FK 没有 ON DELETE CASCADE，须手动递归删除。
     * @param {number} id
     */
    deleteTag(id) {
        const collectIds = (tagId, out = []) => {
            const children = this.db.prepare('SELECT id FROM tags WHERE parent_id = ?').all(tagId);
            for (const c of children) collectIds(c.id, out);
            out.push(tagId); // 后序：先删子再删自身
            return out;
        };

        const deleteAll = this.db.transaction(() => {
            const ids = collectIds(id);
            const del = this.db.prepare('DELETE FROM tags WHERE id = ?');
            for (const tid of ids) del.run(tid);
        });

        return deleteAll();
    }

    // ── 人脸特征样本操作 ──────────────────────────────────

    /**
     * 为人物标签添加一条人脸特征样本
     * @param {number}        tagId
     * @param {number[]}      descriptor - 特征向量数组
     * @param {number|null}   photoId    - 来源照片 ID（可选）
     * @returns {object} better-sqlite3 RunResult
     */
    addFaceDescriptor(tagId, descriptor, photoId = null) {
        return this.db.prepare(`
            INSERT INTO tag_face_descriptors (tag_id, descriptor, photo_id)
            VALUES (?, ?, ?)
        `).run(tagId, JSON.stringify(descriptor), photoId);
    }

    /**
     * 获取某人物的所有人脸特征样本
     * @param {number} tagId
     * @returns {{ id, tag_id, descriptor: number[], photo_id, created_at }[]}
     */
    getFaceDescriptors(tagId) {
        const rows = this.db.prepare(
            'SELECT * FROM tag_face_descriptors WHERE tag_id = ? ORDER BY created_at ASC'
        ).all(tagId);
        return rows.map(r => ({
            ...r,
            descriptor: JSON.parse(r.descriptor)
        }));
    }

    /**
     * 删除单条人脸特征样本
     * @param {number} descriptorId - tag_face_descriptors.id
     */
    deleteFaceDescriptor(descriptorId) {
        return this.db.prepare('DELETE FROM tag_face_descriptors WHERE id = ?').run(descriptorId);
    }

    /**
     * 清空某人物的所有人脸特征样本
     * @param {number} tagId
     */
    clearFaceDescriptors(tagId) {
        return this.db.prepare('DELETE FROM tag_face_descriptors WHERE tag_id = ?').run(tagId);
    }

    /**
     * 更新人物的代表头像路径
     * @param {number} tagId
     * @param {string} previewPath
     */
    updateFacePreview(tagId, previewPath) {
        return this.db.prepare(
            'UPDATE tag_faces SET preview_path = ? WHERE tag_id = ?'
        ).run(previewPath, tagId);
    }

    // ── 事件日期操作 ──────────────────────────────────

    /**
     * 获取所有已设置日期的事件标签（用于时间轴高亮）
     * @returns {{ id, name, color, start_time, end_time }[]}
     */
    getAllEventDates() {
        return this.db.prepare(`
            SELECT t.id, t.name, t.color, e.start_time, e.end_time
            FROM tags t
            JOIN tag_events e ON t.id = e.tag_id
            WHERE t.category = 'event'
              AND e.start_time IS NOT NULL
              AND e.end_time IS NOT NULL
        `).all();
    }

    /**
     * 更新事件标签的日期范围
     * @param {number}      tagId
     * @param {string|null} startTime - ISO 日期字符串
     * @param {string|null} endTime   - ISO 日期字符串
     */
    updateEventDates(tagId, startTime, endTime) {
        return this.db.prepare(
            'UPDATE tag_events SET start_time = ?, end_time = ? WHERE tag_id = ?'
        ).run(startTime, endTime, tagId);
    }

    /**
     * 更新事件标签关联的地标标签
     * @param {number}      tagId          - 事件标签 ID
     * @param {number|null} locationTagId  - 地标标签 ID（null 表示清除）
     */
    updateEventLocationTag(tagId, locationTagId) {
        return this.db.prepare(
            'UPDATE tag_events SET location_tag_id = ? WHERE tag_id = ?'
        ).run(locationTagId, tagId);
    }

    getLocationTags() {
        return this.db.prepare(`
            SELECT t.id, t.name, t.color, l.lat, l.lng, l.radius
            FROM tag_locations l
            JOIN tags t ON t.id = l.tag_id
            WHERE l.lat IS NOT NULL AND l.lng IS NOT NULL
        `).all();
    }

    updateLocation(tagId, lat, lng, radius) {
        return this.db.prepare(`
            INSERT INTO tag_locations (tag_id, lat, lng, radius)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(tag_id) DO UPDATE SET
                lat    = excluded.lat,
                lng    = excluded.lng,
                radius = excluded.radius
        `).run(tagId, lat, lng, radius);
    }

    /** @private 将基础行与扩展表行合并 */
    _mergeTagExtension(base) {
        let extra = {};
        switch (base.category) {
            case 'face': {
                const meta = this.db.prepare('SELECT * FROM tag_faces WHERE tag_id = ?').get(base.id) || {};
                const descriptors = this.db.prepare(
                    'SELECT * FROM tag_face_descriptors WHERE tag_id = ? ORDER BY created_at ASC'
                ).all(base.id);
                extra = { ...meta, descriptors };
                break;
            }
            case 'event':
                extra = this.db.prepare('SELECT * FROM tag_events WHERE tag_id = ?').get(base.id) || {};
                break;
            case 'location':
                extra = this.db.prepare('SELECT * FROM tag_locations WHERE tag_id = ?').get(base.id) || {};
                break;
        }
        return { ...base, ...extra };
    }

    /** @private 将扁平行数组构建为树结构 */
    _buildTree(rows, parentId = null) {
        return rows
            .filter(r => r.parent_id === parentId)
            .map(r => ({ ...r, children: this._buildTree(rows, r.id) }));
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

    unlinkTagFromPhoto(photoId, tagId) {
        return this.db.prepare('DELETE FROM photo_tags WHERE photo_id = ? AND tag_id = ?').run(photoId, tagId);
    }

    /**
     * 查询拥有指定 tag（任一匹配）的所有照片
     * @param {number[]} tagIds
     * @returns {object[]}
     */
    getPhotosByTagIds(tagIds) {
        if (!tagIds || tagIds.length === 0) return [];
        const placeholders = tagIds.map(() => '?').join(',');
        const photos = this.db.prepare(`
            SELECT DISTINCT p.* FROM photos p
            JOIN photo_tags pt ON p.id = pt.photo_id
            WHERE pt.tag_id IN (${placeholders})
            ORDER BY p.time
        `).all(...tagIds);
        return this.filterExistingPhotos(this.addFullPathToPhotos(photos));
    }

    /**
     * 若照片没有位置信息，且指定的 tag 是地标 tag（有坐标），
     * 则将地标的坐标赋给该照片。
     * @param {number} photoId
     * @param {number} tagId
     * @returns {{ lat: number, lng: number } | null} 返回被赋予的坐标，若不满足条件则返回 null
     */
    applyLandmarkLocationToPhoto(photoId, tagId) {
        const photo = this.db.prepare('SELECT lat, lng FROM photos WHERE id = ?').get(photoId);
        if (!photo || photo.lat !== null || photo.lng !== null) return null;

        const loc = this.db.prepare('SELECT lat, lng FROM tag_locations WHERE tag_id = ?').get(tagId);
        if (!loc || loc.lat === null || loc.lng === null) return null;

        this.db.prepare('UPDATE photos SET lat = ?, lng = ? WHERE id = ?').run(loc.lat, loc.lng, photoId);
        return { lat: loc.lat, lng: loc.lng };
    }

    /**
     * 获取所有 face tag 及其 descriptors（用于人脸匹配）
     * @returns {{ id, name, color, descriptors: {descriptor: number[]}[] }[]}
     */
    getAllFaceTagsWithDescriptors() {
        const tags = this.db.prepare(
            "SELECT * FROM tags WHERE category = 'face'"
        ).all();
        return tags.map(t => {
            const descriptors = this.db.prepare(
                'SELECT * FROM tag_face_descriptors WHERE tag_id = ? ORDER BY created_at ASC'
            ).all(t.id);
            return {
                ...t,
                descriptors: descriptors.map(d => ({
                    ...d,
                    descriptor: JSON.parse(d.descriptor)
                }))
            };
        }).filter(t => t.descriptors.length > 0);
    }

    /**
     * 获取所有有时间范围和关联地标的 event tags
     * @returns {{ id, name, color, start_time, end_time, location_tag_id }[]}
     */
    getAllEventTagsWithLocation() {
        return this.db.prepare(`
            SELECT t.id, t.name, t.color, t.parent_id,
                   e.start_time, e.end_time, e.location_tag_id
            FROM tags t
            JOIN tag_events e ON t.id = e.tag_id
            WHERE t.category = 'event'
              AND e.start_time IS NOT NULL
              AND e.end_time IS NOT NULL
              AND e.location_tag_id IS NOT NULL
        `).all();
    }

    /**
     * 获取某个 location tag 的所有子孙 tag（扁平列表，含自身）
     * @param {number} tagId
     * @returns {object[]} 扁平的 location tag 记录列表（含 lat, lng, radius）
     */
    getLocationTagDescendants(tagId) {
        const result = [];
        const collect = (id, depth) => {
            const base = this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
            if (!base) return;
            const loc = this.db.prepare('SELECT * FROM tag_locations WHERE tag_id = ?').get(id) || {};
            result.push({ ...base, ...loc, _depth: depth });
            const children = this.db.prepare(
                "SELECT id FROM tags WHERE parent_id = ? AND category = 'location'"
            ).all(id);
            for (const c of children) collect(c.id, depth + 1);
        };
        collect(tagId, 0);
        return result;
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
     * 获取所有照片的拍摄时间（仅 time 字段，轻量接口供日历使用）
     * @returns {string[]} 时间字符串数组
     */
    getAllPhotoTimes() {
        const rows = this.db.prepare('SELECT time FROM photos WHERE time IS NOT NULL').all();
        return rows.map(r => r.time);
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
     * 获取照片表中所有唯一的目录路径及各目录照片数量
     */
    getUniquePhotoDirs() {
        return this.db.prepare(
            'SELECT directory, COUNT(*) as count FROM photos GROUP BY directory ORDER BY directory'
        ).all();
    }

    /**
     * 根据目录路径精确查询照片
     */
    queryPhotosByDirectory(dirPath) {
        const photos = this.db.prepare('SELECT * FROM photos WHERE directory = ?').all(dirPath);
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
     * 保存语言设置
     */
    saveLanguage(lang) {
        this.saveSetting('language', lang);
    }

    /**
     * 读取语言设置
     */
    getLanguage() {
        return this.getSetting('language');
    }

    /**
     * 关闭数据库连接
     */
    close() {
        this.db.close();
    }
}

module.exports = DatabaseManager;
