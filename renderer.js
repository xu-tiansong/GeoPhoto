const { ipcRenderer } = require('electron');
// Leaflet 已通过 CDN 在 HTML 中加载，使用全局 L 对象

// --- 1. 初始化地图 ---
// 设置初始视角为世界地图
const map = L.map('map').setView([20, 0], 2);

// 使用 Esri 免费卫星图层
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
}).addTo(map);

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

// --- 3. 扫描文件夹功能 ---
const scanBtn = document.getElementById('scan-btn');
const statusText = document.getElementById('status');

scanBtn.addEventListener('click', async () => {
    statusText.innerText = "🔍 正在扫描目录，请稍候...";
    
    // 调用 main.js 中的扫描逻辑
    const result = await ipcRenderer.invoke('scan-directory');
    
    if (result.count > 0) {
        statusText.innerText = `✅ 扫描完成！新增了 ${result.count} 张带GPS的照片。`;
        loadMarkers(); // 扫描完立即刷新地图
    } else {
        statusText.innerText = "ℹ️ 未发现新照片或所选目录无带GPS信息的照片。";
    }
});

// --- 监听来自菜单的扫描事件 ---
ipcRenderer.on('scan-started', () => {
    statusText.innerText = "🔍 正在扫描目录，请稍候...";
});

ipcRenderer.on('scan-completed', (event, data) => {
    if (data.count > 0) {
        statusText.innerText = `✅ 扫描完成！在 "${data.directory}" 中新增了 ${data.count} 个带GPS的文件（照片/视频）。`;
        loadMarkers(); // 扫描完立即刷新地图
    } else {
        statusText.innerText = "ℹ️ 未发现新文件或所选目录无带GPS信息的文件。";
    }
});

ipcRenderer.on('scan-error', (event, data) => {
    statusText.innerText = `❌ 扫描出错: ${data.error}`;
});

// --- 4. 渲染地图标记 (Markers) ---
let markersLayer = L.layerGroup().addTo(map);

async function loadMarkers() {
    // 从数据库获取所有照片信息
    const photos = await ipcRenderer.invoke('get-all-photos');
    
    // 清除旧标记，避免重复叠加
    markersLayer.clearLayers();
    
    photos.forEach(photo => {
        if (photo.lat && photo.lng) {
            const marker = L.marker([photo.lat, photo.lng]);
            
            // 绑定弹出窗，显示时间和类型
            const dateStr = photo.time ? new Date(photo.time).toLocaleString() : '未知时间';
            const typeStr = photo.type === 'video' ? '🎬 视频' : '📷 照片';
            marker.bindPopup(`
                <b>${typeStr}详情</b><br>
                时间: ${dateStr}<br>
                路径: <small>${photo.path}</small>
            `);
            
            markersLayer.addLayer(marker);
        }
    });
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
    constructor() {
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
        
        // 初始化时间范围
        this.initTimeRange();
        
        this.initEvents();
        
        // 延迟渲染以确保容器有正确的宽度
        requestAnimationFrame(() => {
            this.initTimeRange();
            this.render();
        });
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
        const numDays = Math.max(7, Math.floor(containerWidth / this.tickWidth));
        
        // 保持右侧时间不变（显示到今天），调整左侧
        const newStart = new Date(this.timelineEnd);
        newStart.setDate(newStart.getDate() - numDays);
        this.timelineStart = newStart;
        
        // 确保选择范围在可视范围内
        if (this.selectionStart < this.timelineStart) {
            this.selectionStart = new Date(this.timelineStart);
        }
        if (this.selectionEnd > this.timelineEnd) {
            this.selectionEnd = new Date(this.timelineEnd);
        }
        
        this.render();
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
}

// 初始化时间滚动条
let timelineScrollbar;

// 页面启动时，自动加载一次数据库里已有的标记
window.onload = () => {
    loadMarkers();
    // 延迟初始化时间滚动条，确保DOM完全加载
    setTimeout(() => {
        timelineScrollbar = new TimelineScrollbar();
        console.log('Timeline initialized');
    }, 100);
};