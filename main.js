const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Crash logger: captures crashes to Desktop where it's always writable ──
const os = require('os');
const CRASH_LOG = path.join(os.homedir(), 'Desktop', 'spoofer-crash.log');
app.disableHardwareAcceleration();
function writeCrash(type, err) {
    const msg = `[${new Date().toISOString()}] ${type}\n${err?.stack || err}\n\n`;
    console.error('\n=== CRASH ===\n' + msg + '=============\n');
    try { fs.appendFileSync(CRASH_LOG, msg); } catch(e) { console.error('log write failed:', e.message); }
}
process.on('uncaughtException',  err => { writeCrash('uncaughtException',  err); });
process.on('unhandledRejection', err => { writeCrash('unhandledRejection', err); });
app.on('child-process-gone', (_event, details) => {
    if (details.type !== 'GPU') return;
    const msg = `[${new Date().toISOString()}] GPU PROCESS GONE\nReason: ${details.reason}\nExitCode: ${details.exitCode}\nName: ${details.name}\nServiceName: ${details.serviceName}\n\n`;
    try { fs.appendFileSync(path.join(__dirname, 'crash.log'), msg); } catch(e) {}
    console.error('GPU PROCESS GONE:', details);
});

// Keep a global reference of the window object
let mainWindow;

// ── Child-process registry ────────────────────────────────────────────────
// Track every ffmpeg/ffprobe child we spawn so the Stop button can terminate
// them mid-run and so we never orphan processes when the app quits.
const activeChildren = new Set();
function trackChild(cp) {
    if (!cp) return;
    activeChildren.add(cp);
    const done = () => activeChildren.delete(cp);
    cp.on('close', done);
    cp.on('exit', done);
    cp.on('error', done);
}
function killActiveChildren() {
    for (const cp of activeChildren) {
        try { cp.kill('SIGKILL'); } catch (e) { /* already gone */ }
    }
    activeChildren.clear();
}

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
        title: 'Morph',
        show: false // Don't show until ready
    });

    // Load the index.html file
    mainWindow.loadFile('index.html');

    // Show window when ready to prevent visual flash
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Open DevTools for debugging

    // ── Renderer crash detection ───────────────────────────────
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        const msg = `[${new Date().toISOString()}] RENDERER CRASHED\nReason: ${details.reason}\nExitCode: ${details.exitCode}\n\n`;
        try { fs.appendFileSync(path.join(__dirname, 'crash.log'), msg); } catch(e) {}
        console.error('RENDERER CRASHED:', details);
    });

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
    // Never leave ffmpeg running after the UI is gone
    killActiveChildren();
    // On macOS, keep app running even when all windows are closed
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Belt-and-suspenders: also kill children on any quit path
app.on('before-quit', () => { killActiveChildren(); });

