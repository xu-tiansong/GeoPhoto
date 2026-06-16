/**
 * DupConfirmWindow.js - 重复照片逐组确认窗口
 *
 * 当用户选择"逐组确认"模式时，为每组重复照片弹出一个强制前台的审核窗口。
 * 窗口保持打开直至扫描结束，只刷新内容，避免频繁销毁/重建。
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const i18n = require('./i18n');

class DupConfirmWindow {
    /**
     * @param {Electron.BrowserWindow} parentWindow - 主窗口（用于定位）
     * @param {import('./Database')} db - 数据库实例（用于持久化窗口尺寸）
     */
    constructor(parentWindow, db = null) {
        this.parentWindow   = parentWindow;
        this.db             = db;
        this.win            = null;
        this.isReady        = false;   // renderer 已就绪
        this.pendingResolve = null;    // 当前等待用户响应的 Promise resolve
        this.pendingData    = null;    // 等待 renderer 就绪后发送的数据

        // 监听 renderer 就绪信号
        this._onRendererReady = (_event) => {
            this.isReady = true;
            if (this.pendingData) {
                this._sendData(this.pendingData);
                this.pendingData = null;
            }
        };
        ipcMain.on('dup-confirm-renderer-ready', this._onRendererReady);

        // 监听 renderer 的确认/跳过/中断响应
        this._onResponse = (_event, result) => {
            if (this.pendingResolve) {
                const resolve = this.pendingResolve;
                this.pendingResolve = null;
                resolve(result);
            }
        };
        ipcMain.on('dup-confirm-response', this._onResponse);
    }

    /**
     * 展示（或刷新）确认窗口，并等待用户做出选择。
     *
     * @param {object[]} photoData  - [{ photo, fullPath, size, width, height }, ...]，
     *                                  index 0 = 建议保留（最大文件）
     * @param {object}   stats      - { groupIndex, totalGroups, removedSoFar }
     * @returns {Promise<{ action: 'skip'|'interrupt'|'confirm', keepIndices?: number[] }>}
     */
    show(photoData, stats) {
        return new Promise((resolve) => {
            this.pendingResolve = resolve;

            const data = {
                photoData,
                stats,
                lang: i18n.getLanguage()
            };

            if (!this.win || this.win.isDestroyed()) {
                // 首次或窗口已销毁：重新创建
                this.isReady = false;
                this.pendingData = data;
                this._createWindow();
            } else if (!this.isReady) {
                // 窗口存在但尚未就绪（极少情况）
                this.pendingData = data;
            } else {
                // 窗口已就绪：直接刷新数据
                this._sendData(data);
                this.win.show();
                this.win.focus();
                this.win.setAlwaysOnTop(true, 'screen-saver');
            }
        });
    }

    // ── 内部方法 ─────────────────────────────────────────────

    _createWindow() {
        // 读取持久化的窗口尺寸，回退到默认值 800×600
        let w = 800, h = 600;
        if (this.db) {
            const sw = parseInt(this.db.getSetting('dup_confirm_win_width'),  10);
            const sh = parseInt(this.db.getSetting('dup_confirm_win_height'), 10);
            if (!isNaN(sw) && sw >= 480) w = sw;
            if (!isNaN(sh) && sh >= 360) h = sh;
        }

        this.win = new BrowserWindow({
            width:     w,
            height:    h,
            minWidth:  480,
            minHeight: 360,
            frame:     false,
            alwaysOnTop: true,
            webPreferences: {
                nodeIntegration:  true,
                contextIsolation: false,
            },
            show:      false,
            resizable: true,
        });

        this.win.loadFile(path.join(__dirname, '..', 'dup-confirm-window.html'));

        // 用户调整大小时持久化尺寸
        this.win.on('resized', () => {
            if (!this.db || !this.win || this.win.isDestroyed()) return;
            const [width, height] = this.win.getSize();
            this.db.saveSetting('dup_confirm_win_width',  width);
            this.db.saveSetting('dup_confirm_win_height', height);
        });

        this.win.on('closed', () => {
            this.win     = null;
            this.isReady = false;
            // 若窗口被意外关闭（X 按钮），视为中断
            if (this.pendingResolve) {
                const resolve   = this.pendingResolve;
                this.pendingResolve = null;
                resolve({ action: 'interrupt' });
            }
        });
    }

    _sendData(data) {
        if (this.win && !this.win.isDestroyed()) {
            this.win.webContents.send('dup-confirm-data', data);
            this.win.show();
            this.win.focus();
            this.win.setAlwaysOnTop(true, 'screen-saver');
        }
    }

    /** 销毁窗口并清理 IPC 监听器 */
    destroy() {
        ipcMain.removeListener('dup-confirm-renderer-ready', this._onRendererReady);
        ipcMain.removeListener('dup-confirm-response',       this._onResponse);

        if (this.pendingResolve) {
            const resolve   = this.pendingResolve;
            this.pendingResolve = null;
            resolve({ action: 'interrupt' });
        }

        if (this.win && !this.win.isDestroyed()) {
            this.win.destroy();
        }
        this.win     = null;
        this.isReady = false;
    }
}

module.exports = DupConfirmWindow;
