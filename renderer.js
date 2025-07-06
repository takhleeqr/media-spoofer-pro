// Global variables for DOM elements (will be initialized after DOM loads)
let modeSelection, imageInterface, videoInterface, processSection;

// Make functions available globally for HTML onclick handlers immediately
console.log('Defining selectMode function globally...');
window.selectMode = function(mode) {
    console.log('selectMode called with mode:', mode);
    
    // Ensure DOM elements are available
    if (!modeSelection || !imageInterface || !videoInterface || !processSection) {
        console.error('DOM elements not initialized yet');
        return;
    }
    
    currentMode = mode;
    modeSelection.style.display = 'none';
    
    if (mode === 'image') {
        console.log('Setting up image interface');
        imageInterface.classList.add('active');
        setupImageInterface();
    } else if (mode === 'video') {
        console.log('Setting up video interface');
        videoInterface.classList.add('active');
        setupVideoInterface();
    }
    
    processSection.style.display = 'block';
    resetProcessing();
};

console.log('Defining goBack function globally...');
window.goBack = function() {
    // Ensure DOM elements are available
    if (!modeSelection || !imageInterface || !videoInterface || !processSection) {
        console.error('DOM elements not initialized yet');
        return;
    }
    
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
};

// Polyfill for path operations
const path = {
    join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
    parse: (filepath) => {
        // Handle both forward slashes and backslashes
        const lastSlash = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'));
        const lastDot = filepath.lastIndexOf('.');
        return {
            name: lastSlash >= 0 ? filepath.substring(lastSlash + 1, lastDot >= 0 ? lastDot : undefined) : filepath,
            ext: lastDot >= 0 ? filepath.substring(lastDot) : '',
            extension: lastDot >= 0 ? filepath.substring(lastDot + 1) : ''
        };
    },
    dirname: (filepath) => {
        // Handle both forward slashes and backslashes
        const lastSlash = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'));
        return lastSlash >= 0 ? filepath.substring(0, lastSlash) : '.';
    },
    normalize: (filePath) => {
        // Cross-platform path normalization
        if (!filePath || typeof filePath !== 'string') {
            return '';
        }
        // Replace backslashes with forward slashes and remove duplicate slashes
        return filePath.replace(/\\/g, '/').replace(/\/+/g, '/');
    },
    resolve: (...paths) => {
        // Cross-platform path resolution
        if (paths.length === 0) return '';
        
        // Join all paths and normalize
        const joined = paths.join('/').replace(/\/+/g, '/');
        
        // Handle absolute paths
        if (joined.startsWith('/')) {
            return joined;
        }
        
        // Handle Windows absolute paths
        if (joined.match(/^[A-Za-z]:/)) {
            return joined.replace(/\//g, '\\');
        }
        
        return joined;
    }
};

// Helper function to spawn FFmpeg process securely
async function spawnFFmpeg(command) {
    try {
        console.log('Spawning FFmpeg with command:', command);
        console.log('FFmpeg path:', ffmpegPath);
        
        const result = await electronAPI.spawnProcess(ffmpegPath, command);
        console.log('FFmpeg process completed successfully');
        return result;
    } catch (error) {
        console.error('FFmpeg process failed:', error);
        
        // Additional debugging for macOS
        const platform = await electronAPI.getPlatform();
        if (platform === 'darwin') {
            console.error('macOS FFmpeg error details:', {
                ffmpegPath,
                command,
                errorMessage: error.message,
                errorStack: error.stack
            });
        }
        
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
let imageInterfaceSetup = false;
let videoInterfaceSetup = false;

// Cross-platform FFmpeg paths
let ffmpegPath, ffprobePath;

// Initialize FFmpeg paths when the app loads
async function initializeFFmpegPaths() {
    const platform = await electronAPI.getPlatform();
    const appPath = await electronAPI.getAppPath();
    const homeDir = await electronAPI.getHomeDir();
    
    console.log('Platform info:', { platform, appPath, homeDir });
    
    // Check if we're in development or production
    const isDev = appPath.includes('node_modules') || appPath.includes('MediaSpooferApp');
    
    console.log('Path detection:', { appPath, isDev, platform });
    
    if (isDev) {
        // Development: look in app folder
        if (platform === 'win32') {
            ffmpegPath = appPath + '/ffmpeg.exe';
            ffprobePath = appPath + '/ffprobe.exe';
        } else {
            ffmpegPath = appPath + '/ffmpeg';
            ffprobePath = appPath + '/ffprobe';
        }
    } else {
        // Production: look in resources folder (where electron-builder puts extraResources)
        if (platform === 'win32') {
            // For Windows production, the appPath points to the app.asar file
            // We need to go up one level to the app directory, then into resources
            const appDir = appPath.replace('/app.asar', '').replace('\\app.asar', '');
            ffmpegPath = appDir + '/resources/ffmpeg.exe';
            ffprobePath = appDir + '/resources/ffprobe.exe';
        } else {
            // For macOS production, the appPath points to the app bundle
            // We need to go into Contents/Resources
            const appDir = appPath.replace('/app.asar', '').replace('\\app.asar', '');
            ffmpegPath = appDir + '/resources/ffmpeg';
            ffprobePath = appDir + '/resources/ffprobe';
        }
    }
    
    console.log('FFmpeg paths initialized:', { ffmpegPath, ffprobePath, isDev, platform });
    
    // Enhanced debugging for all platforms
    let ffmpegExists = false;
    let ffprobeExists = false;
    
    try {
        ffmpegExists = await electronAPI.exists(ffmpegPath);
        ffprobeExists = await electronAPI.exists(ffprobePath);
        console.log('FFmpeg existence check:', { ffmpegExists, ffprobeExists, ffmpegPath, ffprobePath });
        
        if (ffmpegExists) {
            const ffmpegStats = await electronAPI.getFileStats(ffmpegPath);
            console.log('FFmpeg file stats:', ffmpegStats);
        } else {
            console.error('FFmpeg not found at path:', ffmpegPath);
            
            // Try alternative paths for production builds
            if (!isDev) {
                console.log('Trying alternative production paths...');
                const alternativePaths = [];
                
                if (platform === 'win32') {
                    // Try different Windows production paths
                    const baseDir = appPath.replace('/app.asar', '').replace('\\app.asar', '');
                    alternativePaths.push(
                        baseDir + '/ffmpeg.exe',
                        baseDir + '/ffprobe.exe',
                        appPath.replace('/app.asar', '/resources/ffmpeg.exe').replace('\\app.asar', '\\resources\\ffmpeg.exe'),
                        appPath.replace('/app.asar', '/resources/ffprobe.exe').replace('\\app.asar', '\\resources\\ffprobe.exe')
                    );
                } else {
                    // Try different macOS production paths
                    const baseDir = appPath.replace('/app.asar', '').replace('\\app.asar', '');
                    alternativePaths.push(
                        baseDir + '/ffmpeg',
                        baseDir + '/ffprobe',
                        baseDir + '/Contents/Resources/ffmpeg',
                        baseDir + '/Contents/Resources/ffprobe'
                    );
                }
                
                for (const altPath of alternativePaths) {
                    try {
                        const exists = await electronAPI.exists(altPath);
                        if (exists) {
                            console.log('Found FFmpeg at alternative path:', altPath);
                            if (altPath.includes('ffmpeg')) {
                                ffmpegPath = altPath;
                                ffmpegExists = true;
                            } else if (altPath.includes('ffprobe')) {
                                ffprobePath = altPath;
                                ffprobeExists = true;
                            }
                        }
                    } catch (error) {
                        console.log('Alternative path check failed:', altPath, error.message);
                    }
                }
            }
            
            // macOS-specific debugging
            if (platform === 'darwin') {
                console.error('macOS FFmpeg path issue detected. Common macOS paths:');
                console.error('- /Applications/Media Spoofer Pro.app/Contents/Resources/ffmpeg');
                console.error('- /Applications/Media Spoofer Pro.app/Contents/Resources/resources/ffmpeg');
            }
        }
        if (ffprobeExists) {
            const ffprobeStats = await electronAPI.getFileStats(ffprobePath);
            console.log('FFprobe file stats:', ffprobeStats);
        } else {
            console.error('FFprobe not found at path:', ffprobePath);
            
            // macOS-specific debugging
            if (platform === 'darwin') {
                console.error('macOS FFprobe path issue detected. Common macOS paths:');
                console.error('- /Applications/Media Spoofer Pro.app/Contents/Resources/ffprobe');
                console.error('- /Applications/Media Spoofer Pro.app/Contents/Resources/resources/ffprobe');
            }
        }
    } catch (error) {
        console.error('Error checking FFmpeg files:', error);
    }
    
    // macOS fallback path checking
    if (platform === 'darwin' && (!ffmpegExists || !ffprobeExists)) {
        console.log('Attempting macOS fallback path detection...');
        
        // Try alternative macOS paths
        const alternativePaths = [
            appPath + '/ffmpeg',
            appPath + '/ffprobe',
            appPath.replace('/resources', '') + '/ffmpeg',
            appPath.replace('/resources', '') + '/ffprobe'
        ];
        
        for (const altPath of alternativePaths) {
            try {
                const exists = await electronAPI.exists(altPath);
                if (exists) {
                    console.log('Found FFmpeg at alternative path:', altPath);
                    if (altPath.includes('ffmpeg')) {
                        ffmpegPath = altPath;
                        ffmpegExists = true;
                    } else if (altPath.includes('ffprobe')) {
                        ffprobePath = altPath;
                        ffprobeExists = true;
                    }
                }
            } catch (error) {
                console.log('Alternative path check failed:', altPath, error.message);
            }
        }
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
    try {
        console.log('App initializing...');
        
        // Get platform info for debugging
        const platform = await electronAPI.getPlatform();
        console.log('Platform detected:', platform);
        
        // Store platform globally for use in event listeners
        window.currentPlatform = platform;
        
        console.log('selectMode available:', typeof window.selectMode === 'function');
        console.log('goBack available:', typeof window.goBack === 'function');
        
        // Initialize DOM elements
        modeSelection = document.getElementById('modeSelection');
        imageInterface = document.getElementById('imageInterface');
        videoInterface = document.getElementById('videoInterface');
        processSection = document.getElementById('processSection');
        
        console.log('DOM elements initialized:', {
            modeSelection: !!modeSelection,
            imageInterface: !!imageInterface,
            videoInterface: !!videoInterface,
            processSection: !!processSection
        });
        
        // macOS-specific DOM element verification
        if (platform === 'darwin') {
            console.log('macOS: Verifying DOM elements...');
            if (!modeSelection) {
                console.error('macOS: modeSelection element not found!');
                alert('macOS Error: Mode selection element not found. Please restart the application.');
                return;
            }
            if (!imageInterface) {
                console.error('macOS: imageInterface element not found!');
                alert('macOS Error: Image interface element not found. Please restart the application.');
                return;
            }
            if (!videoInterface) {
                console.error('macOS: videoInterface element not found!');
                alert('macOS Error: Video interface element not found. Please restart the application.');
                return;
            }
            if (!processSection) {
                console.error('macOS: processSection element not found!');
                alert('macOS Error: Process section element not found. Please restart the application.');
                return;
            }
            console.log('macOS: All DOM elements verified successfully');
        }
        
        // Check if electronAPI is available
        if (!window.electronAPI) {
            console.error('electronAPI is not available!');
            alert('Error: electronAPI not available. Please restart the application.');
            return;
        }
        
        console.log('electronAPI is available:', Object.keys(window.electronAPI));
        
        await initializeFFmpegPaths();
        checkFFmpegInstallation();
        setupModeSelection();
        
        // Add event listeners for mode selection cards with macOS-specific handling
        const imageModeCard = document.getElementById('imageModeCard');
        const videoModeCard = document.getElementById('videoModeCard');
        
        if (imageModeCard) {
            console.log('Adding click listener to imageModeCard');
            // macOS-specific: Add both click and mousedown events for better compatibility
            if (window.currentPlatform === 'darwin') {
                imageModeCard.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    console.log('Image mode card mousedown (macOS)');
                    selectMode('image');
                });
                imageModeCard.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log('Image mode card clicked (macOS)');
                    selectMode('image');
                });
            } else {
                imageModeCard.addEventListener('click', () => {
                    console.log('Image mode card clicked');
                    selectMode('image');
                });
            }
        } else {
            console.error('imageModeCard not found!');
        }
        
        if (videoModeCard) {
            console.log('Adding click listener to videoModeCard');
            // macOS-specific: Add both click and mousedown events for better compatibility
            if (window.currentPlatform === 'darwin') {
                videoModeCard.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    console.log('Video mode card mousedown (macOS)');
                    selectMode('video');
                });
                videoModeCard.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log('Video mode card clicked (macOS)');
                    selectMode('video');
                });
            } else {
                videoModeCard.addEventListener('click', () => {
                    console.log('Video mode card clicked');
                    selectMode('video');
                });
            }
        } else {
            console.error('videoModeCard not found!');
        }
        
        // Add event listeners for back buttons
        const imageBackBtn = document.getElementById('imageBackBtn');
        const videoBackBtn = document.getElementById('videoBackBtn');
        if (imageBackBtn) {
            imageBackBtn.addEventListener('click', () => {
                console.log('Image back button clicked');
                goBack();
            });
        } else {
            console.error('imageBackBtn not found!');
        }
        if (videoBackBtn) {
            videoBackBtn.addEventListener('click', () => {
                console.log('Video back button clicked');
                goBack();
            });
        } else {
            console.error('videoBackBtn not found!');
        }
        
        console.log('App initialization complete');
        
        // macOS-specific success message
        if (window.currentPlatform === 'darwin') {
            console.log('macOS: App initialization completed successfully');
        }
        
    } catch (error) {
        console.error('Error during app initialization:', error);
        alert('Error initializing app: ' + error.message);
    }
});

