const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const exifr = require('exifr');

let mainWindow;
let currentPhotoDirectory = null; // 当前指定的照片目录

// 1. 初始化 SQLite 数据库
const db = new Database('photos.db');
db.exec(`
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

// 检查并添加新列（如果不存在）
try {
    const tableInfo = db.prepare("PRAGMA table_info(photos)").all();
    const hasTypeColumn = tableInfo.some(col => col.name === 'type');
    const hasDirectoryColumn = tableInfo.some(col => col.name === 'directory');
    const hasFilenameColumn = tableInfo.some(col => col.name === 'filename');
    
    if (!hasTypeColumn) {
        db.exec("ALTER TABLE photos ADD COLUMN type TEXT DEFAULT 'photo'");
        console.log('已添加 type 列到 photos 表');
    }
    if (!hasDirectoryColumn) {
        db.exec("ALTER TABLE photos ADD COLUMN directory TEXT");
        console.log('已添加 directory 列到 photos 表');
    }
    if (!hasFilenameColumn) {
        db.exec("ALTER TABLE photos ADD COLUMN filename TEXT");
        console.log('已添加 filename 列到 photos 表');
    }
    
    // 迁移旧数据：将 path 拆分为 directory 和 filename
    const oldRecords = db.prepare("SELECT id, path FROM photos WHERE path IS NOT NULL AND (directory IS NULL OR filename IS NULL)").all();
    const updateStmt = db.prepare("UPDATE photos SET directory = ?, filename = ? WHERE id = ?");
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
} catch (err) {
    console.log('检查/添加列时出错:', err);
}

// 创建索引以加速查询
try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_time ON photos(time)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_lat_lng ON photos(lat, lng)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_time_geo ON photos(time, lat, lng)`);
    console.log('数据库索引已创建/验证');
} catch (err) {
    console.log('创建索引时出错:', err);
}

// 创建设置表来存储当前照片目录
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// 读取已保存的照片目录
function loadSavedPhotoDirectory() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('photoDirectory');
    if (row) {
        currentPhotoDirectory = row.value;
    }
}

// 保存照片目录到数据库
function savePhotoDirectory(dirPath) {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run('photoDirectory', dirPath);
    currentPhotoDirectory = dirPath;
}

// 支持的照片和视频格式
const PHOTO_EXTENSIONS = /\.(jpg|jpeg|heic|png|gif|bmp|webp)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp)$/i;

// 检查文件是否已存在于数据库
function isFileExists(dirPath, filename) {
    const row = db.prepare('SELECT id FROM photos WHERE directory = ? AND filename = ?').get(dirPath, filename);
    return !!row;
}

// 递归获取目录下的所有文件（包括子目录）
function getAllFilesRecursively(dirPath, fileList = []) {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
        const fullPath = path.join(dirPath, item);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                // 递归处理子目录
                getAllFilesRecursively(fullPath, fileList);
            } else if (stat.isFile()) {
                fileList.push({
                    directory: dirPath,
                    filename: item,
                    fullPath: fullPath
                });
            }
        } catch (err) {
            console.log('无法访问:', fullPath, err.message);
        }
    }
    
    return fileList;
}

