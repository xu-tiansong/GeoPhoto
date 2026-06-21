/**
 * main.js - Electron 主进程入口
 * 使用模块化结构管理数据库、照片等功能
 */

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const archiver = require('archiver');
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
const AutoFaceScan     = require('./modules/AutoFaceScan');
const AutoDupScan      = require('./modules/AutoDupScan');
const DupConfirmWindow = require('./modules/DupConfirmWindow');
const SlideshowWindow  = require('./modules/SlideshowWindow');
const PhotoEditWindow  = require('./modules/PhotoEditWindow');

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
let autoFaceScanner  = null;
let autoDupScanner   = null;
let dupConfirmWindow = null;

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

    // 修复历史数据：将 directory 字段中的绝对路径转换为相对路径
    if (currentPhotoDirectory) {
        const fixed = db.normalizeDirectoryPaths(currentPhotoDirectory);
        if (fixed > 0) console.log(`[迁移] 修复了 ${fixed} 条照片的目录路径（绝对→相对）`);
    }
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

    // 为无定位照片设置默认坐标
    menuManager.registerHandler('setDefaultLocation', () => {
        setImmediate(async () => {
            const count = db.db.prepare(
                "SELECT COUNT(*) AS cnt FROM photos WHERE (lat IS NULL OR lng IS NULL) AND directory != 'Bin'"
            ).get().cnt;
            if (count === 0) {
                await dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: i18n.t('menu.map.setDefaultLocation'),
                    message: i18n.getLanguage() === 'zh'
                        ? '没有需要设置的照片（所有照片均已有定位信息）。'
                        : 'No photos need updating (all photos already have location info).',
                    buttons: ['OK']
                });
                return;
            }
            const { response } = await dialog.showMessageBox(mainWindow, {
                type: 'question',
                title: i18n.t('menu.map.setDefaultLocation'),
                message: i18n.getLanguage() === 'zh'
                    ? `共有 ${count} 张照片没有定位信息，将统一设置坐标为 (7.027442, 141.296361)，是否继续？`
                    : `${count} photo(s) have no location. Set default coordinates (7.027442, 141.296361) for all of them?`,
                buttons: i18n.getLanguage() === 'zh' ? ['确定', '取消'] : ['OK', 'Cancel'],
                defaultId: 0,
                cancelId: 1
            });
            if (response !== 0) return;
            const changed = db.setDefaultLocationForUnlocatedPhotos(7.027442337002744, 141.29636113745886);
            await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: i18n.t('menu.map.setDefaultLocation'),
                message: i18n.getLanguage() === 'zh'
                    ? `已为 ${changed} 张照片设置默认坐标。`
                    : `Default location set for ${changed} photo(s).`,
                buttons: ['OK']
            });
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('default-location-set');
            }
        });
    });

    // 移除重复照片
    menuManager.registerHandler('removeDuplicatePhotos', () => {
        // 用 setImmediate 延迟执行，避免 Electron 原生菜单点击事件中弹窗失败
        setImmediate(async () => {
            try {
                if (autoDupScanner && autoDupScanner.isRunning) {
                    await dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: i18n.t('dup.scan.confirmTitle'),
                        message: i18n.t('dup.scan.alreadyRunning'),
                        buttons: ['OK']
                    });
                    return;
                }

                // 单步确认：同时选择处理方式
                // 按钮: 0=逐组确认  1=自动移除  2=取消
                const { response } = await dialog.showMessageBox(mainWindow, {
                    type: 'question',
                    title: i18n.t('dup.scan.confirmTitle'),
                    message: i18n.t('dup.scan.confirmMsg'),
                    buttons: [
                        i18n.t('dup.scan.confirmEachMode'),
                        i18n.t('dup.scan.confirmAutoMode'),
                        i18n.t('dup.scan.confirmCancel')
                    ],
                    defaultId: 1,
                    cancelId: 2
                });
                if (response === 2) return; // 取消

                const confirmEach = response === 0;

                let confirmCallback = null;
                if (confirmEach) {
                    if (!dupConfirmWindow) {
                        dupConfirmWindow = new DupConfirmWindow(mainWindow, db);
                    }
                    confirmCallback = (photoData, stats) => dupConfirmWindow.show(photoData, stats);
                }

                const onStop = () => {
                    if (dupConfirmWindow) {
                        dupConfirmWindow.destroy();
                        dupConfirmWindow = null;
                    }
                };

                autoDupScanner = new AutoDupScan(db, mainWindow, moveFileToBin, confirmCallback, onStop);
                autoDupScanner.start();
            } catch (err) {
                console.error('[removeDuplicatePhotos] 错误:', err);
                dialog.showMessageBox(mainWindow, {
                    type: 'error',
                    title: 'Error',
                    message: err.message,
                    buttons: ['OK']
                }).catch(() => {});
            }
        });
    });

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
        if (autoFaceScanner)  autoFaceScanner.destroy();
        if (autoDupScanner)   autoDupScanner.destroy();
        if (dupConfirmWindow) dupConfirmWindow.destroy();
    });
}

// ==================== 容器内重复照片扫描 ====================

/**
 * 从 JPEG 文件的 SOF 段同步读取图像尺寸（不依赖 EXIF，始终可靠）
 * @returns {{ width: number, height: number } | null}
 */
function _readJpegSofDimensions(filePath) {
    const fs = require('fs');
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(2);
        fs.readSync(fd, buf, 0, 2, 0);
        if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null; // 非 JPEG
        let pos = 2;
        while (pos < 0xA00000) {
            fs.readSync(fd, buf, 0, 2, pos); pos += 2;
            if (buf[0] !== 0xFF) break;
            const m = buf[1];
            // SOF0-SOF3 / SOF5-SOF7 / SOF9-SOF11 / SOF13-SOF15 含图像尺寸
            if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) ||
                (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) {
                const s = Buffer.alloc(7);
                fs.readSync(fd, s, 0, 7, pos); // len(2)+precision(1)+height(2)+width(2)
                return { height: s.readUInt16BE(3), width: s.readUInt16BE(5) };
            }
            if (m === 0xD9 || m === 0xDA) break; // EOI / SOS
            fs.readSync(fd, buf, 0, 2, pos);
            const segLen = buf.readUInt16BE(0);
            if (segLen < 2) break;
            pos += segLen;
        }
        return null;
    } catch (_) { return null; }
    finally { if (fd !== undefined) try { require('fs').closeSync(fd); } catch (_) {} }
}

/**
 * 把容器内所有照片打包为 zip 文件，弹出保存对话框让用户选择路径。
 * @param {{ directory: string, filename: string }[]} photoPaths
 * @param {BrowserWindow} senderWin
 */
