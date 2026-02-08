/**
 * MapManager.js - 地图管理类 (渲染器端)
 * 管理Leaflet地图、标记、聚合、绘图工具等
 */

const ThumbnailGenerator = require('./ThumbnailGenerator');

class MapManager {
    constructor(ipcRenderer, mapElementId = 'map') {
        this.ipcRenderer = ipcRenderer;
        this.mapElementId = mapElementId;
        
        // 状态标志
        this.isRestoringState = false;
        this.isLoadingMarkers = false;
        this.currentPhotosCache = [];
        this.cityCache = new Map();
        
        // 逆地理编码请求队列和速率限制
        this.geocodeQueue = [];
        this.isProcessingQueue = false;
        this.lastGeocodingTime = 0;
        this.geocodingInterval = 1500; // Nominatim 要求每秒最多1次请求，设1.5秒更安全
        
        // 防抖定时器
        this.saveMapStateTimeout = null;
        
        // 初始化地图
        this.initMap();
        this.initTileLayers();
        this.initDrawTools();
        this.initMarkerCluster();
        this.initEvents();
    }

    /**
     * 初始化地图
     */
    initMap() {
        this.map = L.map(this.mapElementId, { center: [20, 0], zoom: 2 });
    }

    /**
     * 初始化地图图层
     */
    initTileLayers() {
        // 卫星底图
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri'
        }).addTo(this.map);

        // 标签图层
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
            subdomains: 'abcd',
            pane: 'overlayPane'
        }).addTo(this.map);
    }

    /**
     * 初始化绘图工具
     */
    initDrawTools() {
        this.drawnItems = new L.FeatureGroup();
        this.map.addLayer(this.drawnItems);

        this.drawControl = new L.Control.Draw({
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
            edit: false // 禁用编辑和删除按钮
        });
        this.map.addControl(this.drawControl);
    }

    /**
     * 初始化标记聚合
     */
    initMarkerCluster() {
        this.markersLayer = L.markerClusterGroup({
            chunkedLoading: true,
            chunkInterval: 100,
            chunkDelay: 50,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 50,
            disableClusteringAtZoom: 18,
            animate: false
        });
        this.map.addLayer(this.markersLayer);
    }

    /**
     * 初始化事件监听
     */
    initEvents() {
        // 地图移动和缩放事件
        this.map.on('moveend', () => this.saveMapState());
        this.map.on('zoomend', () => this.saveMapState());

        // 矩形选框事件
        this.map.on(L.Draw.Event.CREATED, (e) => this.onRectangleCreated(e));
    }

    /**
     * 保存地图状态（防抖）
     */
    saveMapState() {
        if (this.isRestoringState) return;
        
        if (this.saveMapStateTimeout) clearTimeout(this.saveMapStateTimeout);
        this.saveMapStateTimeout = setTimeout(async () => {
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            try {
                await this.ipcRenderer.invoke('save-map-state', {
                    lat: center.lat,
                    lng: center.lng,
                    zoom: zoom
                });
                console.log('地图状态已保存:', { lat: center.lat, lng: center.lng, zoom });
            } catch (error) {
                console.error('保存地图状态失败:', error);
            }
        }, 500);
    }

    /**
     * 恢复地图状态
     */
    async restoreState() {
        this.isRestoringState = true;
        try {
            const mapState = await this.ipcRenderer.invoke('load-map-state');
            if (mapState && typeof mapState.lat === 'number' && 
                typeof mapState.lng === 'number' && typeof mapState.zoom === 'number') {
                this.map.setView([mapState.lat, mapState.lng], mapState.zoom);
                console.log('地图状态已恢复:', mapState);
            } else {
                console.log('没有保存的地图状态，使用默认视图');
            }
        } catch (error) {
            console.error('恢复地图状态失败:', error);
        }
        
        setTimeout(() => {
            this.isRestoringState = false;
            console.log('地图状态恢复完成，开始监听变化');
        }, 1000);
    }

    /**
     * 逆地理编码获取城市名称（带速率限制）
     */
    async getCityName(lat, lng) {
        const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
        
        // 已有缓存直接返回
        if (this.cityCache.has(cacheKey)) {
            return this.cityCache.get(cacheKey);
        }
        
        // 加入队列等待处理
        return new Promise((resolve) => {
            this.geocodeQueue.push({ lat, lng, cacheKey, resolve });
            this.processGeocodeQueue();
        });
    }

    /**
     * 处理逆地理编码队列（速率限制：每秒最多1次）
     */
    async processGeocodeQueue() {
        if (this.isProcessingQueue || this.geocodeQueue.length === 0) {
            return;
        }
        
        this.isProcessingQueue = true;
        
        while (this.geocodeQueue.length > 0) {
            const { lat, lng, cacheKey, resolve } = this.geocodeQueue.shift();
            
            // 如果已有缓存，直接返回
            if (this.cityCache.has(cacheKey)) {
                resolve(this.cityCache.get(cacheKey));
                continue;
            }
            
            // 计算需要等待的时间
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastGeocodingTime;
            if (timeSinceLastRequest < this.geocodingInterval) {
                await new Promise(r => setTimeout(r, this.geocodingInterval - timeSinceLastRequest));
            }
            
            try {
                this.lastGeocodingTime = Date.now();
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10&accept-language=zh`,
                    { headers: { 'User-Agent': 'GeoPhoto/1.0' } }
                );
                
                // 检查响应状态
                if (!response.ok) {
                    if (response.status === 429) {
                        // 遇到429错误，加大等待时间并重试
                        console.log('Nominatim API 限流，等待重试...');
                        this.geocodeQueue.unshift({ lat, lng, cacheKey, resolve });
                        await new Promise(r => setTimeout(r, 5000));
                        continue;
                    }
                    // 其他错误状态
                    console.log(`逆地理编码HTTP错误: ${response.status}`);
                    resolve('未知位置');
                    continue;
                }
                
                // 检查content-type是否为JSON
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    console.log('逆地理编码返回非JSON响应');
                    resolve('未知位置');
                    continue;
                }
                
                const data = await response.json();
                
                // 检查是否有错误信息
                if (data.error) {
                    console.log('逆地理编码API错误:', data.error);
                    resolve('未知位置');
                    continue;
                }
                
                const address = data.address || {};
                const cityName = address.city || address.town || address.county || 
                                 address.state || address.country || '未知位置';
                
                this.cityCache.set(cacheKey, cityName);
                resolve(cityName);
            } catch (error) {
                console.log('逆地理编码失败:', error);
                resolve('未知位置');
            }
        }
        
        this.isProcessingQueue = false;
    }

    /**
     * 格式化日期时间
     */
    formatDateTime(timeStr) {
        if (!timeStr) return { date: '未知日期', time: '' };
        const d = new Date(timeStr);
        if (isNaN(d.getTime())) return { date: '未知日期', time: '' };
        
        const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
        const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        return { date, time };
    }

    /**
     * 创建缩略图 Tooltip HTML
     */
    createThumbnailTooltip(photo) {
        const filePath = `${photo.directory}/${photo.filename}`;
        const isVideo = photo.type === 'video';
        const uniqueId = `thumb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // 获取缩略图路径
        const thumbnailInfo = ThumbnailGenerator.getThumbnailPath(filePath);
        const displayPath = thumbnailInfo.path;
        const fileUrl = `file://${displayPath.replace(/\\/g, '/')}`;
        
        const { date, time } = this.formatDateTime(photo.time);
        const dateTimeStr = time ? `${date} ${time}` : date;
        
        const cityId = `city-${uniqueId}`;
        
        if (photo.lat && photo.lng) {
            setTimeout(async () => {
                const cityName = await this.getCityName(photo.lat, photo.lng);
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
            // 如果有缩略图，直接显示图片
            if (thumbnailInfo.isThumbnail) {
                return `
                    <div class="photo-tooltip">
                        <div class="thumbnail-wrapper" id="${uniqueId}">
                            <img src="${fileUrl}" 
                                 style="max-width: 224px; max-height: 224px;"
                                 onload="adjustThumbnailSize(this)"
                                 onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:120px;height:90px;background:#333;display:flex;align-items:center;justify-content:center;\\'><div class=\\'video-play-icon\\'></div></div>';" />
                            <div class="video-play-icon"></div>
                        </div>
                        ${infoHtml}
                    </div>
                `;
            } else {
                return `
                    <div class="photo-tooltip">
                        <div class="thumbnail-wrapper" id="${uniqueId}">
                            <video src="${fileUrl}" 
                                   style="max-width: 224px; max-height: 224px; display: block;"
                                   data-original-path="${filePath}"
                                   onloadedmetadata="adjustVideoThumbnailSize(this); generateVideoThumbnail(this);"
                                   onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:120px;height:90px;background:#333;display:flex;align-items:center;justify-content:center;\\'><div class=\\'video-play-icon\\'></div></div>';" 
                                   muted preload="metadata">
                            </video>
                            <div class="video-play-icon"></div>
                        </div>
                        ${infoHtml}
                    </div>
                `;
            }
        } else {
            return `
                <div class="photo-tooltip">
                    <div class="thumbnail-wrapper">
                        <img src="${fileUrl}" 
                             data-original-path="${filePath}"
                             data-is-thumbnail="${thumbnailInfo.isThumbnail}"
                             style="max-width: 224px; max-height: 224px;"
                             onload="adjustThumbnailSize(this); generateImageThumbnail(this);"
                             onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:100px;height:100px;background:#333;display:flex;align-items:center;justify-content:center;color:#999;\\'>无法加载</div>';">
                    </div>
                    ${infoHtml}
                </div>
            `;
        }
    }

    /**
     * 根据时间范围加载照片标记
     */
    async loadMarkersByTimeRange(startTime, endTime) {
        if (this.isLoadingMarkers) return;
        this.isLoadingMarkers = true;
        
        try {
            // 确保是有效的Date对象
            const start = startTime instanceof Date ? startTime : new Date(startTime);
            const end = endTime instanceof Date ? endTime : new Date(endTime);
            
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                console.error('Invalid time range:', startTime, endTime);
                this.isLoadingMarkers = false;
                return;
            }
            
            const photos = await this.ipcRenderer.invoke('query-photos-by-time', {
                startTime: start.toISOString(),
                endTime: end.toISOString()
            });
            
            console.log(`加载照片: ${photos.length} 张 (${start.toISOString()} - ${end.toISOString()})`);
            
            this.currentPhotosCache = photos;
            this.markersLayer.clearLayers();
            
            const locationCount = new Map();
            const markers = [];
            
            // 默认坐标：54°24′25″S 3°17′16″E
            const DEFAULT_LAT = -54.406944;
            const DEFAULT_LNG = 3.287778;
            
            photos.forEach((photo, index) => {
                // 如果没有有效的经纬度，使用默认坐标
                let photoLat = (photo.lat && typeof photo.lat === 'number') ? photo.lat : DEFAULT_LAT;
                let photoLng = (photo.lng && typeof photo.lng === 'number') ? photo.lng : DEFAULT_LNG;
                
                const locKey = `${photoLat.toFixed(5)},${photoLng.toFixed(5)}`;
                const count = locationCount.get(locKey) || 0;
                locationCount.set(locKey, count + 1);
                
                let lat = photoLat;
                let lng = photoLng;
                if (count > 0) {
                    const angle = count * 0.5;
                    const offset = 0.00002 * count;
                    lat += offset * Math.cos(angle);
                    lng += offset * Math.sin(angle);
                }
                
                const marker = L.marker([lat, lng]);
                    const markerId = `marker-${photo.id || index}-${Date.now()}`;
                    marker._markerId = markerId;
                    marker.photoData = JSON.parse(JSON.stringify(photo));
                    
                    marker.on('mouseover', function() {
                        if (!this._tooltipBound) {
                            const photoInfo = this.photoData;
                            this.bindTooltip(this._mapManager.createThumbnailTooltip(photoInfo), {
                                direction: 'top',
                                offset: [0, -10],
                                opacity: 1,
                                className: 'photo-tooltip-container'
                            });
                            this._tooltipBound = true;
                            this.openTooltip();
                        }
                    });
                    
                    // 点击事件：打开照片窗口（支持照片和视频）
                    marker.on('click', async function() {
                        const photoData = this.photoData;
                        await this._mapManager.ipcRenderer.invoke('open-photo-window', photoData);
                    });
                    
                    marker._mapManager = this;
                    markers.push(marker);
                });
            
            this.markersLayer.addLayers(markers);
            
            console.log(`已加载 ${photos.length} 个标记 (${startTime.toLocaleDateString()} - ${endTime.toLocaleDateString()})`);
        } catch (error) {
            console.error('加载标记出错:', error);
        } finally {
            this.isLoadingMarkers = false;
        }
    }

    /**
     * 加载所有照片标记
     */
    async loadAllMarkers() {
        try {
            const photos = await this.ipcRenderer.invoke('get-all-photos');
            this.currentPhotosCache = photos;
            this.markersLayer.clearLayers();
            
            const locationCount = new Map();
            const markers = [];
            
            // 默认坐标：54°24′25″S 3°17′16″E
            const DEFAULT_LAT = -54.406944;
            const DEFAULT_LNG = 3.287778;
            
            photos.forEach((photo, index) => {
                // 如果没有有效的经纬度，使用默认坐标
                let photoLat = (photo.lat && typeof photo.lat === 'number') ? photo.lat : DEFAULT_LAT;
                let photoLng = (photo.lng && typeof photo.lng === 'number') ? photo.lng : DEFAULT_LNG;
                
                const locKey = `${photoLat.toFixed(5)},${photoLng.toFixed(5)}`;
                const count = locationCount.get(locKey) || 0;
                locationCount.set(locKey, count + 1);
                
                let lat = photoLat;
                let lng = photoLng;
                if (count > 0) {
                    const angle = count * 0.5;
                    const offset = 0.00002 * count;
                    lat += offset * Math.cos(angle);
                    lng += offset * Math.sin(angle);
                }
                
                const marker = L.marker([lat, lng]);
                    const markerId = `marker-${photo.id || index}-${Date.now()}`;
                    marker._markerId = markerId;
                    marker.photoData = JSON.parse(JSON.stringify(photo));
                    
                    marker.on('mouseover', function() {
                        if (!this._tooltipBound) {
                            const photoInfo = this.photoData;
                            this.bindTooltip(this._mapManager.createThumbnailTooltip(photoInfo), {
                                direction: 'top',
                                offset: [0, -10],
                                opacity: 1,
                                className: 'photo-tooltip-container'
                            });
                            this._tooltipBound = true;
                            this.openTooltip();
                        }
                    });
                    
                    // 点击事件：打开照片窗口（支持照片和视频）
                    marker.on('click', async function() {
                        const photoData = this.photoData;
                        await this._mapManager.ipcRenderer.invoke('open-photo-window', photoData);
                    });
                    
                    marker._mapManager = this;
                    markers.push(marker);
            });
            
            this.markersLayer.addLayers(markers);
        } catch (error) {
            console.error('加载标记出错:', error);
        }
    }

    /**
     * 矩形选框创建事件处理
     */
    async onRectangleCreated(e) {
        const layer = e.layer;
        this.drawnItems.clearLayers();
        this.drawnItems.addLayer(layer);

        const bounds = layer.getBounds();
        
        const range = {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        };

        const areaPhotos = await this.ipcRenderer.invoke('query-area', range);
        
        console.log("区域内照片列表:", areaPhotos);
        
        // 如果有照片，打开照片管理窗口
        if (areaPhotos && areaPhotos.length > 0) {
            await this.ipcRenderer.invoke('open-photos-manage-window', {
                tab: 'selected',
                photos: areaPhotos,
                bounds: range
            });
        } else {
            alert('在该矩形区域内没有找到照片');
        }
    }

    /**
     * 设置地图视图
     */
    setView(lat, lng, zoom) {
        this.map.setView([lat, lng], zoom);
    }

    /**
     * 获取当前地图视图中心
     */
    getCenter() {
        return this.map.getCenter();
    }

    /**
     * 获取当前缩放级别
     */
    getZoom() {
        return this.map.getZoom();
    }

    /**
     * 清除所有标记
     */
    clearMarkers() {
        this.markersLayer.clearLayers();
    }

    /**
     * 获取当前缓存的照片数据
     */
    getCachedPhotos() {
        return this.currentPhotosCache;
    }

    /**
     * 清除地图上的矩形选框
     */
    clearRectangle() {
        if (this.drawnItems) {
            this.drawnItems.clearLayers();
            console.log('矩形选框已清除');
        }
    }
}

// 全局辅助函数（用于 HTML 内联事件）
window.adjustThumbnailSize = function(img) {
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    const maxSize = 224;
    
    if (naturalWidth > naturalHeight) {
        img.style.width = maxSize + 'px';
        img.style.height = 'auto';
    } else {
        img.style.height = maxSize + 'px';
        img.style.width = 'auto';
    }
};

window.adjustVideoThumbnailSize = function(video) {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const maxSize = 224;
    
    if (videoWidth > videoHeight) {
        video.style.width = maxSize + 'px';
        video.style.height = 'auto';
    } else {
        video.style.height = maxSize + 'px';
        video.style.width = 'auto';
    }
    video.currentTime = 0.1;
};

// 生成图片缩略图
window.generateImageThumbnail = function(img) {
    const isThumbnail = img.dataset.isThumbnail === 'true';
    const originalPath = img.dataset.originalPath;
    
    if (!isThumbnail && originalPath) {
        // 异步生成缩略图
        ThumbnailGenerator.generateAndSaveThumbnail(img, originalPath).catch(err => {
            console.error('生成缩略图失败:', err);
        });
    }
};

// 生成视频缩略图
window.generateVideoThumbnail = function(video) {
    const originalPath = video.dataset.originalPath;
    
    if (originalPath) {
        video.addEventListener('seeked', () => {
            ThumbnailGenerator.generateAndSaveThumbnail(video, originalPath).catch(err => {
                console.error('生成视频缩略图失败:', err);
            });
        }, { once: true });
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapManager;
}
