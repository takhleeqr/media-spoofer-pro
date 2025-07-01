// Use the secure electronAPI exposed through preload script
const { electronAPI } = window;

// Polyfill for path operations
const path = {
    join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
    parse: (filepath) => {
        const lastSlash = filepath.lastIndexOf('/');
        const lastDot = filepath.lastIndexOf('.');
        return {
            name: lastSlash >= 0 ? filepath.substring(lastSlash + 1, lastDot >= 0 ? lastDot : undefined) : filepath,
            ext: lastDot >= 0 ? filepath.substring(lastDot) : '',
            extension: lastDot >= 0 ? filepath.substring(lastDot + 1) : ''
        };
    }
};

// Helper function to spawn FFmpeg process securely
async function spawnFFmpeg(command) {
    try {
        const result = await electronAPI.spawnProcess(ffmpegPath, command);
        return result;
    } catch (error) {
        throw new Error(`FFmpeg process failed: ${error.message}`);
    }
}

// Application state
let currentMode = null; // 'image' or 'video'
let selectedFiles = [];
let isProcessing = false;
let isPaused = false;
let processedCount = 0;
let outputCount = 0;
let startTime = 0;
let currentBatch = 0;
let totalBatches = 0;
let timerInterval = null;
let currentProcess = null;
let outputDirectory = null;

// Cross-platform FFmpeg paths
let ffmpegPath, ffprobePath;

// Initialize FFmpeg paths when the app loads
async function initializeFFmpegPaths() {
    const platform = await electronAPI.getPlatform();
    const appPath = await electronAPI.getAppPath();
    
    if (platform === 'win32') {
        // Windows
        ffmpegPath = path.join(appPath, 'ffmpeg.exe');
        ffprobePath = path.join(appPath, 'ffprobe.exe');
    } else {
        // Mac and Linux
        ffmpegPath = path.join(appPath, 'ffmpeg');
        ffprobePath = path.join(appPath, 'ffprobe');
    }
}

// DOM elements
const modeSelection = document.getElementById('modeSelection');
const imageInterface = document.getElementById('imageInterface');
const videoInterface = document.getElementById('videoInterface');
const processSection = document.getElementById('processSection');

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
    await initializeFFmpegPaths();
    checkFFmpegInstallation();
    setupModeSelection();
});

// Check if FFmpeg is available
async function checkFFmpegInstallation() {
    const ffmpegExists = await electronAPI.exists(ffmpegPath);
    const ffprobeExists = await electronAPI.exists(ffprobePath);
    
    if (!ffmpegExists || !ffprobeExists) {
        console.warn('FFmpeg not found. Please ensure ffmpeg and ffprobe are in the app folder.');
    }
}

// Mode selection functions
function selectMode(mode) {
    currentMode = mode;
    modeSelection.style.display = 'none';
    
    if (mode === 'image') {
        imageInterface.classList.add('active');
        setupImageInterface();
    } else if (mode === 'video') {
        videoInterface.classList.add('active');
        setupVideoInterface();
    }
    
    processSection.style.display = 'block';
    resetProcessing();
}

function goBack() {
    // Hide current interface
    imageInterface.classList.remove('active');
    videoInterface.classList.remove('active');
    processSection.style.display = 'none';
    
    // Show mode selection
    modeSelection.style.display = 'flex';
    
    // Reset state
    currentMode = null;
    selectedFiles = [];
    outputDirectory = null;
    resetProcessing();
}

function setupModeSelection() {
    // Mode selection is handled by onclick in HTML
    // Just ensure we start with the right display
    modeSelection.style.display = 'flex';
    imageInterface.classList.remove('active');
    videoInterface.classList.remove('active');
    processSection.style.display = 'none';
}

// Image interface setup
function setupImageInterface() {
    const imageDropZone = document.getElementById('imageDropZone');
    const selectImageBtn = document.getElementById('selectImageBtn');
    const selectImageFolderBtn = document.getElementById('selectImageFolderBtn');
    const clearImageBtn = document.getElementById('clearImageBtn');
    const imageFileList = document.getElementById('imageFileList');
    
    // Set default values
    document.getElementById('imageDuplicates').value = 1;
    document.getElementById('imageIntensity').value = 'heavy';

    // Event listeners
    selectImageBtn.addEventListener('click', () => selectFiles('image'));
    selectImageFolderBtn.addEventListener('click', () => selectFolder('image'));
    clearImageBtn.addEventListener('click', clearFiles);
    
    // Drag and drop
    imageDropZone.addEventListener('click', () => selectFiles('image'));
    imageDropZone.addEventListener('dragover', handleDragOver);
    imageDropZone.addEventListener('dragleave', handleDragLeave);
    imageDropZone.addEventListener('drop', (e) => handleDrop(e, 'image'));
    
    // Settings change handlers
    const imageProcessingMode = document.getElementById('imageProcessingMode');
    const imageIntensityGroup = document.getElementById('imageIntensityGroup');
    const imageDuplicatesGroup = document.getElementById('imageDuplicatesGroup');
    
    imageProcessingMode.addEventListener('change', () => {
        const mode = imageProcessingMode.value;
        
        // Hide intensity and duplicates settings for convert-only mode
        if (mode === 'convert-only') {
            imageIntensityGroup.style.display = 'none';
            imageDuplicatesGroup.style.display = 'none';
        } else {
            imageIntensityGroup.style.display = 'block';
            imageDuplicatesGroup.style.display = 'block';
        }
    });
    
    setupProcessingControls();
}