// Check if FFmpeg is available
async function checkFFmpegInstallation() {
    const ffmpegExists = await electronAPI.exists(ffmpegPath);
    const ffprobeExists = await electronAPI.exists(ffprobePath);
    
    if (!ffmpegExists || !ffprobeExists) {
        console.warn('FFmpeg not found. Please ensure ffmpeg and ffprobe are in the app folder.');
    }
}

// Mode selection functions (now defined globally above)

function setupModeSelection() {
    // Ensure DOM elements are available
    if (!modeSelection || !imageInterface || !videoInterface || !processSection) {
        console.error('DOM elements not available in setupModeSelection');
        return;
    }
    
    // Mode selection is handled by onclick in HTML
    // Just ensure we start with the right display
    modeSelection.style.display = 'flex';
    imageInterface.classList.remove('active');
    videoInterface.classList.remove('active');
    processSection.style.display = 'none';
}

// Image interface setup
function setupImageInterface() {
    console.log('setupImageInterface called, already setup:', imageInterfaceSetup);
    
    if (imageInterfaceSetup) {
        console.log('Image interface already setup, skipping');
        return;
    }
    
    const imageDropZone = document.getElementById('imageDropZone');
    const selectImageBtn = document.getElementById('selectImageBtn');
    const selectImageFolderBtn = document.getElementById('selectImageFolderBtn');
    const clearImageBtn = document.getElementById('clearImageBtn');
    const imageFileList = document.getElementById('imageFileList');
    
    console.log('DOM elements found:', {
        imageDropZone: !!imageDropZone,
        selectImageBtn: !!selectImageBtn,
        selectImageFolderBtn: !!selectImageFolderBtn,
        clearImageBtn: !!clearImageBtn,
        imageFileList: !!imageFileList
    });
    
    // Set default values
    document.getElementById('imageDuplicates').value = 1;
    document.getElementById('imageIntensity').value = 'heavy';

    // Event listeners
    if (selectImageBtn) {
        console.log('Adding click listener to selectImageBtn');
        selectImageBtn.addEventListener('click', () => {
            console.log('Select Image button clicked');
            selectFiles('image');
        });
    } else {
        console.error('selectImageBtn not found!');
    }
    if (selectImageFolderBtn) {
        console.log('Adding click listener to selectImageFolderBtn');
        selectImageFolderBtn.addEventListener('click', () => {
            console.log('Select Image Folder button clicked');
            selectFolder('image');
        });
    } else {
        console.error('selectImageFolderBtn not found!');
    }
    
    if (clearImageBtn) {
        console.log('Adding click listener to clearImageBtn');
        clearImageBtn.addEventListener('click', () => {
            console.log('Clear Image button clicked');
            clearFiles();
        });
    } else {
        console.error('clearImageBtn not found!');
    }
    
    // Drag and drop
    if (imageDropZone) {
        imageDropZone.addEventListener('click', () => selectFiles('image'));
        imageDropZone.addEventListener('dragover', handleDragOver);
        imageDropZone.addEventListener('dragleave', handleDragLeave);
        imageDropZone.addEventListener('drop', (e) => handleDrop(e, 'image'));
    }
    
    // Settings change handlers
    const imageProcessingMode = document.getElementById('imageProcessingMode');
    const imageIntensityGroup = document.getElementById('imageIntensityGroup');
    const imageDuplicatesGroup = document.getElementById('imageDuplicatesGroup');
    
    if (imageProcessingMode) {
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
    }
    
    // Watermark UI handlers
    setupWatermarkUI('image');
    
    setupProcessingControls();
    imageInterfaceSetup = true;
}

