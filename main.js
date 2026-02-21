/**
 * main.js - Electron 主进程入口
 * 使用模块化结构管理数据库、照片等功能
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
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
    
    // 窗口关闭前保存状态
    mainWindow.on('close', () => {
        saveWindowState();
    });
}

// ==================== IPC 处理器 ====================
function registerIpcHandlers() {
    // 获取当前语言
    ipcMain.handle('get-language', () => i18n.getLanguage());

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

    // 区域查询
    ipcMain.handle('query-area', (event, range) => {
        return db.queryPhotosByArea(range.north, range.south, range.east, range.west);
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
            photoWindow.show(latestPhotoData, navPhotos, currentIndex);
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

        tagSelectWindow.show(senderWindow, (tagInfo) => {
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
