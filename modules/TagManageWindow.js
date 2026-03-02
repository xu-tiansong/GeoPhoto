/**
 * TagManageWindow.js - 标签管理窗口
 * 提供 Faces / Events / Locations / Common 四类标签的树状管理界面
 */

const { BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { FaceTag, EventTag, LandmarkTag, CommonTag } = require('./Tag');
const TagSelectWindow = require('./TagSelectWindow');
const i18n = require('./i18n');

/**
 * 计算两点之间的地表距离（Haversine 公式），返回单位：米
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const dφ = (lat2 - lat1) * Math.PI / 180;
    const dλ = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const TAG_CLASSES = {
    face:     FaceTag,
    event:    EventTag,
    location: LandmarkTag,
    common:   CommonTag
};

class TagManageWindow {
    constructor(parentWindow, dbManager) {
        this.parentWindow = parentWindow;
        this.db           = dbManager;
        this.window       = null;

        // 绑定引用，便于移除监听器
        this._handleReady      = null;
        this._handleClose      = null;
        this._handleGetTags    = null;
        this._handleAddTag     = null;
        this._handleUpdateTag  = null;
        this._handleDeleteTag  = null;
        this._handleMoveTag    = null;
    }

    // ── 公开方法 ────────────────────────────────────────────

    show(initialTab = null) {
        if (this.window && !this.window.isDestroyed()) {
            this.window.focus();
            // 窗口已打开时，若指定了 tab 则发送切换消息
            if (initialTab) {
                this.window.webContents.send('tag-manage-switch-tab', initialTab);
            }
            return;
        }
        this._initialTab = initialTab;

        this.window = new BrowserWindow({
            width:  1024,
            height: 600,
            modal:  true,
            parent: this.parentWindow,
            webPreferences: {
                preload:          path.join(__dirname, '../renderer-tagmanage.js'),
                contextIsolation: true,
                nodeIntegration:  false
            },
            frame:          false,
            center:         true,
            resizable:      false,
            backgroundColor: '#1a1a1a'
        });

        this.window.loadFile(path.join(__dirname, '..', 'tag-manage-window.html'));
        this._registerHandlers();

        this.window.on('closed', () => {
            this._removeHandlers();
            this.window = null;
            // 通知主窗口刷新事件标签日期高亮
            if (this.parentWindow && !this.parentWindow.isDestroyed()) {
                this.parentWindow.webContents.send('refresh-event-tag-dates');
            }
        });
    }

    close() {
        if (this.window && !this.window.isDestroyed()) this.window.close();
    }

    isOpen() {
        return !!(this.window && !this.window.isDestroyed());
    }

    // ── IPC 注册 ────────────────────────────────────────────

    _registerHandlers() {
        // 窗口就绪后发送初始化信号（once，只触发一次）
        this._handleReady = () => {
            if (this.window && !this.window.isDestroyed()) {
                this.window.webContents.send('tag-manage-init', {
                    lang:       i18n.getLanguage(),
                    initialTab: this._initialTab || null
                });
            }
        };

        this._handleClose = () => {
            if (this.window && !this.window.isDestroyed()) this.window.close();
        };

        // 获取某分类下的完整标签树
        this._handleGetTags = (_event, category) => {
            try {
                const tags = this.db.getTagsByCategory(category);
                return { success: true, tags };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        // 新增标签
        this._handleAddTag = (_event, { name, category, parentId, color, remark }) => {
            try {
                const TagClass = TAG_CLASSES[category] || CommonTag;
                const tag = new TagClass({
                    name,
                    category,
                    parent_id: parentId ?? null,
                    color:     color  || '#3498db',
                    remark:    remark || ''
                });
                const id = this.db.saveTag(tag);
                return { success: true, id };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        // 更新标签基础字段（name / remark / color）
        this._handleUpdateTag = (_event, { id, name, remark, color }) => {
            try {
                this.db.updateTagBase(id, { name, remark, color });
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        // 删除标签（含所有后代）
        this._handleDeleteTag = (_event, { id }) => {
            try {
                this.db.deleteTag(id);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        // 移动标签（改变父节点）
        this._handleMoveTag = (_event, { id, parentId }) => {
            try {
                this.db.moveTag(id, parentId ?? null);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        // 保存人脸识别数据（descriptors + 缩略图）
        this._handleSaveFace = async (_event, { tagId, descriptors, thumbnail }) => {
            try {
                this.db.clearFaceDescriptors(tagId);
                for (const desc of descriptors) {
                    this.db.addFaceDescriptor(tagId, desc, null);
                }
                this.db.updateFacePreview(tagId, thumbnail);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        // 清除人脸识别数据
        this._handleClearFace = async (_event, { tagId }) => {
            try {
                this.db.clearFaceDescriptors(tagId);
                this.db.updateFacePreview(tagId, null);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        // 保存事件日期
        this._handleSaveEvent = async (_event, { tagId, startTime, endTime }) => {
            try {
                // 验证子事件日期不能超出父事件日期范围
                if (startTime && endTime) {
                    const tag = this.db.getTagById(tagId);
                    if (tag && tag.parent_id) {
                        const parent = this.db.getTagById(tag.parent_id);
                        if (parent && parent.start_time && parent.end_time) {
                            const pStart = parent.start_time.substring(0, 10);
                            const pEnd   = parent.end_time.substring(0, 10);
                            const cStart = startTime.substring(0, 10);
                            const cEnd   = endTime.substring(0, 10);
                            if (cStart < pStart || cEnd > pEnd) {
                                return { success: false, error: `Child event dates must be within parent date range (${pStart} ~ ${pEnd})` };
                            }
                        }
                    }
                }
                this.db.updateEventDates(tagId, startTime, endTime);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        // 选择图片文件（点击拖放区时的备选方案）
        this._handlePickImage = async () => {
            try {
                const result = await dialog.showOpenDialog(this.window, {
                    properties: ['openFile'],
                    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp'] }]
                });
                if (result.canceled || result.filePaths.length === 0) return { filePath: null };
                return { filePath: result.filePaths[0] };
            } catch (e) {
                return { filePath: null, error: e.message };
            }
        };

        // 定位到地图：转发坐标给主窗口并关闭标签窗体
        this._handleLocateOnMap = (_event, { lat, lng }) => {
            if (this.parentWindow && !this.parentWindow.isDestroyed()) {
                this.parentWindow.webContents.send('locate-on-map', { lat, lng });
            }
            if (this.window && !this.window.isDestroyed()) this.window.close();
        };

        ipcMain.once('tag-manage-window-ready', this._handleReady);
        ipcMain.on  ('close-tag-manage-window',   this._handleClose);
        ipcMain.on  ('locate-landmark-on-map',    this._handleLocateOnMap);
        ipcMain.handle('tag-manage-get-tags',    this._handleGetTags);
        ipcMain.handle('tag-manage-add-tag',     this._handleAddTag);
        ipcMain.handle('tag-manage-update-tag',  this._handleUpdateTag);
        ipcMain.handle('tag-manage-delete-tag',  this._handleDeleteTag);
        ipcMain.handle('tag-manage-move-tag',    this._handleMoveTag);
        ipcMain.handle('tag-manage-save-face',   this._handleSaveFace);
        ipcMain.handle('tag-manage-clear-face',  this._handleClearFace);
        ipcMain.handle('tag-manage-pick-image',  this._handlePickImage);
        ipcMain.handle('tag-manage-save-event',  this._handleSaveEvent);

        this._handleCountPhotos = (_event, { tagId }) => ({
            count: this.db.countPhotosByTag(tagId)
        });
        ipcMain.handle('tag-manage-count-photos', this._handleCountPhotos);

        // 返回已标记该人物 tag 的照片路径列表（用于人脸识别样本预填充）
        this._handleGetTaggedPhotos = (_event, { tagId }) => {
            return this.db.getPhotosByTag(tagId, 20).map(p => p.fullPath);
        };
        ipcMain.handle('tag-manage-get-tagged-photos', this._handleGetTaggedPhotos);

        // 保存事件关联的地标标签
        this._handleSaveEventLocation = async (_event, { tagId, locationTagId }) => {
            try {
                this.db.updateEventLocationTag(tagId, locationTagId);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        // 打开 TagSelectWindow 选择地标标签（锁定在 location tab）
        this._handleSelectLandmark = async () => {
            return new Promise((resolve) => {
                let resolved = false;
                const selectWin = new TagSelectWindow(this.db);
                selectWin.show(this.window, (tags) => {
                    // tags 是数组，取第一个元素作为选中的地标
                    const tagInfo = Array.isArray(tags) ? tags[0] : tags;
                    if (!resolved) { resolved = true; resolve({ success: true, tag: tagInfo }); }
                }, { lockedCategory: 'location', singleSelect: true });

                // 如果用户关闭窗口未选择，返回 cancelled
                selectWin.window.on('closed', () => {
                    if (!resolved) { resolved = true; resolve({ success: false, cancelled: true }); }
                });
            });
        };

        this._handleSaveLocation = async (_event, { tagId, lat, lng, radius }) => {
            try {
                // 校验1：子标签圆心必须在父标签圆范围内
                const parentLoc = this.db.getParentLocationData(tagId);
                if (parentLoc && parentLoc.lat != null && parentLoc.radius != null) {
                    const dist = haversineDistance(parentLoc.lat, parentLoc.lng, lat, lng);
                    if (dist > parentLoc.radius) {
                        return {
                            success: false,
                            error: `圆心必须在父地标「${parentLoc.name}」的范围内（当前距父中心 ${Math.round(dist)} m，父半径 ${Math.round(parentLoc.radius)} m）`
                        };
                    }
                }

                // 校验2：新圆必须包含所有子孙标签的圆心
                const descendants = this.db.getLocationTagDescendants(tagId);
                for (const desc of descendants) {
                    if (desc.id === tagId) continue; // 跳过自身
                    if (desc.lat == null || desc.lng == null) continue; // 无位置则不校验
                    const dist = haversineDistance(lat, lng, desc.lat, desc.lng);
                    if (dist > radius) {
                        return {
                            success: false,
                            error: `圆形范围未能包含子孙地标「${desc.name}」的圆心（至少需要半径 ${Math.round(dist)} m）`
                        };
                    }
                }

                // 校验3：圆心不能落入同层任何兄弟地标的圆内
                const siblings = this.db.getSiblingLocationTags(tagId);
                for (const sib of siblings) {
                    const dist = haversineDistance(sib.lat, sib.lng, lat, lng);
                    if (dist <= sib.radius) {
                        return {
                            success: false,
                            error: `圆心落入了同级地标「${sib.name}」的范围内（距其中心 ${Math.round(dist)} m，其半径 ${Math.round(sib.radius)} m）`
                        };
                    }
                }

                this.db.updateLocation(tagId, lat, lng, radius);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };
        ipcMain.handle('tag-manage-save-location', this._handleSaveLocation);
        ipcMain.handle('tag-manage-save-event-location', this._handleSaveEventLocation);
        ipcMain.handle('tag-manage-select-landmark',     this._handleSelectLandmark);

        // 自动匹配：将时间范围+地标范围内的照片打上事件标签及最小地标标签，
        // 并删除该地标的所有祖先地标标签（只保留最精确的一级）
        // 每 CHUNK 张照片 yield 一次事件循环，并推送进度给渲染进程
        this._handleAutoMatchEvent = async (_event, { tagId }) => {
            try {
                const tag = this.db.getTagById(tagId);
                if (!tag || !tag.start_time || !tag.end_time || !tag.location_tag_id) {
                    return { success: false, error: 'Missing dates or landmark' };
                }

                // 预加载地标及全部子孙，按深度从深到浅排序（最精确优先）
                const locationTags = this.db.getLocationTagDescendants(tag.location_tag_id)
                    .filter(lt => lt.lat != null && lt.lng != null && lt.radius != null)
                    .sort((a, b) => b._depth - a._depth);

                if (locationTags.length === 0) {
                    return { success: false, error: 'Landmark has no location data set' };
                }

                // id → tag 映射，用于沿 parent_id 链查找祖先
                const locTagMap = new Map(locationTags.map(lt => [lt.id, lt]));
                // 所有已加载的地标 id 集合（仅删除这些范围内的祖先，不误删其他地标）
                const locTagIds = new Set(locTagMap.keys());

                const photos = this.db.getPhotosByTimeRange(tag.start_time, tag.end_time);
                const total = photos.length;
                let matched = 0;
                const CHUNK = 20;

                for (let i = 0; i < photos.length; i += CHUNK) {
                    const end = Math.min(i + CHUNK, photos.length);
                    for (let j = i; j < end; j++) {
                        const photo = photos[j];
                        let bestLoc = null;
                        for (const lt of locationTags) {
                            const dist = haversineDistance(lt.lat, lt.lng, photo.lat, photo.lng);
                            if (dist <= lt.radius) { bestLoc = lt; break; }
                        }
                        if (bestLoc) {
                            this.db.linkTagToPhoto(photo.id, tagId);
                            this.db.linkTagToPhoto(photo.id, bestLoc.id);
                            // 沿 parent_id 链删除祖先地标标签（只精确保留 bestLoc）
                            let parentId = bestLoc.parent_id;
                            while (parentId != null && locTagIds.has(parentId)) {
                                this.db.unlinkTagFromPhoto(photo.id, parentId);
                                parentId = locTagMap.get(parentId)?.parent_id ?? null;
                            }
                            matched++;
                        }
                    }
                    // 推送本批进度，并 yield 事件循环让渲染进程能处理消息
                    if (!_event.sender.isDestroyed()) {
                        _event.sender.send('tag-manage-auto-match-progress', { current: end, total, matched });
                    }
                    await new Promise(resolve => setImmediate(resolve));
                }

                return { success: true, matched, total };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };
        ipcMain.handle('tag-manage-auto-match-event', this._handleAutoMatchEvent);
    }

    _removeHandlers() {
        ipcMain.removeListener('close-tag-manage-window',  this._handleClose);
        ipcMain.removeListener('locate-landmark-on-map',   this._handleLocateOnMap);
        ipcMain.removeHandler('tag-manage-get-tags');
        ipcMain.removeHandler('tag-manage-add-tag');
        ipcMain.removeHandler('tag-manage-update-tag');
        ipcMain.removeHandler('tag-manage-delete-tag');
        ipcMain.removeHandler('tag-manage-move-tag');
        ipcMain.removeHandler('tag-manage-save-face');
        ipcMain.removeHandler('tag-manage-clear-face');
        ipcMain.removeHandler('tag-manage-pick-image');
        ipcMain.removeHandler('tag-manage-save-event');
        ipcMain.removeHandler('tag-manage-count-photos');
        ipcMain.removeHandler('tag-manage-get-tagged-photos');
        ipcMain.removeHandler('tag-manage-save-event-location');
        ipcMain.removeHandler('tag-manage-select-landmark');
        ipcMain.removeHandler('tag-manage-save-location');
        ipcMain.removeHandler('tag-manage-auto-match-event');
    }
}

module.exports = TagManageWindow;