// Video interface setup
function setupVideoInterface() {
    console.log('setupVideoInterface called, already setup:', videoInterfaceSetup);
    
    if (videoInterfaceSetup) {
        console.log('Video interface already setup, skipping');
        return;
    }
    
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
    if (selectVideoBtn) {
        selectVideoBtn.addEventListener('click', () => {
            console.log('Select Video button clicked');
            selectFiles('video');
        });
    }
    if (selectVideoFolderBtn) {
        selectVideoFolderBtn.addEventListener('click', () => {
            console.log('Select Video Folder button clicked');
            selectFolder('video');
        });
    }
    if (clearVideoBtn) {
        clearVideoBtn.addEventListener('click', () => {
            console.log('Clear Video button clicked');
            clearFiles();
        });
    }
    
    // Drag and drop
    if (videoDropZone) {
        videoDropZone.addEventListener('click', () => selectFiles('video'));
        videoDropZone.addEventListener('dragover', handleDragOver);
        videoDropZone.addEventListener('dragleave', handleDragLeave);
        videoDropZone.addEventListener('drop', (e) => handleDrop(e, 'video'));
    }
    
    // Settings change handlers
    const videoProcessingMode = document.getElementById('videoProcessingMode');
    const videoIntensityGroup = document.getElementById('videoIntensityGroup');
    const clipLengthGroup = document.getElementById('clipLengthGroup');
    const videoDuplicatesGroup = document.getElementById('videoDuplicatesGroup');
    
    if (videoProcessingMode) {
        // Function to update UI visibility based on mode
        const updateUIVisibility = (mode) => {
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
        };
        
        // Set up change event listener
        videoProcessingMode.addEventListener('change', () => {
            const mode = videoProcessingMode.value;
            updateUIVisibility(mode);
        });
        
        // Initialize UI visibility for default mode
        updateUIVisibility('spoof-only');
    }
    
    // Watermark UI handlers
    setupWatermarkUI('video');
    
    setupProcessingControls();
    videoInterfaceSetup = true;
}

