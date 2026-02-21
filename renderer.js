/**
 * renderer.js - Electron 渲染进程
 * 使用模块化结构管理地图、时间轴等功能
 */

const { ipcRenderer } = require('electron');
const MapManager = require('./modules/MapManager');
const Timeline = require('./modules/Timeline');
const i18n = require('./modules/i18n');

// ==================== 全局变量 ====================
let mapManager;
let timeline;

// ==================== i18n 初始化 ====================
// 从主进程获取当前语言并应用
(async () => {
    const lang = await ipcRenderer.invoke('get-language');
    i18n.setLanguage(lang);
    i18n.applyToDOM();
})();

// 监听语言切换
ipcRenderer.on('language-changed', (_event, lang) => {
    i18n.setLanguage(lang);
    i18n.applyToDOM();
});

// ==================== 加载遮罩层 ====================
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = loadingOverlay.querySelector('.loading-text');

function showLoading(text) {
    loadingText.textContent = text || i18n.t('loading.scanning');
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

// ==================== IPC 事件监听 ====================
ipcRenderer.on('scan-started', () => {
    showLoading(i18n.t('loading.scanning'));
});

ipcRenderer.on('scan-progress', (_event, progress) => {
    if (progress.phase === 'directory') {
        showLoading(i18n.t('loading.scanningDirs', { count: progress.count }));
    } else if (progress.phase === 'metadata') {
        showLoading(i18n.t('loading.processing', { current: progress.current, total: progress.total }));
    } else if (progress.phase === 'database') {
        showLoading(i18n.t('loading.database'));
    }
});

// 监听清除矩形选框的消息
ipcRenderer.on('clear-map-rectangle', () => {
    if (mapManager) {
        mapManager.clearRectangle();
    }
});

ipcRenderer.on('scan-completed', (_event, data) => {
    hideLoading();

    const newFiles = data.newPhotos + data.newVideos;
    let message = '';

    if (data.skippedDirectory) {
        message = i18n.t('scan.skippedDir');
    } else {
        message = i18n.t('scan.completed');
        message += i18n.t('scan.summary', { totalPhotos: data.totalPhotos, totalVideos: data.totalVideos });

        if (newFiles > 0) {
            message += i18n.t('scan.newFiles', { newPhotos: data.newPhotos, newVideos: data.newVideos });
        } else {
            message += i18n.t('scan.noNewFiles', { skippedFiles: data.skippedFiles });
        }

        // 扫描完成后刷新地图（根据当前时间轴范围）
        if (timeline) {
            const range = timeline.getSelectedRange();
            mapManager.loadMarkersByTimeRange(range.start, range.end);
        } else {
            mapManager.loadAllMarkers();
        }
    }

    alert(message);
});

ipcRenderer.on('scan-error', (event, data) => {
    hideLoading();
    alert(i18n.t('scan.error', { error: data.error }));
});

// 监听照片位置更新（通过地标 tag 赋予坐标），同步移动地图标记
ipcRenderer.on('photo-location-updated', (_event, { photoId, lat, lng }) => {
    if (mapManager) {
        mapManager.updatePhotoMarkerLocation(photoId, lat, lng);
    }
});

// 监听照片Like状态变化，刷新地图上的markers
ipcRenderer.on('photo-like-changed', async (event, { directory, filename, like }) => {
    console.log('照片Like状态变化:', directory, filename, like);
    if (mapManager && timeline) {
        const currentRange = timeline.getCurrentRange();
        if (currentRange) {
            await mapManager.loadMarkersByTimeRange(currentRange.start, currentRange.end);
        }
    }
});

// 监听菜单动作
ipcRenderer.on('menu-action', (event, action) => {
    handleMenuAction(action);
});

// 显示关于对话框
ipcRenderer.on('show-about-dialog', () => {
    alert(i18n.t('about.text'));
});

// ==================== 菜单动作处理 ====================
function handleMenuAction(action) {
    console.log('处理菜单动作:', action);

    const featureMap = {
        'photoDirectoryManagement': 'feature.directoryManagement',
        'tagManagementPeople':      'feature.tagManagement',
        'tagManagementScenes':      'feature.tagManagement',
        'tagManagementEvents':      'feature.tagManagement',
        'backupPhotos':             'feature.backup',
        'slideshow':                'feature.slideshow',
        'burstPhotoSelection':      'feature.burst',
        'photoRecognition':         'feature.recognition',
        'landmarkManagement':       'feature.landmarks',
        'layerSettings':            'feature.layers',
        'offlineMap':               'feature.offline',
        'travelRoutes':             'feature.routes',
    };

    if (featureMap[action]) {
        alert(i18n.t('feature.inDev', { feature: i18n.t(featureMap[action]) }));
        return;
    }

    switch (action) {
        case 'about':
            alert(i18n.t('about.text'));
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

        // 6. 异步加载事件标签日期，用于时间轴高亮
        loadEventTagDates();

        // 7. 异步加载地标标签到地图
        mapManager.loadLocationTags();
    }, 100);
};

// 监听标签管理窗口关闭后刷新事件日期高亮和地标标签
ipcRenderer.on('refresh-event-tag-dates', () => {
    loadEventTagDates();
    if (mapManager) mapManager.loadLocationTags();
});

/**
 * 异步加载事件标签日期并传递给时间轴组件
 */
async function loadEventTagDates() {
    try {
        const events = await ipcRenderer.invoke('get-event-tag-dates');
        if (timeline && events && events.length > 0) {
            timeline.setEventMarkers(events);
        }
    } catch (err) {
        console.error('加载事件标签日期失败:', err);
    }
}

// 监听时间轴状态
ipcRenderer.on('get-timeline-state', () => {
    if (!timeline) {
        console.warn('Timeline not initialized yet');
        ipcRenderer.send('timeline-state', {
            currentMode: 'day',
            range: {
                start: new Date().toISOString(),
                end: new Date().toISOString()
            }
        });
        return;
    }

    const timelineState = {
        currentMode: timeline.getCurrentMode(),
        range: timeline.getCurrentRange()
    };
    console.log('Sending timeline state:', timelineState);
    ipcRenderer.send('timeline-state', timelineState);
});

ipcRenderer.on('update-timeline', (event, data) => {
    if (!timeline) {
        console.warn('Timeline not initialized yet, cannot update');
        return;
    }

    timeline.updateMode(data.mode, true);
    if (data.start && data.end) {
        timeline.updateRange(data.start, data.end);
    } else {
        timeline.onResize();
    }
});
