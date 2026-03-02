const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const i18n = require('./i18n');

class TagSelectWindow {
    constructor(dbManager) {
        this.db = dbManager;
        this.window = null;
        this._onSelectCallback = null;
    }

    /**
     * @param {BrowserWindow} parentWindow
     * @param {function}      onSelect
     * @param {object}        [options]
     * @param {string}        [options.lockedCategory] - 锁定到某个分类 tab（其他 tab 禁用）
     */
    show(parentWindow, onSelect, options = {}) {
        if (this.window && !this.window.isDestroyed()) {
            this.window.focus();
            return;
        }

        this._onSelectCallback = onSelect;
        this._options = options;

        this.window = new BrowserWindow({
            width: 400,
            height: 500,
            modal: true,
            parent: parentWindow,
            webPreferences: {
                preload: path.join(__dirname, '../renderer-tagselect.js'),
                contextIsolation: true,
                nodeIntegration: false
            },
            frame: false,
            center: true,
            resizable: false,
            backgroundColor: '#1a1a1a'
        });

        this.window.loadFile(path.join(__dirname, '..', 'tag-select-window.html'));
        this._registerHandlers();

        this.window.on('closed', () => {
            this._removeHandlers();
            this.window = null;
            this._onSelectCallback = null;
            // 显式把焦点还给调用方窗口，避免在多个模态子窗口并存时
            // Windows 把焦点错误地交给兄弟窗口（如 photosManageWindow）
            if (parentWindow && !parentWindow.isDestroyed()) {
                parentWindow.focus();
            }
        });
    }

    _registerHandlers() {
        this._handleReady = () => {
            if (this.window && !this.window.isDestroyed()) {
                this.window.webContents.send('tag-select-init', {
                    lang: i18n.getLanguage(),
                    lockedCategory: this._options.lockedCategory || null,
                    singleSelect:   this._options.singleSelect   || false
                });
            }
        };

        this._handleClose = () => {
            if (this.window && !this.window.isDestroyed()) this.window.close();
        };

        this._handleGetTags = (_event, category) => {
            try {
                const tags = this.db.getTagsByCategory(category);
                return { success: true, tags };
            } catch (e) {
                return { success: false, error: e.message };
            }
        };

        this._handleConfirm = (_event, { tags }) => {
            if (this._onSelectCallback) {
                this._onSelectCallback(tags);
            }
            if (this.window && !this.window.isDestroyed()) this.window.close();
        };

        ipcMain.once('tag-select-window-ready', this._handleReady);
        ipcMain.on('close-tag-select-window', this._handleClose);
        ipcMain.on('tag-select-confirm', this._handleConfirm);
        ipcMain.handle('tag-select-get-tags', this._handleGetTags);
    }

    _removeHandlers() {
        ipcMain.removeListener('close-tag-select-window', this._handleClose);
        ipcMain.removeListener('tag-select-confirm', this._handleConfirm);
        ipcMain.removeHandler('tag-select-get-tags');
    }
}

module.exports = TagSelectWindow;