// Watermark UI setup function
function setupWatermarkUI(mode) {
    const prefix = mode === 'image' ? 'image' : 'video';
    const watermarkEnabled = document.getElementById(`${prefix}WatermarkEnabled`);
    const watermarkSettings = document.getElementById(`${prefix}WatermarkSettings`);
    const watermarkSize = document.getElementById(`${prefix}WatermarkSize`);
    const watermarkSizeValue = document.getElementById(`${prefix}WatermarkSizeValue`);
    const watermarkRotation = document.getElementById(`${prefix}WatermarkRotation`);
    const watermarkRotationValue = document.getElementById(`${prefix}WatermarkRotationValue`);
    const watermarkOpacity = document.getElementById(`${prefix}WatermarkOpacity`);
    const watermarkOpacityValue = document.getElementById(`${prefix}WatermarkOpacityValue`);
    
    // Toggle watermark settings visibility
    if (watermarkEnabled) {
        watermarkEnabled.addEventListener('change', () => {
            if (watermarkSettings) {
                watermarkSettings.style.display = watermarkEnabled.checked ? 'block' : 'none';
            }
        });
    }
    
    // Update size value display
    if (watermarkSize && watermarkSizeValue) {
        watermarkSize.addEventListener('input', () => {
            watermarkSizeValue.textContent = `${watermarkSize.value}%`;
        });
    }
    
    // Update rotation value display
    if (watermarkRotation && watermarkRotationValue) {
        watermarkRotation.addEventListener('input', () => {
            watermarkRotationValue.textContent = `${watermarkRotation.value}°`;
        });
    }
    
    // Update opacity value display
    if (watermarkOpacity && watermarkOpacityValue) {
        watermarkOpacity.addEventListener('input', () => {
            watermarkOpacityValue.textContent = `${watermarkOpacity.value}%`;
        });
    }
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
        console.log('selectFiles called with mode:', mode);
        console.log('electronAPI available:', typeof window.electronAPI !== 'undefined');
        console.log('electronAPI.selectFiles available:', typeof window.electronAPI?.selectFiles === 'function');
        
        if (!window.electronAPI) {
            console.error('electronAPI is not available!');
            addStatusMessage('Error: electronAPI not available', 'error');
            return;
        }
        
        if (typeof window.electronAPI.selectFiles !== 'function') {
            console.error('electronAPI.selectFiles is not a function!');
            addStatusMessage('Error: selectFiles function not available', 'error');
            return;
        }
        
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
        
        console.log('Calling electronAPI.selectFiles with filters:', filters);
        const filePaths = await electronAPI.selectFiles(filters);
        console.log('File paths returned:', filePaths);
        console.log('File paths type:', typeof filePaths);
        console.log('File paths is array:', Array.isArray(filePaths));
        if (filePaths) {
            console.log('File paths length:', filePaths.length);
            console.log('First file path:', filePaths[0]);
            console.log('First file path type:', typeof filePaths[0]);
        }
        
        if (filePaths && filePaths.length > 0) {
            await addFiles(filePaths, mode);
        } else {
            console.warn('No file paths returned from electronAPI.selectFiles');
        }
    } catch (error) {
        console.error('Error in selectFiles:', error);
        addStatusMessage('Error selecting files: ' + error.message, 'error');
    }
}

