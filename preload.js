const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // File selection
    selectFiles: (filters) => ipcRenderer.invoke('select-files', filters),
    
    // Output folder selection
    selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
    
    // Open output folder
    openOutputFolder: (folderPath) => ipcRenderer.invoke('open-output-folder', folderPath),
    
    // File system operations
    readFile: (path) => ipcRenderer.invoke('read-file', path),
    writeFile: (path, data) => ipcRenderer.invoke('write-file', path, data),
    exists: (path) => ipcRenderer.invoke('file-exists', path),
    mkdir: (path) => ipcRenderer.invoke('mkdir', path),
    copyFile: (src, dest) => ipcRenderer.invoke('copy-file', src, dest),
    unlink: (path) => ipcRenderer.invoke('unlink', path),
    
    // Process management
    spawnProcess: (command, args) => ipcRenderer.invoke('spawn-process', command, args),
    killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
    
    // Platform info
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    getAppPath: () => ipcRenderer.invoke('get-app-path')
}); 