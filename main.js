/**
 * main.js - Electron 主进程入口
 * 使用模块化结构管理数据库、照片等功能
 */

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const piexif = require('piexifjs');
const DatabaseManager = require('./modules/Database');
const PhotoFilesManager = require('./modules/PhotoFilesManager');
const MenuManager = require('./modules/MenuManager');
const PhotoWindow = require('./modules/PhotoWindow');
const PhotosManageWindow = require('./modules/PhotosManageWindow');
const TimeLineSettingWindow = require('./modules/TimeLineSettingWindow');
const TagManageWindow = require('./modules/TagManageWindow');
const TagSelectWindow = require('./modules/TagSelectWindow');
const { EventTag, LandmarkTag } = require('./modules/Tag');
const i18n = require('./modules/i18n');
const AutoFaceScan = require('./modules/AutoFaceScan');

// ==================== 全局变量 ====================
let mainWindow;
let db;
let photoManager;
let menuManager;
let photoWindow;
let photosManageWindow;
let timelineSettingWindow;
let tagManageWindow;
let tagSelectWindow;
let currentPhotoDirectory = null;
let autoFaceScanner = null;

// 待打开的 TimeLineSettingWindow 初始 Tab
let pendingInitialTab = null;

// 逆地理编码缓存和速率限制
const cityCache = new Map();
let lastGeocodingTime = 0;
const geocodingInterval = 1500; // 1.5秒间隔

// ==================== 初始化 ====================
function initializeModules() {
    // 初始化数据库
    db = new DatabaseManager('photos.db');

    // 初始化语言（DB > 系统语言 > 英文）
    const savedLang = db.getLanguage();
    if (savedLang) {
        i18n.setLanguage(savedLang);
    } else {
        const sysLocale = app.getLocale();
        const lang = sysLocale.startsWith('zh') ? 'zh' : 'en';
        i18n.setLanguage(lang);
        db.saveLanguage(lang);
    }

    // 初始化照片管理器
    photoManager = new PhotoFilesManager(db);

    // 初始化菜单管理器并注册处理器
    menuManager = new MenuManager(mainWindow, i18n);
    menuManager.registerHandler('setPhotoDirectory', handleSetPhotoDirectory);
    menuManager.registerHandler('timelineSettings', () => {
        pendingInitialTab = null;
        mainWindow.webContents.send('get-timeline-state');
    });
    menuManager.registerHandler('timeRangeSettings', () => {
        pendingInitialTab = 'TimeRange';
        mainWindow.webContents.send('get-timeline-state');
    });
    menuManager.registerHandler('languageEnglish', () => applyLanguage('en'));
    menuManager.registerHandler('languageChinese', () => applyLanguage('zh'));

    // 读取已保存的照片目录
    currentPhotoDirectory = db.getPhotoDirectory();
    console.log('当前照片目录:', currentPhotoDirectory);
}

/**
 * 切换语言：保存、更新菜单、广播到所有窗口
 */
function applyLanguage(lang) {
    i18n.setLanguage(lang);
    db.saveLanguage(lang);
    menuManager.setLanguage(lang);

    // 广播给所有渲染进程窗口
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
            win.webContents.send('language-changed', lang);
        }
    });
}

// ==================== 目录处理 ====================
async function handleSetPhotoDirectory() {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Photo Directory',
        defaultPath: currentPhotoDirectory || undefined
    });
    
    if (canceled || filePaths.length === 0) return;
    
    const dirPath = filePaths[0];
    
    // 保存新目录
    db.savePhotoDirectory(dirPath);
    currentPhotoDirectory = dirPath;
    
    // 通知渲染进程开始扫描
    mainWindow.webContents.send('scan-started');
    
    // 进度回调函数
    const progressCallback = (progress) => {
        mainWindow.webContents.send('scan-progress', progress);
    };
    
    // 异步执行扫描，不阻塞UI
    (async () => {
        try {
            // 使用 PhotoFilesManager 扫描并处理目录（遍历所有子目录，文件级别去重）
            const result = await photoManager.scanAndProcessDirectory(dirPath, progressCallback, false);
            
            // 通知渲染进程扫描完成
            mainWindow.webContents.send('scan-completed', { 
                directory: dirPath,
                totalPhotos: result.totalPhotos,
                totalVideos: result.totalVideos,
                newPhotos: result.newPhotos,
                newVideos: result.newVideos,
                skippedFiles: result.skippedFiles,
                skippedDirectory: result.skippedDirectory
            });
        } catch (error) {
            console.error('扫描目录出错:', error);
            mainWindow.webContents.send('scan-error', { error: error.message });
        }
    })();
}