async function addFiles(filePaths, mode) {
    console.log('addFiles called with:', { filePaths, mode });
    console.log('filePaths type:', typeof filePaths);
    console.log('filePaths is array:', Array.isArray(filePaths));
    
    if (!filePaths || filePaths.length === 0) {
        console.warn('No file paths provided to addFiles');
        return;
    }
    
    filePaths = Array.isArray(filePaths) ? filePaths : [filePaths];
    
    // Validate and normalize all file paths
    const validFilePaths = filePaths.filter(filePath => {
        if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
            console.warn('Invalid file path:', filePath);
            return false;
        }
        return true;
    });
    
    if (validFilePaths.length === 0) {
        console.warn('No valid file paths found');
        return;
    }
    
    console.log('Processing', validFilePaths.length, 'valid files');
    
    // Convert file paths to file objects if they're just strings
    const fileObjects = await Promise.all(validFilePaths.map(async (filePath) => {
        console.log('Processing file path:', filePath);
        
        // Normalize the path
        const normalizedPath = normalizePath(filePath);
        
        // Use cross-platform helper functions
        const fileName = extractFileName(normalizedPath);
        const fileExtension = extractFileExtension(normalizedPath);
        
        console.log('Extracted filename:', fileName);
        console.log('Extracted extension:', fileExtension);
        
        // Try to get file size
        let fileSize = 0;
        try {
            const stats = await electronAPI.getFileStats(normalizedPath);
            fileSize = stats.size;
            console.log('File size:', fileSize);
        } catch (error) {
            console.warn('Could not get file size for:', normalizedPath, error);
        }
        
        // Force file type based on mode to prevent misclassification
        const fileType = mode === 'image' ? 'image' : getFileType(fileExtension);
        
        // DEBUG: Log file type detection for macOS
        console.log('[DEBUG addFiles] File type detection:', {
            mode,
            fileExtension,
            detectedType: getFileType(fileExtension),
            forcedType: fileType,
            fileName
        });
        
        return {
            path: normalizedPath,
            name: fileName,
            type: fileType,
            extension: fileExtension,
            size: fileSize
        };
    }));
    
    const validFileObjects = fileObjects.filter(Boolean); // Remove null entries
    
    console.log('Created file objects:', validFileObjects);
    
    const newFiles = validFileObjects.filter(f => !selectedFiles.some(existing => existing.path === f.path));
    selectedFiles = selectedFiles.concat(newFiles);
    
    console.log('Updated selectedFiles:', selectedFiles);
    
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

