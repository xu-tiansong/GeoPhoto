/**
 * Timeline.js - 时间轴滚动条类 (渲染器端)
 * 管理时间轴的显示、交互和状态
 */

class Timeline {
    constructor(ipcRenderer, skipInitialRender = false) {
        this.ipcRenderer = ipcRenderer;
        
        // DOM元素
        this.container = document.getElementById('timeline-container');
        this.upperRow = document.getElementById('timeline-upper-row');
        this.lowerRow = document.getElementById('timeline-lower-row');
        this.scrollbar = document.getElementById('timeline-scrollbar');
        this.thumb = document.getElementById('timeline-thumb');
        this.leftHandle = this.thumb.querySelector('.thumb-handle.left');
        this.rightHandle = this.thumb.querySelector('.thumb-handle.right');
        this.arrowLeft = document.getElementById('timeline-arrow-left');
        this.arrowRight = document.getElementById('timeline-arrow-right');
        
        // 精度模式: 'hour', 'day', 'month'
        this.scaleMode = 'day';
        this.scaleModes = ['hour', 'day', 'month'];
        this.scaleModeIndex = 1;
        
        // 每个刻度的像素宽度
        this.tickWidth = 28;
        
        // 拖动状态
        this.isDragging = false;
        this.dragType = null; // 'left', 'right', 'move', 'pan'
        this.dragStartX = 0;
        this.dragStartSelectionStart = null;
        this.dragStartSelectionEnd = null;
        this.dragStartTimelineStart = null;
        this.dragStartTimelineEnd = null;
        
        // 回调函数
        this.selectionChangeCallback = null;
        
        // 初始化时间范围
        this.initTimeRange();
        this.initEvents();
        
        if (!skipInitialRender) {
            requestAnimationFrame(() => {
                this.render();
            });
        }
    }

    /**
     * 初始化时间范围
     */
    initTimeRange() {
        const containerWidth = this.container.offsetWidth || window.innerWidth;
        const numDays = Math.max(7, Math.floor(containerWidth / this.tickWidth));
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        this.timelineEnd = new Date(today);
        this.timelineEnd.setDate(this.timelineEnd.getDate() + 1);
        this.timelineStart = new Date(this.timelineEnd);
        this.timelineStart.setDate(this.timelineStart.getDate() - numDays);
        
        this.selectionEnd = new Date(this.timelineEnd);
        this.selectionStart = new Date(this.selectionEnd);
        this.selectionStart.setDate(this.selectionStart.getDate() - 7);
    }

    /**
     * 窗口大小变化时重新计算
     */
    onResize() {
        const containerWidth = this.container.offsetWidth;
        if (containerWidth <= 0) return;
        
        const numTicks = Math.max(7, Math.floor(containerWidth / this.tickWidth));
        
        const newStart = new Date(this.timelineEnd);
        if (this.scaleMode === 'hour') {
            newStart.setHours(newStart.getHours() - numTicks);
        } else if (this.scaleMode === 'day') {
            newStart.setDate(newStart.getDate() - numTicks);
        } else if (this.scaleMode === 'month') {
            newStart.setMonth(newStart.getMonth() - numTicks);
        }
        this.timelineStart = newStart;
        
        if (this.selectionStart < this.timelineStart) {
            this.selectionStart = new Date(this.timelineStart);
        }
        if (this.selectionEnd > this.timelineEnd) {
            this.selectionEnd = new Date(this.timelineEnd);
        }
        
        this.render();
        this.saveState();
    }

