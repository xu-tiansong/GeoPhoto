/**
 * MenuManager.js - 应用菜单管理类
 * 负责创建和管理应用程序的主菜单
 */

const { Menu } = require('electron');

class MenuManager {
    constructor(mainWindow, i18n, handlers = {}) {
        this.mainWindow = mainWindow;
        this.i18n = i18n;
        this.handlers = handlers;
        this.isFullScreen = false;
    }

    t(key) {
        return this.i18n ? this.i18n.t(key) : key;
    }

    /**
     * 切换语言并重建菜单
     */
    setLanguage(lang) {
        if (this.i18n) this.i18n.setLanguage(lang);
        this.createMenu();
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
            label: this.t('menu.photos'),
            submenu: [
                {
                    label: this.t('menu.photos.setDirectory'),
                    accelerator: 'CmdOrCtrl+I',
                    click: () => this.handleMenuClick('setPhotoDirectory')
                },
                { type: 'separator' },
                {
                    label: this.t('menu.photos.photoManagement'),
                    click: () => this.handleMenuClick('photoManagement')
                },
                {
                    label: this.t('menu.photos.tagManagement'),
                    click: () => this.handleMenuClick('tagManagement')
                },
                { type: 'separator' },
                {
                    label: this.t('menu.photos.backup'),
                    click: () => this.handleMenuClick('backupPhotos')
                },
                {
                    label: this.t('menu.photos.slideshow'),
                    accelerator: 'F5',
                    click: () => this.handleMenuClick('slideshow')
                },
                {
                    label: this.t('menu.photos.burst'),
                    click: () => this.handleMenuClick('burstPhotoSelection')
                },
                {
                    label: this.t('menu.photos.recognition'),
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
            label: this.t('menu.timeline'),
            submenu: [
                {
                    label: this.t('menu.timeline.settings'),
                    click: () => this.handleMenuClick('timelineSettings')
                },
                {
                    label: this.t('menu.timeline.timeRange'),
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
            label: this.t('menu.map'),
            submenu: [
                {
                    label: this.t('menu.map.landmarks'),
                    click: () => this.handleMenuClick('landmarkManagement')
                },
                {
                    label: this.t('menu.map.layers'),
                    click: () => this.handleMenuClick('layerSettings')
                },
                {
                    label: this.t('menu.map.offline'),
                    click: () => this.handleMenuClick('offlineMap')
                },
                {
                    label: this.t('menu.map.routes'),
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
            label: this.t('menu.system'),
            submenu: [
                {
                    label: this.isFullScreen
                        ? this.t('menu.system.exitFullscreen')
                        : this.t('menu.system.fullscreen'),
                    accelerator: 'F11',
                    click: () => this.handleMenuClick('fullscreenMap')
                },
                {
                    label: this.t('menu.system.language'),
                    submenu: [
                        {
                            label: this.t('menu.system.english'),
                            type: 'radio',
                            checked: this.i18n ? this.i18n.getLanguage() === 'en' : true,
                            click: () => this.handleMenuClick('languageEnglish')
                        },
                        {
                            label: this.t('menu.system.chinese'),
                            type: 'radio',
                            checked: this.i18n ? this.i18n.getLanguage() === 'zh' : false,
                            click: () => this.handleMenuClick('languageChinese')
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: this.t('menu.system.devtools'),
                    accelerator: 'F12',
                    click: () => {
                        if (this.mainWindow) {
                            this.mainWindow.webContents.toggleDevTools();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: this.t('menu.system.about'),
                    click: () => this.handleMenuClick('about')
                },
                { type: 'separator' },
                {
                    label: this.t('menu.system.quit'),
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

        if (this.handlers[action]) {
            this.handlers[action]();
        } else {
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