async function handleDrop(e, mode) {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files);
    const filePaths = files.map(file => file.path);
    await addFiles(filePaths, mode);
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
    
    // Prevent image processing if outputDirectory is not set
    if (currentMode === 'image' && !outputDirectory) {
        addStatusMessage('❌ Please select an output folder before starting image processing.', 'error');
        isProcessing = false;
        updateButtons();
        return;
    }
    
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
    
    // Ensure status panel is visible
    const statusPanel = document.getElementById('statusPanel');
    if (statusPanel) {
        statusPanel.style.display = 'block';
        console.log('Status panel made visible');
    }
    
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
            
            // Create unique batch directory with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            addStatusMessage(`\n📁 Processing Batch ${batch} of ${settings.duplicates} (${timestamp})...`, 'info');
            updateOverallProgress(((batch - 1) / settings.duplicates) * 100, `Processing Batch ${batch} of ${settings.duplicates}`);
            
            const batchDir = outputDir + '/batch_' + timestamp;
            console.log('Created batch directory path:', batchDir);
            const batchDirExists = await electronAPI.exists(batchDir);
            if (!batchDirExists) {
                await electronAPI.mkdir(batchDir);
                console.log('Created batch directory:', batchDir);
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
                        console.log('Processing file in batch directory:', batchDir);
                        await processFileInBatch(file, batchDir, batch, i + 1, settings);
                        success = true;
                        addStatusMessage(`✅ Processed: ${file.name} (Batch ${batch} - ${timestamp})`, 'success');
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
                    const outputPath = generateOutputPathForBatch(file, outputDir, settings, 1);
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
    const outputPath = generateOutputPathForBatch(file, outputDir, settings, 1);
    const effects = generateSpoofEffects(settings.intensity);
    
    console.log('processSpoof called with file type:', file.type, 'file path:', file.path);
    
    updateProgress(30);
    
    if (file.type === 'image') {
        console.log('Processing as IMAGE');
        await processImageSpoof(file.path, outputPath, effects, settings, updateProgress);
    } else {
        console.log('Processing as VIDEO');
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
    const outputPath = generateOutputPathForBatch(file, outputDir, settings, 1);
    
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

// Generate watermark filter for FFmpeg
function generateWatermarkFilter(watermarkSettings) {
    if (!watermarkSettings || !watermarkSettings.enabled || !watermarkSettings.text) {
        return '';
    }
    
    const {
        text, font, size, position, rotation, color, opacity
    } = watermarkSettings;
    
    // Escape special characters in text
    const escapedText = text.replace(/'/g, "\\'").replace(/:/g, "\\:");
    
    // Convert color from hex to RGB
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 255, b: 255 };
    };
    
    const rgb = hexToRgb(color);
    const colorString = `0x${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;
    
    // Calculate font size based on percentage
    const fontSize = Math.max(12, Math.floor(size * 2)); // Convert percentage to reasonable font size
    
    // Position mapping
    const positionMap = {
        'top-left': 'x=10:y=10',
        'top-center': 'x=(w-text_w)/2:y=10',
        'top-right': 'x=w-text_w-10:y=10',
        'middle-left': 'x=10:y=(h-text_h)/2',
        'center': 'x=(w-text_w)/2:y=(h-text_h)/2',
        'middle-right': 'x=w-text_w-10:y=(h-text_h)/2',
        'bottom-left': 'x=10:y=h-text_h-10',
        'bottom-center': 'x=(w-text_w)/2:y=h-text_h-10',
        'bottom-right': 'x=w-text_w-10:y=h-text_h-10'
    };
    
    const positionString = positionMap[position] || positionMap['center'];
    const opacityDecimal = opacity / 100;
    
    // Build the drawtext filter
    const filter = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${colorString}:alpha=${opacityDecimal}:${positionString}`;
    
    // Add rotation if not 0
    if (rotation !== 0) {
        return `${filter}:rotation=${rotation}*PI/180`;
    }
    
    return filter;
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
        
        let filterComplex = `scale=iw*${effects.scale}:ih*${effects.scale},rotate=${effects.rotation}*PI/180,crop=iw*0.85:ih*0.85,eq=brightness=${brightnessDecimal}:contrast=${contrastDecimal}:saturation=${saturationDecimal},hue=h=${effects.hue}`;
        
        // Add watermark if enabled
        const watermarkFilter = generateWatermarkFilter(settings.watermark);
        if (watermarkFilter) {
            filterComplex += `,${watermarkFilter}`;
        }
        
        const command = [
            '-y',
            '-i', inputPath,
            '-vf', filterComplex,
            '-pix_fmt', 'yuv420p',
            '-map_metadata', '-1',
            outputPath
        ];
        
        console.log('Image processing command:', command);
        
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
        
        let filterComplex = `scale=iw*${effects.scale}:ih*${effects.scale},rotate=${effects.rotation}*PI/180,crop=iw*0.85:ih*0.85,eq=brightness=${brightnessDecimal}:contrast=${contrastDecimal}:saturation=${saturationDecimal},hue=h=${effects.hue}`;
        
        // Add watermark if enabled
        const watermarkFilter = generateWatermarkFilter(settings.watermark);
        if (watermarkFilter) {
            filterComplex += `,${watermarkFilter}`;
        }
        
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
           const outputPath = generateOutputPathForBatch(file, outputDir, settings, 1);
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
            const clipPath = generateOutputPathForBatch(file, outputDir, settings, clip.number);
            
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
            
            let filterComplex = `scale=iw*${effects.scale}:ih*${effects.scale},rotate=${effects.rotation}*PI/180,crop=iw*0.85:ih*0.85,eq=brightness=${brightnessDecimal}:contrast=${contrastDecimal}:saturation=${saturationDecimal},hue=h=${effects.hue}`;
            
            // Add watermark if enabled
            const watermarkFilter = generateWatermarkFilter(settings.watermark);
            if (watermarkFilter) {
                filterComplex += `,${watermarkFilter}`;
            }
            
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
            // For no effects, we need to handle watermark separately since we can't use -c copy with -vf
            const watermarkFilter = generateWatermarkFilter(settings.watermark);
            if (watermarkFilter) {
                command = [
                    '-y',
                    '-ss', clip.start.toString(),
                    '-i', inputPath,
                    '-t', clip.duration.toString(),
                    '-vf', watermarkFilter,
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
        }
        
        if (settings.removeAudio) {
            command.push('-an');
        } else if (effects || (settings.watermark && settings.watermark.enabled)) {
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
       let command = [
           '-y',
           '-i', inputPath,
           '-pix_fmt', 'yuv420p',
           '-map_metadata', '-1'
       ];
       
       // Add watermark if enabled
       const watermarkFilter = generateWatermarkFilter(settings.watermark);
       if (watermarkFilter) {
           command.push('-vf', watermarkFilter);
       }
       
       command.push(outputPath);
       
       console.log('Image conversion command:', command);
       
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
        let command = [
            '-y',
            '-i', inputPath,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-movflags', '+faststart',
            '-map_metadata', '-1'
        ];
        
        // Add watermark if enabled
        const watermarkFilter = generateWatermarkFilter(settings.watermark);
        if (watermarkFilter) {
            command.push('-vf', watermarkFilter);
        }
        
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
       
       // Watermark settings for images
       settings.watermark = {
           enabled: document.getElementById('imageWatermarkEnabled').checked,
           text: document.getElementById('imageWatermarkText').value,
           font: document.getElementById('imageWatermarkFont').value,
           size: parseInt(document.getElementById('imageWatermarkSize').value),
           position: document.getElementById('imageWatermarkPosition').value,
           rotation: parseInt(document.getElementById('imageWatermarkRotation').value),
           color: document.getElementById('imageWatermarkColor').value,
           opacity: parseInt(document.getElementById('imageWatermarkOpacity').value)
       };
   } else if (currentMode === 'video') {
       settings.mode = document.getElementById('videoProcessingMode').value;
       settings.intensity = document.getElementById('videoIntensity').value;
       settings.duplicates = settings.mode === 'convert-only' ? 1 : parseInt(document.getElementById('videoDuplicates').value);
       settings.videoFormat = document.getElementById('videoFormat').value;
       settings.removeAudio = document.getElementById('removeAudio').checked;
       settings.clipLength = document.getElementById('clipLength').value;
       settings.namingPattern = document.getElementById('videoNamingPattern').value;
       
       // Watermark settings for videos
       settings.watermark = {
           enabled: document.getElementById('videoWatermarkEnabled').checked,
           text: document.getElementById('videoWatermarkText').value,
           font: document.getElementById('videoWatermarkFont').value,
           size: parseInt(document.getElementById('videoWatermarkSize').value),
           position: document.getElementById('videoWatermarkPosition').value,
           rotation: parseInt(document.getElementById('videoWatermarkRotation').value),
           color: document.getElementById('videoWatermarkColor').value,
           opacity: parseInt(document.getElementById('videoWatermarkOpacity').value)
       };
   }
   
   return settings;
}

async function createOutputDirectory() {
    console.log('createOutputDirectory called, currentMode:', currentMode);
    console.log('selectedFiles:', selectedFiles);
    
    if (currentMode === 'video') {
        // Auto-create output folder in the same folder as the first selected file
        if (selectedFiles.length > 0) {
            const firstFile = selectedFiles[0];
            console.log('First file:', firstFile);
            
            if (!firstFile || !firstFile.path) {
                throw new Error('Invalid file object - missing path');
            }
            
            const parentDir = getParentDirectory(firstFile.path);
            console.log('Parent directory:', parentDir);
            
            if (!parentDir) {
                throw new Error('Could not determine parent directory for file: ' + firstFile.path);
            }
            
            // Use cross-platform path joining for better macOS compatibility
            const outDir = path.join(parentDir, 'MediaSpoofer_Output');
            console.log('Output directory:', outDir);
            
            // Additional debugging for macOS
            const platform = await electronAPI.getPlatform();
            if (platform === 'darwin') {
                console.log('[DEBUG createOutputDirectory] macOS output directory creation:', {
                    parentDir,
                    outDir,
                    platform,
                    pathExists: await electronAPI.exists(parentDir)
                });
            }
            
            try {
                await electronAPI.mkdir(outDir);
                outputDirectory = outDir;
                addStatusMessage(`📂 Output folder created: ${outDir}`, 'info');
                console.log('Final output directory set to:', outputDirectory);
                
                // Verify directory was created successfully (especially important for macOS)
                const dirExists = await electronAPI.exists(outDir);
                if (!dirExists) {
                    throw new Error(`Failed to verify directory creation: ${outDir}`);
                }
                
                // Show info
                const outputFolderInfo = document.getElementById('outputFolderInfo');
                const outputFolderText = document.getElementById('outputFolderText');
                if (outputFolderInfo) outputFolderInfo.style.display = 'block';
                if (outputFolderText) outputFolderText.textContent = `Output folder: ${outDir}`;
                
                // Return the output directory path
                return outDir;
            } catch (error) {
                console.error('Failed to create output directory:', error);
                
                // Additional debugging for macOS permission issues
                const platform = await electronAPI.getPlatform();
                if (platform === 'darwin') {
                    console.error('macOS directory creation error:', {
                        parentDir,
                        outDir,
                        errorMessage: error.message,
                        errorStack: error.stack
                    });
                    
                    // Try to provide more helpful error message for macOS
                    if (error.message.includes('permission') || error.message.includes('denied')) {
                        addStatusMessage(`macOS permission error: Please ensure you have write access to the folder containing your files. Try running the app with appropriate permissions.`, 'error');
                    } else {
                        addStatusMessage(`Failed to create output directory: ${error.message}`, 'error');
                    }
                } else {
                    addStatusMessage(`Failed to create output directory: ${error.message}`, 'error');
                }
                
                throw error;
            }
        } else {
            throw new Error('No files selected for video processing');
        }
    } else {
        // For images, outputDirectory should be set by user
        if (!outputDirectory) {
            throw new Error('Output directory not set for image processing');
        }
        return outputDirectory;
    }
}

// Helper function to get parent directory (enhanced for macOS)
function getParentDirectory(filePath) {
    const normalizedPath = path.normalize(filePath);
    const parentDir = path.dirname(normalizedPath);
    
    // Additional debugging for macOS path handling
    const platform = electronAPI.getPlatform ? electronAPI.getPlatform() : 'unknown';
    if (platform === 'darwin') {
        console.log('[DEBUG getParentDirectory] macOS path handling:', {
            originalPath: filePath,
            normalizedPath,
            parentDir,
            platform
        });
    }
    
    return parentDir;
}

// Helper function to normalize paths
function normalizePath(filePath) {
    return path.normalize(filePath);
}

// Helper function to extract filename
function extractFileName(filePath) {
    const parsed = path.parse(filePath);
    return parsed.name || 'unknown';
}

// Helper function to extract file extension
function extractFileExtension(filePath) {
    const parsed = path.parse(filePath);
    return parsed.extension || '';
}

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to sleep
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to generate output path
function generateOutputPath(file, outputDir, settings, index = 1) {
    const timestamp = Date.now();
    const randomId = Math.floor(Math.random() * 1000000000000);
    const extension = file.extension || path.parse(file.path).extension;
    
    let fileName;
    if (settings.namingPattern === 'random') {
        fileName = `clip_${randomId}`;
    } else if (settings.namingPattern === 'timestamp') {
        fileName = `clip_${timestamp}`;
    } else {
        fileName = `${file.name}_${timestamp}`;
    }
    
    // Ensure extension has a dot prefix
    const extensionWithDot = extension.startsWith('.') ? extension : '.' + extension;
    return `${outputDir}/${fileName}${extensionWithDot}`;
}

// Helper function to generate output path for batch processing
function generateOutputPathForBatch(file, batchDir, settings, index = 1) {
    const timestamp = Date.now();
    const randomId = Math.floor(Math.random() * 1000000000000);
    
    // Get extension from file object or parse from path
    let extension = file.extension || path.parse(file.path).extension;
    
    // Force ensure extension has a dot prefix - more robust approach
    if (!extension.startsWith('.')) {
        extension = '.' + extension;
    }
    
    // DEBUG: Log extension and final path for macOS compatibility
    console.log('[DEBUG generateOutputPathForBatch] Extension before dot check:', extension);
    console.log('[DEBUG generateOutputPathForBatch] Extension after dot check:', extension);
    
    let fileName;
    if (settings.namingPattern && settings.namingPattern.includes('{number}')) {
        fileName = settings.namingPattern.replace('{number}', randomId.toString().padStart(12, '0'));
        if (fileName.includes('{word}')) {
            const words = ['summer', 'winter', 'spring', 'autumn', 'brand', 'product', 'item', 'media'];
            const randomWord = words[Math.floor(Math.random() * words.length)];
            fileName = fileName.replace('{word}', randomWord);
        }
    } else if (settings.namingPattern === 'random') {
        fileName = `clip_${randomId}`;
    } else if (settings.namingPattern === 'timestamp') {
        fileName = `clip_${timestamp}`;
    } else {
        fileName = `${file.name}_${timestamp}`;
    }
    const finalPath = `${batchDir}/${fileName}${extension}`;
    console.log('[DEBUG generateOutputPathForBatch] Final path:', finalPath);
    console.log('[DEBUG generateOutputPathForBatch] Full debug info:', {extension, finalPath, fileName, filePath: file.path, settingsNamingPattern: settings.namingPattern});
    return finalPath;
}

// Helper function to process file in batch
async function processFileInBatch(file, batchDir, batch, index, settings) {
    const outputPath = generateOutputPathForBatch(file, batchDir, settings, index);
    
    switch (settings.mode) {
        case 'spoof-split':
            await processSpoofAndSplit(file, batchDir, settings, (percent) => {
                file.progress = percent;
                updateFileList();
            });
            break;
        case 'spoof-only':
            await processSpoof(file, batchDir, settings, (percent) => {
                file.progress = percent;
                updateFileList();
            });
            break;
        case 'split-only':
            if (file.type === 'video') {
                await processSplitOnly(file, batchDir, settings, (percent) => {
                    file.progress = percent;
                    updateFileList();
                });
            } else {
                await electronAPI.copyFile(file.path, outputPath);
                outputCount++;
            }
            break;
        case 'convert-only':
            await processConvert(file, batchDir, settings, (percent) => {
                file.progress = percent;
                updateFileList();
            });
            break;
    }
}

// Status message functions
function addStatusMessage(message, type = 'info') {
    console.log('addStatusMessage called:', message, type);
    
    const statusPanel = document.getElementById('statusPanel');
    const statusContent = document.getElementById('statusContent');
    
    console.log('Status elements found:', {
        statusPanel: !!statusPanel,
        statusContent: !!statusContent
    });
    
    if (!statusPanel || !statusContent) {
        console.error('Status panel elements not found!');
        return;
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = `status-message ${type}`;
    messageElement.textContent = message;
    
    statusContent.appendChild(messageElement);
    statusContent.scrollTop = statusContent.scrollHeight;
    
    // Show the status panel
    statusPanel.style.display = 'block';
    
    console.log('Status message added successfully');
}

function showStatus() {
    const statusPanel = document.getElementById('statusPanel');
    if (statusPanel) statusPanel.style.display = 'block';
}

function hideStatus() {
    const statusPanel = document.getElementById('statusPanel');
    if (statusPanel) statusPanel.style.display = 'none';
}

// Timer functions
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function updateTimer() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    document.getElementById('timeElapsed').textContent = elapsed + 's';
}

// Output folder functions (enhanced for macOS)
async function openOutputFolder() {
    const openFolderBtn = document.getElementById('openFolderBtn');
    const folderPath = openFolderBtn.getAttribute('data-path');
    
    if (folderPath) {
        try {
            // Verify folder exists before trying to open it (especially important for macOS)
            const folderExists = await electronAPI.exists(folderPath);
            if (!folderExists) {
                addStatusMessage(`❌ Output folder not found: ${folderPath}`, 'error');
                return;
            }
            
            await electronAPI.openOutputFolder(folderPath);
        } catch (error) {
            // Enhanced error handling for macOS
            const platform = await electronAPI.getPlatform();
            if (platform === 'darwin') {
                console.error('macOS openOutputFolder error:', error);
                addStatusMessage(`❌ macOS: Could not open output folder. Please check permissions and try opening manually: ${folderPath}`, 'error');
            } else {
                addStatusMessage('Error opening output folder: ' + error.message, 'error');
            }
        }
    }
}

// Folder selection
async function selectFolder(mode) {
    try {
        const folderPath = await electronAPI.selectFolder();
        if (folderPath) {
            const files = await electronAPI.readDirRecursive(folderPath);
            const filteredFiles = files.filter(file => {
                const ext = path.parse(file).extension.toLowerCase();
                if (mode === 'image') {
                    return ['.jpg', '.jpeg', '.png', '.heic', '.webp'].includes(ext);
                } else {
                    return ['.mp4', '.mov', '.avi', '.webm'].includes(ext);
                }
            });
            
            if (filteredFiles.length > 0) {
                await addFiles(filteredFiles, mode);
            } else {
                addStatusMessage(`No ${mode} files found in selected folder`, 'warning');
            }
        }
    } catch (error) {
        addStatusMessage('Error selecting folder: ' + error.message, 'error');
    }
}