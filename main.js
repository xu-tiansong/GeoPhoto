/**
 * main.js - Electron 主进程入口
 * 使用模块化结构管理数据库、照片等功能
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const DatabaseManager = require('./modules/Database');
const PhotoManager = require('./modules/PhotoManager');
const MenuManager = require('./modules/MenuManager');
const PhotoWindow = require('./modules/PhotoWindow');

// ==================== 全局变量 ====================
let mainWindow;
let db;
let photoManager;
let menuManager;
let photoWindow;
let currentPhotoDirectory = null;

// 逆地理编码缓存和速率限制
const cityCache = new Map();
let lastGeocodingTime = 0;
const geocodingInterval = 1500; // 1.5秒间隔

// ==================== 初始化 ====================
function initializeModules() {
    // 初始化数据库
    db = new DatabaseManager('photos.db');
    
    // 初始化照片管理器
    photoManager = new PhotoManager(db);
    
    // 读取已保存的照片目录
    currentPhotoDirectory = db.getPhotoDirectory();
    console.log('当前照片目录:', currentPhotoDirectory);
}

// ==================== 目录处理 ====================
async function handleSetPhotoDirectory() {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Photo Directory'
    });
    
    if (canceled || filePaths.length === 0) return;
    
    const dirPath = filePaths[0];
    
    // 保存新目录
    db.savePhotoDirectory(dirPath);
    currentPhotoDirectory = dirPath;
    
    // 通知渲染进程开始扫描
    mainWindow.webContents.send('scan-started');
    
    // 异步执行扫描，不阻塞UI
    (async () => {
        try {
            // 使用 PhotoManager 扫描并处理目录（跳过已扫描的目录）
            const result = await photoManager.scanAndProcessDirectory(dirPath, null, true);
            
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
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        webPreferences: {
            nodeIntegration: true, 
            contextIsolation: false 
        }
    });

    mainWindow.loadFile('index.html');
    
    // 创建照片窗口管理器
    photoWindow = new PhotoWindow(mainWindow);
    
    // 创建菜单管理器并注册处理器
    menuManager = new MenuManager(mainWindow, {
        setPhotoDirectory: handleSetPhotoDirectory,
        fullscreenMap: () => {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
        },
        about: () => {
            mainWindow.webContents.send('show-about-dialog');
        }
    });
    
    // 创建应用菜单
    menuManager.createMenu();
}

// ==================== IPC 处理器 ====================
function registerIpcHandlers() {
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

    // 根据时间范围查询照片
    ipcMain.handle('query-photos-by-time', (event, { startTime, endTime }) => {
        return db.queryPhotosByTimeRange(startTime, endTime);
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
    ipcMain.handle('open-photo-window', (event, photoData) => {
        if (photoWindow) {
            photoWindow.show(photoData);
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