// Video interface setup
function setupVideoInterface() {
    const videoDropZone = document.getElementById('videoDropZone');
    const selectVideoBtn = document.getElementById('selectVideoBtn');
    const selectVideoFolderBtn = document.getElementById('selectVideoFolderBtn');
    const clearVideoBtn = document.getElementById('clearVideoBtn');
    const videoFileList = document.getElementById('videoFileList');

    // Set default values
    document.getElementById('videoProcessingMode').value = 'spoof-only';
    document.getElementById('videoDuplicates').value = 1;
    document.getElementById('videoIntensity').value = 'heavy';
    
    // Event listeners
    selectVideoBtn.addEventListener('click', () => selectFiles('video'));
    selectVideoFolderBtn.addEventListener('click', () => selectFolder('video'));
    clearVideoBtn.addEventListener('click', clearFiles);
    
    // Drag and drop
    videoDropZone.addEventListener('click', () => selectFiles('video'));
    videoDropZone.addEventListener('dragover', handleDragOver);
    videoDropZone.addEventListener('dragleave', handleDragLeave);
    videoDropZone.addEventListener('drop', (e) => handleDrop(e, 'video'));
    
    // Settings change handlers
    const videoProcessingMode = document.getElementById('videoProcessingMode');
    const videoIntensityGroup = document.getElementById('videoIntensityGroup');
    const clipLengthGroup = document.getElementById('clipLengthGroup');
    const videoDuplicatesGroup = document.getElementById('videoDuplicatesGroup');
    
        videoProcessingMode.addEventListener('change', () => {
        const mode = videoProcessingMode.value;
        
        if (mode === 'convert-only') {
            videoIntensityGroup.style.display = 'none';
            videoDuplicatesGroup.style.display = 'none';
            clipLengthGroup.style.display = 'none';
        } else if (mode === 'spoof-only') {
            // Hide clip length for effects-only mode
            videoIntensityGroup.style.display = 'block';
            videoDuplicatesGroup.style.display = 'block';
            clipLengthGroup.style.display = 'none';
        } else {
            // Show all settings for split modes
            videoIntensityGroup.style.display = 'block';
            videoDuplicatesGroup.style.display = 'block';
            clipLengthGroup.style.display = 'block';
        }
    });
    
    setupProcessingControls();
}

function setupProcessingControls() {
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');
    const openFolderBtn = document.getElementById('openFolderBtn');
    
    // Remove existing listeners to prevent duplicates
    if (startBtn) startBtn.replaceWith(startBtn.cloneNode(true));
    if (pauseBtn) pauseBtn.replaceWith(pauseBtn.cloneNode(true));
    if (stopBtn) stopBtn.replaceWith(stopBtn.cloneNode(true));
    if (openFolderBtn) openFolderBtn.replaceWith(openFolderBtn.cloneNode(true));
    
    // Get fresh references
    const newStartBtn = document.getElementById('startBtn');
    const newPauseBtn = document.getElementById('pauseBtn');
    const newStopBtn = document.getElementById('stopBtn');
    const newOpenFolderBtn = document.getElementById('openFolderBtn');
    
    // Add event listeners
    if (newStartBtn) newStartBtn.addEventListener('click', startProcessing);
    if (newPauseBtn) newPauseBtn.addEventListener('click', pauseProcessing);
    if (newStopBtn) newStopBtn.addEventListener('click', stopProcessing);
    if (newOpenFolderBtn) newOpenFolderBtn.addEventListener('click', openOutputFolder);
    
    // Setup output folder selection
    let selectOutputBtn = document.getElementById('selectOutputBtn');
    if (selectOutputBtn) {
        selectOutputBtn.addEventListener('click', selectOutputFolder);
    }
    
    // Prevent default drag behavior on document
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
}

// Output folder selection
async function selectOutputFolder() {
    try {
        const folderPath = await electronAPI.selectOutputFolder();
        if (folderPath) {
            outputDirectory = folderPath;
            addStatusMessage(`📂 Output folder set to: ${folderPath}`, 'info');
            showStatus();
        }
    } catch (error) {
        addStatusMessage('Error selecting output folder: ' + error.message, 'error');
    }
}

// File selection functions
async function selectFiles(mode) {
    try {
        // Set file filters based on mode
        const filters = mode === 'image' 
            ? [
                { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            : [
                { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'webm'] },
                { name: 'All Files', extensions: ['*'] }
              ];
        
        const filePaths = await electronAPI.selectFiles(filters);
        if (filePaths && filePaths.length > 0) {
            addFiles(filePaths, mode);
        }
    } catch (error) {
        addStatusMessage('Error selecting files: ' + error.message, 'error');
    }
}

function addFiles(filePaths, mode) {
    filePaths = Array.isArray(filePaths) ? filePaths : [filePaths];
    const newFiles = filePaths.filter(f => !selectedFiles.includes(f));
    selectedFiles = selectedFiles.concat(newFiles);
    updateFileList();
    updateStats();
    updateButtons();
}

function getFileType(extension) {
    const imageExts = ['.jpg', '.jpeg', '.png', '.heic', '.webp'];
    const videoExts = ['.mp4', '.mov', '.avi', '.webm'];
    
    if (imageExts.includes(extension)) return 'image';
    if (videoExts.includes(extension)) return 'video';
    return 'unknown';
}

function clearFiles() {
    selectedFiles = [];
    updateFileList();
    updateStats();
    updateButtons();
    hideStatus();
    hideOverallProgress();
}

// Drag and drop handlers
function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
}

