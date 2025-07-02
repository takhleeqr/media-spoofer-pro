const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Keep a global reference of the window object
let mainWindow;

function createWindow() {
   // Create the browser window
   mainWindow = new BrowserWindow({
       width: 1200,
       height: 800,
       webPreferences: {
           nodeIntegration: false,
           contextIsolation: true,
           enableRemoteModule: false,
           preload: path.join(__dirname, 'preload.js')
       },
       icon: path.join(__dirname, 'logo.png'),
       title: 'Media Spoofer Pro',
       show: false // Don't show until ready
   });

   // Load the index.html file
   mainWindow.loadFile('index.html');

   // Show window when ready to prevent visual flash
   mainWindow.once('ready-to-show', () => {
       mainWindow.show();
   });

   // Open DevTools only in development
   if (process.env.NODE_ENV === 'development') {
       mainWindow.webContents.openDevTools();
   }

   // Handle window closed
   mainWindow.on('closed', () => {
       mainWindow = null;
   });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
   createWindow();

   app.on('activate', () => {
       // On macOS, re-create window when dock icon is clicked
       if (BrowserWindow.getAllWindows().length === 0) {
           createWindow();
       }
   });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
   // On macOS, keep app running even when all windows are closed
   if (process.platform !== 'darwin') {
       app.quit();
   }
});

// Handle file selection dialog
ipcMain.handle('select-files', async (event, filters) => {
   console.log('select-files called with filters:', filters);
   
   const result = await dialog.showOpenDialog(mainWindow, {
       properties: ['openFile', 'multiSelections'],
       filters: filters || [
           { name: 'Media Files', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'mp4', 'mov', 'avi', 'webm'] },
           { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp'] },
           { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'webm'] },
           { name: 'All Files', extensions: ['*'] }
       ]
   });
   
   console.log('Dialog result:', result);
   console.log('File paths returned:', result.filePaths);
   console.log('File paths type:', typeof result.filePaths);
   console.log('File paths is array:', Array.isArray(result.filePaths));
   
   return result.filePaths;
});

// Handle output folder selection
ipcMain.handle('select-output-folder', async () => {
   const result = await dialog.showOpenDialog(mainWindow, {
       properties: ['openDirectory'],
       title: 'Select Output Folder'
   });
   
   return result.filePaths[0];
});

// Handle folder selection (for bulk folder import)
ipcMain.handle('select-folder', async () => {
   const result = await dialog.showOpenDialog(mainWindow, {
       properties: ['openDirectory'],
       title: 'Select Folder'
   });
   
   return result.filePaths[0];
});

// Handle recursive directory reading
ipcMain.handle('read-dir-recursive', async (event, dirPath) => {
   const files = [];
   
   function readDirRecursive(currentPath) {
       const items = fs.readdirSync(currentPath);
       for (const item of items) {
           // Use cross-platform path joining
           const fullPath = currentPath + '/' + item;
           const stat = fs.statSync(fullPath);
           if (stat.isDirectory()) {
               readDirRecursive(fullPath);
           } else {
               files.push(fullPath);
           }
       }
   }
   
   try {
       // Ensure cross-platform path handling
       const normalizedPath = dirPath.replace(/\\/g, '/');
       readDirRecursive(normalizedPath);
       return files;
   } catch (error) {
       console.error('read-dir-recursive error:', error);
       throw new Error(`Failed to read directory: ${error.message}`);
   }
});

// Handle opening output folder
ipcMain.handle('open-output-folder', async (event, folderPath) => {
   const { shell } = require('electron');
   try {
       // Ensure cross-platform path handling
       const normalizedPath = folderPath.replace(/\\/g, '/');
       await shell.openPath(normalizedPath);
   } catch (error) {
       console.error('Error opening folder:', error);
   }
});

// File system operations
ipcMain.handle('read-file', async (event, filePath) => {
   try {
       // Ensure cross-platform path handling
       const normalizedPath = filePath.replace(/\\/g, '/');
       return fs.readFileSync(normalizedPath, 'utf8');
   } catch (error) {
       console.error('read-file error:', error);
       throw new Error(`Failed to read file: ${error.message}`);
   }
});