// ==================== 窗口创建 ====================
function createWindow() {
    // 读取保存的窗口状态
    const windowState = db.getWindowState() || {
        width: 1200,
        height: 900,
        x: undefined,
        y: undefined,
        isMaximized: false,
        isFullScreen: false
    };

    mainWindow = new BrowserWindow({
        width: windowState.width,
        height: windowState.height,
        x: windowState.x,
        y: windowState.y,
        webPreferences: {
            nodeIntegration: true, 
            contextIsolation: false 
        }
    });

    // 恢复窗口状态
    if (windowState.isMaximized) {
        mainWindow.maximize();
    }
    if (windowState.isFullScreen) {
        mainWindow.setFullScreen(true);
    }

    mainWindow.loadFile('index.html');
    
    // 创建照片窗口管理器
    photoWindow = new PhotoWindow(mainWindow);
    
    // 设置照片窗口关闭回调：如果 PhotosManageWindow 打开，则聚焦到它
    photoWindow.setOnCloseCallback(() => {
        if (photosManageWindow && photosManageWindow.isOpen()) {
            const manageWin = photosManageWindow.manageWindow;
            if (manageWin && !manageWin.isDestroyed()) {
                manageWin.focus();
            }
        }
    });
    
    // 创建照片管理窗口管理器
    photosManageWindow = new PhotosManageWindow(mainWindow);

    // 创建标签管理窗口管理器
    tagManageWindow = new TagManageWindow(mainWindow, db);
    tagSelectWindow = new TagSelectWindow(db);

    // 创建菜单管理器并注册处理器
    menuManager = new MenuManager(mainWindow, i18n);
    menuManager.registerHandler('setPhotoDirectory', handleSetPhotoDirectory);
    menuManager.registerHandler('photoManagement',     () => photosManageWindow.show({ tab: 'direct' }));
    menuManager.registerHandler('tagManagement',       () => tagManageWindow.show());
    menuManager.registerHandler('landmarkManagement',  () => tagManageWindow.show('location'));
    menuManager.registerHandler('timelineSettings', () => {
        pendingInitialTab = null;
        mainWindow.webContents.send('get-timeline-state');
    });
    menuManager.registerHandler('timeRangeSettings', () => {
        pendingInitialTab = 'TimeRange';
        mainWindow.webContents.send('get-timeline-state');
    });
    menuManager.registerHandler('languageEnglish', () => applyLanguage('en'));
    menuManager.registerHandler('languageChinese', () => applyLanguage('zh'));

    // 设置初始全屏状态
    if (windowState.isFullScreen) {
        menuManager.isFullScreen = true;
    }
    
    // 创建应用菜单
    menuManager.createMenu();
    
    // 保存窗口状态的函数
    const saveWindowState = () => {
        if (!mainWindow) return;
        
        const bounds = mainWindow.getBounds();
        const state = {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y,
            isMaximized: mainWindow.isMaximized(),
            isFullScreen: mainWindow.isFullScreen()
        };
        
        db.saveWindowState(state);
    };
    
    // 监听窗口状态变化
    mainWindow.on('resize', saveWindowState);
    mainWindow.on('move', saveWindowState);
    mainWindow.on('maximize', saveWindowState);
    mainWindow.on('unmaximize', saveWindowState);
    mainWindow.on('enter-full-screen', () => {
        saveWindowState();
        menuManager.setFullScreenState(true);
    });
    mainWindow.on('leave-full-screen', () => {
        saveWindowState();
        menuManager.setFullScreenState(false);
    });
    
    // 窗口关闭前保存状态，并销毁正在运行的人脸扫描 worker
    // （隐藏的 BrowserWindow 会阻止 window-all-closed 触发，导致进程无法退出）
    mainWindow.on('close', () => {
        saveWindowState();
        if (autoFaceScanner) autoFaceScanner.destroy();
    });
}