function handleDrop(e, mode) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files);
    const filePaths = files.map(file => file.path);
    addFiles(filePaths, mode);
}

// UI update functions
function updateFileList() {
    const fileListId = currentMode === 'image' ? 'imageFileList' : 'videoFileList';
    const fileList = document.getElementById(fileListId);
    
    if (selectedFiles.length === 0) {
        fileList.innerHTML = `<div class="empty-state">No ${currentMode}s selected</div>`;
        return;
    }
    
    fileList.innerHTML = selectedFiles.map((file, index) => `
        <div class="file-item">
            <div class="file-info">
                <div class="file-icon ${file.type}">
                    ${file.type === 'image' ? '🖼️' : '🎬'}
                </div>
                <div class="file-details">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
            </div>
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" id="progress-${index}" style="width: ${file.progress || 0}%"></div>
                </div>
                <div class="progress-text" id="progress-text-${index}">${file.status || 'Ready'}</div>
            </div>
        </div>
    `).join('');
}

function updateStats() {
    document.getElementById('totalFiles').textContent = selectedFiles.length;
    document.getElementById('processedFiles').textContent = processedCount;
    document.getElementById('outputFiles').textContent = outputCount;
    
    const statsGrid = document.getElementById('statsGrid');
    if (selectedFiles.length > 0) {
        statsGrid.classList.add('show');
    } else {
        statsGrid.classList.remove('show');
        resetStats();
    }
}

function resetStats() {
    processedCount = 0;
    outputCount = 0;
    selectedFiles.forEach(file => {
        file.progress = 0;
        file.status = 'ready';
    });
    document.getElementById('processedFiles').textContent = 0;
    document.getElementById('outputFiles').textContent = 0;
    document.getElementById('timeElapsed').textContent = '0s';
}

function updateButtons() {
    const hasFiles = selectedFiles.length > 0;
    
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');
    const clearBtn = document.getElementById(currentMode === 'image' ? 'clearImageBtn' : 'clearVideoBtn');
    const selectBtn = document.getElementById(currentMode === 'image' ? 'selectImageBtn' : 'selectVideoBtn');
    
    if (startBtn) startBtn.disabled = !hasFiles || isProcessing;
    if (pauseBtn) pauseBtn.disabled = !isProcessing;
    if (stopBtn) stopBtn.disabled = !isProcessing;
    if (clearBtn) clearBtn.disabled = isProcessing;
    if (selectBtn) selectBtn.disabled = isProcessing;

    const selectOutputBtn = document.getElementById('selectOutputBtn');
    if (currentMode === 'video') {
        selectOutputBtn.style.display = 'none';
    } else {
        selectOutputBtn.style.display = 'inline-block';
    }
}

// Overall progress bar functions
function updateOverallProgress(percent, text) {
    const overallProgress = document.getElementById('overallProgress');
    const overallProgressFill = document.getElementById('overallProgressFill');
    const overallProgressText = document.getElementById('overallProgressText');
    
    if (overallProgress) overallProgress.classList.add('show');
    if (overallProgressFill) overallProgressFill.style.width = `${percent}%`;
    if (overallProgressText) overallProgressText.textContent = text;
}

function hideOverallProgress() {
    const overallProgress = document.getElementById('overallProgress');
    if (overallProgress) overallProgress.classList.remove('show');
}

