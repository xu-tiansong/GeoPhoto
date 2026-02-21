const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    send:   (channel, data)    => ipcRenderer.send(channel, data),
    on:     (channel, func)    => ipcRenderer.on(channel, (_e, ...args) => func(...args)),
    invoke: (channel, data)    => ipcRenderer.invoke(channel, data)
});
