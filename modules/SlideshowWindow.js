const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let slideshowWin = null;

function openSlideshowWindow(photoList) {
    if (slideshowWin && !slideshowWin.isDestroyed()) {
        slideshowWin.close();
    }

    slideshowWin = new BrowserWindow({
        fullscreen: true,
        frame: false,
        autoHideMenuBar: true,
        backgroundColor: '#000000',
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    slideshowWin.setMenuBarVisibility(false);
    slideshowWin.loadFile(path.join(__dirname, '..', 'slideshow-window.html'));

    slideshowWin.once('ready-to-show', () => {
        if (slideshowWin && !slideshowWin.isDestroyed()) {
            slideshowWin.show();
            slideshowWin.webContents.send('load-slideshow', photoList);
        }
    });

    slideshowWin.on('closed', () => {
        slideshowWin = null;
    });
}

function registerIPC() {
    ipcMain.handle('open-slideshow-window', (_event, photoList) => {
        openSlideshowWindow(photoList);
        return true;
    });

    ipcMain.on('slideshow-close', () => {
        if (slideshowWin && !slideshowWin.isDestroyed()) {
            slideshowWin.close();
        }
    });
}

module.exports = { registerIPC };
