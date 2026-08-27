const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // File selection
    selectFiles: (filters) => ipcRenderer.invoke('select-files', filters),

    // Output folder selection
    selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),
    readDirRecursive: (dirPath) => ipcRenderer.invoke('read-dir-recursive', dirPath),

    // Open output folder
    openOutputFolder: (folderPath) => ipcRenderer.invoke('open-output-folder', folderPath),

    // File system operations
    readFile: (path) => ipcRenderer.invoke('read-file', path),
    writeFile: (path, data) => ipcRenderer.invoke('write-file', path, data),
    exists: (path) => ipcRenderer.invoke('file-exists', path),
    getFileStats: (path) => ipcRenderer.invoke('get-file-stats', path),
    mkdir: (path) => ipcRenderer.invoke('mkdir', path),
    copyFile: (src, dest) => ipcRenderer.invoke('copy-file', src, dest),
    unlink: (path) => ipcRenderer.invoke('unlink', path),
    readdir: (dirPath) => ipcRenderer.invoke('readdir', dirPath),
    rmdir: (dirPath) => ipcRenderer.invoke('rmdir', dirPath),
    cleanupTempDirs: (outputDir) => ipcRenderer.invoke('cleanup-temp-dirs', outputDir),

    // Process management
    spawnProcess: (command, args) => ipcRenderer.invoke('spawn-process', command, args),
    killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
    killActiveProcesses: () => ipcRenderer.invoke('kill-active-processes'),
    getFreeSpace: (p) => ipcRenderer.invoke('get-free-space', p),

    // Platform info
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    getAppPath: () => ipcRenderer.invoke('get-app-path'),
    getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
    getTempDir: () => ipcRenderer.invoke('get-temp-dir'),

    // Native Image Conversion
    convertHeic: (inputPath, outputPath) => ipcRenderer.invoke('convert-heic', inputPath, outputPath),

    // ── Frame Extractor ──────────────────────────────────────────────────────
    getVideoInfo: (videoPath, ffprobePath) => ipcRenderer.invoke('get-video-info', videoPath, ffprobePath),
    extractFrames: (options) => ipcRenderer.invoke('extract-frames', options),
    deleteFilePermanent: (filePath) => ipcRenderer.invoke('delete-file-permanent', filePath),
    // Real-time per-frame progress pushed from main process
    onFrameExtractProgress: (callback) => ipcRenderer.on('frame-extract-progress', (_event, data) => callback(data)),
    removeFrameExtractProgress: () => ipcRenderer.removeAllListeners('frame-extract-progress'),

    // Debug: write JS errors to crash.log in the app folder
    writeCrashLog: (msg) => ipcRenderer.invoke('write-crash-log', msg),
});