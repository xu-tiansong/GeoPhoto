const { ipcRenderer } = require('electron');
// Leaflet 已通过 CDN 在 HTML 中加载，使用全局 L 对象

// --- 1. 初始化地图 ---
// 不设置初始视角，等待恢复保存的状态
const map = L.map('map', { center: [20, 0], zoom: 2 });

// 使用 Esri 免费卫星图层（底图）
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri'
}).addTo(map);

// 添加标签图层（国家、城市名称）- 叠加在卫星图上
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    pane: 'overlayPane'  // 确保在覆盖层上显示
}).addTo(map);

// 标记是否正在恢复状态（防止恢复时触发保存）
let isRestoringState = false;

// 保存地图状态（防抖）
let saveMapStateTimeout = null;
function saveMapState() {
    // 如果正在恢复状态，不保存
    if (isRestoringState) return;
    
    if (saveMapStateTimeout) clearTimeout(saveMapStateTimeout);
    saveMapStateTimeout = setTimeout(async () => {
        const center = map.getCenter();
        const zoom = map.getZoom();
        try {
            await ipcRenderer.invoke('save-map-state', {
                lat: center.lat,
                lng: center.lng,
                zoom: zoom
            });
            console.log('地图状态已保存:', { lat: center.lat, lng: center.lng, zoom });
        } catch (error) {
            console.error('保存地图状态失败:', error);
        }
    }, 500); // 500ms 防抖
}

// 监听地图移动和缩放事件
map.on('moveend', saveMapState);
map.on('zoomend', saveMapState);

// --- 2. 初始化矩形绘图工具 ---
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
    draw: {
        polyline: false,
        polygon: false,
        circle: false,
        marker: false,
        circlemarker: false,
        rectangle: {
            shapeOptions: {
                color: '#ff7800',
                weight: 2
            }
        }
    },
    edit: {
        featureGroup: drawnItems
    }
});
map.addControl(drawControl);

// --- 3. 加载遮罩层 ---
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = loadingOverlay.querySelector('.loading-text');

function showLoading(text = '正在扫描文件...') {
    loadingText.textContent = text;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

// --- 监听来自菜单的扫描事件 ---
ipcRenderer.on('scan-started', () => {
    showLoading('正在扫描文件...');
});

ipcRenderer.on('scan-completed', (event, data) => {
    hideLoading();
    
    const totalFiles = data.totalPhotos + data.totalVideos;
    const newFiles = data.newPhotos + data.newVideos;
    
    let message = `扫描完成！\n`;
    message += `目录中共有 ${data.totalPhotos} 张照片和 ${data.totalVideos} 个视频\n`;
    
    if (newFiles > 0) {
        message += `其中新增 ${data.newPhotos} 张照片和 ${data.newVideos} 个视频`;
        loadMarkers(); // 有新文件时刷新地图
    } else {
        message += `没有新增文件（${data.skippedFiles} 个文件已存在）`;
    }
    
    // 使用对话框显示结果
    alert(message);
});

ipcRenderer.on('scan-error', (event, data) => {
    hideLoading();
    alert(`扫描出错: ${data.error}`);
});

// --- 4. 渲染地图标记 (Markers) ---
// 使用 MarkerCluster 进行聚合，大幅提升性能
let markersLayer = L.markerClusterGroup({
    chunkedLoading: true,           // 分块加载，避免UI阻塞
    chunkInterval: 100,             // 每块处理间隔
    chunkDelay: 50,                 // 块之间延迟
    spiderfyOnMaxZoom: true,        // 最大缩放时展开
    showCoverageOnHover: false,     // 不显示覆盖范围
    zoomToBoundsOnClick: true,      // 点击聚合时缩放
    maxClusterRadius: 50,           // 聚合半径（像素）
    disableClusteringAtZoom: 18,    // 缩放级别18时不再聚合
    animate: false                  // 禁用动画提升性能
});
map.addLayer(markersLayer);

let isLoadingMarkers = false;
let currentPhotosCache = [];        // 缓存当前照片数据
let cityCache = new Map();          // 城市信息缓存 (lat,lng -> cityName)

// 逆地理编码获取城市名称（使用 Nominatim 免费服务）
async function getCityName(lat, lng) {
    const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`; // 精度到小数点3位
    
    if (cityCache.has(cacheKey)) {
        return cityCache.get(cacheKey);
    }
    
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&accept-language=zh`,
            { headers: { 'User-Agent': 'GeoPhoto/1.0' } }
        );
        const data = await response.json();
        
        // 提取城市名称（优先级：city > town > county > state）
        const address = data.address || {};
        const cityName = address.city || address.town || address.county || 
                         address.state || address.country || '未知位置';
        
        cityCache.set(cacheKey, cityName);
        return cityName;
    } catch (error) {
        console.log('逆地理编码失败:', error);
        return '未知位置';
    }
}

// 格式化日期时间
function formatDateTime(timeStr) {
    if (!timeStr) return { date: '未知日期', time: '' };
    const d = new Date(timeStr);
    if (isNaN(d.getTime())) return { date: '未知日期', time: '' };
    
    const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    return { date, time };
}