async function _packContainerPhotos(photoPaths, senderWin) {
    const { filePath, canceled } = await dialog.showSaveDialog(senderWin, {
        title: i18n.t('photo.contextMenu.packZip'),
        defaultPath: 'photos.zip',
        filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    });
    if (canceled || !filePath) return;

    const photoDir = db.getPhotoDirectory();
    // 收集实际存在的文件
    const files = [];
    for (const { directory, filename } of photoPaths) {
        const full = path.join(photoDir, directory, filename);
        if (fs.existsSync(full)) files.push({ full, filename });
    }
    if (files.length === 0) {
        await dialog.showMessageBox(senderWin, {
            type: 'warning',
            title: i18n.t('photo.contextMenu.packZip'),
            message: i18n.getLanguage() === 'zh' ? '没有找到可打包的照片文件。' : 'No photo files found to pack.',
            buttons: ['OK']
        });
        return;
    }

    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(filePath);
        const archive = archiver('zip', { zlib: { level: 0 } }); // level 0 = store only（照片已压缩）
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        // 文件名重复时加序号前缀
        const seen = new Map();
        for (const { full, filename } of files) {
            const count = seen.get(filename) || 0;
            seen.set(filename, count + 1);
            const entryName = count === 0 ? filename : `${count}_${filename}`;
            archive.file(full, { name: entryName });
        }
        archive.finalize();
    }).catch(async (err) => {
        await dialog.showMessageBox(senderWin, {
            type: 'error',
            title: i18n.t('photo.contextMenu.packZip'),
            message: err.message,
            buttons: ['OK']
        });
        return;
    });

    await dialog.showMessageBox(senderWin, {
        type: 'info',
        title: i18n.t('photo.contextMenu.packZip'),
        message: i18n.getLanguage() === 'zh'
            ? `已将 ${files.length} 张照片打包到：\n${filePath}`
            : `${files.length} photo(s) packed to:\n${filePath}`,
        buttons: ['OK']
    });
}

/**
 * 对当前容器中的照片子集执行重复照片检测，无进度显示，完成后弹对话框。
 */
async function _runDupScanForContainer(photoIds, senderWin) {
    // 确认框：三按钮 0=逐组确认  1=自动移除  2=取消
    const win = senderWin && !senderWin.isDestroyed() ? senderWin : mainWindow;
    const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        title: i18n.t('dup.scan.confirmTitle'),
        message: i18n.t('dup.container.confirmMsg', { count: photoIds.length }),
        buttons: [
            i18n.t('dup.scan.confirmEachMode'),
            i18n.t('dup.scan.confirmOk'),
            i18n.t('dup.scan.confirmCancel')
        ],
        defaultId: 1,
        cancelId: 2
    });
    if (response === 2) return;

    const confirmEach = response === 0;
    let localConfirmWindow = null;
    if (confirmEach) {
        localConfirmWindow = new DupConfirmWindow(mainWindow, db);
    }

    let exifrModule = null;
    const loadExifr = async () => {
        if (exifrModule !== undefined) return exifrModule;
        try { const m = await import('exifr'); exifrModule = m.default || m; }
        catch (_) { exifrModule = null; }
        return exifrModule;
    };

    const getImageDimensions = async (fp) => {
        const ext = require('path').extname(fp).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg') {
            const dims = _readJpegSofDimensions(fp);
            if (dims) return dims;
        }
        // 非 JPEG 或 SOF 读取失败时回退到 exifr
        try {
            const exifr = await loadExifr();
            if (!exifr) return { width: null, height: null };
            const tags = await exifr.parse(fp, {
                pick: ['PixelXDimension', 'PixelYDimension', 'ImageWidth', 'ImageHeight',
                       'ExifImageWidth', 'ExifImageHeight']
            });
            if (!tags) return { width: null, height: null };
            return {
                width:  tags.PixelXDimension  || tags.ExifImageWidth  || tags.ImageWidth  || null,
                height: tags.PixelYDimension  || tags.ExifImageHeight || tags.ImageHeight || null
            };
        } catch (_) { return { width: null, height: null }; }
    };

    // 1. 从 DB 拉取照片数据
    const photos = photoIds.map(id => db.getPhotoById(id)).filter(Boolean);
    console.log(`[容器去重] 选中 ${photos.length} 张照片`);

    // 2. 按 time+lat+lng 分组（经纬度四舍五入到6位小数处理精度问题）
    const groupMap = new Map();
    for (const p of photos) {
        console.log(`[容器去重] 照片 ${p.id}: time=${p.time}, lat=${p.lat}, lng=${p.lng}, dir=${p.directory}`);
        if (!p.lat || !p.lng) { console.log(`  → 跳过：无位置信息`); continue; }
        if (!p.time || p.directory === 'Bin') { console.log(`  → 跳过：无时间或在Bin`); continue; }
        const key = `${p.time}|${p.lat.toFixed(6)}|${p.lng.toFixed(6)}`;
        console.log(`  → key: ${key}`);
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key).push(p);
    }

    console.log(`[容器去重] 分组数: ${groupMap.size}`);
    for (const [key, arr] of groupMap.entries()) {
        console.log(`  组 "${key}": ${arr.length} 张`);
    }

    // 3. 阶段一：在每个候选组（时间+位置相同）内筛出真正的重复集合。
    //    判据（满足其一）：文件大小完全相同（字节副本），或基础文件名相同（去扩展名、
    //    忽略大小写，如 IMG_7976.HEIC 与 IMG_7976.JPG 同源不同格式）。用并查集合并。
    //    同一秒连拍的不同照片（文件名与大小都不同）会被正确排除。只读文件大小、不解码图片。
    let removed = 0;
    let interrupted = false;
    let processedGroups = 0;
    const candidateGroups = [...groupMap.values()].filter(g => g.length >= 2);

    const validatedGroups = []; // 每项为一组真重复的 normalizedData（DupConfirmWindow 所需格式）
    for (const group of candidateGroups) {
        // 收集路径、大小、基础文件名
        const items = [];
        for (const p of group) {
            const enriched = db.addFullPathToPhoto({ ...p });
            if (!enriched || enriched.isMissing) { console.log(`  照片 ${p.id}: 路径缺失`); continue; }
            const fp = enriched.fullPath;
            if (!require('fs').existsSync(fp)) { console.log(`  照片 ${p.id}: 文件不存在 ${fp}`); continue; }
            let size = 0;
            try { size = require('fs').statSync(fp).size; } catch (_) { console.log(`  照片 ${p.id}: 无法获取文件大小`); continue; }
            const name = p.filename || '';
            const base = path.basename(name, path.extname(name)).toLowerCase();
            items.push({ photo: p, fullPath: fp, size, width: null, height: null, _base: base });
        }
        if (items.length < 2) continue;

        // 并查集：同大小 或 同基础文件名 → 合并为一簇
        const parent = items.map((_, i) => i);
        const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                if (items[i].size === items[j].size ||
                    (items[i]._base && items[i]._base === items[j]._base)) {
                    union(i, j);
                }
            }
        }
        const clusters = new Map();
        for (let i = 0; i < items.length; i++) {
            const r = find(i);
            if (!clusters.has(r)) clusters.set(r, []);
            clusters.get(r).push(items[i]);
        }
        for (const arr of clusters.values()) {
            if (arr.length >= 2) {
                arr.sort((a, b) => b.size - a.size); // 最大文件在前（建议保留）
                arr.forEach(it => delete it._base);
                validatedGroups.push(arr);
            }
        }
    }

    const totalGroups = validatedGroups.length;

    // 阶段二：逐组处理（确认模式弹窗，自动模式直接保留第一张）
    for (let gi = 0; gi < totalGroups; gi++) {
        const normalizedData = validatedGroups[gi];
        let toRemove;

        if (confirmEach) {
            // 展示前才读取像素尺寸（仅当前组）
            for (const item of normalizedData) {
                try { const d = await getImageDimensions(item.fullPath); item.width = d.width; item.height = d.height; } catch (_) {}
            }
            const stats = { groupIndex: gi + 1, totalGroups, removedSoFar: removed };
            const result = await localConfirmWindow.show(normalizedData, stats);

            // 用户中断：当前组未处理完，不计入已处理数，直接退出
            if (result.action === 'interrupt') { interrupted = true; break; }
            processedGroups = gi + 1; // 确认或跳过均算已处理
            if (result.action === 'skip') continue;

            // 'confirm'：按索引保留用户选中的照片，移除其余
            const keepIndexSet = new Set(result.keepIndices);
            toRemove = normalizedData.filter((_, i) => !keepIndexSet.has(i));
        } else {
            // 自动移除：同大小重复保留第一张，移除其余
            toRemove = normalizedData.slice(1);
            processedGroups = gi + 1;
        }

        for (const { photo, fullPath } of toRemove) {
            try {
                moveFileToBin(photo.id, fullPath, photo.directory, photo.filename, photo.remark);
                removed++;
                const payload = { photoId: photo.id, fromDir: photo.directory, toDir: 'Bin' };
                if (senderWin && !senderWin.isDestroyed()) senderWin.webContents.send('photo-deleted', payload);
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('photo-deleted', payload);
            } catch (err) { console.error('容器去重移入Bin失败:', err.message); }
        }
    }

    if (localConfirmWindow) { localConfirmWindow.destroy(); localConfirmWindow = null; }

    // 4. 结果对话框
    await dialog.showMessageBox(win, {
        type: 'info',
        title: i18n.t('dup.scan.confirmTitle'),
        message: interrupted
            ? i18n.t('dup.scan.stoppedWithStats', { removed, processed: processedGroups })
            : i18n.t('dup.container.result', { total: photos.length, removed }),
        buttons: ['OK']
    });
}