ipcMain.handle('write-file', async (event, filePath, data) => {
   try {
       // Ensure cross-platform path handling
       const normalizedPath = filePath.replace(/\\/g, '/');
       fs.writeFileSync(normalizedPath, data);
       return true;
   } catch (error) {
       console.error('write-file error:', error);
       throw new Error(`Failed to write file: ${error.message}`);
   }
});

ipcMain.handle('file-exists', async (event, filePath) => {
   try {
       // Ensure cross-platform path handling
       const normalizedPath = filePath.replace(/\\/g, '/');
       return fs.existsSync(normalizedPath);
   } catch (error) {
       console.error('file-exists error:', error);
       return false;
   }
});

ipcMain.handle('get-file-stats', async (event, filePath) => {
   try {
       // Ensure cross-platform path handling
       const normalizedPath = filePath.replace(/\\/g, '/');
       const stats = fs.statSync(normalizedPath);
       return {
           size: stats.size,
           isFile: stats.isFile(),
           isDirectory: stats.isDirectory(),
           mtime: stats.mtime
       };
   } catch (error) {
       console.error('get-file-stats error:', error);
       throw new Error(`Failed to get file stats: ${error.message}`);
   }
});

ipcMain.handle('mkdir', async (event, dirPath) => {
   try {
       // Ensure cross-platform path handling
       const normalizedPath = dirPath.replace(/\\/g, '/');
       fs.mkdirSync(normalizedPath, { recursive: true });
       return true;
   } catch (error) {
       console.error('mkdir error:', error);
       throw new Error(`Failed to create directory: ${error.message}`);
   }
});

ipcMain.handle('copy-file', async (event, src, dest) => {
   try {
       // Ensure cross-platform path handling
       const normalizedSrc = src.replace(/\\/g, '/');
       const normalizedDest = dest.replace(/\\/g, '/');
       fs.copyFileSync(normalizedSrc, normalizedDest);
       return true;
   } catch (error) {
       console.error('copy-file error:', error);
       throw new Error(`Failed to copy file: ${error.message}`);
   }
});

ipcMain.handle('unlink', async (event, filePath) => {
   try {
       // Ensure cross-platform path handling
       const normalizedPath = filePath.replace(/\\/g, '/');
       fs.unlinkSync(normalizedPath);
       return true;
   } catch (error) {
       console.error('unlink error:', error);
       throw new Error(`Failed to delete file: ${error.message}`);
   }
});

// Process management
ipcMain.handle('spawn-process', async (event, command, args) => {
   const { spawn } = require('child_process');
   return new Promise((resolve, reject) => {
       // Ensure command is executable on macOS
       const options = {
           stdio: ['pipe', 'pipe', 'pipe']
       };
       
       // On macOS, we might need to handle shell execution differently
       if (process.platform === 'darwin') {
           // For macOS, ensure the command path is properly resolved
           console.log('Spawning process on macOS:', command, args);
       }
       
       const process = spawn(command, args, options);
       let stdout = '';
       let stderr = '';
       
       process.stdout.on('data', (data) => {
           stdout += data.toString();
       });
       
       process.stderr.on('data', (data) => {
           stderr += data.toString();
       });
       
       process.on('close', (code) => {
           console.log('Process closed with code:', code);
           if (code === 0) {
               resolve({ stdout, stderr, code });
           } else {
               reject(new Error(`Process exited with code ${code}: ${stderr}`));
           }
       });
       
       process.on('error', (error) => {
           console.error('Process error:', error);
           reject(error);
       });
   });
});

ipcMain.handle('kill-process', async (event, pid) => {
   try {
       process.kill(pid);
       return true;
   } catch (error) {
       throw new Error(`Failed to kill process: ${error.message}`);
   }
});

// Platform info
ipcMain.handle('get-platform', async () => {
   return process.platform;
});

ipcMain.handle('get-app-path', async () => {
   return app.getAppPath();
});

ipcMain.handle('get-home-dir', async () => {
   return require('os').homedir();
});