// 创建缩略图 HTML，根据图片比例调整大小，视频显示播放图标
function createThumbnailTooltip(photo) {
    const filePath = `${photo.directory}/${photo.filename}`;
    const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;
    const isVideo = photo.type === 'video';
    const uniqueId = `thumb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // 格式化日期时间
    const { date, time } = formatDateTime(photo.time);
    const dateTimeStr = time ? `${date} ${time}` : date;
    
    // 创建城市占位符ID
    const cityId = `city-${uniqueId}`;
    
    // 异步加载城市名称
    if (photo.lat && photo.lng) {
        setTimeout(async () => {
            const cityName = await getCityName(photo.lat, photo.lng);
            const cityEl = document.getElementById(cityId);
            if (cityEl) {
                cityEl.textContent = cityName;
            }
        }, 0);
    }
    
    const infoHtml = `
        <div class="tooltip-info">
            <div class="tooltip-datetime">${dateTimeStr}</div>
            <div class="tooltip-city" id="${cityId}">${photo.lat && photo.lng ? '加载中...' : '无位置信息'}</div>
        </div>
    `;
    
    if (isVideo) {
        // 视频：使用 video 元素获取第一帧，并叠加播放图标
        return `
            <div class="photo-tooltip">
                <div class="thumbnail-wrapper" id="${uniqueId}">
                    <video src="${fileUrl}" 
                           style="max-width: 224px; max-height: 224px; display: block;"
                           onloadedmetadata="adjustVideoThumbnailSize(this)"
                           onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:120px;height:90px;background:#333;display:flex;align-items:center;justify-content:center;\\'><div class=\\'video-play-icon\\'></div></div>';"
                           muted preload="metadata">
                    </video>
                    <div class="video-play-icon"></div>
                </div>
                ${infoHtml}
            </div>
        `;
    } else {
        // 照片需要动态加载以获取原始尺寸
        return `
            <div class="photo-tooltip">
                <div class="thumbnail-wrapper">
                    <img src="${fileUrl}" 
                         style="max-width: 224px; max-height: 224px;"
                         onload="adjustThumbnailSize(this)"
                         onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:100px;height:100px;background:#333;display:flex;align-items:center;justify-content:center;color:#999;\\'>无法加载</div>';">
                </div>
                ${infoHtml}
            </div>
        `;
    }
}

// 调整照片缩略图大小，保持比例，224px 为限制
window.adjustThumbnailSize = function(img) {
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    const maxSize = 224;
    
    if (naturalWidth > naturalHeight) {
        // 横幅照片：宽度 224px，高度按比例
        img.style.width = maxSize + 'px';
        img.style.height = 'auto';
    } else {
        // 竖幅照片：高度 224px，宽度按比例
        img.style.height = maxSize + 'px';
        img.style.width = 'auto';
    }
};

// 调整视频缩略图大小，保持比例，224px 为限制
window.adjustVideoThumbnailSize = function(video) {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const maxSize = 224;
    
    if (videoWidth > videoHeight) {
        // 横幅视频：宽度 224px，高度按比例
        video.style.width = maxSize + 'px';
        video.style.height = 'auto';
    } else {
        // 竖幅视频：高度 224px，宽度按比例
        video.style.height = maxSize + 'px';
        video.style.width = 'auto';
    }
    // 跳转到第 0.1 秒以显示第一帧
    video.currentTime = 0.1;
};

// 根据时间范围异步加载照片标记
async function loadMarkersByTimeRange(startTime, endTime) {
    if (isLoadingMarkers) return; // 防止重复加载
    isLoadingMarkers = true;
    
    try {
        // 异步查询指定时间范围的照片
        const photos = await ipcRenderer.invoke('query-photos-by-time', {
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString()
        });
        
        // 缓存当前照片数据
        currentPhotosCache = photos;
        
        // 清除旧标记，避免重复叠加
        markersLayer.clearLayers();
        
        // 统计同一位置的照片数量，用于添加微小偏移
        const locationCount = new Map();
        
        // 批量创建标记数组，然后一次性添加
        const markers = [];
        photos.forEach((photo, index) => {
            if (photo.lat && photo.lng) {
                // 计算位置key（精确到小数点后5位）
                const locKey = `${photo.lat.toFixed(5)},${photo.lng.toFixed(5)}`;
                const count = locationCount.get(locKey) || 0;
                locationCount.set(locKey, count + 1);
                
                // 为同一位置的照片添加微小偏移（螺旋排列）
                let lat = photo.lat;
                let lng = photo.lng;
                if (count > 0) {
                    const angle = count * 0.5; // 弧度
                    const offset = 0.00002 * count; // 约2米的偏移
                    lat += offset * Math.cos(angle);
                    lng += offset * Math.sin(angle);
                }
                
                const marker = L.marker([lat, lng]);
                
                // 使用唯一ID标识每个marker
                const markerId = `marker-${photo.id || index}-${Date.now()}`;
                marker._markerId = markerId;
                
                // 深拷贝照片数据到 marker，避免引用问题
                marker.photoData = JSON.parse(JSON.stringify(photo));
                
                // 鼠标移入时才创建 tooltip（延迟加载）
                marker.on('mouseover', function() {
                    if (!this._tooltipBound) {
                        const photoInfo = this.photoData;
                        this.bindTooltip(createThumbnailTooltip(photoInfo), {
                            direction: 'top',
                            offset: [0, -10],
                            opacity: 1,
                            className: 'photo-tooltip-container'
                        });
                        this._tooltipBound = true;
                        this.openTooltip();
                    }
                });
                
                // 点击时才创建 popup（延迟加载）
                marker.on('click', function() {
                    if (!this._popupBound) {
                        const p = this.photoData;
                        const dateStr = p.time ? new Date(p.time).toLocaleString() : '未知时间';
                        const typeStr = p.type === 'video' ? '🎬 视频' : '📷 照片';
                        this.bindPopup(`
                            <b>${typeStr}详情</b><br>
                            时间: ${dateStr}<br>
                            文件名: <small>${p.filename || '未知'}</small><br>
                            目录: <small>${p.directory || '未知'}</small>
                        `);
                        this._popupBound = true;
                        this.openPopup();
                    }
                });
                
                markers.push(marker);
            }
        });
        
        // 批量添加到聚合层
        markersLayer.addLayers(markers);
        
        console.log(`已加载 ${photos.length} 个标记 (${startTime.toLocaleDateString()} - ${endTime.toLocaleDateString()})`);
    } catch (error) {
        console.error('加载标记出错:', error);
    } finally {
        isLoadingMarkers = false;
    }
}

// 兼容旧的 loadMarkers 函数（加载所有照片）
async function loadMarkers() {
    try {
        const photos = await ipcRenderer.invoke('get-all-photos');
        currentPhotosCache = photos;
        markersLayer.clearLayers();
        
        // 统计同一位置的照片数量，用于添加微小偏移
        const locationCount = new Map();
        
        const markers = [];
        photos.forEach((photo, index) => {
            if (photo.lat && photo.lng) {
                // 计算位置key（精确到小数点后5位）
                const locKey = `${photo.lat.toFixed(5)},${photo.lng.toFixed(5)}`;
                const count = locationCount.get(locKey) || 0;
                locationCount.set(locKey, count + 1);
                
                // 为同一位置的照片添加微小偏移（螺旋排列）
                let lat = photo.lat;
                let lng = photo.lng;
                if (count > 0) {
                    const angle = count * 0.5; // 弧度
                    const offset = 0.00002 * count; // 约2米的偏移
                    lat += offset * Math.cos(angle);
                    lng += offset * Math.sin(angle);
                }
                
                const marker = L.marker([lat, lng]);
                
                // 使用唯一ID标识每个marker
                const markerId = `marker-${photo.id || index}-${Date.now()}`;
                marker._markerId = markerId;
                
                // 深拷贝照片数据到 marker，避免引用问题
                marker.photoData = JSON.parse(JSON.stringify(photo));
                
                // 鼠标移入时才创建 tooltip（延迟加载）
                marker.on('mouseover', function() {
                    if (!this._tooltipBound) {
                        const photoInfo = this.photoData;
                        this.bindTooltip(createThumbnailTooltip(photoInfo), {
                            direction: 'top',
                            offset: [0, -10],
                            opacity: 1,
                            className: 'photo-tooltip-container'
                        });
                        this._tooltipBound = true;
                        this.openTooltip();
                    }
                });
                
                // 点击时才创建 popup（延迟加载）
                marker.on('click', function() {
                    if (!this._popupBound) {
                        const p = this.photoData;
                        const dateStr = p.time ? new Date(p.time).toLocaleString() : '未知时间';
                        const typeStr = p.type === 'video' ? '🎬 视频' : '📷 照片';
                        this.bindPopup(`
                            <b>${typeStr}详情</b><br>
                            时间: ${dateStr}<br>
                            文件名: <small>${p.filename || '未知'}</small><br>
                            目录: <small>${p.directory || '未知'}</small>
                        `);
                        this._popupBound = true;
                        this.openPopup();
                    }
                });
                
                markers.push(marker);
            }
        });
        
        // 批量添加到聚合层
        markersLayer.addLayers(markers);
    } catch (error) {
        console.error('加载标记出错:', error);
    }
}

// --- 5. 监听矩形选框结束事件 ---
map.on(L.Draw.Event.CREATED, async function (e) {
    const layer = e.layer;
    drawnItems.clearLayers(); // 页面上只保留一个选框
    drawnItems.addLayer(layer);

    const bounds = layer.getBounds();
    
    // 构造查询范围
    const range = {
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
    };

    // 调用主进程查询该区域照片
    const areaPhotos = await ipcRenderer.invoke('query-area', range);
    
    console.log("区域内照片列表:", areaPhotos);
    alert(`在该矩形区域内找到 ${areaPhotos.length} 张照片。结果已打印在控制台(F12)`);
    
    // TODO: 这里将来可以调用函数在底部滚动条显示 areaPhotos 的缩略图
});

// --- 6. 时间滚动条组件 ---
class TimelineScrollbar {
    constructor(skipInitialRender = false) {
        this.container = document.getElementById('timeline-container');
        this.upperRow = document.getElementById('timeline-upper-row');
        this.lowerRow = document.getElementById('timeline-lower-row');
        this.scrollbar = document.getElementById('timeline-scrollbar');
        this.thumb = document.getElementById('timeline-thumb');
        this.leftHandle = this.thumb.querySelector('.thumb-handle.left');
        this.rightHandle = this.thumb.querySelector('.thumb-handle.right');
        
        // 精度模式: 'hour', 'day', 'month'
        this.scaleMode = 'day'; // 默认为天模式
        this.scaleModes = ['hour', 'day', 'month'];
        this.scaleModeIndex = 1; // 默认索引为1（天模式）
        
        // 每个刻度的像素宽度 - 28像素
        this.tickWidth = 28;
        
        // 拖动状态
        this.isDragging = false;
        this.dragType = null; // 'left', 'right', 'move', 'pan'
        this.dragStartX = 0;
        this.dragStartSelectionStart = null;
        this.dragStartSelectionEnd = null;
        this.dragStartTimelineStart = null;
        this.dragStartTimelineEnd = null;
        
        // 初始化时间范围（默认值）
        this.initTimeRange();
        
        this.initEvents();
        
        // 如果不跳过初始渲染，则延迟渲染
        if (!skipInitialRender) {
            requestAnimationFrame(() => {
                this.render();
            });
        }
    }
    
    // 初始化时间范围
    initTimeRange() {
        // 根据屏幕宽度计算显示多少天
        const containerWidth = this.container.offsetWidth || window.innerWidth;
        const numDays = Math.max(7, Math.floor(containerWidth / this.tickWidth));
        
        // 时间范围 - 从今天往前倒推n天，确保右侧是今天
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        this.timelineEnd = new Date(today);
        this.timelineEnd.setDate(this.timelineEnd.getDate() + 1); // 包含今天（到明天0点）
        this.timelineStart = new Date(this.timelineEnd);
        this.timelineStart.setDate(this.timelineStart.getDate() - numDays);
        
        // 选择的时间范围 (滚动bar表示的范围) - 右侧最近7天，对齐到刻度
        this.selectionEnd = new Date(this.timelineEnd);
        this.selectionStart = new Date(this.selectionEnd);
        this.selectionStart.setDate(this.selectionStart.getDate() - 7);
    }
    
    // 窗口大小变化时重新计算
    onResize() {
        const containerWidth = this.container.offsetWidth;
        if (containerWidth <= 0) return;
        
        // 根据当前精度模式计算应显示的刻度数
        const numTicks = Math.max(7, Math.floor(containerWidth / this.tickWidth));
        
        // 保持右侧时间不变，调整左侧
        const newStart = new Date(this.timelineEnd);
        if (this.scaleMode === 'hour') {
            newStart.setHours(newStart.getHours() - numTicks);
        } else if (this.scaleMode === 'day') {
            newStart.setDate(newStart.getDate() - numTicks);
        } else if (this.scaleMode === 'month') {
            newStart.setMonth(newStart.getMonth() - numTicks);
        }
        this.timelineStart = newStart;
        
        // 确保选择范围在可视范围内
        if (this.selectionStart < this.timelineStart) {
            this.selectionStart = new Date(this.timelineStart);
        }
        if (this.selectionEnd > this.timelineEnd) {
            this.selectionEnd = new Date(this.timelineEnd);
        }
        
        this.render();
        this.saveState(); // 保存状态
    }
    
    // 保存时间轴状态到数据库
    async saveState() {
        const state = {
            scaleMode: this.scaleMode,
            scaleModeIndex: this.scaleModeIndex,
            timelineStart: this.timelineStart.toISOString(),
            timelineEnd: this.timelineEnd.toISOString(),
            selectionStart: this.selectionStart.toISOString(),
            selectionEnd: this.selectionEnd.toISOString()
        };
        try {
            await ipcRenderer.invoke('save-timeline-state', state);
        } catch (error) {
            console.error('保存时间轴状态失败:', error);
        }
    }
    
    // 从数据库恢复时间轴状态
    async restoreState() {
        try {
            const state = await ipcRenderer.invoke('load-timeline-state');
            if (state) {
                this.scaleMode = state.scaleMode || 'day';
                this.scaleModeIndex = state.scaleModeIndex !== undefined ? state.scaleModeIndex : 1;
                
                const savedTimelineStart = new Date(state.timelineStart);
                const savedTimelineEnd = new Date(state.timelineEnd);
                const savedSelectionStart = new Date(state.selectionStart);
                const savedSelectionEnd = new Date(state.selectionEnd);
                
                // 验证时间有效性
                if (isNaN(savedTimelineStart.getTime()) || isNaN(savedTimelineEnd.getTime()) ||
                    isNaN(savedSelectionStart.getTime()) || isNaN(savedSelectionEnd.getTime())) {
                    console.log('保存的时间无效，使用默认值');
                    return false;
                }
                
                // 保持选择范围不变，根据当前容器宽度重新计算时间轴范围
                this.selectionStart = savedSelectionStart;
                this.selectionEnd = savedSelectionEnd;
                
                // 根据容器宽度计算应显示的刻度数
                const containerWidth = this.container.offsetWidth || window.innerWidth;
                const numTicks = Math.max(7, Math.floor(containerWidth / this.tickWidth));
                
                // 以选择范围的中点为中心，计算时间轴范围
                // 保持右侧为 savedTimelineEnd（或调整到当前日期如果更晚）
                this.timelineEnd = savedTimelineEnd;
                const newStart = new Date(this.timelineEnd);
                
                if (this.scaleMode === 'hour') {
                    newStart.setHours(newStart.getHours() - numTicks);
                } else if (this.scaleMode === 'day') {
                    newStart.setDate(newStart.getDate() - numTicks);
                } else if (this.scaleMode === 'month') {
                    newStart.setMonth(newStart.getMonth() - numTicks);
                }
                this.timelineStart = newStart;
                
                // 确保选择范围在可视范围内
                if (this.selectionStart < this.timelineStart) {
                    // 如果选择范围在可视范围外，调整时间轴以包含选择范围
                    this.timelineStart = new Date(this.selectionStart);
                }
                if (this.selectionEnd > this.timelineEnd) {
                    this.timelineEnd = new Date(this.selectionEnd);
                }
                
                console.log('时间轴状态已恢复:', {
                    scaleMode: this.scaleMode,
                    timelineStart: this.timelineStart,
                    timelineEnd: this.timelineEnd,
                    selectionStart: this.selectionStart,
                    selectionEnd: this.selectionEnd
                });
                return true;
            }
        } catch (error) {
            console.error('恢复时间轴状态失败:', error);
        }
        return false;
    }
    
    // 将时间对齐到刻度（天的开始）
    snapToTick(time, roundUp = false) {
        const snapped = new Date(time);
        if (this.scaleMode === 'day') {
            if (roundUp && (snapped.getHours() > 0 || snapped.getMinutes() > 0 || snapped.getSeconds() > 0)) {
                snapped.setDate(snapped.getDate() + 1);
            }
            snapped.setHours(0, 0, 0, 0);
        } else if (this.scaleMode === 'hour') {
            if (roundUp && (snapped.getMinutes() > 0 || snapped.getSeconds() > 0)) {
                snapped.setHours(snapped.getHours() + 1);
            }
            snapped.setMinutes(0, 0, 0);
        } else if (this.scaleMode === 'month') {
            if (roundUp && snapped.getDate() > 1) {
                snapped.setMonth(snapped.getMonth() + 1);
            }
            snapped.setDate(1);
            snapped.setHours(0, 0, 0, 0);
        }
        return snapped;
    }
    
    // 星期几名称
    getDayName(date) {
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return days[date.getDay()];
    }
    
    // 月份缩写
    getMonthAbbr(month) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[month];
    }
    
    // 计算时间到像素位置（基于刻度宽度）
    timeToPixel(time) {
        const startMs = this.timelineStart.getTime();
        const timeMs = time.getTime();
        const msPerDay = 24 * 60 * 60 * 1000;
        
        if (this.scaleMode === 'day') {
            const days = (timeMs - startMs) / msPerDay;
            return days * this.tickWidth;
        } else if (this.scaleMode === 'hour') {
            const hours = (timeMs - startMs) / (60 * 60 * 1000);
            return hours * this.tickWidth;
        } else {
            // month mode - approximate
            const totalMs = this.timelineEnd.getTime() - startMs;
            const offsetMs = timeMs - startMs;
            const containerWidth = this.container.offsetWidth;
            return (offsetMs / totalMs) * containerWidth;
        }
    }
    
    // 计算像素位置到时间
    pixelToTime(pixel) {
        const startMs = this.timelineStart.getTime();
        const msPerDay = 24 * 60 * 60 * 1000;
        
        if (this.scaleMode === 'day') {
            const days = pixel / this.tickWidth;
            return new Date(startMs + days * msPerDay);
        } else if (this.scaleMode === 'hour') {
            const hours = pixel / this.tickWidth;
            return new Date(startMs + hours * 60 * 60 * 1000);
        } else {
            const totalMs = this.timelineEnd.getTime() - startMs;
            const containerWidth = this.container.offsetWidth;
            const offsetMs = (pixel / containerWidth) * totalMs;
            return new Date(startMs + offsetMs);
        }
    }
    
    // 渲染刻度
    render() {
        this.upperRow.innerHTML = '';
        this.lowerRow.innerHTML = '';
        
        const containerWidth = this.container.offsetWidth;
        console.log('Rendering timeline, containerWidth:', containerWidth, 'scaleMode:', this.scaleMode);
        
        if (containerWidth <= 0) {
            console.log('Container width is 0, skipping render');
            return;
        }
        
        if (this.scaleMode === 'hour') {
            this.renderHourScale(containerWidth);
        } else if (this.scaleMode === 'day') {
            this.renderDayScale(containerWidth);
        } else if (this.scaleMode === 'month') {
            this.renderMonthScale(containerWidth);
        }
        
        this.updateThumb();
    }
    
    // 小时刻度模式
    renderHourScale(containerWidth) {
        const startTime = new Date(this.timelineStart);
        startTime.setMinutes(0, 0, 0);
        
        // 下行：每小时一个刻度
        let currentHour = new Date(startTime);
        let hourIndex = 0;
        while (currentHour < this.timelineEnd) {
            const x = hourIndex * this.tickWidth;
            if (x >= 0 && x < containerWidth) {
                const tick = document.createElement('div');
                tick.className = 'timeline-tick';
                tick.style.left = x + 'px';
                tick.style.width = this.tickWidth + 'px';
                tick.textContent = currentHour.getHours().toString().padStart(2, '0');
                this.lowerRow.appendChild(tick);
            }
            currentHour = new Date(currentHour.getTime() + 3600000);
            hourIndex++;
        }
        
        // 上行：每天一个跨度
        currentHour = new Date(startTime);
        let dayStartX = 0;
        let currentDayStart = new Date(currentHour.getFullYear(), currentHour.getMonth(), currentHour.getDate());
        hourIndex = 0;
        
        while (currentHour < this.timelineEnd) {
            const nextHour = new Date(currentHour.getTime() + 3600000);
            
            // 检查是否跨天了
            if (nextHour.getDate() !== currentHour.getDate() || nextHour >= this.timelineEnd) {
                const dayEndX = (hourIndex + 1) * this.tickWidth;
                const spanWidth = dayEndX - dayStartX;
                
                if (spanWidth > 0) {
                    const span = document.createElement('div');
                    span.className = 'timeline-span';
                    span.style.left = dayStartX + 'px';
                    span.style.width = Math.min(spanWidth, containerWidth - dayStartX) + 'px';
                    const month = (currentHour.getMonth() + 1).toString().padStart(2, '0');
                    const day = currentHour.getDate().toString().padStart(2, '0');
                    span.textContent = `${month}/${day} ${this.getDayName(currentHour)}`;
                    this.upperRow.appendChild(span);
                }
                
                dayStartX = dayEndX;
            }
            
            currentHour = nextHour;
            hourIndex++;
        }
    }
    
    // 天刻度模式
    renderDayScale(containerWidth) {
        // 确保从整天开始
        const startTime = new Date(this.timelineStart);
        startTime.setHours(0, 0, 0, 0);
        
        // 下行：每天一个刻度，28像素宽度
        let currentDay = new Date(startTime);
        let dayIndex = 0;
        while (currentDay < this.timelineEnd) {
            const x = dayIndex * this.tickWidth;
            if (x >= 0 && x < containerWidth) {
                const tick = document.createElement('div');
                tick.className = 'timeline-tick';
                tick.style.left = x + 'px';
                tick.style.width = this.tickWidth + 'px';
                tick.textContent = currentDay.getDate().toString();
                this.lowerRow.appendChild(tick);
            }
            currentDay = new Date(currentDay);
            currentDay.setDate(currentDay.getDate() + 1);
            dayIndex++;
        }
        
        // 上行：每月一个跨度，在每月1号进行分割
        let currentMonth = new Date(startTime);
        // 找到开始时间所在月份的1号
        if (currentMonth.getDate() !== 1) {
            // 如果不是1号，从当前月的1号开始但要计算偏移
        }
        
        // 遍历每一天找到每月的边界
        currentDay = new Date(startTime);
        let monthStartX = 0;
        let currentMonthStart = new Date(currentDay.getFullYear(), currentDay.getMonth(), 1);
        dayIndex = 0;
        
        while (currentDay < this.timelineEnd) {
            const nextDay = new Date(currentDay);
            nextDay.setDate(nextDay.getDate() + 1);
            
            // 检查是否跨月了
            if (nextDay.getMonth() !== currentDay.getMonth() || nextDay >= this.timelineEnd) {
                // 当前月结束，绘制上行跨度
                const monthEndX = (dayIndex + 1) * this.tickWidth;
                const spanWidth = monthEndX - monthStartX;
                
                if (spanWidth > 0) {
                    const span = document.createElement('div');
                    span.className = 'timeline-span';
                    span.style.left = monthStartX + 'px';
                    span.style.width = Math.min(spanWidth, containerWidth - monthStartX) + 'px';
                    span.textContent = `${currentDay.getFullYear()}年${currentDay.getMonth() + 1}月`;
                    this.upperRow.appendChild(span);
                }
                
                // 新月份开始
                monthStartX = monthEndX;
            }
            
            currentDay = nextDay;
            dayIndex++;
        }
    }
    
    // 月刻度模式
    renderMonthScale(containerWidth) {
        const startTime = new Date(this.timelineStart);
        startTime.setDate(1);
        startTime.setHours(0, 0, 0, 0);
        
        // 下行：每月一个刻度
        let currentMonth = new Date(startTime);
        let monthIndex = 0;
        while (currentMonth < this.timelineEnd) {
            const x = monthIndex * this.tickWidth;
            if (x >= 0 && x < containerWidth) {
                const tick = document.createElement('div');
                tick.className = 'timeline-tick';
                tick.style.left = x + 'px';
                tick.style.width = this.tickWidth + 'px';
                tick.textContent = this.getMonthAbbr(currentMonth.getMonth());
                this.lowerRow.appendChild(tick);
            }
            currentMonth = new Date(currentMonth);
            currentMonth.setMonth(currentMonth.getMonth() + 1);
            monthIndex++;
        }
        
        // 上行：每年一个跨度
        currentMonth = new Date(startTime);
        let yearStartX = 0;
        monthIndex = 0;
        
        while (currentMonth < this.timelineEnd) {
            const nextMonth = new Date(currentMonth);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            
            // 检查是否跨年了
            if (nextMonth.getFullYear() !== currentMonth.getFullYear() || nextMonth >= this.timelineEnd) {
                const yearEndX = (monthIndex + 1) * this.tickWidth;
                const spanWidth = yearEndX - yearStartX;
                
                if (spanWidth > 0) {
                    const span = document.createElement('div');
                    span.className = 'timeline-span';
                    span.style.left = yearStartX + 'px';
                    span.style.width = Math.min(spanWidth, containerWidth - yearStartX) + 'px';
                    span.textContent = currentMonth.getFullYear().toString();
                    this.upperRow.appendChild(span);
                }
                
                yearStartX = yearEndX;
            }
            
            currentMonth = nextMonth;
            monthIndex++;
        }
    }
    
    // 更新滚动bar位置（对齐到刻度）
    updateThumb() {
        // 计算对齐到刻度的位置
        const left = this.timeToPixel(this.selectionStart);
        const right = this.timeToPixel(this.selectionEnd);
        
        // 对齐到刻度宽度
        const snappedLeft = Math.round(left / this.tickWidth) * this.tickWidth;
        const snappedRight = Math.round(right / this.tickWidth) * this.tickWidth;
        
        this.thumb.style.left = snappedLeft + 'px';
        this.thumb.style.width = Math.max(this.tickWidth, snappedRight - snappedLeft) + 'px';
    }
    
    // 初始化事件
    initEvents() {
        // 鼠标滚轮切换精度
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY > 0) {
                // 向下滚动，切换到更大精度
                this.scaleModeIndex = Math.min(this.scaleModeIndex + 1, this.scaleModes.length - 1);
            } else {
                // 向上滚动，切换到更小精度
                this.scaleModeIndex = Math.max(this.scaleModeIndex - 1, 0);
            }
            this.scaleMode = this.scaleModes[this.scaleModeIndex];
            this.adjustTimelineForScale();
            this.render();
            this.saveState(); // 保存状态
        });
        
        // 左侧手柄拖动
        this.leftHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.startDrag(e, 'left');
        });
        
        // 右侧手柄拖动
        this.rightHandle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.startDrag(e, 'right');
        });
        
        // 整个thumb拖动
        this.thumb.addEventListener('mousedown', (e) => {
            if (e.target === this.leftHandle || e.target === this.rightHandle) return;
            this.startDrag(e, 'move');
        });
        
        // 非thumb区域拖动平移时间轴
        this.container.addEventListener('mousedown', (e) => {
            if (e.target === this.thumb || 
                e.target === this.leftHandle || 
                e.target === this.rightHandle) return;
            this.startDrag(e, 'pan');
        });
        
        // 鼠标移动
        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            this.onDrag(e);
        });
        
        // 鼠标释放
        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                // 拖动结束后通知选择范围变化（只有当拖动的是选择范围时）
                if (this.dragType === 'left' || this.dragType === 'right' || this.dragType === 'move') {
                    this.notifySelectionChange();
                }
                // 平移时间轴后也保存状态
                if (this.dragType === 'pan') {
                    this.saveState();
                }
            }
            this.isDragging = false;
            this.dragType = null;
            this.container.style.cursor = 'grab';
        });
        
        // 窗口大小变化
        window.addEventListener('resize', () => {
            this.onResize();
        });
    }
    
    // 根据精度调整时间轴范围
    adjustTimelineForScale() {
        const containerWidth = this.container.offsetWidth || window.innerWidth;
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        
        if (this.scaleMode === 'hour') {
            // 每小时一个刻度，显示n小时
            const numHours = Math.floor(containerWidth / this.tickWidth);
            this.timelineEnd = new Date(today);
            this.timelineEnd.setHours(this.timelineEnd.getHours() + 1);
            this.timelineStart = new Date(this.timelineEnd);
            this.timelineStart.setHours(this.timelineStart.getHours() - numHours);
            
            // 选择范围：最近24小时
            this.selectionEnd = new Date(this.timelineEnd);
            this.selectionStart = new Date(this.selectionEnd);
            this.selectionStart.setHours(this.selectionStart.getHours() - 24);
        } else if (this.scaleMode === 'day') {
            // 每天一个刻度，显示n天
            const numDays = Math.floor(containerWidth / this.tickWidth);
            this.timelineEnd = new Date(today);
            this.timelineEnd.setDate(this.timelineEnd.getDate() + 1);
            this.timelineStart = new Date(this.timelineEnd);
            this.timelineStart.setDate(this.timelineStart.getDate() - numDays);
            
            // 选择范围：最近7天
            this.selectionEnd = new Date(this.timelineEnd);
            this.selectionStart = new Date(this.selectionEnd);
            this.selectionStart.setDate(this.selectionStart.getDate() - 7);
        } else if (this.scaleMode === 'month') {
            // 每月一个刻度，显示n个月
            const numMonths = Math.floor(containerWidth / this.tickWidth);
            this.timelineEnd = new Date(today);
            this.timelineEnd.setMonth(this.timelineEnd.getMonth() + 1);
            this.timelineEnd.setDate(1);
            this.timelineStart = new Date(this.timelineEnd);
            this.timelineStart.setMonth(this.timelineStart.getMonth() - numMonths);
            
            // 选择范围：最近3个月
            this.selectionEnd = new Date(this.timelineEnd);
            this.selectionStart = new Date(this.selectionEnd);
            this.selectionStart.setMonth(this.selectionStart.getMonth() - 3);
        }
    }
    
    // 开始拖动
    startDrag(e, type) {
        this.isDragging = true;
        this.dragType = type;
        this.dragStartX = e.clientX;
        this.dragStartSelectionStart = new Date(this.selectionStart);
        this.dragStartSelectionEnd = new Date(this.selectionEnd);
        this.dragStartTimelineStart = new Date(this.timelineStart);
        this.dragStartTimelineEnd = new Date(this.timelineEnd);
        
        // 设置拖动时的光标样式
        if (type === 'pan') {
            this.container.style.cursor = 'grabbing';
        }
    }
    
    // 拖动中
    onDrag(e) {
        const deltaX = e.clientX - this.dragStartX;
        const containerWidth = this.container.offsetWidth;
        const totalMs = this.dragStartTimelineEnd.getTime() - this.dragStartTimelineStart.getTime();
        const deltaMs = (deltaX / containerWidth) * totalMs;
        
        if (this.dragType === 'left') {
            // 调整开始时间
            const newStart = new Date(this.dragStartSelectionStart.getTime() + deltaMs);
            if (newStart < this.selectionEnd && newStart >= this.timelineStart) {
                this.selectionStart = newStart;
            }
        } else if (this.dragType === 'right') {
            // 调整结束时间
            const newEnd = new Date(this.dragStartSelectionEnd.getTime() + deltaMs);
            if (newEnd > this.selectionStart && newEnd <= this.timelineEnd) {
                this.selectionEnd = newEnd;
            }
        } else if (this.dragType === 'move') {
            // 整体移动选择范围
            const duration = this.dragStartSelectionEnd.getTime() - this.dragStartSelectionStart.getTime();
            let newStart = new Date(this.dragStartSelectionStart.getTime() + deltaMs);
            let newEnd = new Date(newStart.getTime() + duration);
            
            // 边界检查
            if (newStart < this.timelineStart) {
                newStart = new Date(this.timelineStart);
                newEnd = new Date(newStart.getTime() + duration);
            }
            if (newEnd > this.timelineEnd) {
                newEnd = new Date(this.timelineEnd);
                newStart = new Date(newEnd.getTime() - duration);
            }
            
            this.selectionStart = newStart;
            this.selectionEnd = newEnd;
        } else if (this.dragType === 'pan') {
            // 平移整个时间轴
            const timelineDuration = this.dragStartTimelineEnd.getTime() - this.dragStartTimelineStart.getTime();
            this.timelineStart = new Date(this.dragStartTimelineStart.getTime() - deltaMs);
            this.timelineEnd = new Date(this.timelineStart.getTime() + timelineDuration);
            
            // 同时移动选择范围保持相对位置
            const selectionDuration = this.dragStartSelectionEnd.getTime() - this.dragStartSelectionStart.getTime();
            this.selectionStart = new Date(this.dragStartSelectionStart.getTime() - deltaMs);
            this.selectionEnd = new Date(this.selectionStart.getTime() + selectionDuration);
            
            this.render();
            return;
        }
        
        this.updateThumb();
    }
    
    // 获取当前选择的时间范围
    getSelectedRange() {
        return {
            start: this.selectionStart,
            end: this.selectionEnd
        };
    }
    
    // 设置时间轴范围（根据数据库中的照片时间）
    setTimelineRange(startTime, endTime) {
        this.timelineStart = new Date(startTime);
        this.timelineEnd = new Date(endTime);
        
        // 设置默认选择范围
        const duration = (endTime.getTime() - startTime.getTime()) * 0.1;
        this.selectionStart = new Date(startTime);
        this.selectionEnd = new Date(startTime.getTime() + duration);
        
        this.render();
    }
    
    // 当选择范围变化时触发回调
    onSelectionChange(callback) {
        this.selectionChangeCallback = callback;
    }
    
    // 通知选择范围变化
    notifySelectionChange() {
        if (this.selectionChangeCallback) {
            this.selectionChangeCallback(this.selectionStart, this.selectionEnd);
        }
        this.saveState(); // 保存状态
    }
}

// 初始化时间滚动条
let timelineScrollbar;

// 页面启动时的初始化
window.onload = async () => {
    // 1. 恢复地图状态（在恢复期间禁止保存）
    isRestoringState = true;
    try {
        const mapState = await ipcRenderer.invoke('load-map-state');
        if (mapState && typeof mapState.lat === 'number' && typeof mapState.lng === 'number' && typeof mapState.zoom === 'number') {
            map.setView([mapState.lat, mapState.lng], mapState.zoom);
            console.log('地图状态已恢复:', mapState);
        } else {
            console.log('没有保存的地图状态，使用默认视图');
        }
    } catch (error) {
        console.error('恢复地图状态失败:', error);
    }
    // 延迟一点再允许保存，避免恢复动画触发保存
    setTimeout(() => {
        isRestoringState = false;
        console.log('地图状态恢复完成，开始监听变化');
    }, 1000);
    
    // 2. 延迟初始化时间滚动条，确保DOM完全加载
    setTimeout(async () => {
        // 创建时间滚动条，跳过初始渲染
        timelineScrollbar = new TimelineScrollbar(true);
        
        // 尝试恢复保存的状态
        const restored = await timelineScrollbar.restoreState();
        console.log('Timeline initialized, restored:', restored);
        
        // 渲染时间轴
        timelineScrollbar.render();
        
        // 3. 设置选择范围变化的回调
        timelineScrollbar.onSelectionChange((startTime, endTime) => {
            // 异步加载选择时间范围内的照片
            loadMarkersByTimeRange(startTime, endTime);
        });
        
        // 4. 初始加载：根据时间滚动条的当前选择范围异步加载照片
        const range = timelineScrollbar.getSelectedRange();
        loadMarkersByTimeRange(range.start, range.end);
    }, 100);
};