// ==================== IPC 处理器 ====================
function registerIpcHandlers() {
    // 获取当前语言
    ipcMain.handle('get-language', () => i18n.getLanguage());

    // HEIC → JPEG 转换（Chromium 不原生支持 HEIC，通过主进程解码）
    // Step 1: 命中 .gpj 缓存文件 → 直接返回（最快）
    // Step 2: nativeImage.createFromPath() → 利用 Windows HEIC 解码器（快，需系统安装扩展）
    // Step 3: heic-convert WASM → 纯软件解码（慢，但不依赖系统扩展）
    // Step 4: exifr.thumbnail() 内嵌预览降级 → 低分辨率，需修正旋转
    ipcMain.handle('convert-heic', async (_event, { filePath }) => {
        const ext = path.extname(filePath);
        const cacheFile = filePath.slice(0, -ext.length) + '.gpj';

        // Step 1: 命中缓存
        try {
            const cached = fs.readFileSync(cacheFile);
            if (cached.length > 5000) {
                return { success: true, data: cached.toString('base64'), isPreview: false };
            }
        } catch (_) {}

        // Step 2: 原生 OS 解码（Windows 安装了 HEIC 扩展时极快）
        try {
            const img = nativeImage.createFromPath(filePath);
            if (!img.isEmpty()) {
                const jpegBuf = img.toJPEG(92);
                try { fs.writeFileSync(cacheFile, jpegBuf); } catch (_) {}
                return { success: true, data: jpegBuf.toString('base64'), isPreview: false };
            }
        } catch (_) {}

        // Step 3: heic-convert WASM（较慢，成功后写入缓存）
        try {
            const { default: heicConvert } = await import('heic-convert');
            const inputBuffer = fs.readFileSync(filePath);
            const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 1 });
            const jpegBuf = Buffer.from(outputBuffer);
            try { fs.writeFileSync(cacheFile, jpegBuf); } catch (_) {}
            return { success: true, data: jpegBuf.toString('base64'), isPreview: false };
        } catch (convertErr) {
            // Step 4: 内嵌 JPEG 预览降级（低分辨率，需修正旋转）
            try {
                const exifr = require('exifr');
                const thumbnailBuf = await exifr.thumbnail(filePath);
                if (thumbnailBuf && thumbnailBuf.length > 5000) {
                    let orientation = 1;
                    try {
                        const meta = await exifr.parse(filePath, { pick: ['Orientation'] });
                        orientation = meta?.Orientation || 1;
                    } catch (_) {}
                    return { success: true, data: Buffer.from(thumbnailBuf).toString('base64'), isPreview: true, orientation };
                }
            } catch (_) {}
            return { success: false, error: convertErr.message };
        }
    });

    // 扫描目录
    ipcMain.handle('scan-directory', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if (canceled) return { count: 0 };

        const dirPath = filePaths[0];
        const result = await photoManager.scanAndProcessDirectory(dirPath);
        return { count: result.newPhotos + result.newVideos };
    });

    // 区域查询（附带时间范围过滤）
    ipcMain.handle('query-area', (event, range) => {
        return db.queryPhotosByArea(range.north, range.south, range.east, range.west, range.startTime, range.endTime);
    });

    // 获取所有照片
    ipcMain.handle('get-all-photos', () => {
        return db.getAllPhotos();
    });

    // 获取所有照片时间（仅 time 字段，供日历使用）
    ipcMain.handle('get-all-photo-dates', () => {
        return db.getAllPhotoTimes();
    });

    // 根据时间范围查询照片
    ipcMain.handle('query-photos-by-time', (event, { startTime, endTime }) => {
        return db.queryPhotosByTimeRange(startTime, endTime);
    });

    // 获取目录树（用于照片管理窗口的"目录"tab）
    // photos.directory 存储的是相对于 photoDirectory 根目录的相对路径，根目录本身存为 ''
    ipcMain.handle('get-directory-tree', () => {
        const photoDir = db.getPhotoDirectory();
        if (!photoDir) return [];

        const uniqueDirs = db.getUniquePhotoDirs(); // [{directory, count}]
        if (uniqueDirs.length === 0) return [];

        const dirCountMap = new Map(uniqueDirs.map(r => [r.directory, r.count]));
        const allRelDirs = uniqueDirs.map(r => r.directory);

        function buildNode(relPath) {
            const children = [];
            const visited = new Set();

            for (const d of allRelDirs) {
                if (d === relPath) continue;
                let rest;
                if (relPath === '') {
                    // 根节点：d 的第一段路径即为直接子节点
                    if (d === '') continue;
                    rest = d;
                } else {
                    // 检查 d 是否以 relPath + 分隔符 开头
                    if (d.startsWith(relPath + '\\')) {
                        rest = d.slice(relPath.length + 1);
                    } else if (d.startsWith(relPath + '/')) {
                        rest = d.slice(relPath.length + 1);
                    } else {
                        continue;
                    }
                }
                const firstSeg = rest.split(/[/\\]/)[0];
                if (!firstSeg || visited.has(firstSeg)) continue;
                visited.add(firstSeg);
                const childRel = relPath === '' ? firstSeg : relPath + path.sep + firstSeg;
                children.push(buildNode(childRel));
            }

            children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

            const displayName = relPath === '' ? path.basename(photoDir) : path.basename(relPath);
            const absPath = relPath === '' ? photoDir : path.join(photoDir, relPath);

            return {
                name: displayName,
                fullPath: relPath,  // 相对路径，供 query-photos-by-directory 使用
                absPath: absPath,   // 绝对路径，供前端 tooltip 显示
                photoCount: dirCountMap.get(relPath) || 0,
                children
            };
        }

        return [buildNode('')];
    });

    // 根据目录查询照片
    ipcMain.handle('query-photos-by-directory', (event, dirPath) => {
        return db.queryPhotosByDirectory(dirPath);
    });

    // 保存地图状态
    ipcMain.handle('save-map-state', (event, state) => {
        db.saveMapState(state);
        return true;
    });

    // 读取地图状态
    ipcMain.handle('load-map-state', () => {
        return db.getMapState();
    });

    // 保存时间轴状态
    ipcMain.handle('save-timeline-state', (event, state) => {
        db.saveTimelineState(state);
        return true;
    });

    // 读取时间轴状态
    ipcMain.handle('load-timeline-state', () => {
        return db.getTimelineState();
    });

    // 打开照片窗口
    ipcMain.handle('open-photo-window', (event, arg) => {
        if (photoWindow) {
            // 兼容两种调用方式：{ photo, navPhotos, currentIndex } 或直接传照片对象
            let photoData, navPhotos = null, currentIndex = -1;
            if (arg && arg.photo) {
                photoData = arg.photo;
                navPhotos = arg.navPhotos || null;
                currentIndex = typeof arg.currentIndex === 'number' ? arg.currentIndex : -1;
            } else {
                photoData = arg;
            }
            // 从数据库获取最新的照片数据（包括最新的remark）
            const latestPhotoData = db.getPhotoByPath(photoData.directory, photoData.filename);
            if (!latestPhotoData) {
                return { success: false, error: '文件不存在或已移动，请重新扫描目录。' };
            }
            // 若从子窗口（如 photosManageWindow）打开，以该子窗口为 modal parent，
            // 形成链式层级，避免与 photosManageWindow 同级产生的焦点争抢问题
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            const overrideParent = (senderWindow && senderWindow !== mainWindow) ? senderWindow : null;
            photoWindow.show(latestPhotoData, navPhotos, currentIndex, overrideParent);
        }
        return { success: true };
    });

    // 照片预览窗口翻页
    ipcMain.handle('navigate-photo', (event, direction) => {
        if (!photoWindow || !photoWindow.navPhotos) return { success: false };
        const { navPhotos, currentIndex } = photoWindow;
        const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
        if (newIndex < 0 || newIndex >= navPhotos.length) return { success: false };
        const navPhoto = navPhotos[newIndex];
        const latestPhotoData = db.getPhotoByPath(navPhoto.directory, navPhoto.filename);
        if (!latestPhotoData) return { success: false };
        photoWindow.navigateTo(latestPhotoData, newIndex);
        return { success: true };
    });

    // 打开照片管理窗口
    ipcMain.handle('open-photos-manage-window', (event, options) => {
        if (photosManageWindow) {
            photosManageWindow.show(options);
        }
        return true;
    });

    // 保存照片备注
    ipcMain.handle('save-photo-remark', (event, { directory, filename, remark }) => {
        try {
            db.savePhotoRemark(directory, filename, remark);
            return { success: true };
        } catch (error) {
            console.error('Failed to save remark:', error);
            return { success: false, error: error.message };
        }
    });

    // 切换照片Like状态
    ipcMain.handle('toggle-photo-like', (event, { directory, filename, like }) => {
        try {
            db.updatePhotoLike(directory, filename, like);
            
            // 通知主窗口刷新地图缩略图
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('photo-like-changed', { directory, filename, like });
            }
            
            // 通知PhotosManageWindow刷新缩略图
            if (photosManageWindow && photosManageWindow.isOpen()) {
                photosManageWindow.updatePhotos({ likeChanged: { directory, filename, like } });
            }
            
            return { success: true, like };
        } catch (error) {
            console.error('Failed to toggle like:', error);
            return { success: false, error: error.message };
        }
    });

    // 设置照片窗口全屏
    ipcMain.handle('set-photo-window-fullscreen', (event, isFullScreen) => {
        if (photoWindow) {
            photoWindow.setFullScreen(isFullScreen);
        }
        return true;
    });

    // 获取城市名称（逆地理编码）
    ipcMain.handle('get-city-name', async (event, { lat, lng }) => {
        const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
        
        // 检查缓存
        if (cityCache.has(cacheKey)) {
            return cityCache.get(cacheKey);
        }
        
        // 速率限制
        const now = Date.now();
        const timeSinceLastRequest = now - lastGeocodingTime;
        if (timeSinceLastRequest < geocodingInterval) {
            await new Promise(r => setTimeout(r, geocodingInterval - timeSinceLastRequest));
        }
        
        try {
            lastGeocodingTime = Date.now();
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&accept-language=en`,
                { headers: { 'User-Agent': 'GeoPhoto/1.0' } }
            );
            
            if (!response.ok) {
                if (response.status === 429) {
                    console.log('Nominatim API 限流，返回默认值');
                }
                return 'Unknown Location';
            }
            
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                return 'Unknown Location';
            }
            
            const data = await response.json();
            if (data.error) {
                return 'Unknown Location';
            }
            
            const address = data.address || {};
            const cityName = address.city || address.town || address.county || 
                             address.state || address.country || 'Unknown Location';
            
            cityCache.set(cacheKey, cityName);
            return cityName;
        } catch (error) {
            console.log('逆地理编码失败:', error.message);
            return 'Unknown Location';
        }
    });

    // 获取所有事件标签日期（用于时间轴高亮）
    ipcMain.handle('get-event-tag-dates', () => {
        return db.getAllEventDates();
    });

    ipcMain.handle('get-location-tags', () => {
        return db.getLocationTags();
    });

    ipcMain.handle('get-location-tag-tree', () => {
        return db.getLocationTagTree();
    });

    // ── 照片管理窗口：标签树 & 按标签查询照片 ──────────────────
    ipcMain.handle('manage-get-tags-tree', () => {
        return {
            face:     db.getTreeByCategory('face'),
            event:    db.getTreeByCategory('event'),
            location: db.getTreeByCategory('location'),
            common:   db.getTreeByCategory('common')
        };
    });

    ipcMain.handle('manage-query-photos-by-tags', (_event, { tagIds }) => {
        try {
            return { success: true, photos: db.getPhotosByTagIds(tagIds) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // ── Photo Tags ─────────────────────────────────────────
    ipcMain.handle('get-photo-tags', (_event, { photoId }) => {
        try {
            const tags = db.getPhotoTags(photoId);
            return { success: true, tags };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('link-tag-to-photo', (_event, { photoId, tagId }) => {
        try {
            db.linkTagToPhoto(photoId, tagId);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('unlink-tag-from-photo', (_event, { photoId, tagId }) => {
        try {
            db.unlinkTagFromPhoto(photoId, tagId);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('open-tag-select-window', (event, { photoId }) => {
        const senderWindow = BrowserWindow.fromWebContents(event.sender);
        if (!senderWindow) return { success: false };

        tagSelectWindow.show(senderWindow, (tags) => {
            for (const tagInfo of tags) {
                try {
                    db.linkTagToPhoto(photoId, tagInfo.tagId);
                    let locationApplied = null;
                    if (tagInfo.tagCategory === 'location') {
                        locationApplied = db.applyLandmarkLocationToPhoto(photoId, tagInfo.tagId);
                    }
                    if (senderWindow && !senderWindow.isDestroyed()) {
                        senderWindow.webContents.send('tag-added', { ...tagInfo, locationApplied });
                    }
                    if (locationApplied && mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('photo-location-updated', {
                            photoId,
                            lat: locationApplied.lat,
                            lng: locationApplied.lng
                        });
                    }
                } catch (e) {
                    console.error('Failed to link tag:', e);
                }
            }
        });
        return { success: true };
    });

    // ── 标签匹配 ─────────────────────────────────────────
    ipcMain.handle('get-all-face-descriptors', () => {
        try {
            const faceTags = db.getAllFaceTagsWithDescriptors();
            return { success: true, faceTags };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('match-tags-for-photo', (_event, { photoId, matchedFaceTagIds = [] }) => {
        try {
            const photo = db.db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
            if (!photo) return { success: false, error: 'Photo not found' };

            const existingTags = db.getPhotoTags(photoId);
            const existingIds = new Set(existingTags.map(t => t.id));
            const matchedTags = [];

            // 1. Link face tags passed from renderer
            for (const faceTagId of matchedFaceTagIds) {
                if (!existingIds.has(faceTagId)) {
                    db.linkTagToPhoto(photoId, faceTagId);
                    const tag = db.db.prepare('SELECT * FROM tags WHERE id = ?').get(faceTagId);
                    if (tag) {
                        matchedTags.push({ id: tag.id, name: tag.name, color: tag.color, category: tag.category });
                        existingIds.add(tag.id);
                    }
                }
            }

            // 2. Event matching: time + location
            if (photo.time && photo.lat != null && photo.lng != null) {
                const events = db.getAllEventTagsWithLocation();
                for (const evt of events) {
                    const eventTag = new EventTag(evt);
                    if (!eventTag.containsTime(photo.time)) continue;

                    // Check location
                    const locData = db.db.prepare(
                        'SELECT * FROM tags t JOIN tag_locations l ON t.id = l.tag_id WHERE t.id = ?'
                    ).get(evt.location_tag_id);
                    if (!locData) continue;

                    const landmark = new LandmarkTag(locData);
                    if (!landmark.containsPoint(photo.lat, photo.lng)) continue;

                    // Event matches — add event tag
                    if (!existingIds.has(evt.id)) {
                        db.linkTagToPhoto(photoId, evt.id);
                        matchedTags.push({ id: evt.id, name: evt.name, color: evt.color, category: 'event' });
                        existingIds.add(evt.id);
                    }

                    // 3. Find descendant landmark match
                    const descendants = db.getLocationTagDescendants(evt.location_tag_id);
                    // Sort by depth descending to find deepest match first
                    descendants.sort((a, b) => b._depth - a._depth);

                    let matchedLoc = null;
                    for (const desc of descendants) {
                        if (desc._depth === 0) continue; // skip root (the landmark itself), check children first
                        const descLandmark = new LandmarkTag(desc);
                        if (descLandmark.containsPoint(photo.lat, photo.lng)) {
                            matchedLoc = desc;
                            break; // deepest match
                        }
                    }
                    // If no descendant matched, use the landmark itself
                    if (!matchedLoc) {
                        matchedLoc = descendants.find(d => d._depth === 0) || null;
                    }

                    if (matchedLoc && !existingIds.has(matchedLoc.id)) {
                        db.linkTagToPhoto(photoId, matchedLoc.id);
                        matchedTags.push({ id: matchedLoc.id, name: matchedLoc.name, color: matchedLoc.color, category: 'location' });
                        existingIds.add(matchedLoc.id);
                    }
                }
            }

            return { success: true, matchedTags };
        } catch (e) {
            console.error('match-tags-for-photo error:', e);
            return { success: false, error: e.message };
        }
    });

    // 获取时间上相邻的照片（编辑位置时参考用）
    ipcMain.handle('get-photos-near-time', (_event, { photoId, count = 3 }) => {
        return db.getPhotosNearTime(photoId, count);
    });

    // 更新照片坐标（照片窗口地图编辑）
    ipcMain.handle('update-photo-location', async (_event, { photoId, lat, lng }) => {
        try {
            db.db.prepare('UPDATE photos SET lat = ?, lng = ? WHERE id = ?').run(lat, lng, photoId);

            // 同步写入照片文件 EXIF GPS（仅 JPEG，不修改拍摄日期）
            const photo = db.db.prepare('SELECT directory, filename, type FROM photos WHERE id = ?').get(photoId);
            if (photo && photo.type !== 'video') {
                const filePath = path.join(photo.directory, photo.filename);
                writeGpsToFile(filePath, lat, lng);
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('photo-location-updated', { photoId, lat, lng });
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // ── 全局人脸扫描 ────────────────────────────────────────
    ipcMain.handle('start-global-face-scan', async (_event, { tagId, mode = 'balanced' }) => {
        try {
            if (!autoFaceScanner) {
                autoFaceScanner = new AutoFaceScan(db, mainWindow);
            }
            const result = await autoFaceScanner.start(tagId, mode);
            // 启动成功则关闭标签管理窗口
            if (result.success && tagManageWindow && tagManageWindow.isOpen()) {
                tagManageWindow.close();
            }
            return result;
        } catch (err) {
            console.error('start-global-face-scan 异常:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('cancel-face-scan', async () => {
        if (autoFaceScanner && autoFaceScanner.cancel()) {
            return { success: true };
        }
        return { success: false };
    });

    // 双击时间bar/时间轴触发设置窗口
    ipcMain.on('open-timeline-settings', () => {
        pendingInitialTab = null;
        mainWindow.webContents.send('get-timeline-state');
    });
    ipcMain.on('open-timerange-settings', () => {
        pendingInitialTab = 'TimeRange';
        mainWindow.webContents.send('get-timeline-state');
    });

    // ── 照片右键菜单 ─────────────────────────────────────────
    ipcMain.on('show-photo-context-menu', (event, { photoId, directory, filename, isVideo }) => {
        const photoData = db.getPhotoByPath(directory, filename);
        const fullPath  = photoData ? photoData.fullPath : null;
        const senderWin = BrowserWindow.fromWebContents(event.sender);

        // 获取该照片当前的标签列表
        let currentTags = [];
        try { currentTags = db.getPhotoTags(photoId) || []; } catch (_) {}

        // 通知辅助：若 photo-window 正在展示此照片则发消息
        const notifyPhotoWin = (channel, data) => {
            if (photoWindow && photoWindow.isOpen() &&
                photoWindow.currentPhoto && photoWindow.currentPhoto.id === photoId) {
                photoWindow.photoWindow.webContents.send(channel, data);
            }
        };

        // ── 标签子菜单 ────────────────────────────────────────
        const tagsSubmenu = [
            {
                label: i18n.t('photo.contextMenu.addTag'),
                click: () => {
                    tagSelectWindow.show(senderWin, (tags) => {
                        for (const tagInfo of tags) {
                            try {
                                db.linkTagToPhoto(photoId, tagInfo.tagId);
                                let locationApplied = null;
                                if (tagInfo.tagCategory === 'location') {
                                    locationApplied = db.applyLandmarkLocationToPhoto(photoId, tagInfo.tagId);
                                }
                                notifyPhotoWin('tag-added', { ...tagInfo, locationApplied });
                                if (locationApplied && mainWindow && !mainWindow.isDestroyed()) {
                                    mainWindow.webContents.send('photo-location-updated', {
                                        photoId,
                                        lat: locationApplied.lat,
                                        lng: locationApplied.lng
                                    });
                                }
                            } catch (e) {
                                console.error('Failed to link tag from context menu:', e);
                            }
                        }
                    });
                }
            }
        ];

        if (currentTags.length > 0) {
            tagsSubmenu.push({ type: 'separator' });
            for (const tag of currentTags) {
                tagsSubmenu.push({
                    label: i18n.t('photo.contextMenu.removeTagPrefix') + tag.name,
                    click: () => {
                        try {
                            db.unlinkTagFromPhoto(photoId, tag.id);
                            notifyPhotoWin('tag-removed', { photoId, tagId: tag.id });
                        } catch (e) {
                            console.error('Failed to unlink tag from context menu:', e);
                        }
                    }
                });
            }
        }

        const template = [
            {
                label:   i18n.t('photo.contextMenu.copy'),
                enabled: !isVideo && !!fullPath,
                click: () => {
                    try {
                        clipboard.writeImage(nativeImage.createFromPath(fullPath));
                    } catch (e) {
                        console.error('复制照片失败:', e);
                    }
                }
            },
            {
                label:   i18n.t('photo.contextMenu.saveAs'),
                enabled: !!fullPath,
                click: async () => {
                    const ext = path.extname(filename).slice(1) || 'jpg';
                    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
                        defaultPath: filename,
                        filters: [{ name: 'Image', extensions: [ext] }]
                    });
                    if (!canceled && savePath) {
                        try { fs.copyFileSync(fullPath, savePath); } catch (e) { console.error('另存失败:', e); }
                    }
                }
            },
            { type: 'separator' },
            {
                label:   i18n.t('photo.contextMenu.tags'),
                submenu: tagsSubmenu
            },
            { type: 'separator' },
            {
                label:   i18n.t('photo.contextMenu.delete'),
                enabled: true,
                click: async () => {
                    const { response } = await dialog.showMessageBox(senderWin, {
                        type:      'warning',
                        title:     i18n.t('photo.deleteConfirmTitle'),
                        message:   i18n.t('photo.deleteConfirmMsg'),
                        buttons:   [i18n.t('photo.deleteConfirmOk'), i18n.t('photo.deleteConfirmCancel')],
                        defaultId: 1,
                        cancelId:  1
                    });
                    if (response !== 0) return;

                    // 删除原文件
                    if (fullPath) {
                        try { fs.unlinkSync(fullPath); } catch (_) {}
                        const base = path.join(path.dirname(fullPath), path.basename(fullPath, path.extname(fullPath)));
                        try { fs.unlinkSync(base + '.gpt'); } catch (_) {}  // 缩略图 sidecar
                        try { fs.unlinkSync(base + '.gpj'); } catch (_) {}  // HEIC 转换缓存
                    }

                    // 从数据库删除（ON DELETE CASCADE 自动清理 photo_tags）
                    db.deletePhoto(photoId);

                    // 通知各窗口移除该照片
                    if (photosManageWindow && photosManageWindow.isOpen()) {
                        photosManageWindow.manageWindow.webContents.send('photo-deleted', { photoId });
                    }
                    if (photoWindow && photoWindow.isOpen()) {
                        photoWindow.photoWindow.webContents.send('photo-deleted', { photoId });
                    }
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('photo-deleted', { photoId });
                    }
                }
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: senderWin });
    });

    // ── 删除照片（按钮直接触发，与右键菜单删除逻辑相同）─────────
    ipcMain.handle('delete-photo', async (event, { photoId, directory, filename }) => {
        const senderWin = BrowserWindow.fromWebContents(event.sender);
        const { response } = await dialog.showMessageBox(senderWin, {
            type:      'warning',
            title:     i18n.t('photo.deleteConfirmTitle'),
            message:   i18n.t('photo.deleteConfirmMsg'),
            buttons:   [i18n.t('photo.deleteConfirmOk'), i18n.t('photo.deleteConfirmCancel')],
            defaultId: 1,
            cancelId:  1
        });
        if (response !== 0) return { cancelled: true };

        const photoData = db.getPhotoByPath(directory, filename);
        const fullPath  = photoData ? photoData.fullPath : null;

        if (fullPath) {
            try { fs.unlinkSync(fullPath); } catch (_) {}
            const base = path.join(path.dirname(fullPath), path.basename(fullPath, path.extname(fullPath)));
            try { fs.unlinkSync(base + '.gpt'); } catch (_) {}  // 缩略图 sidecar
            try { fs.unlinkSync(base + '.gpj'); } catch (_) {}  // HEIC 转换缓存
        }

        db.deletePhoto(photoId);

        if (photosManageWindow && photosManageWindow.isOpen()) {
            photosManageWindow.manageWindow.webContents.send('photo-deleted', { photoId });
        }
        if (photoWindow && photoWindow.isOpen()) {
            photoWindow.photoWindow.webContents.send('photo-deleted', { photoId });
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('photo-deleted', { photoId });
        }
        return { deleted: true };
    });

    // 打开时间轴设置窗口
    ipcMain.on('timeline-state', (event, timelineState) => {
        if (!timelineSettingWindow || !timelineSettingWindow.window || timelineSettingWindow.window.isDestroyed()) {
            const stateWithTab = Object.assign({}, timelineState, { initialTab: pendingInitialTab });
            pendingInitialTab = null;
            timelineSettingWindow = new TimeLineSettingWindow(mainWindow, stateWithTab);
        } else {
            timelineSettingWindow.window.focus();
        }
    });
}

// ==================== 应用生命周期 ====================
app.whenReady().then(() => {
    initializeModules();
    registerIpcHandlers();
    createWindow();

    // 检查并自动恢复中断的人脸扫描任务
    const resumed = AutoFaceScan.checkAndResume(db, mainWindow);
    if (resumed) autoFaceScanner = resumed;
});

app.on('window-all-closed', () => {
    if (db) {
        db.close();
    }
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// ── GPS 写入照片文件 ────────────────────────────────────────
// 将十进制度转为 EXIF GPS 有理数格式 [度, 分, 秒]
function _decimalToGps(decimal) {
    const abs = Math.abs(decimal);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = Math.round((mFloat - m) * 60 * 10000);
    return [[d, 1], [m, 1], [s, 10000]];
}

// 将 GPS 坐标写入 JPEG 文件 EXIF，不修改 DateTimeOriginal
function writeGpsToFile(filePath, lat, lng) {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.jpg', '.jpeg'].includes(ext)) return; // 仅支持 JPEG

    let buffer;
    try {
        buffer = fs.readFileSync(filePath);
    } catch (e) {
        console.error('writeGpsToFile: 读取文件失败', filePath, e.message);
        return;
    }

    const data = buffer.toString('binary');
    let exifObj;
    try {
        exifObj = piexif.load(data);
    } catch (_) {
        exifObj = { '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {} };
    }

    exifObj['GPS'][piexif.GPSIFD.GPSLatitudeRef]  = lat >= 0 ? 'N' : 'S';
    exifObj['GPS'][piexif.GPSIFD.GPSLatitude]      = _decimalToGps(lat);
    exifObj['GPS'][piexif.GPSIFD.GPSLongitudeRef] = lng >= 0 ? 'E' : 'W';
    exifObj['GPS'][piexif.GPSIFD.GPSLongitude]     = _decimalToGps(Math.abs(lng));

    try {
        const exifBytes = piexif.dump(exifObj);
        const newData   = piexif.insert(exifBytes, data);
        fs.writeFileSync(filePath, Buffer.from(newData, 'binary'));
        console.log('GPS 写入文件成功:', filePath, lat, lng);
    } catch (e) {
        console.error('writeGpsToFile: 写入失败', filePath, e.message);
    }
}