// ==================== Bin 相关操作 ====================
/**
 * 将照片文件（及 sidecar）移动到指定目录，更新 DB 路径。
 * @param {number} photoId
 * @param {string} fullPath        照片当前完整路径
 * @param {string} targetRelDir    目标目录的相对路径
 * @returns {string} 目标目录相对路径
 */
function movePhotoToDirectory(photoId, fullPath, targetRelDir) {
    const photoDirectory = db.getPhotoDirectory();
    if (!photoDirectory) throw new Error('未设置照片目录');

    const targetAbsDir = path.join(photoDirectory, targetRelDir);
    if (!fs.existsSync(targetAbsDir)) fs.mkdirSync(targetAbsDir, { recursive: true });

    const origFilename = path.basename(fullPath);
    const ext = path.extname(origFilename);
    const baseName = path.basename(origFilename, ext);
    
    // 处理同名冲突
    let destFilename = origFilename;
    let destPath = path.join(targetAbsDir, destFilename);
    let i = 1;
    while (fs.existsSync(destPath)) {
        destFilename = `${baseName}_${i}${ext}`;
        destPath = path.join(targetAbsDir, destFilename);
        i++;
    }

    // 移动主文件
    fs.renameSync(fullPath, destPath);

    // 移动 sidecar（.gpt 缩略图、.gpj HEIC缓存）
    const srcBase  = path.join(path.dirname(fullPath), baseName);
    const destBase = path.join(targetAbsDir, path.basename(destFilename, ext));
    try { fs.renameSync(srcBase + '.gpt', destBase + '.gpt'); } catch (_) {}
    try { fs.renameSync(srcBase + '.gpj', destBase + '.gpj'); } catch (_) {}

    // 更新DB路径（保留原始remark）
    db.movePhoto(photoId, targetRelDir, destFilename, undefined);
    return targetRelDir;
}

/**
 * 将照片文件（及 sidecar）移动到 <photoDirectory>/Bin，更新 DB 路径和 remark。
 * remark 写入 JSON：{ orgrmk, orgnm, orgdir }，便于日后恢复。
 * 文件名冲突时自动加序号（原始文件名保存在 orgnm，不受影响）。
 * @param {number} photoId
 * @param {string} fullPath        照片当前完整路径
 * @param {string} originalDir     DB 中原始 directory 字段值
 * @param {string} originalFilename DB 中原始 filename 字段值
 * @param {string|null} originalRemark DB 中原始 remark 字段值
 */
function moveFileToBin(photoId, fullPath, originalDir, originalFilename, originalRemark) {
    const photoDirectory = db.getPhotoDirectory();
    if (!photoDirectory) throw new Error('未设置照片目录');

    const binDir = path.join(photoDirectory, 'Bin');
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    // 处理同名冲突：在文件名后附加序号（原始文件名记录在 orgnm，不受影响）
    const origFilename = path.basename(fullPath);
    const ext = path.extname(origFilename);
    const baseName = path.basename(origFilename, ext);
    let destFilename = origFilename;
    let destPath = path.join(binDir, destFilename);
    let i = 1;
    while (fs.existsSync(destPath)) {
        destFilename = `${baseName}_${i}${ext}`;
        destPath = path.join(binDir, destFilename);
        i++;
    }

    // 移动主文件
    fs.renameSync(fullPath, destPath);

    // 移动 sidecar（.gpt 缩略图、.gpj HEIC缓存）
    const srcBase  = path.join(path.dirname(fullPath), baseName);
    const destBase = path.join(binDir, path.basename(destFilename, ext));
    try { fs.renameSync(srcBase + '.gpt', destBase + '.gpt'); } catch (_) {}
    try { fs.renameSync(srcBase + '.gpj', destBase + '.gpj'); } catch (_) {}

    // 将原始信息写入 remark（DB 中 directory 用相对路径 'Bin'）
    const remarkJson = JSON.stringify({
        orgrmk: originalRemark !== undefined ? originalRemark : null,
        orgnm:  originalFilename,
        orgdir: originalDir
    });
    db.movePhoto(photoId, 'Bin', destFilename, remarkJson);
}

