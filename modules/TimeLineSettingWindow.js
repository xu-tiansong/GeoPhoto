const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

class TimeLineSettingWindow {
    constructor(parentWindow, timelineState) {
        this.parentWindow = parentWindow;
        this.timelineState = timelineState;
        this.window = new BrowserWindow({
            width: 600,
            height: 300,
            modal: true,
            parent: this.parentWindow,
            webPreferences: {
                preload: path.join(__dirname, '../renderer-timelinesetting.js'),
                contextIsolation: true,
                nodeIntegration: false
            },
            frame: false,
            center: true,
            resizable: false,
            backgroundColor: '#1a1a1a'
        });

        this.window.loadFile('timeline-setting-window.html');
        // this.window.webContents.openDevTools();

        // 绑定事件处理器
        this.handleReady = () => {
            if (this.window && !this.window.isDestroyed()) {
                console.log('Sending timeline state to window:', this.timelineState);
                this.window.webContents.send('init-data', this.timelineState);
            }
        };

        this.handleSubmit = (event, data) => {
            if (!this.window || this.window.isDestroyed()) return;
            // Add validation logic here
            if (data.start && data.end) {
                // For month mode (YYYY-MM), same month is valid (single-month selection)
                const isMonthMode = data.mode === 'month';
                const startD = new Date(data.start + (data.start.length === 7 ? '-01T00:00:00' : (data.start.length === 10 ? 'T00:00:00' : '')));
                const endD = new Date(data.end + (data.end.length === 7 ? '-01T00:00:00' : (data.end.length === 10 ? 'T00:00:00' : '')));
                if (isMonthMode ? startD > endD : startD >= endD) {
                    this.window.webContents.send('validation-error', 'Start date must be before end date.');
                    return;
                }
            }
            this.parentWindow.webContents.send('update-timeline', data);
            this.window.close();
        };

        this.handleClose = () => {
            if (this.window && !this.window.isDestroyed()) {
                this.window.close();
            }
        };

        // 注册监听器
        ipcMain.once('timeline-setting-window-ready', this.handleReady);
        ipcMain.on('timeline-setting-form-submit', this.handleSubmit);
        ipcMain.on('close-timeline-setting-window', this.handleClose);

        this.window.on('closed', () => {
            // 移除监听器
            ipcMain.removeListener('timeline-setting-form-submit', this.handleSubmit);
            ipcMain.removeListener('close-timeline-setting-window', this.handleClose);
            this.window = null;
        });
    }
}

module.exports = TimeLineSettingWindow;
