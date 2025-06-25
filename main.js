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
           nodeIntegration: true,
           contextIsolation: false,
           enableRemoteModule: true
       },
       icon: path.join(__dirname, 'logo.png'), // NEW
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
   // mainWindow.webContents.openDevTools();

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

// Handle opening output folder
ipcMain.handle('open-output-folder', async (event, folderPath) => {
   const { shell } = require('electron');
   try {
       await shell.openPath(folderPath);
   } catch (error) {
       console.error('Error opening folder:', error);
   }
});