/**
 * 将目录（relPath）及其子目录下的所有照片移到 Bin，然后物理删除该目录。
 * @param {string} relPath  DB 中的相对路径（根目录为 ''）
 * @param {string} absPath  该目录的绝对路径
 * @returns {number[]} 被移动到 Bin 的照片 ID 列表
 */
function deleteDirectoryWithBin(relPath, absPath) {
    const photos = db.getPhotosByDirectoryTree(relPath);
    const movedIds = [];
    for (const photo of photos) {
        const enriched = db.addFullPathToPhoto({ ...photo });
        if (enriched && enriched.fullPath && fs.existsSync(enriched.fullPath)) {
            try {
                moveFileToBin(photo.id, enriched.fullPath, photo.directory, photo.filename, photo.remark);
                movedIds.push(photo.id);
            } catch (e) {
                console.error(`移动到Bin失败 [${enriched.fullPath}]:`, e.message);
            }
        }
    }
    // 删除物理目录（照片文件已移走，目录应为空或仅剩子目录）
    if (fs.existsSync(absPath)) {
        try { fs.rmSync(absPath, { recursive: true, force: true }); } catch (e) {
            console.error(`删除目录失败 [${absPath}]:`, e.message);
        }
    }
    return movedIds;
}

/**
 * 将照片从 Bin 恢复到原始目录，并还原 remark。
 * @param {number} photoId
 * @param {string} fullPath   照片当前完整路径（在 Bin 内）
 * @param {string} remarkJson DB 中当前 remark（含 orgrmk/orgnm/orgdir）
 */
function restorePhotoFromBin(photoId, fullPath, remarkJson) {
    const photoDirectory = db.getPhotoDirectory();
    if (!photoDirectory) throw new Error('未设置照片目录');

    console.log('[restore] remarkJson =', JSON.stringify(remarkJson));

    // 尝试解析 JSON remark，失败时降级使用 Bin 文件名 + 根目录
    let orgrmk = remarkJson;   // 默认保留当前 remark（非 JSON 时即用户原始备注）
    let orgnm  = path.basename(fullPath);
    let orgdir = '';

    try {
        const parsed = JSON.parse(remarkJson);
        console.log('[restore] parsed =', parsed);
        if (parsed && typeof parsed === 'object') {
            orgrmk = parsed.orgrmk !== undefined ? parsed.orgrmk : null;
            if (parsed.orgnm) orgnm = parsed.orgnm;
            orgdir = parsed.orgdir != null ? String(parsed.orgdir) : '';
        }
    } catch (e) {
        console.log('[restore] JSON.parse 失败:', e.message);
        // remark 不是 JSON（旧版本记录或用户手写备注），使用 Bin 文件名恢复到根目录
    }
    console.log('[restore] orgdir =', JSON.stringify(orgdir), '| orgnm =', orgnm);

    // 计算原始目录绝对路径（orgdir 可能是相对路径也可能是绝对路径）
    const orgDirAbs = path.isAbsolute(orgdir) ? orgdir : path.join(photoDirectory, orgdir);
    if (!fs.existsSync(orgDirAbs)) fs.mkdirSync(orgDirAbs, { recursive: true });

    const destPath = path.join(orgDirAbs, orgnm);
    fs.renameSync(fullPath, destPath);

    // 移动 sidecar
    const srcBase  = path.join(path.dirname(fullPath), path.basename(fullPath, path.extname(fullPath)));
    const destBase = path.join(orgDirAbs, path.basename(orgnm, path.extname(orgnm)));
    try { fs.renameSync(srcBase + '.gpt', destBase + '.gpt'); } catch (_) {}
    try { fs.renameSync(srcBase + '.gpj', destBase + '.gpj'); } catch (_) {}

    // 恢复 DB 路径和 remark
    db.movePhoto(photoId, orgdir, orgnm, orgrmk);
    return orgdir;
}