// Renderer JS error logger
ipcMain.handle('write-crash-log', (event, msg) => {
    try { fs.appendFileSync(path.join(__dirname, 'crash.log'), `[${new Date().toISOString()}] RENDERER JS ERROR\n${msg}\n\n`); } catch(e) {}
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

// Handle non-recursive directory reading (only top-level files)
ipcMain.handle('read-dir', async (event, dirPath) => {
    const files = [];

    try {
        // Ensure cross-platform path handling
        const normalizedPath = dirPath.replace(/\\/g, '/');
        const items = fs.readdirSync(normalizedPath);

        for (const item of items) {
            // Use cross-platform path joining
            const fullPath = normalizedPath + '/' + item;
            const stat = fs.statSync(fullPath);

            // Only include files, not directories
            if (stat.isFile()) {
                files.push(fullPath);
            }
        }

        return files;
    } catch (error) {
        console.error('read-dir error:', error);
        throw new Error(`Failed to read directory: ${error.message}`);
    }
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

// Handle directory listing (non-recursive)
ipcMain.handle('readdir', async (event, dirPath) => {
    try {
        // Ensure cross-platform path handling
        const normalizedPath = dirPath.replace(/\\/g, '/');
        const items = fs.readdirSync(normalizedPath);
        return items;
    } catch (error) {
        console.error('readdir error:', error);
        throw new Error(`Failed to read directory: ${error.message}`);
    }
});

// Handle directory removal
ipcMain.handle('rmdir', async (event, dirPath) => {
    try {
        // Ensure cross-platform path handling
        const normalizedPath = dirPath.replace(/\\/g, '/');

        // Use fs.rmSync with recursive option for better cleanup
        // This will remove the directory and all its contents
        fs.rmSync(normalizedPath, { recursive: true, force: true });
        return true;
    } catch (error) {
        console.error('rmdir error:', error);
        throw new Error(`Failed to remove directory: ${error.message}`);
    }
});

// Handle cleanup of temporary conversion directories
ipcMain.handle('cleanup-temp-dirs', async (event, outputDir) => {
    try {
        // Ensure cross-platform path handling
        const normalizedPath = outputDir.replace(/\\/g, '/');

        if (fs.existsSync(normalizedPath)) {
            const items = fs.readdirSync(normalizedPath);

            for (const item of items) {
                if (item === 'temp_converted') {
                    const tempDirPath = normalizedPath + '/' + item;

                    try {
                        // Remove the entire temp_converted directory and its contents
                        fs.rmSync(tempDirPath, { recursive: true, force: true });
                        console.log('Cleaned up temp directory:', tempDirPath);
                    } catch (tempError) {
                        console.warn('Failed to cleanup temp directory:', tempError);
                    }
                }
            }
        }

        return true;
    } catch (error) {
        console.error('cleanup-temp-dirs error:', error);
        throw new Error(`Failed to cleanup temporary directories: ${error.message}`);
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

        const childProcess = spawn(command, args, options);
        trackChild(childProcess);
        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        childProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        childProcess.on('close', (code) => {
            console.log('Process closed with code:', code);
            if (code === 0) {
                resolve({ stdout, stderr, code });
            } else {
                reject(new Error(`Process exited with code ${code}: ${stderr}`));
            }
        });

        childProcess.on('error', (error) => {
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

// Terminate every ffmpeg/ffprobe child we spawned (used by the Stop button).
ipcMain.handle('kill-active-processes', async () => {
    killActiveChildren();
    return true;
});

// Free disk space (bytes) on the volume holding the given path — for preflight.
ipcMain.handle('get-free-space', async (event, targetPath) => {
    try {
        if (typeof fs.statfsSync === 'function') {
            const s = fs.statfsSync(targetPath.replace(/\\/g, '/'));
            return { free: s.bavail * s.bsize, ok: true };
        }
    } catch (e) {
        console.warn('get-free-space failed:', e.message);
    }
    return { free: null, ok: false };
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

ipcMain.handle('get-temp-dir', async () => {
    return require('os').tmpdir();
});

// Handle native HEIC conversion (bypassing sips/ffmpeg)
ipcMain.handle('convert-heic', async (event, inputPath, outputPath) => {
    try {
        // Use Electron's native image handling (uses OS APIs: NSImage on macOS, WIC on Windows)
        // This is much more robust than CLI tools for "rendering" the image as a user sees it.
        const image = nativeImage.createFromPath(inputPath);

        if (image.isEmpty()) {
            throw new Error('Failed to load image (empty)');
        }

        // Convert to high-quality JPEG
        const buffer = image.toJPEG(95);

        // Write to disk
        await fs.promises.writeFile(outputPath, buffer);

        return { success: true };
    } catch (error) {
        console.error('Native conversion failed:', error);
        return { success: false, error: error.message };
    }
});

// ============================================================
// FRAME EXTRACTOR IPC HANDLERS
// ============================================================

// Get video metadata: duration, fps, width, height
ipcMain.handle('get-video-info', async (event, videoPath, ffprobePath) => {
    const { spawn } = require('child_process');
    return new Promise((resolve, reject) => {
        const args = [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'format=duration:stream=width,height,r_frame_rate,nb_frames',
            '-of', 'json',
            videoPath
        ];
        const proc = spawn(ffprobePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        trackChild(proc);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
            try {
                const data = JSON.parse(stdout);
                const stream = data.streams && data.streams[0] ? data.streams[0] : {};
                const format = data.format || {};
                const duration = parseFloat(format.duration || 0);
                const width = parseInt(stream.width || 0);
                const height = parseInt(stream.height || 0);
                // r_frame_rate is a fraction like "30000/1001"
                let fps = 30;
                if (stream.r_frame_rate) {
                    const parts = stream.r_frame_rate.split('/');
                    fps = parts.length === 2 ? parseFloat(parts[0]) / parseFloat(parts[1]) : parseFloat(parts[0]);
                }
                resolve({ duration, width, height, fps, path: videoPath });
            } catch (e) {
                resolve({ duration: 0, width: 0, height: 0, fps: 30, path: videoPath, error: e.message });
            }
        });
        proc.on('error', err => reject(err));
    });
});

// Extract frames from a video with real-time progress via IPC events
ipcMain.handle('extract-frames', async (event, options) => {
    const { spawn } = require('child_process');
    const { ffmpegPath, videoPath, outputDir, method, frameCount, interval, quality, format, skipStart, skipEnd, sceneThreshold, resolution, duration } = options;

    // Ensure output directory exists
    fs.mkdirSync(outputDir, { recursive: true });

    // Build ffmpeg filter based on method
    let vfParts = [];

    // SAR normalization (fixes stretched frames from anamorphic / HandBrake videos).
    // Scaling width by the sample aspect ratio and stamping setsar=1 converts the
    // stored non-square pixels to square pixels, so extracted frames aren't squished.
    // `sar` is the input sample aspect ratio; for square-pixel video this is a no-op.
    vfParts.push('scale=trunc(iw*sar/2)*2:trunc(ih/2)*2', 'setsar=1');

    // Resolution scaling — cap the LONG edge so portrait frames aren't upscaled
    // (a portrait 1080x1920 must not become 1920x3413). force_original_aspect_ratio
    // =decrease against a square box limits whichever dimension is larger (P4).
    if (resolution && resolution !== 'original') {
        const longEdge = { '1080p': 1920, '720p': 1280, '480p': 854 };
        const edge = longEdge[resolution];
        if (edge) vfParts.push(`scale=${edge}:${edge}:force_original_aspect_ratio=decrease`);
    }

    let args = ['-y'];

    // Skip start
    if (skipStart && skipStart > 0) {
        args.push('-ss', String(skipStart));
    }

    args.push('-i', videoPath);

    // Duration limit (skip end)
    const effectiveDuration = duration - (skipStart || 0) - (skipEnd || 0);
    if (skipEnd && skipEnd > 0 && effectiveDuration > 0) {
        args.push('-t', String(Math.max(1, effectiveDuration)));
    }

    // Method-based filter
    if (method === 'scene') {
        const thresh = sceneThreshold || 0.3;
        vfParts.push(`select=gt(scene\\,${thresh})`);
        args.push('-vsync', 'vfr');
    } else if (method === 'keyframes') {
        vfParts.push(`select=eq(pict_type\\,I)`);
        args.push('-vsync', 'vfr');
    } else if (method === 'interval') {
        const sec = interval || 5;
        vfParts.push(`fps=1/${sec}`);
    } else {
        // evenly spaced: calculate fps from frameCount + duration
        const eff = Math.max(1, effectiveDuration || duration || 60);
        const calcInterval = Math.max(0.5, eff / Math.max(1, frameCount || 20));
        vfParts.push(`fps=1/${calcInterval.toFixed(3)}`);
    }

    if (vfParts.length > 0) {
        args.push('-vf', vfParts.join(','));
    }

    // Output quality
    const fmt = format || 'jpg';
    const q = quality || 90;
    if (fmt === 'jpg' || fmt === 'jpeg') {
        // ffmpeg q:v for JPEG: 2=best, 31=worst. Map 60-100% -> q 14-2
        const qv = Math.round(2 + ((100 - q) / 100) * 12);
        args.push('-q:v', String(qv));
    } else if (fmt === 'webp') {
        args.push('-quality', String(q));
    }

    args.push(path.join(outputDir, `frame_%05d.${fmt}`));

    return new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        trackChild(proc);
        let stderr = '';
        let framesDone = 0;

        proc.stderr.on('data', d => {
            const chunk = d.toString();
            stderr += chunk;
            // Parse ffmpeg progress: "frame=  123"
            const match = chunk.match(/frame=\s*(\d+)/);
            if (match) {
                framesDone = parseInt(match[1]);
                // Send progress event to renderer
                try {
                    event.sender.send('frame-extract-progress', { framesDone, videoPath });
                } catch(e) {}
            }
        });

        proc.on('close', code => {
            if (code === 0) {
                // List extracted files
                try {
                    const files = fs.readdirSync(outputDir)
                        .filter(f => f.startsWith('frame_') && (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png') || f.endsWith('.webp')))
                        .sort()
                        .map(f => path.join(outputDir, f));
                    resolve({ success: true, files, framesDone });
                } catch(e) {
                    resolve({ success: true, files: [], framesDone });
                }
            } else {
                reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-500)}`));
            }
        });

        proc.on('error', err => reject(err));
    });
});

// Permanent delete (move to trash not available in Electron without shell module workaround)
ipcMain.handle('delete-file-permanent', async (event, filePath) => {
    try {
        fs.unlinkSync(filePath.replace(/\\/g, '/'));
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});
