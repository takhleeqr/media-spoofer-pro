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

   // Open DevTools in development
   mainWindow.webContents.openDevTools();

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
   const result = await dialog.showOpenDialog(mainWindow, {
       properties: ['openFile', 'multiSelections'],
       filters: filters || [
           { name: 'Media Files', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'mp4', 'mov', 'avi', 'webm'] },
           { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp'] },
           { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'webm'] },
           { name: 'All Files', extensions: ['*'] }
       ]
   });
   
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
           const fullPath = path.join(currentPath, item);
           const stat = fs.statSync(fullPath);
           if (stat.isDirectory()) {
               readDirRecursive(fullPath);
           } else {
               files.push(fullPath);
           }
       }
   }
   
   try {
       readDirRecursive(dirPath);
       return files;
   } catch (error) {
       throw new Error(`Failed to read directory: ${error.message}`);
   }
});

// Handle opening output folder
ipcMain.handle('open-output-folder', async (event, folderPath) => {
   const { shell } = require('electron');
   try {
       await shell.openPath(folderPath);
   } catch (error) {
       console.error('Error opening folder:', error);
   }
});

// File system operations
ipcMain.handle('read-file', async (event, filePath) => {
   try {
       return fs.readFileSync(filePath, 'utf8');
   } catch (error) {
       throw new Error(`Failed to read file: ${error.message}`);
   }
});

ipcMain.handle('write-file', async (event, filePath, data) => {
   try {
       fs.writeFileSync(filePath, data);
       return true;
   } catch (error) {
       throw new Error(`Failed to write file: ${error.message}`);
   }
});

ipcMain.handle('file-exists', async (event, filePath) => {
   return fs.existsSync(filePath);
});

ipcMain.handle('mkdir', async (event, dirPath) => {
   try {
       fs.mkdirSync(dirPath, { recursive: true });
       return true;
   } catch (error) {
       throw new Error(`Failed to create directory: ${error.message}`);
   }
});

ipcMain.handle('copy-file', async (event, src, dest) => {
   try {
       fs.copyFileSync(src, dest);
       return true;
   } catch (error) {
       throw new Error(`Failed to copy file: ${error.message}`);
   }
});

ipcMain.handle('unlink', async (event, filePath) => {
   try {
       fs.unlinkSync(filePath);
       return true;
   } catch (error) {
       throw new Error(`Failed to delete file: ${error.message}`);
   }
});

// Process management
ipcMain.handle('spawn-process', async (event, command, args) => {
   const { spawn } = require('child_process');
   return new Promise((resolve, reject) => {
       const process = spawn(command, args);
       let stdout = '';
       let stderr = '';
       
       process.stdout.on('data', (data) => {
           stdout += data.toString();
       });
       
       process.stderr.on('data', (data) => {
           stderr += data.toString();
       });
       
       process.on('close', (code) => {
           if (code === 0) {
               resolve({ stdout, stderr, code });
           } else {
               reject(new Error(`Process exited with code ${code}: ${stderr}`));
           }
       });
       
       process.on('error', (error) => {
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