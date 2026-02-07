/**
 * PhotoWindow.js - 照片查看窗口类
 * 负责创建和管理照片详情的模态窗口
 */

const { BrowserWindow } = require('electron');
const path = require('path');

class PhotoWindow {
    constructor(parentWindow) {
        this.parentWindow = parentWindow;
        this.photoWindow = null;
        this.currentPhoto = null;
    }

    /**
     * 显示照片窗口
     */
    show(photoData) {
        if (this.photoWindow) {
            this.photoWindow.close();
        }

        this.currentPhoto = photoData;

        // 获取父窗口尺寸和位置
        const parentBounds = this.parentWindow.getBounds();
        const windowWidth = parentBounds.width - 112;
        const windowHeight = parentBounds.height - 112;
        const windowX = parentBounds.x + 56;
        const windowY = parentBounds.y + 56;

        // 创建模态窗口
        this.photoWindow = new BrowserWindow({
            width: windowWidth,
            height: windowHeight,
            x: windowX,
            y: windowY,
            parent: this.parentWindow,
            modal: true,
            frame: false,
            resizable: false,
            show: false,
            backgroundColor: '#1a1a1a',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        // 加载HTML内容
        this.photoWindow.loadFile(path.join(__dirname, '..', 'photo-window.html'));

        // 窗口准备好后显示
        this.photoWindow.once('ready-to-show', () => {
            this.photoWindow.show();
            // 发送照片数据到渲染进程
            this.photoWindow.webContents.send('load-photo', photoData);
        });

        // 监听父窗口大小变化
        this.parentResizeListener = () => {
            if (this.photoWindow && !this.photoWindow.isDestroyed()) {
                const newBounds = this.parentWindow.getBounds();
                const newWidth = newBounds.width - 112;
                const newHeight = newBounds.height - 112;
                const newX = newBounds.x + 56;
                const newY = newBounds.y + 56;
                
                this.photoWindow.setBounds({
                    x: newX,
                    y: newY,
                    width: newWidth,
                    height: newHeight
                });
            }
        };

        this.parentWindow.on('resize', this.parentResizeListener);
        this.parentWindow.on('move', this.parentResizeListener);

        // 窗口关闭时清理
        this.photoWindow.on('closed', () => {
            this.parentWindow.removeListener('resize', this.parentResizeListener);
            this.parentWindow.removeListener('move', this.parentResizeListener);
            this.photoWindow = null;
            this.currentPhoto = null;
        });
    }

    /**
     * 关闭窗口
     */
    close() {
        if (this.photoWindow && !this.photoWindow.isDestroyed()) {
            this.photoWindow.close();
        }
    }

    /**
     * 检查窗口是否打开
     */
    isOpen() {
        return this.photoWindow && !this.photoWindow.isDestroyed();
    }
}

module.exports = PhotoWindow;
