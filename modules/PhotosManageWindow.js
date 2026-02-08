/**
 * PhotosManageWindow.js - 照片管理窗口类
 * 负责创建和管理照片列表的窗口，支持Direct、Selected、Tag三种模式
 */

const { BrowserWindow } = require('electron');
const path = require('path');

class PhotosManageWindow {
    constructor(parentWindow) {
        this.parentWindow = parentWindow;
        this.manageWindow = null;
    }

    /**
     * 显示照片管理窗口
     * @param {Object} options - 选项
     * @param {string} options.tab - 初始选中的tab: 'direct', 'selected', 'tag'
     * @param {Array} options.photos - 照片数据数组
     */
    show(options = {}) {
        if (this.manageWindow) {
            // 如果窗口已存在，聚焦并更新数据
            this.manageWindow.focus();
            this.manageWindow.webContents.send('update-photos', options);
            return;
        }

        // 获取父窗口尺寸和位置
        const parentBounds = this.parentWindow.getBounds();
        const windowWidth = parentBounds.width - 224;
        const windowHeight = parentBounds.height - 224;
        const windowX = parentBounds.x + 112;
        const windowY = parentBounds.y + 112;

        // 创建子窗口
        this.manageWindow = new BrowserWindow({
            width: windowWidth,
            height: windowHeight,
            x: windowX,
            y: windowY,
            parent: this.parentWindow,
            modal: true,
            frame: false,
            resizable: false,
            minWidth: 800,
            minHeight: 600,
            show: false,
            backgroundColor: '#2a2a2a',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        // 加载HTML内容
        this.manageWindow.loadFile(path.join(__dirname, '..', 'photos-manage-window.html'));

        // 窗口准备好后显示
        this.manageWindow.once('ready-to-show', () => {
            this.manageWindow.show();
            // 发送初始数据到渲染进程
            this.manageWindow.webContents.send('init-photos', options);
        });

        // 监听父窗口移动（保持相对位置）
        this.parentMoveListener = () => {
            if (this.manageWindow && !this.manageWindow.isDestroyed()) {
                const newBounds = this.parentWindow.getBounds();
                const newWidth = newBounds.width - 224;
                const newHeight = newBounds.height - 224;
                const newX = newBounds.x + 112;
                const newY = newBounds.y + 112;
                
                this.manageWindow.setBounds({
                    x: newX,
                    y: newY,
                    width: newWidth,
                    height: newHeight
                });
            }
        };

        this.parentWindow.on('resize', this.parentMoveListener);
        this.parentWindow.on('move', this.parentMoveListener);

        // 窗口关闭时清理
        this.manageWindow.on('closed', () => {
            this.parentWindow.removeListener('resize', this.parentMoveListener);
            this.parentWindow.removeListener('move', this.parentMoveListener);
            
            // 通知主窗口清除矩形选框
            if (this.parentWindow && !this.parentWindow.isDestroyed()) {
                this.parentWindow.webContents.send('clear-map-rectangle');
            }
            
            this.manageWindow = null;
        });
    }

    /**
     * 关闭窗口
     */
    close() {
        if (this.manageWindow && !this.manageWindow.isDestroyed()) {
            this.manageWindow.close();
        }
    }

    /**
     * 检查窗口是否打开
     */
    isOpen() {
        return this.manageWindow && !this.manageWindow.isDestroyed();
    }

    /**
     * 更新照片数据
     */
    updatePhotos(options) {
        if (this.manageWindow && !this.manageWindow.isDestroyed()) {
            this.manageWindow.webContents.send('update-photos', options);
        }
    }
}

module.exports = PhotosManageWindow;