    /**
     * 保存时间轴状态到数据库
     */
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
            await this.ipcRenderer.invoke('save-timeline-state', state);
        } catch (error) {
            console.error('保存时间轴状态失败:', error);
        }
    }

    /**
     * 从数据库恢复时间轴状态
     */
    async restoreState() {
        try {
            const state = await this.ipcRenderer.invoke('load-timeline-state');
            if (state) {
                this.scaleMode = state.scaleMode || 'day';
                this.scaleModeIndex = state.scaleModeIndex !== undefined ? state.scaleModeIndex : 1;
                
                const savedTimelineStart = new Date(state.timelineStart);
                const savedTimelineEnd = new Date(state.timelineEnd);
                const savedSelectionStart = new Date(state.selectionStart);
                const savedSelectionEnd = new Date(state.selectionEnd);
                
                if (isNaN(savedTimelineStart.getTime()) || isNaN(savedTimelineEnd.getTime()) ||
                    isNaN(savedSelectionStart.getTime()) || isNaN(savedSelectionEnd.getTime())) {
                    console.log('保存的时间无效，使用默认值');
                    return false;
                }
                
                this.selectionStart = savedSelectionStart;
                this.selectionEnd = savedSelectionEnd;
                
                const containerWidth = this.container.offsetWidth || window.innerWidth;
                const numTicks = Math.max(7, Math.floor(containerWidth / this.tickWidth));
                
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
                
                if (this.selectionStart < this.timelineStart) {
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

    /**
     * 将时间对齐到刻度
     */
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

    addTicks(baseTime, ticks) {
        const result = new Date(baseTime);
        if (this.scaleMode === 'day') {
            result.setDate(result.getDate() + ticks);
        } else if (this.scaleMode === 'hour') {
            result.setHours(result.getHours() + ticks);
        } else if (this.scaleMode === 'month') {
            result.setMonth(result.getMonth() + ticks);
            result.setDate(1);
            result.setHours(0, 0, 0, 0);
        }
        return result;
    }

    roundToNearestTick(time) {
        const lower = this.snapToTick(time, false);
        const upper = this.addTicks(lower, 1);

        const toLower = Math.abs(time.getTime() - lower.getTime());
        const toUpper = Math.abs(upper.getTime() - time.getTime());
        return toLower <= toUpper ? lower : upper;
    }

    getTickDistance(startTime, endTime) {
        if (this.scaleMode === 'day') {
            const msPerDay = 24 * 60 * 60 * 1000;
            return Math.max(1, Math.round((endTime.getTime() - startTime.getTime()) / msPerDay));
        }

        if (this.scaleMode === 'hour') {
            const msPerHour = 60 * 60 * 1000;
            return Math.max(1, Math.round((endTime.getTime() - startTime.getTime()) / msPerHour));
        }

        let distance = 0;
        let cursor = new Date(startTime);
        while (cursor < endTime) {
            cursor = this.addTicks(cursor, 1);
            distance++;
            if (distance > 5000) break;
        }
        return Math.max(1, distance);
    }

    getScaleUnitMs(mode = this.scaleMode) {
        if (mode === 'hour') {
            return 60 * 60 * 1000;
        }
        if (mode === 'day') {
            return 24 * 60 * 60 * 1000;
        }
        if (mode === 'month') {
            return null;
        }
        return null;
    }

    getTickDistanceByMode(startTime, endTime, mode) {
        const unitMs = this.getScaleUnitMs(mode);
        if (unitMs) {
            return Math.max(1, Math.ceil((endTime.getTime() - startTime.getTime()) / unitMs));
        }

        let distance = 0;
        let cursor = new Date(startTime);
        while (cursor < endTime) {
            if (mode === 'month') {
                cursor.setMonth(cursor.getMonth() + 1);
                cursor.setDate(1);
                cursor.setHours(0, 0, 0, 0);
            }
            distance++;
            if (distance > 5000) break;
        }
        return Math.max(1, distance);
    }

    /**
     * 获取星期几名称
     */
    getDayName(date) {
        const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return days[date.getDay()];
    }

    /**
     * 获取月份缩写
     */
    getMonthAbbr(month) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[month];
    }

    /**
     * 计算时间到像素位置
     */
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
            // 对齐到月初，与渲染一致
            const baseMonthStart = new Date(this.timelineStart);
            baseMonthStart.setDate(1);
            baseMonthStart.setHours(0, 0, 0, 0);
            
            const timeMonthStart = new Date(time);
            timeMonthStart.setDate(1);
            timeMonthStart.setHours(0, 0, 0, 0);
            
            const yearDiff = timeMonthStart.getFullYear() - baseMonthStart.getFullYear();
            const monthDiff = timeMonthStart.getMonth() - baseMonthStart.getMonth();
            const monthOffset = yearDiff * 12 + monthDiff;
            
            // 增加月内偏移（日期部分）
            const timeInMonth = time.getTime() - timeMonthStart.getTime();
            const nextMonth = new Date(timeMonthStart);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            const monthDuration = nextMonth.getTime() - timeMonthStart.getTime();
            const fractional = monthDuration > 0 ? timeInMonth / monthDuration : 0;
            
            return (monthOffset + fractional) * this.tickWidth;
        }
    }

    /**
     * 计算像素位置到时间
     */
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
            // 对齐到月初基准
            const baseMonthStart = new Date(this.timelineStart);
            baseMonthStart.setDate(1);
            baseMonthStart.setHours(0, 0, 0, 0);
            
            const monthOffset = pixel / this.tickWidth;
            const wholeMonths = monthOffset >= 0 ? Math.floor(monthOffset) : Math.ceil(monthOffset);
            const fractional = monthOffset - wholeMonths;

            const targetMonthStart = new Date(baseMonthStart);
            targetMonthStart.setMonth(targetMonthStart.getMonth() + wholeMonths);
            
            if (fractional === 0) {
                return targetMonthStart;
            }

            const nextMonth = new Date(targetMonthStart);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            const monthDuration = nextMonth.getTime() - targetMonthStart.getTime();
            return new Date(targetMonthStart.getTime() + fractional * monthDuration);
        }
    }

    /**
     * 渲染刻度
     */
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

    /**
     * 小时刻度模式
     */
    renderHourScale(containerWidth) {
        const startTime = new Date(this.timelineStart);
        startTime.setMinutes(0, 0, 0);
        
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
        
        currentHour = new Date(startTime);
        let dayStartX = 0;
        hourIndex = 0;
        
        while (currentHour < this.timelineEnd) {
            const nextHour = new Date(currentHour.getTime() + 3600000);
            
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

    /**
     * 天刻度模式
     */
    renderDayScale(containerWidth) {
        const startTime = new Date(this.timelineStart);
        startTime.setHours(0, 0, 0, 0);
        
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
        
        currentDay = new Date(startTime);
        let monthStartX = 0;
        dayIndex = 0;
        
        while (currentDay < this.timelineEnd) {
            const nextDay = new Date(currentDay);
            nextDay.setDate(nextDay.getDate() + 1);
            
            if (nextDay.getMonth() !== currentDay.getMonth() || nextDay >= this.timelineEnd) {
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
                
                monthStartX = monthEndX;
            }
            
            currentDay = nextDay;
            dayIndex++;
        }
    }

    /**
     * 月刻度模式
     */
    renderMonthScale(containerWidth) {
        const startTime = new Date(this.timelineStart);
        startTime.setDate(1);
        startTime.setHours(0, 0, 0, 0);
        
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
        
        currentMonth = new Date(startTime);
        let yearStartX = 0;
        monthIndex = 0;
        
        while (currentMonth < this.timelineEnd) {
            const nextMonth = new Date(currentMonth);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            
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

    /**
     * 更新滚动bar位置
     */
    updateThumb(shouldSnap = true) {
        const left = this.timeToPixel(this.selectionStart);
        const right = this.timeToPixel(this.selectionEnd);
        
        if (shouldSnap && this.scaleMode !== 'month') {
            const snappedLeft = Math.round(left / this.tickWidth) * this.tickWidth;
            const snappedRight = Math.round(right / this.tickWidth) * this.tickWidth;
            
            this.thumb.style.left = snappedLeft + 'px';
            this.thumb.style.width = Math.max(this.tickWidth, snappedRight - snappedLeft) + 'px';
        } else {
            this.thumb.style.left = left + 'px';
            this.thumb.style.width = Math.max(this.tickWidth, right - left) + 'px';
        }
    }

    /**
     * 初始化事件
     */
    initEvents() {
        // 鼠标滚轮切换精度
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const oldSelectionStart = new Date(this.selectionStart);
            const oldSelectionEnd = new Date(this.selectionEnd);
            const oldTimelineStart = new Date(this.timelineStart);
            const oldTimelineEnd = new Date(this.timelineEnd);

            if (e.deltaY > 0) {
                this.scaleModeIndex = Math.min(this.scaleModeIndex + 1, this.scaleModes.length - 1);
            } else {
                this.scaleModeIndex = Math.max(this.scaleModeIndex - 1, 0);
            }

            const oldMode = this.scaleMode;
            this.scaleMode = this.scaleModes[this.scaleModeIndex];

            if (oldMode !== this.scaleMode) {
                this.adjustTimelineForScale(oldSelectionStart, oldSelectionEnd, oldTimelineStart, oldTimelineEnd);
            }

            this.render();
            this.notifySelectionChange();
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
                e.target === this.rightHandle ||
                this.arrowLeft.contains(e.target) ||
                this.arrowRight.contains(e.target)) return;
            this.startDrag(e, 'pan');
        });
        
        // 箭头按钮平移时间轴
        this.arrowLeft.addEventListener('click', (e) => {
            e.stopPropagation();
            this.panTimeline(-1);
        });
        
        this.arrowRight.addEventListener('click', (e) => {
            e.stopPropagation();
            this.panTimeline(1);
        });
        
        // 长按箭头持续滚动
        let arrowInterval = null;
        const startArrowScroll = (direction) => {
            this.panTimeline(direction);
            arrowInterval = setInterval(() => {
                this.panTimeline(direction);
            }, 100);
        };
        const stopArrowScroll = () => {
            if (arrowInterval) {
                clearInterval(arrowInterval);
                arrowInterval = null;
            }
        };
        
        this.arrowLeft.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            startArrowScroll(-1);
        });
        
        this.arrowRight.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            startArrowScroll(1);
        });
        
        document.addEventListener('mouseup', () => {
            stopArrowScroll();
            if (this.isDragging) {
                if (this.dragType === 'left' || this.dragType === 'right') {
                    this.selectionStart = this.snapToTick(this.selectionStart, false);
                    this.selectionEnd = this.snapToTick(this.selectionEnd, true);
                    this.updateThumb(true);
                    this.notifySelectionChange();
                }
                if (this.dragType === 'move') {
                    const spanTicks = this.getTickDistance(this.dragStartSelectionStart, this.dragStartSelectionEnd);

                    let snappedStart = this.roundToNearestTick(this.selectionStart);
                    let snappedEnd = this.addTicks(snappedStart, spanTicks);

                    if (snappedStart < this.timelineStart) {
                        snappedStart = this.snapToTick(this.timelineStart, false);
                        snappedEnd = this.addTicks(snappedStart, spanTicks);
                    }

                    if (snappedEnd > this.timelineEnd) {
                        snappedEnd = this.snapToTick(this.timelineEnd, true);
                        snappedStart = this.addTicks(snappedEnd, -spanTicks);
                    }

                    this.selectionStart = snappedStart;
                    this.selectionEnd = snappedEnd;
                    this.updateThumb(true);
                    this.notifySelectionChange();
                }
                if (this.dragType === 'pan') {
                    this.saveState();
                }
            }
            this.isDragging = false;
            this.dragType = null;
            this.container.style.cursor = 'grab';
        });
        
        document.addEventListener('mouseleave', () => {
            stopArrowScroll();
        });
        
        // 鼠标移动
        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            this.onDrag(e);
        });
        
        // 窗口大小变化
        window.addEventListener('resize', () => {
            this.onResize();
        });
    }

    /**
     * 根据精度调整时间轴范围
     */
    adjustTimelineForScale(oldSelectionStart = this.selectionStart, oldSelectionEnd = this.selectionEnd, oldTimelineStart = this.timelineStart, oldTimelineEnd = this.timelineEnd) {
        const containerWidth = this.container.offsetWidth || window.innerWidth;
        const visibleTicks = Math.max(7, Math.floor(containerWidth / this.tickWidth));

        const newSelectionStart = this.snapToTick(oldSelectionStart, false);
        const selectionTicks = this.getTickDistanceByMode(oldSelectionStart, oldSelectionEnd, this.scaleMode);
        const newSelectionEnd = this.addTicks(newSelectionStart, selectionTicks);

        const timelineCenterMs = (oldTimelineStart.getTime() + oldTimelineEnd.getTime()) / 2;
        const newTimelineCenter = this.snapToTick(new Date(timelineCenterMs), false);
        let newTimelineStart = this.addTicks(newTimelineCenter, -Math.floor(visibleTicks / 2));
        let newTimelineEnd = this.addTicks(newTimelineStart, visibleTicks);

        if (newSelectionStart < newTimelineStart) {
            newTimelineStart = new Date(newSelectionStart);
            newTimelineEnd = this.addTicks(newTimelineStart, visibleTicks);
        }

        if (newSelectionEnd > newTimelineEnd) {
            newTimelineEnd = new Date(newSelectionEnd);
            newTimelineStart = this.addTicks(newTimelineEnd, -visibleTicks);
        }

        this.selectionStart = newSelectionStart;
        this.selectionEnd = newSelectionEnd;
        this.timelineStart = newTimelineStart;
        this.timelineEnd = newTimelineEnd;
    }

    /**
     * 开始拖动
     */
    startDrag(e, type) {
        this.isDragging = true;
        this.dragType = type;
        this.dragStartX = e.clientX;
        this.dragStartSelectionStart = new Date(this.selectionStart);
        this.dragStartSelectionEnd = new Date(this.selectionEnd);
        this.dragStartTimelineStart = new Date(this.timelineStart);
        this.dragStartTimelineEnd = new Date(this.timelineEnd);
        
        if (type === 'pan') {
            this.container.style.cursor = 'grabbing';
        }
    }

    /**
     * 拖动中
     */
    onDrag(e) {
        const deltaX = e.clientX - this.dragStartX;
        
        if (this.dragType === 'left') {
            const startPixel = this.timeToPixel(this.dragStartSelectionStart);
            const newStart = this.pixelToTime(startPixel + deltaX);
            if (newStart < this.selectionEnd && newStart >= this.timelineStart) {
                this.selectionStart = newStart;
            }
            this.updateThumb(false);
        } else if (this.dragType === 'right') {
            const endPixel = this.timeToPixel(this.dragStartSelectionEnd);
            const newEnd = this.pixelToTime(endPixel + deltaX);
            if (newEnd > this.selectionStart && newEnd <= this.timelineEnd) {
                this.selectionEnd = newEnd;
            }
            this.updateThumb(false);
        } else if (this.dragType === 'move') {
            const spanTicks = this.getTickDistance(this.dragStartSelectionStart, this.dragStartSelectionEnd);
            const startPixel = this.timeToPixel(this.dragStartSelectionStart);
            let newStart = this.pixelToTime(startPixel + deltaX);
            let newEnd = this.addTicks(newStart, spanTicks);
            
            if (newStart < this.timelineStart) {
                newStart = new Date(this.timelineStart);
                newEnd = this.addTicks(newStart, spanTicks);
            }
            if (newEnd > this.timelineEnd) {
                newEnd = new Date(this.timelineEnd);
                newStart = this.addTicks(newEnd, -spanTicks);
            }
            
            this.selectionStart = newStart;
            this.selectionEnd = newEnd;
            this.updateThumb(false);
        } else if (this.dragType === 'pan') {
            const visibleTicks = this.getTickDistance(this.dragStartTimelineStart, this.dragStartTimelineEnd);
            const startPixel = this.timeToPixel(this.dragStartTimelineStart);
            this.timelineStart = this.pixelToTime(startPixel - deltaX);
            this.timelineEnd = this.addTicks(this.timelineStart, visibleTicks);
            
            this.render();
            return;
        }
    }

    /**
     * 箭头按钮平移时间轴
     */
    panTimeline(direction) {
        this.timelineStart = this.addTicks(this.timelineStart, direction);
        this.timelineEnd = this.addTicks(this.timelineEnd, direction);
        
        this.render();
        this.saveState();
    }

    /**
     * 获取当前选择的时间范围
     */
    getSelectedRange() {
        return {
            start: this.selectionStart,
            end: this.selectionEnd
        };
    }

    /**
     * 设置时间轴范围
     */
    setTimelineRange(startTime, endTime) {
        this.timelineStart = new Date(startTime);
        this.timelineEnd = new Date(endTime);
        
        const duration = (endTime.getTime() - startTime.getTime()) * 0.1;
        this.selectionStart = new Date(startTime);
        this.selectionEnd = new Date(startTime.getTime() + duration);
        
        this.render();
    }

    /**
     * 当选择范围变化时触发回调
     */
    onSelectionChange(callback) {
        this.selectionChangeCallback = callback;
    }

    /**
     * 通知选择范围变化
     */
    notifySelectionChange() {
        if (this.selectionChangeCallback) {
            this.selectionChangeCallback(this.selectionStart, this.selectionEnd);
        }
        this.saveState();
    }

    /**
     * 获取当前模式
     */
    getCurrentMode() {
        return this.scaleMode;
    }

    /**
     * 格式化日期为本地 ISO 格式字符串（避免 UTC 时区偏移）
     */
    toLocalISOString(date) {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }

    /**
     * 获取当前选择范围
     * month 模式下，selectionEnd 落在月初零点表示"到上月底"，
     * 需要减一个月才能正确显示最后覆盖的月份
     */
    getCurrentRange() {
        let endForDisplay = new Date(this.selectionEnd);
        
        if (this.scaleMode === 'month' &&
            endForDisplay.getDate() === 1 &&
            endForDisplay.getHours() === 0 &&
            endForDisplay.getMinutes() === 0 &&
            endForDisplay.getSeconds() === 0 &&
            endForDisplay.getMilliseconds() === 0) {
            // 月初零点 → 上一个月才是最后覆盖的月
            endForDisplay.setMonth(endForDisplay.getMonth() - 1);
        }
        
        return {
            start: this.toLocalISOString(this.selectionStart),
            end: this.toLocalISOString(endForDisplay)
        };
    }

    /**
     * 更新模式
     */
    updateMode(mode, skipRender = false) {
        const modeIndex = this.scaleModes.indexOf(mode);
        if (modeIndex !== -1) {
            this.scaleModeIndex = modeIndex;
            this.scaleMode = mode;
            if (!skipRender) {
                this.onResize(); // Re-calculate and render
            }
        }
    }

    /**
     * 更新范围
     */
    /**
     * Parse a date string as local time based on the current scale mode.
     * - Month mode (YYYY-MM): first of month, local midnight
     * - Day mode (YYYY-MM-DD): local midnight
     * - Hour mode (YYYY-MM-DDTHH:mm): already parsed as local by new Date()
     * - Date objects: used as-is
     */
    parseLocalDate(value) {
        if (value instanceof Date) return new Date(value);
        const s = String(value);
        if (/^\d{4}-\d{2}$/.test(s)) {
            // YYYY-MM → local midnight on 1st
            return new Date(s + '-01T00:00:00');
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            // YYYY-MM-DD → local midnight
            return new Date(s + 'T00:00:00');
        }
        return new Date(s);
    }

    updateRange(start, end) {
        this.selectionStart = this.parseLocalDate(start);
        this.selectionEnd = this.parseLocalDate(end);

        // Month mode: YYYY-MM end means the START of that month,
        // so advance to the start of the next month to include it
        if (this.scaleMode === 'month' && typeof end === 'string' && /^\d{4}-\d{2}$/.test(end)) {
            this.selectionEnd.setMonth(this.selectionEnd.getMonth() + 1);
        }

        // Ensure the timeline encompasses the new range
        // Recalculate the visible timeline window around the selection
        const containerWidth = this.container.offsetWidth;
        const numTicks = Math.max(7, Math.floor(containerWidth / this.tickWidth));

        // Center the timeline around the selection, with some padding
        this.timelineEnd = this.addTicks(this.selectionEnd, 2);
        this.timelineStart = this.addTicks(this.timelineEnd, -numTicks);

        // Make sure selection start is visible
        if (this.selectionStart < this.timelineStart) {
            this.timelineStart = this.addTicks(this.selectionStart, -1);
            this.timelineEnd = this.addTicks(this.timelineStart, numTicks);
        }

        this.render();
        this.saveState();
        if (this.selectionChangeCallback) {
            this.selectionChangeCallback(this.selectionStart, this.selectionEnd);
        }
    }
}

// 导出为全局变量（渲染器端使用）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Timeline;
}