// Processing functions with real progress tracking
async function startProcessing() {
    if (isProcessing) return;
    
    isProcessing = true;
    isPaused = false;
    processedCount = 0;
    outputCount = 0;
    currentBatch = 0;
    startTime = Date.now();
    
    // Reset file statuses
    selectedFiles.forEach(file => {
        file.progress = 0;
        file.status = 'waiting';
    });
    
    updateButtons();
    showStatus();
    updateFileList();
    
    // Get settings based on current mode
    const settings = getProcessingSettings();
    totalBatches = settings.duplicates;
    
    addStatusMessage('🚀 Starting media processing...', 'info');
    addStatusMessage(`📊 Processing ${selectedFiles.length} ${currentMode}s with ${settings.duplicates} duplicates`, 'info');
    addStatusMessage(`⚙️ Mode: ${settings.mode} | Intensity: ${settings.intensity || 'N/A'}`, 'info');
    
    // Start timer
    startTimer();
    updateOverallProgress(0, 'Starting...');
    
    try {
        // Create output directory
        const outputDir = outputDirectory || await createOutputDirectory();
        
        // Process files in batches
        for (let batch = 1; batch <= settings.duplicates; batch++) {
            if (!isProcessing) break;
            
            currentBatch = batch;
            addStatusMessage(`\n📁 Processing Batch ${batch} of ${settings.duplicates}...`, 'info');
            updateOverallProgress(((batch - 1) / settings.duplicates) * 100, `Processing Batch ${batch} of ${settings.duplicates}`);
            
            const batchDir = path.join(outputDir, `batch_${batch}`);
            if (!fs.existsSync(batchDir)) {
                fs.mkdirSync(batchDir, { recursive: true });
            }
            
            // Process each file in the batch - IMPROVED VERSION WITH BETTER PAUSE HANDLING
            for (let i = 0; i < selectedFiles.length; i++) {
                if (!isProcessing) break;
                
                const file = selectedFiles[i];
                
                // Handle pause - IMPROVED: Don't interrupt current processing
                while (isPaused && isProcessing) {
                    file.status = 'paused';
                    updateFileList();
                    await sleep(500);
                }
                
                if (!isProcessing) break;
                
                // Update file status for current batch
                file.status = `processing (batch ${batch})`;
                const fileProgressInBatch = (i / selectedFiles.length) * (1 / settings.duplicates) * 100;
                const batchProgress = ((batch - 1) / settings.duplicates) * 100;
                file.progress = batchProgress + fileProgressInBatch;
                
                updateFileList();
                
                // IMPROVED: Retry logic for failed files
                let retryCount = 0;
                const maxRetries = 2;
                let success = false;
                
                while (!success && retryCount <= maxRetries && isProcessing) {
                    try {
                        await processFileInBatch(file, batchDir, batch, i + 1, settings);
                        success = true;
                        addStatusMessage(`✅ Processed: ${file.name} (Batch ${batch})`, 'success');
                    } catch (error) {
                        retryCount++;
                        
                        if (error.message.includes('FFmpeg exited with code null')) {
                            // This was likely due to pause - don't retry, just log
                            addStatusMessage(`⏸️ Processing interrupted for ${file.name} (Batch ${batch}) - will retry if needed`, 'warning');
                            break; // Exit retry loop for pause interruptions
                        } else if (retryCount <= maxRetries) {
                            addStatusMessage(`⚠️ Retry ${retryCount}/${maxRetries} for ${file.name}: ${error.message}`, 'warning');
                            await sleep(1000); // Wait before retry
                        } else {
                            addStatusMessage(`❌ Failed after ${maxRetries} retries - ${file.name}: ${error.message}`, 'error');
                        }
                    }
                }
                
                // If file failed and we're not paused, mark it as failed
                if (!success && isProcessing) {
                    file.status = 'failed';
                    addStatusMessage(`❌ Skipping ${file.name} in batch ${batch} due to errors`, 'error');
                } else if (success) {
                    // Only increment output count on actual success
                    // (outputCount is already incremented in processFileInBatch)
                }
                
                updateFileList();
            }
            
            // Update progress after each batch
            selectedFiles.forEach(file => {
                if (file.status !== 'failed') {
                    if (batch === settings.duplicates) {
                        file.status = 'complete';
                        file.progress = 100;
                    } else {
                        file.status = `batch ${batch} complete`;
                        file.progress = (batch / settings.duplicates) * 100;
                    }
                }
            });
            
            // Update processed count only after completing all files in the batch
            if (batch === settings.duplicates) {
                processedCount = selectedFiles.filter(f => f.status !== 'failed').length;
            }
            
            updateFileList();
            updateStats();
            
            addStatusMessage(`✅ Batch ${batch} completed!`, 'success');
            updateOverallProgress((batch / settings.duplicates) * 100, `Batch ${batch} completed`);
        }
        
        if (isProcessing) {
            const failedFiles = selectedFiles.filter(f => f.status === 'failed');
            const successFiles = selectedFiles.filter(f => f.status !== 'failed');
            
            updateOverallProgress(100, 'All processing completed!');
            addStatusMessage('\n🎉 All processing completed!', 'success');
            
            if (successFiles.length > 0) {
                addStatusMessage(`✅ Successfully processed: ${successFiles.length} files`, 'success');
            }
            
            if (failedFiles.length > 0) {
                addStatusMessage(`⚠️ Failed to process: ${failedFiles.length} files`, 'warning');
                failedFiles.forEach(file => {
                    addStatusMessage(`   • ${file.name}`, 'warning');
                });
            }
            
            addStatusMessage(`📂 Output saved to: ${outputDir}`, 'info');
            
            const openFolderBtn = document.getElementById('openFolderBtn');
            if (openFolderBtn) {
                openFolderBtn.disabled = false;
                openFolderBtn.setAttribute('data-path', outputDir);
            }
        }
        
    } catch (error) {
        addStatusMessage(`❌ Processing error: ${error.message}`, 'error');
    } finally {
        stopTimer();
        isProcessing = false;
        isPaused = false;
        updateButtons();
    }
}

function pauseProcessing() {
    if (!isProcessing) return;
    
    isPaused = !isPaused;
    const pauseBtn = document.getElementById('pauseBtn');
    
    if (isPaused) {
        pauseBtn.innerHTML = '▶️ Resume';
        addStatusMessage('⏸️ Processing will pause after current file...', 'warning');
        stopTimer();
        
        // Don't kill process immediately - let current file finish
        // currentProcess will be handled by the processing loop
    } else {
        pauseBtn.innerHTML = '⏸️ Pause';
        addStatusMessage('▶️ Processing resumed...', 'info');
        startTimer();
    }
}

function stopProcessing() {
    if (!isProcessing) return;
    
    isProcessing = false;
    isPaused = false;
    
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) pauseBtn.innerHTML = '⏸️ Pause';
    
    // Kill current FFmpeg process
    if (currentProcess) {
        currentProcess.kill('SIGTERM');
        currentProcess = null;
    }
    
    addStatusMessage('⏹️ Processing stopped by user', 'warning');
    stopTimer();
    updateButtons();
    hideOverallProgress();
}

function resetProcessing() {
    isProcessing = false;
    isPaused = false;
    processedCount = 0;
    outputCount = 0;
    
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) pauseBtn.innerHTML = '⏸️ Pause';
    
    const openFolderBtn = document.getElementById('openFolderBtn');
    if (openFolderBtn) openFolderBtn.disabled = true;
    
    hideStatus();
    hideOverallProgress();
    resetStats();
    updateButtons();
}