// 扫描目录并处理所有照片和视频（包括子目录）
async function scanAndProcessDirectory(dirPath) {
    // 递归获取所有文件
    const allItems = getAllFilesRecursively(dirPath);
    
    // 统计信息
    let totalPhotos = 0;
    let totalVideos = 0;
    let newPhotos = 0;
    let newVideos = 0;
    let skippedFiles = 0;
    
    // 收集所有文件的元数据
    const photoMetaList = []; // 存储照片的时间和地理信息
    const videoMetaList = []; // 存储视频的信息（可能没有地理信息）
    
    // 第一遍：处理所有照片文件，收集地理信息
    for (const item of allItems) {
        const { directory, filename, fullPath } = item;
        
        if (filename.match(PHOTO_EXTENSIONS)) {
            totalPhotos++;
            
            // 检查是否已存在
            if (isFileExists(directory, filename)) {
                skippedFiles++;
                continue;
            }
            
            try {
                const meta = await exifr.parse(fullPath);
                const time = meta?.DateTimeOriginal || null;
                const lat = meta?.latitude || null;
                const lng = meta?.longitude || null;
                
                photoMetaList.push({
                    path: fullPath,
                    directory: directory,
                    filename: filename,
                    time: time,
                    lat: lat,
                    lng: lng,
                    type: 'photo'
                });
            } catch (err) {
                console.log('跳过照片文件（无信息或损坏）:', filename);
            }
        } else if (filename.match(VIDEO_EXTENSIONS)) {
            totalVideos++;
            
            // 检查是否已存在
            if (isFileExists(directory, filename)) {
                skippedFiles++;
                continue;
            }
            
            try {
                const meta = await exifr.parse(fullPath);
                const time = meta?.DateTimeOriginal || meta?.CreateDate || null;
                const lat = meta?.latitude || null;
                const lng = meta?.longitude || null;
                
                videoMetaList.push({
                    path: fullPath,
                    directory: directory,
                    filename: filename,
                    time: time,
                    lat: lat,
                    lng: lng,
                    type: 'video'
                });
            } catch (err) {
                // 视频可能没有EXIF信息，尝试从文件修改时间获取
                try {
                    const stats = fs.statSync(fullPath);
                    videoMetaList.push({
                        path: fullPath,
                        directory: directory,
                        filename: filename,
                        time: stats.mtime,
                        lat: null,
                        lng: null,
                        type: 'video'
                    });
                } catch (e) {
                    console.log('跳过视频文件:', filename);
                }
            }
        }
    }
    
    // 为没有地理信息的视频查找最接近时间的照片
    for (const video of videoMetaList) {
        if (!video.lat || !video.lng) {
            // 找时间最接近的有地理信息的照片
            const nearestPhoto = findNearestPhotoByTime(video.time, photoMetaList);
            if (nearestPhoto && nearestPhoto.lat && nearestPhoto.lng) {
                video.lat = nearestPhoto.lat;
                video.lng = nearestPhoto.lng;
                video.geoSource = 'inferred'; // 标记地理位置是推断的
            }
        }
    }
    
    // 将所有文件写入数据库（包括没有地理信息的文件）
    const allFiles = [...photoMetaList, ...videoMetaList];
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO photos (directory, filename, time, lat, lng, type) 
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    for (const file of allFiles) {
        // 记录所有文件，不再仅限于有地理信息的
        stmt.run(
            file.directory,
            file.filename,
            file.time ? (file.time instanceof Date ? file.time.toISOString() : file.time) : null,
            file.lat || null,
            file.lng || null,
            file.type
        );
        
        if (file.type === 'photo') {
            newPhotos++;
        } else {
            newVideos++;
        }
    }
    
    return {
        totalPhotos,
        totalVideos,
        newPhotos,
        newVideos,
        skippedFiles
    };
}

// 查找时间最接近的照片
function findNearestPhotoByTime(targetTime, photoList) {
    if (!targetTime || photoList.length === 0) return null;
    
    const targetMs = targetTime instanceof Date ? targetTime.getTime() : new Date(targetTime).getTime();
    if (isNaN(targetMs)) return null;
    
    let nearestPhoto = null;
    let minTimeDiff = Infinity;
    
    for (const photo of photoList) {
        if (!photo.time || !photo.lat || !photo.lng) continue;
        
        const photoMs = photo.time instanceof Date ? photo.time.getTime() : new Date(photo.time).getTime();
        if (isNaN(photoMs)) continue;
        
        const timeDiff = Math.abs(targetMs - photoMs);
        if (timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff;
            nearestPhoto = photo;
        }
    }
    
    return nearestPhoto;
}

