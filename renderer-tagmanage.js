const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    send:   (channel, data)    => ipcRenderer.send(channel, data),
    on:     (channel, func)    => {
        const wrapped = (_e, ...args) => func(...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    },
    invoke: (channel, data)    => ipcRenderer.invoke(channel, data)
});