// File processing logic with progress updates
async function processFile(file, outputDir, batch, index, settings) {
    const updateProgress = (percent) => {
        file.progress = percent;
        updateFileList();
    };
    
    updateProgress(10);
    
    try {
        switch (settings.mode) {
            case 'spoof-split':
                await processSpoofAndSplit(file, outputDir, settings, updateProgress);
                break;
            case 'spoof-only':
                await processSpoof(file, outputDir, settings, updateProgress);
                break;
            case 'split-only':
                if (file.type === 'video') {
                    await processSplitOnly(file, outputDir, settings, updateProgress);
                } else {
                    const outputPath = generateOutputPath(file, outputDir, settings, 1);
                    await electronAPI.copyFile(file.path, outputPath);
                    outputCount++;
                    updateProgress(100);
                }
                break;
            case 'convert-only':
                await processConvert(file, outputDir, settings, updateProgress);
                break;
        }
    } catch (error) {
        throw error;
    }
}

// Processing mode implementations
async function processSpoof(file, outputDir, settings, updateProgress) {
    const outputPath = generateOutputPath(file, outputDir, settings, 1);
    const effects = generateSpoofEffects(settings.intensity);
    
    updateProgress(30);
    
    if (file.type === 'image') {
        await processImageSpoof(file.path, outputPath, effects, settings, updateProgress);
    } else {
        await processVideoSpoof(file.path, outputPath, effects, settings, updateProgress);
    }
    
    outputCount++;
    updateProgress(100);
}

async function processSpoofAndSplit(file, outputDir, settings, updateProgress) {
    if (file.type === 'video') {
        // Check video duration first
        const duration = await getVideoDuration(file.path);
        
        if (duration > 10) {
            // Split video first, then spoof each clip
            await processVideoSplit(file, outputDir, settings, true, updateProgress);
        } else {
            // Just spoof the video
            await processSpoof(file, outputDir, settings, updateProgress);
        }
    } else {
        // For images, just spoof
        await processSpoof(file, outputDir, settings, updateProgress);
    }
}

async function processSplitOnly(file, outputDir, settings, updateProgress) {
    if (file.type === 'video') {
        await processVideoSplit(file, outputDir, settings, false, updateProgress);
    }
}

async function processConvert(file, outputDir, settings, updateProgress) {
    const outputPath = generateOutputPath(file, outputDir, settings, 1);
    
    updateProgress(30);
    
    if (file.type === 'image') {
        await convertImage(file.path, outputPath, settings);
    } else {
        await convertVideo(file.path, outputPath, settings);
    }
    
    outputCount++;
    updateProgress(100);
}

// FFmpeg helper functions
async function getVideoDuration(videoPath) {
    try {
        const command = [
            '-v', 'quiet',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            videoPath
        ];
        
        const result = await electronAPI.spawnProcess(ffprobePath, command);
        
        if (result.code === 0) {
            const duration = parseFloat(result.stdout.trim());
            return duration || 90;
        } else {
            return 90; // Default fallback
        }
    } catch (error) {
        return 90; // Default fallback
    }
}

function generateSpoofEffects(intensity) {
    if (!intensity) return null;
    
    const ranges = {
        light: { rotation: 1, brightness: 3, contrast: [98, 102], saturation: [99, 105], hue: 3 },
        medium: { rotation: 3, brightness: 6, contrast: [95, 105], saturation: [98, 108], hue: 6 },
        heavy: { rotation: 5, brightness: 10, contrast: [90, 110], saturation: [95, 115], hue: 10 }
    };
    
    const range = ranges[intensity] || ranges.medium;
    
    return {
        rotation: (Math.random() * range.rotation * 2) - range.rotation,
        brightness: (Math.random() * range.brightness * 2) - range.brightness,
        contrast: range.contrast[0] + (Math.random() * (range.contrast[1] - range.contrast[0])),
        saturation: range.saturation[0] + (Math.random() * (range.saturation[1] - range.saturation[0])),
        hue: (Math.random() * range.hue * 2) - range.hue,
        scale: 1.25 + (Math.random() * 0.1) // 1.25 to 1.35
    };
}

async function processImageSpoof(inputPath, outputPath, effects, settings, updateProgress) {
    if (!effects) {
        return convertImage(inputPath, outputPath, settings);
    }
    
    updateProgress(50);
    
    return new Promise((resolve, reject) => {
        const brightnessDecimal = effects.brightness / 100;
        const contrastDecimal = effects.contrast / 100;
        const saturationDecimal = effects.saturation / 100;
        
        const filterComplex = `scale=iw*${effects.scale}:ih*${effects.scale},rotate=${effects.rotation}*PI/180,crop=iw*0.85:ih*0.85,eq=brightness=${brightnessDecimal}:contrast=${contrastDecimal}:saturation=${saturationDecimal},hue=h=${effects.hue}`;
        
        const command = [
            '-y',
            '-i', inputPath,
            '-vf', filterComplex,
            '-map_metadata', '-1',
            outputPath
        ];
        
        // Use secure FFmpeg spawning
        spawnFFmpeg(command).then(result => {
            currentProcess = null;
            updateProgress(90);
            if (result.code === 0) {
                resolve();
            } else {
                reject(new Error(`Image processing failed`));
            }
        }).catch(error => {
            currentProcess = null;
            reject(new Error(`Image processing failed: ${error.message}`));
        });
    });
}

