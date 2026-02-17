/**
 * MenuManager.js - 应用菜单管理类
 * 负责创建和管理应用程序的主菜单
 */

const { Menu } = require('electron');

class MenuManager {
    constructor(mainWindow, handlers = {}) {
        this.mainWindow = mainWindow;
        this.handlers = handlers;
        this.isFullScreen = false;
    }

    /**
     * 创建应用菜单
     */
    createMenu() {
        const template = [
            this.createPhotosMenu(),
            this.createTimelineMenu(),
            this.createMapMenu(),
            this.createSystemMenu()
        ];
        
        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
    }

    /**
     * 1. 照片菜单
     */
    createPhotosMenu() {
        return {
            label: 'Photos',
            submenu: [
                {
                    label: 'Set Photo Directory',
                    accelerator: 'CmdOrCtrl+I',
                    click: () => this.handleMenuClick('setPhotoDirectory')
                },
                { type: 'separator' },
                {
                    label: 'Photo Directory Management',
                    click: () => this.handleMenuClick('photoDirectoryManagement')
                },
                {
                    label: 'Tag Management',
                    click: () => this.handleMenuClick('tagManagement')
                },
                { type: 'separator' },
                {
                    label: 'Backup Photos',
                    click: () => this.handleMenuClick('backupPhotos')
                },
                {
                    label: 'Slideshow',
                    accelerator: 'F5',
                    click: () => this.handleMenuClick('slideshow')
                },
                {
                    label: 'Burst Photo Selection',
                    click: () => this.handleMenuClick('burstPhotoSelection')
                },
                {
                    label: 'Photo Recognition',
                    click: () => this.handleMenuClick('photoRecognition')
                }
            ]
        };
    }

    /**
     * 2. 时间轴菜单
     */
    createTimelineMenu() {
        return {
            label: 'Timeline',
            submenu: [
                {
                    label: 'Timeline Settings',
                    click: () => this.handleMenuClick('timelineSettings')
                },
                {
                    label: 'Time Range Settings',
                    click: () => this.handleMenuClick('timeRangeSettings')
                }
            ]
        };
    }

    /**
     * 3. 地图菜单
     */
    createMapMenu() {
        return {
            label: 'Map',
            submenu: [
                {
                    label: 'Landmark Management',
                    click: () => this.handleMenuClick('landmarkManagement')
                },
                {
                    label: 'Layer Settings',
                    click: () => this.handleMenuClick('layerSettings')
                },
                {
                    label: 'Offline Map',
                    click: () => this.handleMenuClick('offlineMap')
                },
                {
                    label: 'Travel Routes',
                    click: () => this.handleMenuClick('travelRoutes')
                }
            ]
        };
    }

    /**
     * 4. 系统菜单
     */
    createSystemMenu() {
        return {
            label: 'System',
            submenu: [
                {
                    label: this.isFullScreen ? 'Exit Fullscreen' : 'Fullscreen Map',
                    accelerator: 'F11',
                    click: () => this.handleMenuClick('fullscreenMap')
                },
                {
                    label: 'Language Settings',
                    submenu: [
                        {
                            label: 'English',
                            type: 'radio',
                            checked: true,
                            click: () => this.handleMenuClick('languageEnglish')
                        },
                        {
                            label: '简体中文',
                            type: 'radio',
                            click: () => this.handleMenuClick('languageChinese')
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Developer Tools',
                    accelerator: 'F12',
                    click: () => {
                        if (this.mainWindow) {
                            this.mainWindow.webContents.toggleDevTools();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'About',
                    click: () => this.handleMenuClick('about')
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    accelerator: 'CmdOrCtrl+Q',
                    role: 'quit'
                }
            ]
        };
    }

    /**
     * 处理菜单点击事件
     */
    handleMenuClick(action) {
        console.log('菜单点击:', action);
        
        // 检查是否有对应的处理器
        if (this.handlers[action]) {
            this.handlers[action]();
        } else {
            // 默认处理：发送到渲染进程
            if (this.mainWindow && this.mainWindow.webContents) {
                this.mainWindow.webContents.send('menu-action', action);
            }
        }
    }

    /**
     * 注册菜单处理器
     */
    registerHandler(action, handler) {
        this.handlers[action] = handler;
    }

    /**
     * 批量注册菜单处理器
     */
    registerHandlers(handlers) {
        Object.assign(this.handlers, handlers);
    }

    /**
     * 设置全屏状态
     */
    setFullScreenState(isFullScreen) {
        this.isFullScreen = isFullScreen;
        this.updateMenu();
    }

    /**
     * 更新菜单（重新创建）
     */
    updateMenu() {
        this.createMenu();
    }
}

module.exports = MenuManager;
