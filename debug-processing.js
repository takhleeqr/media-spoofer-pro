// Debug script to test processing functionality
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Simple test window for debugging
function createDebugWindow() {
    const debugWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    debugWindow.loadFile('debug-test.html');
    debugWindow.webContents.openDevTools();
}

// Test IPC handlers
ipcMain.handle('test-processing', async () => {
    console.log('Test processing called');
    return { success: true, message: 'Processing test successful' };
});

ipcMain.handle('test-file-write', async (event, data) => {
    try {
        fs.writeFileSync('debug-test.txt', data);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

app.whenReady().then(() => {
    createDebugWindow();
});

app.on('window-all-closed', () => {
    app.quit();
}); 