async function processVideoSpoof(inputPath, outputPath, effects, settings, updateProgress) {
    if (!effects) {
        return convertVideo(inputPath, outputPath, settings);
    }
    
    updateProgress(50);
    
    return new Promise((resolve, reject) => {
        const brightnessDecimal = effects.brightness / 100;
        const contrastDecimal = effects.contrast / 100;
        const saturationDecimal = effects.saturation / 100;
        
        const filterComplex = `scale=iw*${effects.scale}:ih*${effects.scale},rotate=${effects.rotation}*PI/180,crop=iw*0.85:ih*0.85,eq=brightness=${brightnessDecimal}:contrast=${contrastDecimal}:saturation=${saturationDecimal},hue=h=${effects.hue}`;
        
        const command = [
            '-y',
            '-i', inputPath,
            '-vf', filterComplex,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-map_metadata', '-1'
        ];
        
        if (settings.removeAudio) {
            command.push('-an');
        } else {
            command.push('-c:a', 'aac', '-b:a', '128k');
        }
        
        command.push(outputPath);
        
        // Use secure FFmpeg spawning
        spawnFFmpeg(command).then(result => {
            currentProcess = null;
            updateProgress(90);
            
            if (result.code === 0) {
                resolve();
            } else {
                // Only show user-friendly error, not technical details
                reject(new Error(`Video processing failed`));
            }
        }).catch(error => {
            currentProcess = null;
            reject(new Error(`Video processing failed: ${error.message}`));
        });
    });
}


async function processVideoSplit(file, outputDir, settings, applySpoof = false, updateProgress) {
   const duration = await getVideoDuration(file.path);
   
   if (duration <= 10) {
       // Video is short enough, just process normally
       if (applySpoof) {
           await processSpoof(file, outputDir, settings, updateProgress);
       } else {
           const outputPath = generateOutputPath(file, outputDir, settings, 1);
           await electronAPI.copyFile(file.path, outputPath);
           outputCount++;
           updateProgress(100);
       }
       return;
   }
   
   // Determine clip length based on settings
   const clipLengthSetting = settings.clipLength || '6-8';
   let getClipLength;
   
   switch (clipLengthSetting) {
       case '8':
           getClipLength = () => 8;
           break;
       case '10':
           getClipLength = () => 10;
           break;
       case '15':
           getClipLength = () => 15;
           break;
       default: // '6-8'
           getClipLength = () => 6 + Math.random() * 2;
   }
   
   // Split video into clips
   const clips = [];
   let startTime = 0;
   let clipNumber = 1;
   
   while (startTime < duration) {
       const clipLength = getClipLength();
       const endTime = Math.min(startTime + clipLength, duration);
       
       if (endTime - startTime < 3) break; // Skip very short clips
       
       clips.push({
           start: startTime,
           duration: endTime - startTime,
           number: clipNumber++
       });
       
       startTime = endTime;
   }
   
   // Process each clip
   for (let i = 0; i < clips.length; i++) {
       const clip = clips[i];
       const clipPath = generateOutputPath(file, outputDir, settings, clip.number);
       
       // Update progress based on clip progress
       const clipProgress = (i / clips.length) * 80 + 10; // 10-90%
       updateProgress(clipProgress);
       
       if (applySpoof) {
           const effects = generateSpoofEffects(settings.intensity);
           await processVideoClipWithEffects(file.path, clipPath, clip, effects, settings);
       } else {
           await extractVideoClip(file.path, clipPath, clip);
       }
       
       outputCount++;
   }
   
   updateProgress(100);
}

async function processVideoClipWithEffects(inputPath, outputPath, clip, effects, settings) {
    return new Promise((resolve, reject) => {
        let command;
        
        if (effects) {
            const brightnessDecimal = effects.brightness / 100;
            const contrastDecimal = effects.contrast / 100;
            const saturationDecimal = effects.saturation / 100;
            
            const filterComplex = `scale=iw*${effects.scale}:ih*${effects.scale},rotate=${effects.rotation}*PI/180,crop=iw*0.85:ih*0.85,eq=brightness=${brightnessDecimal}:contrast=${contrastDecimal}:saturation=${saturationDecimal},hue=h=${effects.hue}`;
            
            command = [
                '-y',
                '-ss', clip.start.toString(),
                '-i', inputPath,
                '-t', clip.duration.toString(),
                '-vf', filterComplex,
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-map_metadata', '-1'
            ];
        } else {
            command = [
                '-y',
                '-ss', clip.start.toString(),
                '-i', inputPath,
                '-t', clip.duration.toString(),
                '-c', 'copy',
                '-map_metadata', '-1'
            ];
        }
        
        if (settings.removeAudio) {
            command.push('-an');
        } else if (effects) {
            command.push('-c:a', 'aac', '-b:a', '128k');
        }
        
        command.push(outputPath);
        
        // Use secure FFmpeg spawning
        spawnFFmpeg(command).then(result => {
            currentProcess = null;
            if (result.code === 0) {
                resolve();
            } else {
                reject(new Error(`Video clip processing failed`));
            }
        }).catch(error => {
            currentProcess = null;
            reject(new Error(`Video clip processing failed: ${error.message}`));
        });
    });
}

