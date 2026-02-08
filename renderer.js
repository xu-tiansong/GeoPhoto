/**
 * renderer.js - Electron 渲染进程
 * 使用模块化结构管理地图、时间轴等功能
 */

const { ipcRenderer } = require('electron');
const MapManager = require('./modules/MapManager');
const Timeline = require('./modules/Timeline');

// ==================== 全局变量 ====================
let mapManager;
let timeline;

// ==================== 加载遮罩层 ====================
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = loadingOverlay.querySelector('.loading-text');

function showLoading(text = '正在扫描文件...') {
    loadingText.textContent = text;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

// ==================== IPC 事件监听 ====================
ipcRenderer.on('scan-started', () => {
    showLoading('Scanning files...');
});

ipcRenderer.on('scan-progress', (event, progress) => {
    if (progress.phase === 'directory') {
        showLoading(`Scanning directories... (${progress.count} found)`);
    } else if (progress.phase === 'metadata') {
        showLoading(`Processing ${progress.current}/${progress.total} media files...`);
    } else if (progress.phase === 'database') {
        showLoading('Writing to database...');
    }
});

// 监听清除矩形选框的消息
ipcRenderer.on('clear-map-rectangle', () => {
    if (mapManager) {
        mapManager.clearRectangle();
    }
});

ipcRenderer.on('scan-completed', (event, data) => {
    hideLoading();
    
    const totalFiles = data.totalPhotos + data.totalVideos;
    const newFiles = data.newPhotos + data.newVideos;
    
    let message = '';
    
    if (data.skippedDirectory) {
        message = `该目录已经扫描过，跳过扫描。\n如需重新扫描，请先从数据库删除该目录记录。`;
    } else {
        message = `扫描完成！\n`;
        message += `目录中共有 ${data.totalPhotos} 张照片和 ${data.totalVideos} 个视频\n`;
        
        if (newFiles > 0) {
            message += `其中新增 ${data.newPhotos} 张照片和 ${data.newVideos} 个视频`;
        } else {
            message += `没有新增文件（${data.skippedFiles} 个文件已存在）`;
        }
        
        // 扫描完成后刷新地图（根据当前时间轴范围）
        if (timeline) {
            const range = timeline.getSelectedRange();
            mapManager.loadMarkersByTimeRange(range.start, range.end);
        } else {
            // 时间轴未初始化，加载所有照片
            mapManager.loadAllMarkers();
        }
    }
    
    alert(message);
});

ipcRenderer.on('scan-error', (event, data) => {
    hideLoading();
    alert(`扫描出错: ${data.error}`);
});

// 监听菜单动作
ipcRenderer.on('menu-action', (event, action) => {
    handleMenuAction(action);
});

// 显示关于对话框
ipcRenderer.on('show-about-dialog', () => {
    alert('GeoPhoto v1.0\n\nA photo management application with map and timeline features.\n\n© 2026');
});

// ==================== 菜单动作处理 ====================
function handleMenuAction(action) {
    console.log('处理菜单动作:', action);
    
    switch (action) {
        case 'photoDirectoryManagement':
            alert('照片目录管理功能正在开发中...');
            break;
        case 'tagManagementPeople':
        case 'tagManagementScenes':
        case 'tagManagementEvents':
            alert('标签管理功能正在开发中...');
            break;
        case 'backupPhotos':
            alert('照片备份功能正在开发中...');
            break;
        case 'slideshow':
            alert('幻灯片功能正在开发中...');
            break;
        case 'burstPhotoSelection':
            alert('连拍筛选功能正在开发中...');
            break;
        case 'photoRecognition':
            alert('照片识别功能正在开发中...');
            break;
        case 'timelineSettings':
            alert('时间轴设置功能正在开发中...');
            break;
        case 'timeRangeSettings':
            alert('时间跨度设置功能正在开发中...');
            break;
        case 'landmarkManagement':
            alert('地标管理功能正在开发中...');
            break;
        case 'layerSettings':
            alert('图层设置功能正在开发中...');
            break;
        case 'offlineMap':
            alert('离线地图功能正在开发中...');
            break;
        case 'travelRoutes':
            alert('旅行轨迹功能正在开发中...');
            break;
        case 'languageEnglish':
            alert('Language changed to English');
            break;
        case 'languageChinese':
            alert('语言已切换为简体中文');
            break;
        default:
            console.log('未处理的菜单动作:', action);
    }
}

// ==================== 页面初始化 ====================
window.onload = async () => {
    // 1. 初始化地图管理器
    mapManager = new MapManager(ipcRenderer, 'map');
    
    // 2. 恢复地图状态
    await mapManager.restoreState();
    
    // 3. 延迟初始化时间轴，确保DOM完全加载
    setTimeout(async () => {
        // 创建时间轴，跳过初始渲染
        timeline = new Timeline(ipcRenderer, true);
        
        // 尝试恢复保存的状态
        const restored = await timeline.restoreState();
        console.log('Timeline initialized, restored:', restored);
        
        // 渲染时间轴
        timeline.render();
        
        // 4. 设置选择范围变化的回调
        timeline.onSelectionChange((startTime, endTime) => {
            mapManager.loadMarkersByTimeRange(startTime, endTime);
        });
        
        // 5. 初始加载：根据时间轴的当前选择范围加载照片
        const range = timeline.getSelectedRange();
        mapManager.loadMarkersByTimeRange(range.start, range.end);
    }, 100);
};