// ==================== IPC 处理器 ====================
function registerIpcHandlers() {
    SlideshowWindow.registerIPC();
    PhotoEditWindow.registerIPC(db);
    // 启动诊断：返回 DB 照片基本统计，方便在渲染器 DevTools 中检查
    ipcMain.handle('get-startup-diagnostics', () => {
        try {
            const photoDir = db.getPhotoDirectory();
            const total = db.db.prepare('SELECT COUNT(*) as cnt FROM photos WHERE directory != "Bin"').get();
            const samples = db.db.prepare('SELECT directory, filename, time FROM photos WHERE directory != "Bin" LIMIT 5').all();
            const minMax = db.db.prepare('SELECT MIN(time) as minT, MAX(time) as maxT FROM photos WHERE directory != "Bin"').get();
            return { photoDir, totalPhotos: total.cnt, samples, minTime: minMax.minT, maxTime: minMax.maxT };
        } catch (e) {
            return { error: e.message };
        }
    });

    // 获取当前语言
    ipcMain.handle('get-language', () => i18n.getLanguage());

    // 读取原始文件的 EXIF Orientation（数字 1..8），失败回退 1。
    // 必须关闭 translateValues，否则 exifr 会把 6 翻译成 "Rotate 90 CW" 字符串。
    async function readExifOrientation(filePath) {
        try {
            const exifr = require('exifr');
            const meta = await exifr.parse(filePath, { pick: ['Orientation'], translateValues: false });
            const o = meta && meta.Orientation;
            return (typeof o === 'number' && o >= 1 && o <= 8) ? o : 1;
        } catch (_) { return 1; }
    }

    // 给解码出的 JPEG 写入正确的 EXIF Orientation 标签。
    // nativeImage / heic-convert 输出的都是「原始像素方向」且不含方向标签，
    // 打上标签后浏览器 <img>（默认 image-orientation: from-image）会自动摆正，
    // 放大视图、缩略图生成、去重确认窗等所有消费方都一致正确。
    // orientation === 1 时原样返回（绝大多数横拍照片零开销）。
    function stampOrientation(jpegBuf, orientation) {
        if (!orientation || orientation === 1) return jpegBuf;
        try {
            const dataStr = jpegBuf.toString('binary');
            let exifObj;
            try { exifObj = piexif.load(dataStr); }
            catch (_) { exifObj = { '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {} }; }
            if (!exifObj['0th']) exifObj['0th'] = {};
            exifObj['0th'][piexif.ImageIFD.Orientation] = orientation;
            const exifBytes = piexif.dump(exifObj);
            return Buffer.from(piexif.insert(exifBytes, dataStr), 'binary');
        } catch (_) {
            return jpegBuf;   // 打标签失败则退回未标版（仍可显示，只是方向不修正）
        }
    }

    // HEIC → JPEG 转换（Chromium 不原生支持 HEIC，通过主进程解码）
    // Step 1: 命中 .gpj 缓存文件 → 直接返回（最快）
    // Step 2: nativeImage.createFromPath() → 利用 Windows HEIC 解码器（快，需系统安装扩展）
    // Step 3: heic-convert WASM → 纯软件解码（慢，但不依赖系统扩展）
    // Step 4: exifr.thumbnail() 内嵌预览降级 → 低分辨率
    // 所有步骤的输出都补盖 EXIF Orientation（含缓存命中，自动修复旧的无标签缓存）。
    ipcMain.handle('convert-heic', async (_event, { filePath }) => {
        const ext = path.extname(filePath);
        const cacheFile = filePath.slice(0, -ext.length) + '.gpj';
        const orientation = await readExifOrientation(filePath);
        const stamp = (buf) => stampOrientation(buf, orientation);

        // Step 1: 命中缓存（旧缓存为原始方向、无标签，这里补盖标签后返回）
        try {
            const cached = fs.readFileSync(cacheFile);
            if (cached.length > 5000) {
                return { success: true, data: stamp(cached).toString('base64') };
            }
        } catch (_) {}

        // Step 2: 原生 OS 解码（Windows 安装了 HEIC 扩展时极快）
        try {
            const img = nativeImage.createFromPath(filePath);
            if (!img.isEmpty()) {
                const jpegBuf = img.toJPEG(92);
                try { fs.writeFileSync(cacheFile, jpegBuf); } catch (_) {}   // 缓存原始版，读时再补标签
                return { success: true, data: stamp(jpegBuf).toString('base64') };
            }
        } catch (_) {}

        // Step 3: heic-convert WASM（较慢，成功后写入缓存）
        try {
            const { default: heicConvert } = await import('heic-convert');
            const inputBuffer = fs.readFileSync(filePath);
            const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 1 });
            const jpegBuf = Buffer.from(outputBuffer);
            try { fs.writeFileSync(cacheFile, jpegBuf); } catch (_) {}
            return { success: true, data: stamp(jpegBuf).toString('base64') };
        } catch (convertErr) {
            // Step 4: 内嵌 JPEG 预览降级（低分辨率）
            try {
                const exifr = require('exifr');
                const thumbnailBuf = await exifr.thumbnail(filePath);
                if (thumbnailBuf && thumbnailBuf.length > 5000) {
                    return { success: true, data: stamp(Buffer.from(thumbnailBuf)).toString('base64') };
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

        const uniqueDirs = db.getAllDirectoriesWithCounts(); // [{directory, count}] 包括空目录
        if (uniqueDirs.length === 0) return [];

        // 将绝对路径（在 photoDir 范围内）转为相对路径，其余绝对路径忽略
        const normPhotoDir = path.normalize(photoDir);
        const photoDirPrefix = normPhotoDir + path.sep;
        function toRel(d) {
            if (!path.isAbsolute(d)) return d;
            const nd = path.normalize(d);
            if (nd === normPhotoDir) return '';
            if (nd.startsWith(photoDirPrefix)) return nd.slice(photoDirPrefix.length);
            return null;
        }

        const dirCountMap = new Map();
        for (const r of uniqueDirs) {
            const rel = toRel(r.directory);
            if (rel === null) continue;
            dirCountMap.set(rel, (dirCountMap.get(rel) || 0) + r.count);
        }
        const allRelDirs = [...dirCountMap.keys()];

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

    // 「另存副本」后：把新照片插入导航列表的当前项之后并跳转到它，
    // 使翻页箭头能在原图与副本之间正常切换。
    ipcMain.handle('insert-edited-copy-into-nav', (_event, newPhoto) => {
        if (!photoWindow || !photoWindow.isOpen() || !newPhoto) return { success: false };
        const entry = { directory: newPhoto.directory, filename: newPhoto.filename };

        if (Array.isArray(photoWindow.navPhotos) && photoWindow.navPhotos.length > 0) {
            const insertAt = Math.min(photoWindow.currentIndex + 1, photoWindow.navPhotos.length);
            photoWindow.navPhotos.splice(insertAt, 0, entry);
            photoWindow.currentIndex = insertAt;
        } else {
            // 之前无导航列表（单张打开）：用原图 + 副本组成两项列表
            const orig = photoWindow.currentPhoto;
            const origEntry = orig ? { directory: orig.directory, filename: orig.filename } : null;
            photoWindow.navPhotos = origEntry ? [origEntry, entry] : [entry];
            photoWindow.currentIndex = photoWindow.navPhotos.length - 1;
        }
        photoWindow.currentPhoto = newPhoto;
        photoWindow.photoWindow.webContents.send('set-navigation', {
            currentIndex: photoWindow.currentIndex,
            total: photoWindow.navPhotos.length
        });
        return { success: true, currentIndex: photoWindow.currentIndex, total: photoWindow.navPhotos.length };
    });

    // 编辑落盘后（另存副本入库 / 覆盖原图且改名）通知主窗口刷新地图标记，
    // 使新照片立即出现、改名照片的标记指向新文件，而不必等用户手动调整日期。
    ipcMain.handle('refresh-map-photos', (_event, photo) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('map-photos-changed', photo);
        }
        return true;
    });

    // 「覆盖原图」且格式改变（HEIC→JPG 改名）后：更新当前导航项的文件名，
    // 否则翻页离开再回来会因旧文件名找不到记录。
    ipcMain.handle('update-current-nav-entry', (_event, newPhoto) => {
        if (!photoWindow || !photoWindow.isOpen() || !newPhoto) return { success: false };
        photoWindow.currentPhoto = newPhoto;
        if (Array.isArray(photoWindow.navPhotos) &&
            photoWindow.currentIndex >= 0 &&
            photoWindow.currentIndex < photoWindow.navPhotos.length) {
            photoWindow.navPhotos[photoWindow.currentIndex] = {
                directory: newPhoto.directory,
                filename:  newPhoto.filename
            };
        }
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

    // 获取/保存相似照片参数设置（minuteRange + threshold）
    ipcMain.handle('get-sim-settings', () => {
        const minutes   = parseInt(db.getSetting('sim_minutes'),   10);
        const threshold = parseInt(db.getSetting('sim_threshold'), 10);
        return {
            minutes:   isNaN(minutes)   ? 5  : minutes,
            threshold: isNaN(threshold) ? 50 : threshold,
        };
    });

    ipcMain.handle('save-sim-settings', (_event, { minutes, threshold }) => {
        if (minutes   !== undefined) db.saveSetting('sim_minutes',   minutes);
        if (threshold !== undefined) db.saveSetting('sim_threshold', threshold);
    });

    // 获取相似候选照片列表（Similar tab 用）
    ipcMain.handle('get-similar-photos', (_event, { photoId, minuteRange = 5 }) => {
        try {
            const photos = db.getSimilarPhotosByTime(photoId, minuteRange);
            return { success: true, photos };
        } catch (e) {
            return { success: false, error: e.message, photos: [] };
        }
    });

    // 批量移除相似照片到 Bin（Similar tab 用，含确认对话框）
    ipcMain.handle('remove-similar-photos', async (event, { photoIds }) => {
        try {
            const senderWin = BrowserWindow.fromWebContents(event.sender);
            const { response } = await dialog.showMessageBox(senderWin, {
                type: 'warning',
                title: '移到回收站',
                message: `确认将 ${photoIds.length} 张照片移入回收站？`,
                buttons: ['移除', '取消'],
                defaultId: 1,
                cancelId: 1
            });
            if (response !== 0) return { cancelled: true, removedIds: [] };

            const removedIds = [];
            for (const photoId of photoIds) {
                const photoData = db.addFullPathToPhoto(db.getPhotoById(photoId));
                if (!photoData) continue;
                const fullPath = photoData.fullPath;
                if (fullPath && fs.existsSync(fullPath)) {
                    moveFileToBin(photoId, fullPath, photoData.directory, photoData.filename, photoData.remark);
                    removedIds.push(photoId);
                }
            }
            for (const photoId of removedIds) {
                const payload = { photoId, fromDir: null, toDir: 'Bin' };
                if (photosManageWindow && photosManageWindow.isOpen())
                    photosManageWindow.manageWindow.webContents.send('photo-deleted', payload);
                if (mainWindow && !mainWindow.isDestroyed())
                    mainWindow.webContents.send('photo-deleted', payload);
            }
            return { success: true, removedIds };
        } catch (e) {
            return { success: false, error: e.message };
        }
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
    ipcMain.handle('get-tag-auto-scan-cursor', (_event, tagId) => {
        return db.getTagAutoScanCursor(tagId);
    });

    ipcMain.handle('start-global-face-scan', async (_event, { tagId, mode = 'balanced', fromScratch = false }) => {
        try {
            if (!autoFaceScanner) {
                autoFaceScanner = new AutoFaceScan(db, mainWindow);
            }
            const result = await autoFaceScanner.start(tagId, mode, fromScratch);
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

    ipcMain.handle('cancel-dup-scan', async () => {
        if (autoDupScanner && autoDupScanner.cancel()) {
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

    // ── 容器背景右键菜单 ────────────────────────────────────────
    ipcMain.on('show-container-context-menu', (event, { photoIds, photoPaths }) => {
        const senderWin = BrowserWindow.fromWebContents(event.sender);
        const template = [];

        // "移除重复照片"（超过1张才启用）
        template.push({
            label: i18n.t('photo.contextMenu.removeDupsInContainer'),
            enabled: photoIds.length > 1,
            click: () => _runDupScanForContainer(photoIds, senderWin)
        });

        template.push({ type: 'separator' });

        // "生成打包文件"
        template.push({
            label: i18n.t('photo.contextMenu.packZip'),
            click: () => _packContainerPhotos(photoPaths, senderWin)
        });

        Menu.buildFromTemplate(template).popup({ window: senderWin });
    });

    // ── 照片右键菜单 ─────────────────────────────────────────
    ipcMain.on('show-photo-context-menu', (event, { photoId, directory, filename, isVideo, navPhotos, currentIndex }) => {
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

        // 判断照片是否在 Bin 目录（用于切换菜单项）
        const photoDirectory = db.getPhotoDirectory();
        const binDirAbs = photoDirectory ? path.join(photoDirectory, 'Bin') : null;
        const isInBin = !!(fullPath && binDirAbs &&
            path.normalize(path.dirname(fullPath)) === path.normalize(binDirAbs));

        // 广播辅助
        const notifyAllWindows = (channel, data) => {
            if (photosManageWindow && photosManageWindow.isOpen())
                photosManageWindow.manageWindow.webContents.send(channel, data);
            if (photoWindow && photoWindow.isOpen())
                photoWindow.photoWindow.webContents.send(channel, data);
            if (mainWindow && !mainWindow.isDestroyed())
                mainWindow.webContents.send(channel, data);
        };

        const template = [
            {
                label:   i18n.t('photo.contextMenu.open'),
                enabled: !!fullPath,
                click: () => {
                    if (photoWindow && photoData) {
                        photoWindow.show(photoData, navPhotos || null, currentIndex ?? -1, senderWin !== mainWindow ? senderWin : null);
                    }
                }
            },
            { type: 'separator' },
            {
                label:   i18n.t('photo.contextMenu.setWallpaper'),
                enabled: !isVideo && !!fullPath,
                click: () => {
                    if (!fullPath) return;
                    // 设置注册表：WallpaperStyle=10(Fill/Cover), TileWallpaper=0
                    const escapedPath = fullPath.replace(/'/g, "''");
                    const ps = `
$regPath = 'HKCU:\\Control Panel\\Desktop';
Set-ItemProperty -Path $regPath -Name WallpaperStyle -Value 10;
Set-ItemProperty -Path $regPath -Name TileWallpaper -Value 0;
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool SystemParametersInfo(int a, int b, string c, int d); }';
[W]::SystemParametersInfo(20, 0, '${escapedPath}', 3);
`.trim();
                    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], (err) => {
                        if (err) console.error('设置桌面壁纸失败:', err);
                    });
                }
            },
            { type: 'separator' },
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
            {
                label:   i18n.t('photo.contextMenu.refreshThumbnail'),
                enabled: !!fullPath,
                click: () => {
                    // 缩略图重建需在渲染进程用 canvas 进行（会按 EXIF 方向自动摆正），
                    // 通知触发右键菜单的窗口（照片管理窗）重建该照片缩略图。
                    if (senderWin && !senderWin.isDestroyed()) {
                        senderWin.webContents.send('regenerate-thumbnail', { photoId, fullPath });
                    }
                }
            },
            { type: 'separator' },
            {
                label:   i18n.t('photo.contextMenu.tags'),
                submenu: tagsSubmenu
            },
            { type: 'separator' },
            // "移动到"子菜单（仅非Bin照片显示）
            ...(!isInBin ? [(() => {
                // 构建目录子菜单
                const photoDir = db.getPhotoDirectory();
                if (!photoDir) return { label: i18n.t('photo.contextMenu.moveTo'), enabled: false };
                
                const uniqueDirs = db.getAllDirectoriesWithCounts();
                const normPhotoDir = path.normalize(photoDir);
                const photoDirPrefix = normPhotoDir + path.sep;
                
                function toRel(d) {
                    if (!path.isAbsolute(d)) return d;
                    const nd = path.normalize(d);
                    if (nd === normPhotoDir) return '';
                    if (nd.startsWith(photoDirPrefix)) return nd.slice(photoDirPrefix.length);
                    return null;
                }
                
                const allRelDirs = new Set();
                for (const r of uniqueDirs) {
                    const rel = toRel(r.directory);
                    if (rel !== null && rel !== 'Bin') allRelDirs.add(rel);
                }
                
                // 递归构建子菜单
                function buildSubmenu(relPath) {
                    const children = [];
                    const visited = new Set();
                    
                    for (const d of allRelDirs) {
                        if (d === relPath) continue;
                        let rest;
                        if (relPath === '') {
                            if (d === '') continue;
                            rest = d;
                        } else {
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
                        children.push({ relPath: childRel, name: firstSeg });
                    }
                    
                    children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                    
                    return children.map(child => {
                        const subChildren = buildSubmenu(child.relPath);
                        const isCurrent = (directory === child.relPath);
                        const menuItem = {
                            label: child.name,
                            // 有子目录时始终启用（禁用会导致 Windows 原生菜单不打开子菜单）
                            enabled: subChildren.length > 0 || !isCurrent,
                            click: () => {
                                if (isCurrent || !fullPath || !photoData) return;
                                try {
                                    const fromDir = photoData.directory;
                                    movePhotoToDirectory(photoId, fullPath, child.relPath);
                                    notifyAllWindows('photo-deleted', { photoId, fromDir, toDir: child.relPath });
                                } catch (e) {
                                    console.error('移动照片失败:', e);
                                    dialog.showMessageBox(senderWin, { type: 'error', message: e.message });
                                }
                            }
                        };
                        if (subChildren.length > 0) {
                            menuItem.submenu = subChildren;
                        }
                        return menuItem;
                    });
                }
                
                const rootSubmenu = buildSubmenu('');
                // 添加根目录选项
                const isAtRoot = (directory === '');
                rootSubmenu.unshift({
                    label: path.basename(photoDir) + ' (根目录)',
                    enabled: !isAtRoot,
                    click: () => {
                        if (!fullPath || !photoData) return;
                        try {
                            const fromDir = photoData.directory;
                            movePhotoToDirectory(photoId, fullPath, '');
                            notifyAllWindows('photo-deleted', { photoId, fromDir, toDir: '' });
                        } catch (e) {
                            console.error('移动照片失败:', e);
                            dialog.showMessageBox(senderWin, { type: 'error', message: e.message });
                        }
                    }
                });
                if (rootSubmenu.length > 1) {
                    rootSubmenu.splice(1, 0, { type: 'separator' });
                }
                
                return {
                    label:   i18n.t('photo.contextMenu.moveTo'),
                    enabled: !!fullPath,
                    submenu: rootSubmenu
                };
            })()] : []),
            // Bin 内照片显示"恢复"，否则显示"移到回收站"
            isInBin ? {
                label:   i18n.t('photo.contextMenu.restore'),
                enabled: !!fullPath,
                click: async () => {
                    if (!fullPath || !photoData) return;
                    try {
                        const toDir = restorePhotoFromBin(photoId, fullPath, photoData.remark);
                        notifyAllWindows('photo-deleted', { photoId, fromDir: 'Bin', toDir });
                    } catch (e) {
                        console.error('恢复失败:', e);
                        dialog.showMessageBox(senderWin, { type: 'error', message: e.message });
                    }
                }
            } : {
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

                    if (fullPath && photoData) {
                        try {
                            moveFileToBin(photoId, fullPath, photoData.directory, photoData.filename, photoData.remark);
                        } catch (e) {
                            console.error('移动到回收站失败:', e);
                        }
                    }
                    notifyAllWindows('photo-deleted', { photoId, fromDir: photoData ? photoData.directory : null, toDir: 'Bin' });
                }
            }
        ];

        const menu = Menu.buildFromTemplate(template);
        menu.popup({ window: senderWin });
    });

    // ── 定位到主地图（关闭照片窗和管理窗，主窗口飞到该位置）────────
    ipcMain.on('locate-photo-on-main-map', (_event, { lat, lng }) => {
        if (photosManageWindow && photosManageWindow.isOpen()) {
            photosManageWindow.manageWindow.close();
        }
        if (photoWindow && photoWindow.isOpen()) {
            photoWindow.photoWindow.close();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('locate-on-map', { lat, lng });
            mainWindow.focus();
        }
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

        if (fullPath && photoData) {
            try {
                moveFileToBin(photoId, fullPath, photoData.directory, photoData.filename, photoData.remark);
            } catch (e) {
                console.error('移动到回收站失败:', e);
            }
        }

        const payload = { photoId, fromDir: photoData ? photoData.directory : null, toDir: 'Bin' };
        if (photosManageWindow && photosManageWindow.isOpen()) {
            photosManageWindow.manageWindow.webContents.send('photo-deleted', payload);
        }
        if (photoWindow && photoWindow.isOpen()) {
            photoWindow.photoWindow.webContents.send('photo-deleted', payload);
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('photo-deleted', payload);
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

    // ── 目录右键菜单 ─────────────────────────────────────────
    ipcMain.on('show-directory-context-menu', (event, { relPath, absPath, name }) => {
        const senderWin = BrowserWindow.fromWebContents(event.sender);
        
        // Bin 目录特殊处理：显示「恢复全部照片」菜单
        if (relPath === 'Bin') {
            const binPhotos = db.getPhotosByDirectoryTree('Bin');
            const template = [
                {
                    label:   i18n.t('dir.contextMenu.restoreAll'),
                    enabled: binPhotos.length > 0,
                    click: async () => {
                        const { response } = await dialog.showMessageBox(senderWin, {
                            type:      'question',
                            title:     i18n.t('dir.restoreAllConfirmTitle'),
                            message:   i18n.t('dir.restoreAllConfirmMsg', { count: binPhotos.length }),
                            buttons:   [i18n.t('dir.restoreAllConfirmOk'), i18n.t('dir.restoreAllConfirmCancel')],
                            defaultId: 1,
                            cancelId:  1
                        });
                        if (response !== 0) return;

                        let successCount = 0;
                        let failCount = 0;
                        for (const photo of binPhotos) {
                            const enriched = db.addFullPathToPhoto({ ...photo });
                            if (enriched && enriched.fullPath && fs.existsSync(enriched.fullPath)) {
                                try {
                                    restorePhotoFromBin(photo.id, enriched.fullPath, photo.remark);
                                    successCount++;
                                } catch (e) {
                                    console.error(`恢复照片失败 [${enriched.fullPath}]:`, e.message);
                                    failCount++;
                                }
                            } else {
                                failCount++;
                            }
                        }

                        // 通知渲染进程刷新
                        senderWin.webContents.send('bin-photos-restored');

                        dialog.showMessageBox(senderWin, {
                            type:    'info',
                            title:   i18n.t('dir.restoreAllCompleteTitle'),
                            message: i18n.t('dir.restoreAllCompleteMsg', { success: successCount, fail: failCount })
                        });
                    }
                },
                {
                    label:   i18n.t('dir.contextMenu.emptyBin'),
                    enabled: binPhotos.length > 0,
                    click: async () => {
                        const { response } = await dialog.showMessageBox(senderWin, {
                            type:      'warning',
                            title:     i18n.t('dir.emptyBinConfirmTitle'),
                            message:   i18n.t('dir.emptyBinConfirmMsg', { count: binPhotos.length }),
                            buttons:   [i18n.t('dir.emptyBinConfirmOk'), i18n.t('dir.emptyBinConfirmCancel')],
                            defaultId: 1,
                            cancelId:  1
                        });
                        if (response !== 0) return;

                        let deleted = 0;
                        let fail    = 0;
                        const deletedIds = [];

                        for (const photo of binPhotos) {
                            const enriched = db.addFullPathToPhoto({ ...photo });
                            if (!enriched || !enriched.fullPath) { fail++; continue; }

                            const fullPath = enriched.fullPath;
                            const ext      = path.extname(fullPath);
                            const base     = path.join(path.dirname(fullPath), path.basename(fullPath, ext));

                            // 删除主文件
                            try {
                                if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                            } catch (e) {
                                console.error(`清空Bin: 删除文件失败 [${fullPath}]:`, e.message);
                                fail++;
                                continue;
                            }

                            // 删除 sidecar（.gpt 缩略图、.gpj HEIC缓存），失败不影响计数
                            try { fs.unlinkSync(base + '.gpt'); } catch (_) {}
                            try { fs.unlinkSync(base + '.gpj'); } catch (_) {}

                            deletedIds.push(photo.id);
                            deleted++;
                        }

                        // 批量删除 DB 记录（含 photo_tags）
                        if (deletedIds.length > 0) {
                            db.deletePhotosByIds(deletedIds);
                        }

                        // 通知渲染进程刷新
                        senderWin.webContents.send('bin-photos-restored');

                        dialog.showMessageBox(senderWin, {
                            type:    'info',
                            title:   i18n.t('dir.emptyBinCompleteTitle'),
                            message: i18n.t('dir.emptyBinCompleteMsg', { deleted, fail })
                        });
                    }
                }
            ];
            Menu.buildFromTemplate(template).popup({ window: senderWin });
            return;
        }
        
        const isRoot = relPath === '';

        const template = [
            {
                label:   i18n.t('dir.contextMenu.createSubdir'),
                click: () => {
                    // 通知渲染进程开启内联输入创建子目录
                    senderWin.webContents.send('dir-create-subdir-prompt', { relPath, absPath });
                }
            },
            {
                label:   i18n.t('dir.contextMenu.rename'),
                enabled: !isRoot,
                click: () => {
                    // 通知渲染进程启动内联重命名
                    senderWin.webContents.send('dir-rename-prompt', { relPath, name });
                }
            },
            {
                label:   i18n.t('dir.contextMenu.delete'),
                enabled: !isRoot,
                click: async () => {
                    const { response } = await dialog.showMessageBox(senderWin, {
                        type:      'warning',
                        title:     i18n.t('dir.deleteConfirmTitle'),
                        message:   i18n.t('dir.deleteConfirmMsg', { name }),
                        buttons:   [i18n.t('dir.deleteConfirmOk'), i18n.t('dir.deleteConfirmCancel')],
                        defaultId: 1,
                        cancelId:  1
                    });
                    if (response !== 0) return;
                    try {
                        const movedIds = deleteDirectoryWithBin(relPath, absPath);
                        senderWin.webContents.send('directory-deleted', { relPath });
                        // 通知主窗口从地图移除照片标记
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            for (const photoId of movedIds) {
                                mainWindow.webContents.send('photo-deleted', { photoId, fromDir: relPath, toDir: 'Bin' });
                            }
                        }
                    } catch (e) {
                        console.error('删除目录失败:', e);
                        dialog.showMessageBox(senderWin, { type: 'error', message: e.message });
                    }
                }
            }
        ];
        Menu.buildFromTemplate(template).popup({ window: senderWin });
    });

    // ── 目录重命名 ──────────────────────────────────────────
    ipcMain.handle('rename-directory', (_event, { oldRelPath, newName }) => {
        if (!newName || /[\\/:*?"<>|]/.test(newName)) {
            return { success: false, error: i18n.t('dir.invalidName') || '目录名包含非法字符' };
        }
        const photoDirectory = db.getPhotoDirectory();
        if (!photoDirectory) return { success: false, error: '未设置照片目录' };

        // 计算新相对路径（保留父目录部分）
        const sep = path.sep;
        const lastSep = Math.max(oldRelPath.lastIndexOf('\\'), oldRelPath.lastIndexOf('/'));
        const parentRel = lastSep >= 0 ? oldRelPath.slice(0, lastSep) : '';
        const newRelPath = parentRel ? parentRel + sep + newName : newName;

        const oldAbsPath = path.join(photoDirectory, oldRelPath);
        const newAbsPath = path.join(photoDirectory, newRelPath);

        if (!fs.existsSync(oldAbsPath)) return { success: false, error: '目录不存在' };
        if (fs.existsSync(newAbsPath)) return { success: false, error: '同名目录已存在' };

        try {
            fs.renameSync(oldAbsPath, newAbsPath);
        } catch (e) {
            return { success: false, error: e.message };
        }
        db.renamePhotosDirectory(oldRelPath, newRelPath);
        return { success: true, newRelPath, newName };
    });

    // ── 创建子目录 ──────────────────────────────────────────
    ipcMain.handle('create-subdirectory', (_event, { parentRelPath, subDirName }) => {
        if (!subDirName || /[\\/:*?"<>|]/.test(subDirName)) {
            return { success: false, error: i18n.t('dir.invalidName') || '目录名包含非法字符' };
        }
        if (subDirName.toLowerCase() === 'bin') {
            return { success: false, error: '"Bin" 是系统保留目录名，请使用其他名称' };
        }
        const photoDirectory = db.getPhotoDirectory();
        if (!photoDirectory) return { success: false, error: '未设置照片目录' };

        // 计算新子目录的相对路径和绝对路径
        const newRelPath = parentRelPath ? parentRelPath + path.sep + subDirName : subDirName;
        const newAbsPath = path.join(photoDirectory, newRelPath);

        if (fs.existsSync(newAbsPath)) {
            return { success: false, error: '同名目录已存在' };
        }

        try {
            fs.mkdirSync(newAbsPath, { recursive: true });
        } catch (e) {
            return { success: false, error: e.message };
        }

        // 添加到 directories 表
        db.addDirectory(newRelPath);

        return { success: true, newRelPath, newAbsPath, name: subDirName };
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

    // 检查并自动恢复中断的重复照片移除任务
    const resumedDup = AutoDupScan.checkAndResume(db, mainWindow, moveFileToBin);
    if (resumedDup) autoDupScanner = resumedDup;
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