async function extractVideoClip(inputPath, outputPath, clip) {
   return new Promise((resolve, reject) => {
       const command = [
           '-y',
           '-ss', clip.start.toString(),
           '-i', inputPath,
           '-t', clip.duration.toString(),
           '-c', 'copy',
           '-map_metadata', '-1',
           outputPath
       ];
       
       // Use secure FFmpeg spawning
       spawnFFmpeg(command).then(result => {
           currentProcess = null;
           if (result.code === 0) {
               resolve();
           } else {
               reject(new Error(`FFmpeg clip extraction failed with code ${result.code}`));
           }
       }).catch(error => {
           currentProcess = null;
           reject(error);
       });
   });
}

async function convertImage(inputPath, outputPath, settings) {
   return new Promise((resolve, reject) => {
       const command = [
           '-y',
           '-i', inputPath,
           '-map_metadata', '-1',
           outputPath
       ];
       
       // Use secure FFmpeg spawning
       spawnFFmpeg(command).then(result => {
           currentProcess = null;
           if (result.code === 0) {
               resolve();
           } else {
               reject(new Error(`Image conversion failed with code ${result.code}`));
           }
       }).catch(error => {
           currentProcess = null;
           reject(error);
       });
   });
}

async function convertVideo(inputPath, outputPath, settings) {
    return new Promise((resolve, reject) => {
        const command = [
            '-y',
            '-i', inputPath,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-movflags', '+faststart',
            '-map_metadata', '-1'
        ];
        
        if (settings.removeAudio) {
            command.push('-an');
        } else {
            command.push('-c:a', 'aac', '-b:a', '128k');
        }
        
        command.push(outputPath);
        
        // Use secure FFmpeg spawning
        spawnFFmpeg(command).then(result => {
            currentProcess = null;
            if (result.code === 0) {
                resolve();
            } else {
                reject(new Error(`Video conversion failed`));
            }
        }).catch(error => {
            currentProcess = null;
            reject(new Error(`Video conversion failed: ${error.message}`));
        });
    });
}

// Helper functions
function getProcessingSettings() {
   const settings = {
       mode: null,
       intensity: null,
       duplicates: 1,
       removeAudio: false,
       clipLength: '6-8'
   };
   
   if (currentMode === 'image') {
       settings.mode = document.getElementById('imageProcessingMode').value;
       settings.intensity = document.getElementById('imageIntensity').value;
       settings.duplicates = settings.mode === 'convert-only' ? 1 : parseInt(document.getElementById('imageDuplicates').value);
       settings.imageFormat = document.getElementById('imageFormat').value;
       settings.namingPattern = document.getElementById('imageNamingPattern').value;
   } else if (currentMode === 'video') {
       settings.mode = document.getElementById('videoProcessingMode').value;
       settings.intensity = document.getElementById('videoIntensity').value;
       settings.duplicates = settings.mode === 'convert-only' ? 1 : parseInt(document.getElementById('videoDuplicates').value);
       settings.videoFormat = document.getElementById('videoFormat').value;
       settings.removeAudio = document.getElementById('removeAudio').checked;
       settings.clipLength = document.getElementById('clipLength').value;
       settings.namingPattern = document.getElementById('videoNamingPattern').value;
   }
   
   return settings;
}

async function createOutputDirectory() {
    if (currentMode === 'video') {
        // Auto-create output folder in the same folder as the first selected file
        if (selectedFiles.length > 0) {
            const firstFile = selectedFiles[0];
            const parentDir = path.dirname(firstFile.path);
            const outDir = path.join(parentDir, 'MediaSpoofer_Output');
            await electronAPI.mkdir(outDir);
            outputDirectory = outDir;
            // Show info
            document.getElementById('outputFolderInfo').style.display = 'block';
            document.getElementById('outputFolderText').textContent = `Output folder: ${outDir}`;
        }
    } else {
        // Use manual selection for images
        if (!outputDirectory) {
            document.getElementById('outputFolderInfo').style.display = 'none';
        }
    }
    
    // Ensure the directory exists
    if (outputDirectory) {
        await electronAPI.mkdir(outputDirectory);
    }
    
    return outputDirectory;
}

function generateOutputPath(file, outputDir, settings, fileNumber) {
   const namingPattern = settings.namingPattern || (currentMode === 'image' ? 'photo_{number}' : 'clip_{number}');
   const currentDate = new Date().toISOString().slice(0, 10);
   
   // Use the new generateNameFromPattern function for better naming
   let filename = generateNameFromPattern(namingPattern, currentMode === 'image' ? 'photo' : 'clip')
       .replace('{date}', currentDate)
       .replace('{original}', path.parse(file.name).name);
   
   // If no {number} in pattern, add a sequential number
   if (!namingPattern.includes('{number}')) {
       filename += '_' + fileNumber.toString().padStart(3, '0');
   }
   
   let ext = file.extension;
   if (file.type === 'image' && settings.imageFormat) {
       ext = '.' + settings.imageFormat;
   } else if (file.type === 'video' && settings.videoFormat) {
       ext = '.' + settings.videoFormat;
   }
   
   return path.join(outputDir, filename + ext);
}

function addStatusMessage(message, type = 'info') {
   const statusContent = document.getElementById('statusContent');
   if (!statusContent) return;
   
   const statusLine = document.createElement('div');
   statusLine.className = `status-line status-${type}`;
   statusLine.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
   statusContent.appendChild(statusLine);
   statusContent.scrollTop = statusContent.scrollHeight;
}

function showStatus() {
   const statusPanel = document.getElementById('statusPanel');
   if (statusPanel) statusPanel.classList.add('show');
}

function hideStatus() {
   const statusPanel = document.getElementById('statusPanel');
   if (statusPanel) statusPanel.classList.remove('show');
}

