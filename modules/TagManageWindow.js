/**
 * TagManageWindow.js - 标签管理窗口
 * 提供 Faces / Events / Locations / Common 四类标签的树状管理界面
 */

const { BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { FaceTag, EventTag, LandmarkTag, CommonTag } = require('./Tag');
const TagSelectWindow = require('./TagSelectWindow');
const i18n = require('./i18n');

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

        ipcMain.once('tag-manage-window-ready', this._handleReady);
        ipcMain.on  ('close-tag-manage-window', this._handleClose);
        ipcMain.handle('tag-manage-get-tags',    this._handleGetTags);
        ipcMain.handle('tag-manage-add-tag',     this._handleAddTag);
        ipcMain.handle('tag-manage-update-tag',  this._handleUpdateTag);
        ipcMain.handle('tag-manage-delete-tag',  this._handleDeleteTag);
        ipcMain.handle('tag-manage-move-tag',    this._handleMoveTag);
        ipcMain.handle('tag-manage-save-face',   this._handleSaveFace);
        ipcMain.handle('tag-manage-clear-face',  this._handleClearFace);
        ipcMain.handle('tag-manage-pick-image',  this._handlePickImage);
        ipcMain.handle('tag-manage-save-event',  this._handleSaveEvent);

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
                selectWin.show(this.window, (tagInfo) => {
                    if (!resolved) { resolved = true; resolve({ success: true, tag: tagInfo }); }
                }, { lockedCategory: 'location' });

                // 如果用户关闭窗口未选择，返回 cancelled
                selectWin.window.on('closed', () => {
                    if (!resolved) { resolved = true; resolve({ success: false, cancelled: true }); }
                });
            });
        };

        this._handleSaveLocation = async (_event, { tagId, lat, lng, radius }) => {
            try {
                this.db.updateLocation(tagId, lat, lng, radius);
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };
        ipcMain.handle('tag-manage-save-location', this._handleSaveLocation);
        ipcMain.handle('tag-manage-save-event-location', this._handleSaveEventLocation);
        ipcMain.handle('tag-manage-select-landmark',     this._handleSelectLandmark);
    }

    _removeHandlers() {
        ipcMain.removeListener('close-tag-manage-window', this._handleClose);
        ipcMain.removeHandler('tag-manage-get-tags');
        ipcMain.removeHandler('tag-manage-add-tag');
        ipcMain.removeHandler('tag-manage-update-tag');
        ipcMain.removeHandler('tag-manage-delete-tag');
        ipcMain.removeHandler('tag-manage-move-tag');
        ipcMain.removeHandler('tag-manage-save-face');
        ipcMain.removeHandler('tag-manage-clear-face');
        ipcMain.removeHandler('tag-manage-pick-image');
        ipcMain.removeHandler('tag-manage-save-event');
        ipcMain.removeHandler('tag-manage-save-event-location');
        ipcMain.removeHandler('tag-manage-select-landmark');
        ipcMain.removeHandler('tag-manage-save-location');
    }
}

module.exports = TagManageWindow;