// 创建应用菜单
function createApplicationMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: '指定照片目录',
                    click: async () => {
                        await handleSetPhotoDirectory();
                    }
                },
                { type: 'separator' },
                { role: 'quit', label: '退出' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'close' }
            ]
        }
    ];
    
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// 处理"指定照片目录"菜单点击
async function handleSetPhotoDirectory() {
    if (currentPhotoDirectory) {
        // 已有指定目录，询问是否更改
        const result = await dialog.showMessageBox(mainWindow, {
            type: 'question',
            buttons: ['是', '否'],
            defaultId: 1,
            title: '更改照片目录',
            message: `是否要更改 "${currentPhotoDirectory}" 这个照片目录？`
        });
        
        if (result.response === 1) {
            // 用户选择"否"
            return;
        }
    }
    
    // 弹出目录选择对话框
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择照片目录'
    });
    
    if (canceled || filePaths.length === 0) return;
    
    const dirPath = filePaths[0];
    
    // 保存新目录
    savePhotoDirectory(dirPath);
    
    // 通知渲染进程开始扫描
    mainWindow.webContents.send('scan-started');
    
    try {
        // 扫描并处理目录
        const result = await scanAndProcessDirectory(dirPath);
        
        // 通知渲染进程扫描完成，传递详细统计信息
        mainWindow.webContents.send('scan-completed', { 
            directory: dirPath,
            totalPhotos: result.totalPhotos,
            totalVideos: result.totalVideos,
            newPhotos: result.newPhotos,
            newVideos: result.newVideos,
            skippedFiles: result.skippedFiles
        });
    } catch (error) {
        console.error('扫描目录出错:', error);
        mainWindow.webContents.send('scan-error', { error: error.message });
    }
}

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
  
  // 加载已保存的照片目录
  loadSavedPhotoDirectory();
  
  // 创建应用菜单
  createApplicationMenu();
}

// 监听扫描文件夹请求
ipcMain.handle('scan-directory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });

    if (canceled) return { count: 0 };

    const dirPath = filePaths[0];
    const files = fs.readdirSync(dirPath);
    let count = 0;

    for (const file of files) {
        // 支持 jpg, jpeg, heic 格式
        if (file.toLowerCase().match(/\.(jpg|jpeg|heic)$/)) {
            const fullPath = path.join(dirPath, file);
            try {
                // 提取拍摄时间和 GPS
                const meta = await exifr.parse(fullPath);
                if (meta && meta.latitude && meta.longitude) {
                    const stmt = db.prepare('INSERT INTO photos (path, time, lat, lng) VALUES (?, ?, ?, ?)');
                    stmt.run(
                        fullPath, 
                        meta.DateTimeOriginal ? meta.DateTimeOriginal.toISOString() : null, 
                        meta.latitude, 
                        meta.longitude
                    );
                    count++;
                }
            } catch (err) {
                console.log('跳过文件（无信息或损坏）:', file);
            }
        }
    }
    return { count };
});


ipcMain.handle('query-area', (event, range) => {
    // SQL 逻辑：纬度在南北之间，经度在东西之间
    const sql = `
        SELECT * FROM photos 
        WHERE lat <= ? AND lat >= ? 
        AND lng <= ? AND lng >= ?
    `;
    return db.prepare(sql).all(range.north, range.south, range.east, range.west);
});

// 获取所有已存照片用于地图显示
ipcMain.handle('get-all-photos', () => {
    return db.prepare('SELECT * FROM photos').all();
});

// 根据时间范围查询照片
ipcMain.handle('query-photos-by-time', (event, { startTime, endTime }) => {
    const sql = `
        SELECT * FROM photos 
        WHERE time >= ? AND time <= ?
        AND lat IS NOT NULL AND lng IS NOT NULL
    `;
    return db.prepare(sql).all(startTime, endTime);
});

// 保存地图状态
ipcMain.handle('save-map-state', (event, state) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run('mapState', JSON.stringify(state));
    return true;
});

// 读取地图状态
ipcMain.handle('load-map-state', () => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('mapState');
    if (row) {
        try {
            return JSON.parse(row.value);
        } catch (e) {
            return null;
        }
    }
    return null;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});