function startTimer() {
   timerInterval = setInterval(() => {
       const elapsed = Math.floor((Date.now() - startTime) / 1000);
       const timeElement = document.getElementById('timeElapsed');
       if (timeElement) timeElement.textContent = `${elapsed}s`;
   }, 1000);
}

function stopTimer() {
   if (timerInterval) {
       clearInterval(timerInterval);
       timerInterval = null;
   }
}

async function openOutputFolder() {
   const openFolderBtn = document.getElementById('openFolderBtn');
   const folderPath = openFolderBtn?.getAttribute('data-path');
   if (folderPath) {
       await electronAPI.openOutputFolder(folderPath);
   }
}

function formatFileSize(bytes) {
   if (bytes === 0) return '0 Bytes';
   const k = 1024;
   const sizes = ['Bytes', 'KB', 'MB', 'GB'];
   const i = Math.floor(Math.log(bytes) / Math.log(k));
   return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function sleep(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
}

// Add these new functions before the last lines of renderer.js

// New function to handle individual file processing in batches
async function processFileInBatch(file, outputDir, batch, fileNumber, settings) {
    // Generate unique output path for this file in this batch
    const outputPath = generateOutputPathForBatch(file, outputDir, settings, fileNumber, batch);
    
    const updateProgress = (percent) => {
        // Progress is handled at the batch level now
    };
    
    try {
        switch (settings.mode) {
            case 'spoof-split':
                await processSpoofAndSplit(file, outputDir, settings, updateProgress, fileNumber, batch);
                break;
            case 'spoof-only':
                await processSpoofOnly(file, outputDir, settings, updateProgress, fileNumber, batch);
                break;
            case 'split-only':
                if (file.type === 'video') {
                    await processSplitOnly(file, outputDir, settings, updateProgress, fileNumber, batch);
                } else {
                    await electronAPI.copyFile(file.path, outputPath);
                }
                break;
            case 'convert-only':
                await processConvertOnly(file, outputDir, settings, updateProgress, fileNumber, batch);
                break;
        }
        
        // Only increment outputCount if we reach here without error
        outputCount++;
    } catch (error) {
        // Check if the output file was partially created and remove it
        const outputExists = await electronAPI.exists(outputPath);
        if (outputExists) {
            try {
                await electronAPI.unlink(outputPath);
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
        }
        throw error;
    }
}

// Updated function to generate unique output paths for batches
function generateOutputPathForBatch(file, outputDir, settings, fileNumber, batch) {
    const namingPattern = settings.namingPattern || (currentMode === 'image' ? 'photo_{number}' : 'clip_{number}');
    const currentDate = new Date().toISOString().slice(0, 10);
    
    // Create unique filename for this file in this batch using the new function
    let filename = generateNameFromPattern(namingPattern, currentMode === 'image' ? 'photo' : 'clip')
        .replace('{date}', currentDate)
        .replace('{original}', path.parse(file.name).name);
    
    // If no {number} in pattern, add a sequential number
    if (!namingPattern.includes('{number}')) {
        filename += '_' + fileNumber.toString().padStart(3, '0');
    }
    
    // Add batch info if multiple batches
    if (settings.duplicates > 1) {
        filename += `_batch${batch}`;
    }
    
    let ext = file.extension;
    if (file.type === 'image' && settings.imageFormat) {
        ext = '.' + settings.imageFormat;
    } else if (file.type === 'video' && settings.videoFormat) {
        ext = '.' + settings.videoFormat;
    }
    
    return path.join(outputDir, filename + ext);
}

// Updated spoof processing functions
async function processSpoofOnly(file, outputDir, settings, updateProgress, fileNumber, batch) {
    const outputPath = generateOutputPathForBatch(file, outputDir, settings, fileNumber, batch);
    const effects = generateSpoofEffects(settings.intensity);
    
    if (file.type === 'image') {
        await processImageSpoof(file.path, outputPath, effects, settings, updateProgress);
    } else {
        await processVideoSpoof(file.path, outputPath, effects, settings, updateProgress);
    }
}

async function processConvertOnly(file, outputDir, settings, updateProgress, fileNumber, batch) {
    const outputPath = generateOutputPathForBatch(file, outputDir, settings, fileNumber, batch);
    
    if (file.type === 'image') {
        await convertImage(file.path, outputPath, settings);
    } else {
        await convertVideo(file.path, outputPath, settings);
    }
}

// Add selectFolder for both image and video
async function selectFolder(mode) {
    const folderPath = await electronAPI.selectFolder();
    if (folderPath) {
        // Get all files in the folder (images or videos)
        const files = await electronAPI.readDirRecursive(folderPath);
        const filtered = files.filter(f => {
            const ext = f.split('.').pop().toLowerCase();
            if (mode === 'image') return ['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext);
            if (mode === 'video') return ['mp4', 'mov', 'avi', 'webm'].includes(ext);
            return false;
        });
        addFiles(filtered, mode);
    }
}

// Update naming pattern logic
function generateNameFromPattern(pattern, word) {
    // Replace {word} with the provided word (default 'photo' or 'clip')
    const safeWord = word || (currentMode === 'image' ? 'photo' : 'clip');
    let name = pattern.replace(/{word}/g, safeWord);
    // Replace {number} with a random 12-digit number
    name = name.replace(/{number}/g, () => Math.floor(1e11 + Math.random() * 9e11).toString());
    return name;
}

// Make functions available globally for HTML onclick handlers
window.selectMode = selectMode;
window.goBack = goBack;