// Global variables for DOM elements (will be initialized after DOM loads)
let modeSelection, imageInterface, videoInterface, processSection;

// Global variables for preview navigation
let currentPreviewIndex = 0;

// Global variables for enhanced progress tracking
let progressStartTime = 0;
let progressUpdateInterval = null;
let lastProgressUpdate = 0;
let estimatedTotalTime = 0;
let currentProcessingStep = '';
let currentStepProgress = 0;
let totalProcessingSteps = 0;
let completedSteps = 0;

// Make functions available globally for HTML onclick handlers immediately
console.log('Defining selectMode function globally...');
window.selectMode = function(mode) {
    try {
        console.log('selectMode called with mode:', mode);
        
        // Ensure DOM elements are available
        if (!modeSelection || !imageInterface || !videoInterface || !processSection) {
            console.error('DOM elements not initialized yet');
            return;
        }
        
        currentMode = mode;
        modeSelection.style.display = 'none';
        
        // Clear any existing previews when switching modes
        clearPreview('image');
        clearPreview('video');
        
        // Reset preview index when switching modes
        currentPreviewIndex = 0;
        
        // Clean up any temporary conversion directories when switching modes
        if (outputDirectory) {
            cleanupRemainingTempDirectories(outputDirectory).catch(error => {
                console.warn('Cleanup failed during selectMode:', error);
            });
        }
        
        if (mode === 'image') {
            console.log('Setting up image interface');
            imageInterface.classList.add('active');
            setupImageInterface();
        } else if (mode === 'video') {
            console.log('Setting up video interface');
            
            // Remove active class from image interface first
            if (imageInterface) {
                imageInterface.classList.remove('active');
            }
            
            // Add active class to video interface
            videoInterface.classList.add('active');
            setupVideoInterface();
        }
        
        processSection.style.display = 'block';
        resetProcessing();
        
        // Show preview for first file if any exist
        if (selectedFiles.length > 0) {
            showPreview(selectedFiles[0].path, mode);
        }
        
        console.log('selectMode completed successfully for mode:', mode);
    } catch (error) {
        console.error('Error in selectMode:', error);
    }
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
    
    // Clear all previews when going back
    clearPreview('image');
    clearPreview('video');
    
    // Show mode selection
    modeSelection.style.display = 'flex';
    
    // Reset state
    currentMode = null;
    selectedFiles = [];
    currentPreviewIndex = 0; // Reset preview index
    
    // Update navigation button states
    updateNavigationButtons('image');
    updateNavigationButtons('video');
    
    // Clean up any temporary conversion directories before resetting
    if (outputDirectory) {
        cleanupRemainingTempDirectories(outputDirectory).catch(error => {
            console.warn('Cleanup failed during goBack:', error);
        });
    }
    
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
        
        // Ensure we're getting the actual file extension (last dot in the filename part)
        let filename = lastSlash >= 0 ? filepath.substring(lastSlash + 1) : filepath;
        let extension = '';
        let name = filename;
        
        if (lastDot > lastSlash) {
            extension = filepath.substring(lastDot);
            name = filepath.substring(lastSlash + 1, lastDot);
        }
        
        return { name, extension, base: filename };
    },
    normalize: (filepath) => {
        // Custom normalize function to replace path.normalize
        return filepath.replace(/\\/g, '/').replace(/\/+/g, '/');
    },
    isAbsolute: (filepath) => {
        // Check if path is absolute (starts with drive letter on Windows or / on Unix)
        if (filepath && filepath.length >= 2 && filepath[1] === ':') {
            // Windows absolute path (e.g., C:\folder or C:/folder)
            return true;
        }
        if (filepath && filepath.startsWith('/')) {
            // Unix absolute path
            return true;
        }
        return false;
    },
    resolve: (...parts) => {
        // Simple resolve function that joins parts and ensures absolute path
        const joined = parts.join('/').replace(/\/+/g, '/');
        if (path.isAbsolute(joined)) {
            return joined;
        }
        // For relative paths, assume they're relative to current working directory
        // In a browser context, this is a best-effort approach
        return joined;
    },
    dirname: (filepath) => {
        // Get the directory name of a file path
        const lastSlash = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'));
        if (lastSlash >= 0) {
            return filepath.substring(0, lastSlash);
        }
        return '.';
    }
};

// Add missing clearPreview function
function clearPreview(mode) {
    try {
        console.log(`Clearing preview for ${mode} mode`);
        const previewSection = document.getElementById(`${mode}PreviewSection`);
        if (previewSection) {
            previewSection.style.display = 'none';
        }
        
        const previewElement = document.getElementById(`${mode === 'image' ? 'image' : 'video'}-preview`);
        if (previewElement) {
            previewElement.style.display = 'none';
            previewElement.src = '';
        }
        
        const watermarkElement = document.getElementById(`${mode === 'image' ? 'image' : 'video'}-text-watermark`);
        if (watermarkElement) {
            watermarkElement.style.display = 'none';
        }
        
        console.log(`Preview cleared for ${mode} mode`);
        
        // Update navigation button states
        updateNavigationButtons(mode);
    } catch (error) {
        console.warn(`Error clearing preview for ${mode}:`, error);
    }
}

// Add missing showPreview function
function showPreview(filePath, mode) {
    try {
        console.log(`Showing preview for ${mode} mode, file:`, filePath);
        const previewSection = document.getElementById(`${mode}PreviewSection`);
        if (previewSection) {
            previewSection.style.display = 'block';
        }
        
        const previewElement = document.getElementById(`${mode === 'image' ? 'image' : 'video'}-preview`);
        if (previewElement) {
            previewElement.style.display = 'block';
            previewElement.src = filePath;
        }
        
        console.log(`Preview shown for ${mode} mode`);
        
        // Update navigation button states
        updateNavigationButtons(mode);
    } catch (error) {
        console.warn(`Error showing preview for ${mode}:`, error);
    }
}

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
        
        // Enhanced debugging for all platforms
        const platform = await electronAPI.getPlatform();
        console.error(`${platform} FFmpeg error details:`, {
            ffmpegPath,
            command,
            errorMessage: error.message,
            errorStack: error.stack
        });
        
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

// Video duration cache to avoid redundant ffprobe calls
const videoDurationCache = new Map();

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
            ffmpegPath = appPath + '\\ffmpeg.exe';
            ffprobePath = appPath + '\\ffprobe.exe';
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
            ffmpegPath = appDir + '\\resources\\ffmpeg.exe';
            ffprobePath = appDir + '\\resources\\ffprobe.exe';
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
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, initializing application...');
    console.log('Document ready state:', document.readyState);
    console.log('Document body:', !!document.body);
    
    // Wait a bit to ensure everything is fully loaded
    await new Promise(resolve => setTimeout(resolve, 100));
    
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
    
    // Debug: Check if elements exist and their properties
    if (videoInterface) {
        console.log('Video interface found:', videoInterface);
        console.log('Video interface ID:', videoInterface.id);
        console.log('Video interface classes:', videoInterface.className);
        console.log('Video interface display:', window.getComputedStyle(videoInterface).display);
        console.log('Video interface visibility:', window.getComputedStyle(videoInterface).visibility);
    } else {
        console.error('Video interface NOT found!');
    }
    
    // Check if electronAPI is available
    if (!window.electronAPI) {
        console.error('electronAPI is not available!');
        alert('Error: electronAPI not available. Please restart the application.');
        return;
    }
    
    console.log('electronAPI is available:', Object.keys(window.electronAPI));
    
    // Initialize FFmpeg paths
    await initializeFFmpegPaths();
    checkFFmpegInstallation();
    setupModeSelection();
    
    // Set up mode selection event listeners
    setupModeSelectionEventListeners();
    
    // Set up interfaces
    setupImageInterface();
    setupVideoInterface();
    
    // Add keyboard navigation for preview
    setupPreviewKeyboardNavigation();
    
    // Initialize navigation button states
    updateNavigationButtons('image');
    updateNavigationButtons('video');
    
    console.log('Application initialized successfully');
    
    // Final check - test if elements are clickable
    const testElement = document.getElementById('imageModeCard');
    if (testElement) {
        console.log('Final test - imageModeCard element:', testElement);
        console.log('Final test - imageModeCard display:', window.getComputedStyle(testElement).display);
        console.log('Final test - imageModeCard visibility:', window.getComputedStyle(testElement).visibility);
        console.log('Final test - imageModeCard pointer-events:', window.getComputedStyle(testElement).pointerEvents);
    }
});

// Setup mode selection event listeners
function setupModeSelectionEventListeners() {
    try {
        console.log('Setting up mode selection event listeners...');
        
        const imageModeCard = document.getElementById('imageModeCard');
        const videoModeCard = document.getElementById('videoModeCard');
        
        console.log('Found elements:', {
            imageModeCard: !!imageModeCard,
            videoModeCard: !!videoModeCard
        });
        
        if (imageModeCard) {
            console.log('Adding click listener to imageModeCard');
            // Remove any existing listeners first
            imageModeCard.replaceWith(imageModeCard.cloneNode(true));
            const newImageModeCard = document.getElementById('imageModeCard');
            
            // Add visual feedback
            newImageModeCard.style.cursor = 'pointer';
            newImageModeCard.style.userSelect = 'none';
            
            newImageModeCard.addEventListener('click', (e) => {
                console.log('Image mode card clicked!', e);
                e.preventDefault();
                e.stopPropagation();
                selectMode('image');
            });
            
            // Also add onclick as backup
            newImageModeCard.onclick = () => {
                console.log('Image mode card onclick triggered');
                selectMode('image');
            };
            
            // Test if element is clickable
            console.log('Image mode card element:', newImageModeCard);
            console.log('Image mode card computed styles:', window.getComputedStyle(newImageModeCard));
        } else {
            console.error('imageModeCard not found!');
        }
        
        if (videoModeCard) {
            console.log('Adding click listener to videoModeCard');
            // Remove any existing listeners first
            videoModeCard.replaceWith(videoModeCard.cloneNode(true));
            const newVideoModeCard = document.getElementById('videoModeCard');
            
            // Add visual feedback
            newVideoModeCard.style.cursor = 'pointer';
            newVideoModeCard.style.userSelect = 'none';
            
            newVideoModeCard.addEventListener('click', (e) => {
                console.log('Video mode card clicked!', e);
                e.preventDefault();
                e.stopPropagation();
                selectMode('video');
            });
            
            // Also add onclick as backup
            newVideoModeCard.onclick = () => {
                console.log('Video mode card onclick triggered');
                selectMode('video');
            };
            
            // Test if element is clickable
            console.log('Video mode card element:', newVideoModeCard);
            console.log('Video mode card computed styles:', window.getComputedStyle(newVideoModeCard));
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
        
        console.log('Mode selection event listeners setup completed');
        
        // Add test button listener
        const testButton = document.getElementById('testButton');
        if (testButton) {
            testButton.addEventListener('click', () => {
                alert('Test button clicked! JavaScript is working!');
                console.log('Test button clicked successfully');
            });
        } else {
            console.error('Test button not found!');
        }
    } catch (error) {
        console.error('Error setting up mode selection event listeners:', error);
    }
}

// Setup keyboard navigation for preview
function setupPreviewKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        if (selectedFiles.length === 0) return;
        
        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                navigatePreview(currentMode, 'prev');
                break;
            case 'ArrowRight':
                e.preventDefault();
                navigatePreview(currentMode, 'next');
                break;
            case 'Home':
                e.preventDefault();
                navigatePreview(currentMode, 'home');
                break;
            case 'End':
                e.preventDefault();
                navigatePreview(currentMode, 'end');
                break;
        }
    });
}

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
        console.log('Setting up image drop zone event listeners');
        imageDropZone.addEventListener('click', () => {
            console.log('Image drop zone clicked!');
            selectFiles('image');
        });
        imageDropZone.addEventListener('dragover', handleDragOver);
        imageDropZone.addEventListener('dragleave', handleDragLeave);
        imageDropZone.addEventListener('drop', (e) => handleDrop(e, 'image'));
        console.log('Image drop zone event listeners set up successfully');
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
            
            // Hide "Original" option in image format when processing type is convert-only
            const imageFormat = document.getElementById('imageFormat');
            if (imageFormat) {
                const originalOption = imageFormat.querySelector('option[value="original"]');
                if (originalOption) {
                    if (mode === 'convert-only') {
                        originalOption.style.display = 'none';
                        // If "Original" was selected, change to "jpg" as default
                        if (imageFormat.value === 'original') {
                            imageFormat.value = 'jpg';
                        }
                    } else {
                        originalOption.style.display = 'block';
                    }
                }
            }
        });
        
        // Initialize the format option visibility
        const mode = imageProcessingMode.value;
        const imageFormat = document.getElementById('imageFormat');
        if (imageFormat && mode === 'convert-only') {
            const originalOption = imageFormat.querySelector('option[value="original"]');
            if (originalOption) {
                originalOption.style.display = 'none';
                if (imageFormat.value === 'original') {
                    imageFormat.value = 'jpg';
                }
            }
        }
    }
    
    // Watermark UI handlers
    const imageWatermarkUI = setupWatermarkUI('image');
    window.imageWatermarkUI = imageWatermarkUI; // Store reference globally
    
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
        console.log('Setting up video drop zone event listeners');
        videoDropZone.addEventListener('click', () => {
            console.log('Video drop zone clicked!');
            selectFiles('video');
        });
        videoDropZone.addEventListener('dragover', handleDragOver);
        videoDropZone.addEventListener('dragleave', handleDragLeave);
        videoDropZone.addEventListener('drop', (e) => handleDrop(e, 'video'));
        console.log('Video drop zone event listeners set up successfully');
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
            } else if (mode === 'split-only') {
                // Hide intensity for split-only mode, but show duplicates
                videoIntensityGroup.style.display = 'none';
                videoDuplicatesGroup.style.display = 'block';
                clipLengthGroup.style.display = 'block';
            } else {
                // Show all settings for spoof-split mode
                videoIntensityGroup.style.display = 'block';
                videoDuplicatesGroup.style.display = 'block';
                clipLengthGroup.style.display = 'block';
            }
        };
        
        // Set up change event listener
        videoProcessingMode.addEventListener('change', () => {
            const mode = videoProcessingMode.value;
            updateUIVisibility(mode);
            
            // Hide "Original" option in video format when processing type is convert-only
            const videoFormat = document.getElementById('videoFormat');
            if (videoFormat) {
                const originalOption = videoFormat.querySelector('option[value="original"]');
                if (originalOption) {
                    if (mode === 'convert-only') {
                        originalOption.style.display = 'none';
                        // If "Original" was selected, change to "mp4" as default
                        if (videoFormat.value === 'original') {
                            videoFormat.value = 'mp4';
                        }
                    } else {
                        originalOption.style.display = 'block';
                    }
                }
            }
        });
        
        // Initialize UI visibility for default mode
        updateUIVisibility('spoof-only');
        
        // Initialize the format option visibility
        const videoFormat = document.getElementById('videoFormat');
        if (videoFormat) {
            const originalOption = videoFormat.querySelector('option[value="original"]');
            if (originalOption) {
                originalOption.style.display = 'block'; // Default mode is spoof-only, so show original
            }
        }
    }
    
    // Watermark UI handlers
    const videoWatermarkUI = setupWatermarkUI('video');
    window.videoWatermarkUI = videoWatermarkUI; // Store reference globally
    
    setupProcessingControls();
    videoInterfaceSetup = true;
}

// Calculate appropriate watermark size based on media dimensions
function calculateDefaultWatermarkSize(width, height, mode = 'video') {
    // For videos, use a size that's roughly 5-8% of the smaller dimension
    // For images, use a size that's roughly 8-12% of the smaller dimension
    const smallerDimension = Math.min(width, height);
    const percentage = mode === 'video' ? 0.06 : 0.1; // 6% for video, 10% for image
    const calculatedSize = Math.round(smallerDimension * percentage);
    
    // Ensure size is within reasonable bounds
    return Math.max(16, Math.min(120, calculatedSize));
}

// Watermark UI setup function
function setupWatermarkUI(mode) {
    try {
        const prefix = mode === 'image' ? 'image' : 'video';
        
        // Get watermark elements
        const watermarkEnabled = document.getElementById(`${prefix}WatermarkEnabled`);
        const watermarkSettings = document.getElementById(`${prefix}WatermarkSettings`);
        
        // If basic watermark elements don't exist, return early
        if (!watermarkEnabled || !watermarkSettings) {
            console.warn(`Watermark elements not found for ${mode} mode`);
            return { 
                updateWatermarkSizeForMedia: () => {}, 
                updateWatermarkPreview: () => {} 
            };
        }
        
        const watermarkText = document.getElementById(`${prefix}WatermarkText`);
        const watermarkFont = document.getElementById(`${prefix}WatermarkFont`);
        const watermarkSize = document.getElementById(`${prefix}WatermarkSize`);
        const watermarkPosition = document.getElementById(`${prefix}WatermarkPosition`);
        const watermarkColor = document.getElementById(`${prefix}WatermarkColor`);
        const watermarkOpacity = document.getElementById(`${prefix}WatermarkOpacity`);
        const watermarkOpacityValue = document.getElementById(`${prefix}WatermarkOpacityValue`);
        const watermarkBackgroundEnabled = document.getElementById(`${prefix}WatermarkBackgroundEnabled`);
        const watermarkBackgroundColor = document.getElementById(`${prefix}WatermarkBackgroundColor`);
        const watermarkBackgroundColorContainer = document.getElementById(`${prefix}WatermarkBackgroundColorContainer`);
        
        // Preview elements
        const previewElement = document.getElementById(`${prefix === 'image' ? 'image' : 'video'}-preview`);
        const watermarkElement = document.getElementById(`${prefix === 'image' ? 'image' : 'video'}-text-watermark`);
        
        // Function to update watermark size based on loaded media
        function updateWatermarkSizeForMedia(width, height) {
            if (watermarkSize) {
                const defaultSize = calculateDefaultWatermarkSize(width, height, mode);
                watermarkSize.value = defaultSize;
                updateWatermarkPreview();
            }
        }
        
        // Update preview function with proper scaling
        function updateWatermarkPreview() {
            try {
                if (!watermarkEnabled || !watermarkEnabled.checked || !watermarkText || !watermarkText.value.trim()) {
                    if (watermarkElement) watermarkElement.style.display = 'none';
                    return;
                }
                
                if (watermarkElement && previewElement && watermarkFont && watermarkSize && watermarkColor && watermarkOpacity) {
                    watermarkElement.textContent = watermarkText.value;
                    watermarkElement.style.fontFamily = watermarkFont.value;
                    
                    // Use the actual watermark size for preview (no scaling)
                    // This gives you an accurate preview of how it will look in the output
                    const previewSize = watermarkSize.value;
                    watermarkElement.style.fontSize = `${Math.max(8, previewSize)}px`;
                    

                    
                    watermarkElement.style.color = watermarkColor.value;
                    watermarkElement.style.opacity = watermarkOpacity.value / 100;
                    
                    // Handle background
                    if (watermarkBackgroundEnabled && watermarkBackgroundEnabled.checked && watermarkBackgroundColor) {
                        watermarkElement.style.backgroundColor = watermarkBackgroundColor.value;
                        watermarkElement.style.padding = '4px 8px';
                        watermarkElement.style.borderRadius = '4px';
                    } else {
                        watermarkElement.style.backgroundColor = 'transparent';
                        watermarkElement.style.padding = '0';
                        watermarkElement.style.borderRadius = '0';
                    }
                    
                    // Position the watermark
                    if (watermarkPosition) {
                        const position = watermarkPosition.value;
                        watermarkElement.style.position = 'absolute';
                        
                        // Reset all positioning
                        watermarkElement.style.top = '';
                        watermarkElement.style.left = '';
                        watermarkElement.style.right = '';
                        watermarkElement.style.bottom = '';
                        
                        // Build transform string for positioning
                        let transformString = '';
                        
                        switch (position) {
                            case 'top-left':
                                watermarkElement.style.top = '16px';
                                watermarkElement.style.left = '16px';
                                break;
                            case 'top-center':
                                watermarkElement.style.top = '16px';
                                watermarkElement.style.left = '50%';
                                transformString = 'translateX(-50%)';
                                break;
                            case 'top-right':
                                watermarkElement.style.top = '16px';
                                watermarkElement.style.right = '16px';
                                break;
                            case 'middle-left':
                                watermarkElement.style.top = '50%';
                                watermarkElement.style.left = '16px';
                                transformString = 'translateY(-50%)';
                                break;
                            case 'center':
                                watermarkElement.style.top = '50%';
                                watermarkElement.style.left = '50%';
                                transformString = 'translate(-50%, -50%)';
                                break;
                            case 'middle-right':
                                watermarkElement.style.top = '50%';
                                watermarkElement.style.right = '16px';
                                transformString = 'translateY(-50%)';
                                break;
                            case 'bottom-left':
                                watermarkElement.style.bottom = '16px';
                                watermarkElement.style.left = '16px';
                                break;
                            case 'bottom-center':
                                watermarkElement.style.bottom = '16px';
                                watermarkElement.style.left = '50%';
                                transformString = 'translateX(-50%)';
                                break;
                            case 'bottom-right':
                                watermarkElement.style.bottom = '16px';
                                watermarkElement.style.right = '16px';
                                break;
                        }
                        
                        // Apply the combined transform
                        watermarkElement.style.transform = transformString;
                    }
                    
                    watermarkElement.style.display = 'block';
                }
            } catch (error) {
                console.warn('Error updating watermark preview:', error);
                // Don't let watermark errors break the UI
            }
        }
        
        // Toggle watermark settings visibility when checkbox changes
        if (watermarkEnabled && watermarkSettings) {
            watermarkEnabled.addEventListener('change', () => {
                watermarkSettings.style.display = watermarkEnabled.checked ? 'block' : 'none';
                updateWatermarkPreview();
            });
        }
        
        // Toggle background color container visibility
        if (watermarkBackgroundEnabled && watermarkBackgroundColorContainer) {
            watermarkBackgroundEnabled.addEventListener('change', () => {
                watermarkBackgroundColorContainer.style.display = watermarkBackgroundEnabled.checked ? 'block' : 'none';
                updateWatermarkPreview();
            });
        }
        
        // Add event listeners
        if (watermarkEnabled) watermarkEnabled.addEventListener('change', updateWatermarkPreview);
        if (watermarkText) watermarkText.addEventListener('input', updateWatermarkPreview);
        if (watermarkFont) watermarkFont.addEventListener('change', updateWatermarkPreview);
        if (watermarkSize) watermarkSize.addEventListener('input', updateWatermarkPreview);
        if (watermarkPosition) watermarkPosition.addEventListener('change', updateWatermarkPreview);
        if (watermarkColor) watermarkColor.addEventListener('change', updateWatermarkPreview);
        if (watermarkOpacity) watermarkOpacity.addEventListener('input', updateWatermarkPreview);
        
        // Add background event listeners with null checks
        if (watermarkBackgroundEnabled) {
            watermarkBackgroundEnabled.addEventListener('change', updateWatermarkPreview);
        }
        if (watermarkBackgroundColor) {
            watermarkBackgroundColor.addEventListener('change', updateWatermarkPreview);
        }
        
        // Update opacity value display
        if (watermarkOpacity && watermarkOpacityValue) {
            watermarkOpacity.addEventListener('input', () => {
                watermarkOpacityValue.textContent = `${watermarkOpacity.value}%`;
                updateWatermarkPreview();
            });
        }
        
        // Initial preview update
        updateWatermarkPreview();
        
        // Initialize watermark settings visibility
        if (watermarkEnabled && watermarkSettings) {
            watermarkSettings.style.display = watermarkEnabled.checked ? 'block' : 'none';
        }
        
        // Initialize background color container visibility
        if (watermarkBackgroundEnabled && watermarkBackgroundColorContainer) {
            watermarkBackgroundColorContainer.style.display = watermarkBackgroundEnabled.checked ? 'block' : 'none';
        }
        
        // Return the function so it can be called when media is loaded
        return { updateWatermarkSizeForMedia, updateWatermarkPreview };
    } catch (error) {
        console.warn('Error setting up watermark UI:', error);
        // Return empty functions to prevent errors
        return { 
            updateWatermarkSizeForMedia: () => {}, 
            updateWatermarkPreview: () => {} 
        };
    }
}

// Setup quality info display updates
function setupQualityInfo(mode) {
    try {
        const qualitySelect = document.getElementById(`${mode}Quality`);
        const qualityInfo = document.getElementById(`${mode}QualityInfo`);
        
        if (qualitySelect && qualityInfo) {
            // Update info when quality changes
            qualitySelect.addEventListener('change', () => {
                const quality = qualitySelect.value;
                const settings = getQualitySettings(quality);
                qualityInfo.textContent = settings.description;
            });
            
            // Set initial info
            const initialQuality = qualitySelect.value;
            const initialSettings = getQualitySettings(initialQuality);
            qualityInfo.textContent = initialSettings.description;
        }
    } catch (error) {
        console.warn('Error setting up quality info:', error);
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
                { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp', 'gif', 'tiff', '.tif', 'svg', '.ico', '.jfif', '.avif', '.jxl', '.raw', '.cr2', '.nef', '.arw', '.dng'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            : [
                { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'webm', 'ts', 'mkv', 'flv', 'wmv', 'm4v', '3gp', 'ogv', 'mts', 'm2ts', 'vob', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'mpg', '.mpeg', 'mxf', 'f4v'] },
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

// Add the missing selectFolder function
async function selectFolder(mode) {
    try {
        console.log('selectFolder called with mode:', mode);
        
        if (!window.electronAPI) {
            console.error('electronAPI is not available!');
            addStatusMessage('Error: electronAPI not available', 'error');
            return;
        }
        
        if (typeof window.electronAPI.selectFolder !== 'function') {
            console.error('electronAPI.selectFolder is not a function!');
            addStatusMessage('Error: selectFolder function not available', 'error');
            return;
        }
        
        console.log('Calling electronAPI.selectFolder');
        const folderPath = await electronAPI.selectFolder();
        console.log('Folder path returned:', folderPath);
        
        if (folderPath) {
            // Read all files from the selected folder
            const filePaths = await electronAPI.readDir(folderPath);
            console.log('Files found in folder:', filePaths);
            
            if (filePaths && filePaths.length > 0) {
                // Filter files by mode
                const filteredFiles = filePaths.filter(filePath => {
                    const extension = path.parse(filePath).extension.toLowerCase();
                    if (mode === 'image') {
                        return ['.jpg', '.jpeg', '.png', '.heic', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.svg', '.ico', '.jfif', '.avif', '.jxl', '.raw', '.cr2', '.nef', '.arw', '.dng'].includes(extension);
                    } else {
                        return ['.mp4', '.mov', '.avi', '.webm', '.ts', '.mkv', '.flv', '.wmv', '.m4v', '.3gp', '.ogv', '.mts', '.m2ts', '.vob', '.asf', '.rm', '.rmvb', '.divx', '.xvid', '.mpg', '.mpeg', '.mxf', '.f4v'].includes(extension);
                    }
                });
                
                console.log('Filtered files for mode:', mode, filteredFiles);
                
                if (filteredFiles.length > 0) {
                    await addFiles(filteredFiles, mode);
                    addStatusMessage(`📁 Added ${filteredFiles.length} files from folder: ${folderPath}`, 'success');
                } else {
                    addStatusMessage(`⚠️ No ${mode} files found in the selected folder`, 'warning');
                }
            } else {
                addStatusMessage('⚠️ No files found in the selected folder', 'warning');
            }
        } else {
            console.warn('No folder path returned from electronAPI.selectFolder');
        }
    } catch (error) {
        console.error('Error in selectFolder:', error);
        addStatusMessage('Error selecting folder: ' + error.message, 'error');
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
        let fileType = mode === 'image' ? 'image' : getFileType(fileExtension);
        
        // Special handling for files that might have incorrect extensions
        if (fileType === 'unknown' && mode === 'video') {
            // Check if the original filename contains video extensions
            const originalName = filePath.toLowerCase();
            if (originalName.includes('.ts') || originalName.includes('.mp4') || originalName.includes('.mov') || 
                originalName.includes('.avi') || originalName.includes('.mkv') || originalName.includes('.webm')) {
                fileType = 'video';
            }
        }
        
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
    
    // Reset preview index to show first file
    currentPreviewIndex = 0;
    
    updateFileList();
    updateStats();
    updateButtons();
    // Show preview for the first file
    if (selectedFiles.length > 0) {
        showPreview(selectedFiles[0].path, currentMode);
    }
}

function getFileType(extension) {
    const imageExts = [
        '.jpg', '.jpeg', '.png', '.heic', '.webp', '.bmp', '.gif', '.tiff', '.tif', 
        '.svg', '.ico', '.jfif', '.pjpeg', '.pjp', '.avif', '.jxl', '.raw', '.cr2', 
        '.nef', '.arw', '.dng', '.orf', '.rw2', '.pef', '.srw', '.raf', '.mrw', 
        '.kdc', '.dcr', '.x3f', '.mef', '.iiq', '.3fr', '.erf', '.mdc', '.mos', 
        '.mrw', '.nrw', '.rwz', '.srw', '.arw', '.bay', '.crw', '.cs1', '.dc2', 
        '.dcr', '.dng', '.erf', '.fff', '.hdr', '.k25', '.kdc', '.mdc', '.mos', 
        '.mrw', '.nef', '.nrw', '.orf', '.pef', '.raf', '.raw', '.rw2', '.rwl', 
        '.rwz', '.srw', '.srf', '.sr2', '.x3f'
    ];
    const videoExts = [
        '.mp4', '.mov', '.avi', '.webm', '.ts', '.TS', '.mkv', '.flv', '.wmv', 
        '.m4v', '.3gp', '.ogv', '.mts', '.m2ts', '.vob', '.asf', '.rm', '.rmvb', 
        '.divx', '.xvid', '.mpg', '.mpeg', '.mpe', '.m1v', '.m2v', '.mpv', '.mpv2', 
        '.m2p', '.m2t', '.m2ts', '.mts', '.ts', '.TS', '.mxf', '.f4v', '.f4p', 
        '.f4a', '.f4b', '.ogx', '.ogm', '.ogv', '.oga', '.spx', '.opus', '.webm', 
        '.m4a', '.m4b', '.m4p', '.m4r', '.m4v', '.3g2', '.3gp', '.3gp2', '.3gpp', 
        '.3gpp2', '.amc', '.amv', '.asf', '.asx', '.avi', '.bik', '.bin', '.divx', 
        '.drc', '.dv', '.dvr-ms', '.evo', '.fli', '.flv', '.hdmov', '.ifo', '.ivf', 
        '.m1v', '.m2t', '.m2ts', '.m2v', '.m4v', '.mkv', '.mod', '.mov', '.mp4', 
        '.mpe', '.mpeg', '.mpg', '.mpl', '.mpls', '.mpv', '.mpv2', '.mts', '.mxf', 
        '.nsv', '.nuv', '.ogg', '.ogm', '.ogv', '.ogx', '.ps', '.rec', '.rm', '.rmvb', 
        '.rpl', '.smil', '.smk', '.swf', '.tivo', '.tod', '.tp', '.trp', '.ts', '.TS', 
        '.vob', '.vp6', '.vro', '.webm', '.wm', '.wmv', '.wtv', '.xvid'
    ];
    
    if (imageExts.includes(extension)) return 'image';
    if (videoExts.includes(extension)) return 'video';
    return 'unknown';
}

function clearFiles() {
    // Clean up any temporary conversion directories before clearing
    if (outputDirectory) {
        cleanupRemainingTempDirectories(outputDirectory).catch(error => {
            console.warn('Cleanup failed during clearFiles:', error);
        });
    }
    
    selectedFiles = [];
    currentPreviewIndex = 0; // Reset preview index
    updateFileList();
    updateStats();
    updateButtons();
    hideStatus();
    hideOverallProgress();
    
    // Clear preview windows
    clearPreview('image');
    clearPreview('video');
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
    const fileList = document.getElementById(`${currentMode}FileList`);
    
    if (selectedFiles.length === 0) {
        fileList.innerHTML = '<div class="empty-state">No files selected</div>';
        return;
    }
    
    fileList.innerHTML = selectedFiles.map((file, index) => `
        <div class="file-item ${index === currentPreviewIndex ? 'active' : ''}" onclick="previewFileByClick(${index})" style="cursor: pointer;">
            <div class="file-info">
                <div class="file-icon ${file.type}">
                    ${file.type === 'image' ? '🖼️' : '🎬'}
                </div>
                <div class="file-details">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
            </div>
            <div class="file-actions">
                <button class="btn btn-danger btn-sm" onclick="removeFile(${index}); event.stopPropagation();" title="Remove file">
                    🗑️
                </button>
            </div>
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" id="progress-${index}" style="width: ${file.progress || 0}%"></div>
                </div>
                <div class="progress-text" id="progress-text-${index}">${file.status || 'Ready'}</div>
            </div>
        </div>
    `).join('');
    
    updatePreviewAfterFileChange(currentMode);
    
    // Update navigation button states
    if (currentMode) {
        updateNavigationButtons(currentMode);
    }
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
    if (selectOutputBtn) {
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
    
    // Prevent processing if outputDirectory is not set
    if (!outputDirectory) {
        const modeText = currentMode === 'image' ? 'image' : 'video';
        addStatusMessage(`❌ Please select an output folder before starting ${modeText} processing.`, 'error');
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
    
    // Clear video duration cache to ensure fresh data
    videoDurationCache.clear();
    console.log('Cleared video duration cache for fresh processing');
    
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
    
    // Calculate total processing steps for progress tracking
    const totalSteps = selectedFiles.length * settings.duplicates;
    startProgressTracking(totalSteps);
    
    addStatusMessage('🚀 Starting media processing...', 'info');
    addStatusMessage(`📊 Processing ${selectedFiles.length} ${currentMode}s with ${settings.duplicates} duplicates`, 'info');
    addStatusMessage(`⚙️ Mode: ${settings.mode} | Intensity: ${settings.intensity || 'N/A'}`, 'info');
    
    // Start timer
    startTimer();
    updateOverallProgress(0, 'Starting...');
    
    // Declare outputDir at function scope so it's accessible throughout
    let outputDir;
    
    try {
        // Use the manually selected output directory
        if (outputDirectory) {
            outputDir = outputDirectory;
            console.log('Using existing global outputDirectory:', outputDir);
        } else {
            // This should not happen since we validate outputDirectory in startProcessing()
            throw new Error('No output directory selected. Please select an output folder before processing.');
        }
        
        // Double-check that outputDir is properly set and is an absolute path
        if (!outputDir || !path.isAbsolute(outputDir)) {
            throw new Error(`Invalid output directory: ${outputDir}`);
        }
        
        addStatusMessage(`📂 Output directory: ${outputDir}`, 'info');
        
        // CONVERT FIRST APPROACH: Convert all files to target format immediately
        addStatusMessage('🔄 Converting files to target format...', 'info');
        updateOverallProgress(5, 'Converting files...');
        
        const convertedFiles = new Map(); // Store converted file paths
        
        for (let i = 0; i < selectedFiles.length; i++) {
            if (!isProcessing) break;
            
            const file = selectedFiles[i];
            const conversionProgress = (i / selectedFiles.length) * 10; // 5-15%
            updateOverallProgress(5 + conversionProgress, `Converting ${file.name}...`);
            
            try {
                // Convert file to target format if needed
                const convertedPath = await convertFileToTargetFormat(file, outputDir, settings);
                if (convertedPath && convertedPath !== file.path) {
                    convertedFiles.set(file.path, convertedPath);
                    addStatusMessage(`✅ Converted: ${file.name}`, 'success');
                }
            } catch (error) {
                addStatusMessage(`⚠️ Conversion failed for ${file.name}: ${error.message}`, 'warning');
                // Continue with original file
            }
        }
        
        updateOverallProgress(15, 'Starting batch processing...');
        
        // Process files in batches
        for (let batch = 1; batch <= settings.duplicates; batch++) {
            if (!isProcessing) break;
            
            currentBatch = batch;
            
            // Create unique batch directory with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            addStatusMessage(`\n📁 Processing Batch ${batch} of ${settings.duplicates} (${timestamp})...`, 'info');
            updateOverallProgress(((batch - 1) / settings.duplicates) * 70 + 15, `Processing Batch ${batch} of ${settings.duplicates}`);
            
            // Ensure we're using the absolute path for batch directory creation
            const batchDir = path.resolve(outputDir, 'batch_' + timestamp);
            console.log('Created batch directory path:', batchDir);
            const batchDirExists = await electronAPI.exists(batchDir);
            console.log('Batch directory exists check result:', batchDirExists);
            addStatusMessage(`🔍 Creating batch directory: ${batchDir}`, 'info');
            if (!batchDirExists) {
                console.log('Attempting to create batch directory:', batchDir);
                try {
                    // Try to create the directory with more detailed error handling
                    const result = await electronAPI.mkdir(batchDir);
                    console.log('mkdir result:', result);
                    
                    // Small delay to ensure directory is fully created (reduced for performance)
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                    // Verify the directory was created
                    const verifyExists = await electronAPI.exists(batchDir);
                    console.log('Verification - batch directory exists after creation:', verifyExists);
                    
                    if (!verifyExists) {
                        throw new Error(`Directory creation verification failed: ${batchDir}`);
                    }
                } catch (error) {
                    console.error('Failed to create batch directory:', error);
                    console.error('Error details:', {
                        batchDir,
                        outputDir,
                        timestamp,
                        error: error.message,
                        stack: error.stack
                    });
                    throw error;
                }
            } else {
                console.log('Batch directory already exists:', batchDir);
            }
            
            // Process each file in the batch - IMPROVED VERSION WITH BETTER PAUSE HANDLING
            for (let i = 0; i < selectedFiles.length; i++) {
                if (!isProcessing) break;
                
                const file = selectedFiles[i];
                
                // Handle pause - IMPROVED: Don't interrupt current processing
                while (isPaused && isProcessing) {
                    file.status = 'paused';
                    updateFileList();
                    await sleep(100); // Reduced sleep time for better responsiveness
                }
                
                if (!isProcessing) break;
                
                // Update file status for current batch
                file.status = `processing (batch ${batch})`;
                
                // Update step progress for real-time tracking
                const stepName = `Processing ${file.name} (Batch ${batch})`;
                updateStepProgress(stepName, 0);
                
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
                        addStatusMessage(`🔄 Processing file in batch directory: ${batchDir}`, 'info');
                        console.log('Processing file in batch directory:', batchDir);
                        
                        // Update step progress to show processing
                        updateStepProgress(stepName, 25);
                        
                        // Pass the converted file path to processing functions
                        const convertedFilePath = convertedFiles.get(file.path);
                        await processFileInBatch(file, batchDir, batch, i + 1, settings, convertedFilePath);
                        
                        // Update step progress to show completion
                        updateStepProgress(stepName, 100);
                        completeProcessingStep();
                        
                        success = true;
                        addStatusMessage(`✅ Processed: ${file.name} (Batch ${batch} - ${timestamp})`, 'success');
                    } catch (error) {
                        retryCount++;
                        
                        if (retryCount <= maxRetries) {
                            addStatusMessage(`⚠️ Retry ${retryCount}/${maxRetries} for ${file.name}: ${error.message}`, 'warning');
                            await sleep(500); // Reduced wait time before retry
                        } else {
                            addStatusMessage(`❌ Failed to process ${file.name} after ${maxRetries} retries: ${error.message}`, 'error');
                            file.status = 'failed';
                            file.error = error.message;
                        }
                    }
                }
                
                if (success) {
                    processedCount++;
                    file.status = 'completed';
                    file.progress = 100;
                }
                
                updateFileList();
                updateStats();
                
                // Small delay between files to prevent overwhelming the system
                if (i < selectedFiles.length - 1) {
                    await sleep(100);
                }
            }
            
            // Batch completed
            addStatusMessage(`✅ Batch ${batch} completed`, 'success');
        }
        
        // Processing completed successfully
        if (isProcessing) {
            // Stop progress tracking
            stopProgressTracking();
            
            addStatusMessage('\n🎉 All processing completed!', 'success');
            
            // Count successful and failed files
            const successFiles = selectedFiles.filter(f => f.status === 'completed');
            const failedFiles = selectedFiles.filter(f => f.status === 'failed');
            
            if (successFiles.length > 0) {
                addStatusMessage(`✅ Successfully processed: ${successFiles.length} files`, 'success');
            }
            
            if (failedFiles.length > 0) {
                addStatusMessage(`⚠️ Failed to process: ${failedFiles.length} files`, 'warning');
                failedFiles.forEach(file => {
                    addStatusMessage(`   • ${file.name}`, 'warning');
                });
            }
            
            addStatusMessage(`📂 Output saved to: ${outputDirectory || outputDir}`, 'info');
            console.log('Final status - outputDirectory:', outputDirectory, 'outputDir:', outputDir);
            
            // Final cleanup: Remove any remaining temporary conversion directories and files
            await cleanupRemainingTempDirectories(outputDirectory || outputDir);
            await cleanupTempConversionFiles(outputDirectory || outputDir);
            
            const openFolderBtn = document.getElementById('openFolderBtn');
            if (openFolderBtn) {
                openFolderBtn.disabled = false;
                // Use the main output directory, not the batch directory
                openFolderBtn.setAttribute('data-path', outputDirectory || outputDir);
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
    
    // Stop progress tracking
    stopProgressTracking();
    
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) pauseBtn.innerHTML = '⏸️ Pause';
    
    // Kill current FFmpeg process
    if (currentProcess) {
        currentProcess.kill('SIGTERM');
        currentProcess = null;
    }
    
            // Clean up any temporary conversion directories and files that might exist
        if (outputDirectory) {
            cleanupRemainingTempDirectories(outputDirectory).catch(error => {
                console.warn('Cleanup failed during stop:', error);
            });
            cleanupTempConversionFiles(outputDirectory).catch(error => {
                console.warn('Temp conversion cleanup failed during stop:', error);
            });
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
    
            // Clean up any temporary conversion directories and files
        if (outputDirectory) {
            cleanupRemainingTempDirectories(outputDirectory).catch(error => {
                console.warn('Cleanup failed during reset:', error);
            });
            cleanupTempConversionFiles(outputDirectory).catch(error => {
                console.warn('Temp conversion cleanup failed during reset:', error);
            });
        }
    
    hideStatus();
    hideOverallProgress();
    resetStats();
    updateButtons();
}

// File processing logic with progress updates
async function processFile(file, outputDir, batch, index, settings, convertedFilePath = null) {
    const updateProgress = (percent) => {
        file.progress = percent;
        updateFileList();
    };
    
    updateProgress(10);
    
    try {
        switch (settings.mode) {
            case 'spoof-split':
                await processSpoofAndSplit(file, outputDir, settings, updateProgress, convertedFilePath);
                break;
            case 'spoof-only':
                await processSpoof(file, outputDir, settings, updateProgress, convertedFilePath, index);
                break;
            case 'split-only':
                if (file.type === 'video') {
                    await processSplitOnly(file, outputDir, settings, updateProgress, convertedFilePath);
                } else {
                    const outputPath = generateOutputPathForBatch(file, outputDir, settings, batch, index);
                    await electronAPI.copyFile(file.path, outputPath);
                    outputCount++;
                    updateProgress(100);
                }
                break;
            case 'convert-only':
                await processConvert(file, outputDir, settings, updateProgress, index);
                break;
        }
    } catch (error) {
        throw error;
    }
}

// Processing mode implementations
async function processSpoof(file, outputDir, settings, updateProgress, convertedFilePath = null, fileIndex = 0) {
    const outputPath = generateOutputPathForBatch(file, outputDir, settings, 1, fileIndex);
    const effects = generateSpoofEffects(settings.intensity);
    
    console.log('processSpoof called with file type:', file.type, 'file path:', file.path);
    
    updateProgress(30);
    
    // Use converted file path if available (Convert FIRST approach)
    const inputPath = convertedFilePath || file.path;
    
    if (file.type === 'image') {
        console.log('Processing as IMAGE');
        await processImageSpoof(inputPath, outputPath, effects, settings, updateProgress);
    } else {
        console.log('Processing as VIDEO');
        await processVideoSpoof(inputPath, outputPath, effects, settings, updateProgress);
    }
    
    outputCount++;
    updateProgress(100);
}

async function processSpoofAndSplit(file, outputDir, settings, updateProgress, convertedFilePath = null) {
    // Use converted file path if available (Convert FIRST approach)
    const inputPath = convertedFilePath || file.path;
    
    if (file.type === 'video') {
        // Check video duration first
        const duration = await getVideoDuration(inputPath);
        
        if (duration > 10) {
            // Split video first, then spoof each clip
            await processVideoSplit(file, outputDir, settings, true, updateProgress, convertedFilePath, 0);
        } else {
            // Just spoof the video
            await processSpoof(file, outputDir, settings, updateProgress, convertedFilePath, 0);
        }
    } else {
        // For images, just spoof
        await processSpoof(file, outputDir, settings, updateProgress, convertedFilePath, 0);
    }
}

async function processSplitOnly(file, outputDir, settings, updateProgress, convertedFilePath = null) {
    // Use converted file path if available (Convert FIRST approach)
    const inputPath = convertedFilePath || file.path;
    
    if (file.type === 'video') {
        const duration = await getVideoDuration(inputPath);
        
        if (duration > 10) {
            // Split video into clips
            await processVideoSplit(file, outputDir, settings, false, updateProgress, convertedFilePath, 0);
        } else {
            // For videos under 10 seconds - process with watermark and audio removal
            const outputPath = generateOutputPathForBatch(file, outputDir, settings, 1, 0);
            
            // Check if watermark or audio removal is needed
            if (settings.watermark && settings.watermark.enabled || settings.removeAudio) {
                // Process with watermark/audio removal
                await processVideoClipWithEffects(inputPath, outputPath, { start: 0, duration: duration, number: 1 }, null, settings);
            } else {
                // Just copy the converted file to final output
                await electronAPI.copyFile(inputPath, outputPath);
            }
            
            outputCount++;
            updateProgress(100);
        }
    }
}



async function processConvert(file, outputDir, settings, updateProgress, fileIndex = 0) {
    const outputPath = generateOutputPathForBatch(file, outputDir, settings, 1, fileIndex);
    
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
        // Check cache first to avoid redundant ffprobe calls
        const normalizedPath = path.normalize(videoPath);
        if (videoDurationCache.has(normalizedPath)) {
            console.log('Using cached duration for:', normalizedPath);
            return videoDurationCache.get(normalizedPath);
        }
        
        console.log('Getting video duration with ffprobe for:', normalizedPath);
        const command = [
            '-v', 'quiet',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            normalizedPath
        ];
        
        const result = await electronAPI.spawnProcess(ffprobePath, command);
        
        if (result.code === 0) {
            const duration = parseFloat(result.stdout.trim());
            const finalDuration = duration || 90;
            
            // Cache the result for future use
            videoDurationCache.set(normalizedPath, finalDuration);
            console.log('Cached duration for:', normalizedPath, '=', finalDuration);
            
            return finalDuration;
        } else {
            console.warn('FFprobe failed, using default duration:', result.stderr);
            const defaultDuration = 90;
            videoDurationCache.set(normalizedPath, defaultDuration);
            return defaultDuration;
        }
    } catch (error) {
        console.error('Error getting video duration:', error);
        const defaultDuration = 90;
        videoDurationCache.set(path.normalize(videoPath), defaultDuration);
        return defaultDuration;
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
        text, font, size, position, color, opacity, backgroundEnabled, backgroundColor
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
    // Format color as hex for FFmpeg (0xRRGGBB format)
    const colorString = `0x${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;
    const opacityDecimal = opacity / 100;
    
    // Use the size directly as font size in pixels (no percentage calculation)
    const fontSize = size;
    
    // Position calculation
    let positionString = '';
    switch (position) {
        case 'top-left':
            positionString = 'x=16:y=16';
            break;
        case 'top-center':
            positionString = 'x=(w-text_w)/2:y=16';
            break;
        case 'top-right':
            positionString = 'x=w-text_w-16:y=16';
            break;
        case 'middle-left':
            positionString = 'x=16:y=(h-text_h)/2';
            break;
        case 'center':
            positionString = 'x=(w-text_w)/2:y=(h-text_h)/2';
            break;
        case 'middle-right':
            positionString = 'x=w-text_w-16:y=(h-text_h)/2';
            break;
        case 'bottom-left':
            positionString = 'x=16:y=h-text_h-16';
            break;
        case 'bottom-center':
            positionString = 'x=(w-text_w)/2:y=h-text_h-16';
            break;
        case 'bottom-right':
            positionString = 'x=w-text_w-16:y=h-text_h-16';
            break;
        default:
            positionString = 'x=(w-text_w)/2:y=(h-text_h)/2';
    }
    
    // Build the drawtext filter with explicit parameters to prevent duplication
    let filter = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${colorString}:${positionString}:enable='between(t,0,999999)'`;
    
    // Add background if enabled
    if (backgroundEnabled && backgroundColor) {
        const bgRgb = hexToRgb(backgroundColor);
        const bgColorString = `0x${bgRgb.r.toString(16).padStart(2, '0')}${bgRgb.g.toString(16).padStart(2, '0')}${bgRgb.b.toString(16).padStart(2, '0')}`;
        filter += `:box=1:boxcolor=${bgColorString}@${opacityDecimal}:boxborderw=5`;
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
        let command;
        
        // Check if format conversion is needed
        const inputExt = path.parse(inputPath).extension.toLowerCase();
        const needsFormatConversion = inputExt !== outputPath.split('.').pop();
        
        if (watermarkFilter) {
            // For format conversion + effects, use a more structured approach
            if (needsFormatConversion) {
                // Apply effects first, then watermark, then format conversion
                filterComplex += `,${watermarkFilter}`;
                // Add format conversion at the end to ensure compatibility
                filterComplex += ',format=yuv420p';
                console.log('Format conversion detected - using structured filter chain');
            } else {
                // Same format - apply watermark normally
                filterComplex += `,${watermarkFilter}`;
            }
            console.log('Watermark filter added:', watermarkFilter);
            console.log('Final filter complex:', filterComplex);
        } else if (needsFormatConversion) {
            // No watermark but format conversion needed
            filterComplex += ',format=yuv420p';
            console.log('Format conversion detected - added pixel format conversion');
        }
        
        // For MOV files, ensure proper pixel format to prevent filter issues
        if (inputExt === '.mov' && !needsFormatConversion) {
            // Add pixel format conversion for MOV files to ensure compatibility
            filterComplex += ',format=yuv420p';
            console.log('Added pixel format conversion for MOV file');
        }
        
        command = [
            '-y',
            '-i', inputPath,
            '-vf', filterComplex,
            '-pix_fmt', 'yuv420p',
            '-map_metadata', '-1',
            outputPath
        ];
        
        console.log('Full FFmpeg command:', command);
        
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
        // Ensure proper path handling for Windows
        const normalizedInputPath = path.normalize(inputPath);
        const normalizedOutputPath = path.normalize(outputPath);
        
        // Determine output format from file extension
        const outputExt = path.parse(normalizedOutputPath).extension.toLowerCase();
        
        const brightnessDecimal = effects.brightness / 100;
        const contrastDecimal = effects.contrast / 100;
        const saturationDecimal = effects.saturation / 100;
        
        let filterComplex = `scale=iw*${effects.scale}:ih*${effects.scale},rotate=${effects.rotation}*PI/180,crop=iw*0.85:ih*0.85,eq=brightness=${brightnessDecimal}:contrast=${contrastDecimal}:saturation=${saturationDecimal},hue=h=${effects.hue}`;
        
        // Add watermark if enabled
        const watermarkFilter = generateWatermarkFilter(settings.watermark);
        let command;
        
        // Check if format conversion is needed
        const inputExt = path.parse(normalizedInputPath).extension.toLowerCase();
        const needsFormatConversion = inputExt !== outputExt;
        
        if (watermarkFilter) {
            // For format conversion + effects, use a more structured approach
            if (needsFormatConversion) {
                // Apply effects first, then watermark, then format conversion
                filterComplex += `,${watermarkFilter}`;
                // Add format conversion at the end to ensure compatibility
                filterComplex += ',format=yuv420p';
                console.log('Format conversion detected - using structured filter chain');
            } else {
                // Same format - apply watermark normally
                filterComplex += `,${watermarkFilter}`;
            }
            console.log('Watermark filter added:', watermarkFilter);
            console.log('Final filter complex:', filterComplex);
        } else if (needsFormatConversion) {
            // No watermark but format conversion needed
            filterComplex += ',format=yuv420p';
            console.log('Format conversion detected - added pixel format conversion');
        }
        
        // For MOV files, ensure proper pixel format to prevent filter issues
        if (inputExt === '.mov' && !needsFormatConversion) {
            // Add pixel format conversion for MOV files to ensure compatibility
            filterComplex += ',format=yuv420p';
            console.log('Added pixel format conversion for MOV file');
        }
        
        command = [
            '-y',
            '-i', normalizedInputPath,
            '-vf', filterComplex,
            '-map_metadata', '-1'
        ];
        
        console.log('Full FFmpeg command:', command);
        
        // Configure codecs based on output format
        switch (outputExt) {
            case '.mp4':
                command.push('-c:v', 'libx264', '-preset', 'fast');
                break;
            case '.webm':
                command.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0');
                break;
            case '.mov':
                command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'mov');
                break;
            case '.avi':
                command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'avi');
                break;
            case '.mkv':
                command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'matroska');
                break;
            default:
                // Default to MP4 settings for unknown formats
                command.push('-c:v', 'libx264', '-preset', 'fast');
        }
        
        if (settings.removeAudio) {
            command.push('-an');
        } else {
            // Configure audio codec based on output format
            switch (outputExt) {
                case '.webm':
                    command.push('-c:a', 'libopus', '-b:a', '128k');
                    break;
                case '.mkv':
                    command.push('-c:a', 'aac', '-b:a', '128k');
                    break;
                default:
                    command.push('-c:a', 'aac', '-b:a', '128k');
                    break;
            }
        }
        
        command.push(normalizedOutputPath);
        
        console.log('Processing video spoof:', { input: normalizedInputPath, output: normalizedOutputPath, format: outputExt });
        
        // Additional debugging for MOV files
        if (inputExt === '.mov') {
            console.log('MOV file processing details:', {
                inputFormat: inputExt,
                outputFormat: outputExt,
                filterComplex: filterComplex,
                watermarkEnabled: settings.watermark?.enabled,
                watermarkText: settings.watermark?.text
            });
        }
        
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


async function processVideoSplit(file, outputDir, settings, applySpoof = false, updateProgress, convertedFilePath = null, fileIndex = 0) {
   // Use converted file path if available (Convert FIRST approach)
   const inputPath = convertedFilePath || file.path;
   const duration = await getVideoDuration(inputPath);
   console.log('Video splitting:', { filePath: inputPath, duration, applySpoof, settings });
   addStatusMessage(`Processing video: ${duration.toFixed(2)} seconds total`, 'info');
   
   // Determine clip length based on settings
   const clipLengthSetting = settings.clipLength || '6-8';
   let clipLength;
   
   switch (clipLengthSetting) {
       case '8':
           clipLength = 8;
           break;
       case '10':
           clipLength = 10;
           break;
       case '15':
           clipLength = 15;
           break;
       default: // '6-8'
           clipLength = 6 + Math.random() * 2;
   }
   
   // Split video into clips
   const clips = [];
   let startTime = 0;
   let clipNumber = 1;
   
   while (startTime < duration) {
       const endTime = Math.min(startTime + clipLength, duration);
       
       if (endTime - startTime < 3) break; // Skip very short clips
       
       clips.push({
           start: startTime,
           duration: endTime - startTime,
           number: clipNumber++
       });
       
       startTime = endTime;
   }
   
   console.log('Clips created:', clips.length, clips);
   addStatusMessage(`Created ${clips.length} clips: ${clips.map(c => `${c.duration.toFixed(1)}s`).join(', ')}`, 'info');
   
           // Process each clip
        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const clipPath = generateOutputPathForBatch(file, outputDir, settings, clip.number, fileIndex);
            
            // Update progress based on clip progress
            const clipProgress = (i / clips.length) * 80 + 10; // 10-90%
            updateProgress(clipProgress);
            
            if (applySpoof) {
                const effects = generateSpoofEffects(settings.intensity);
                await processVideoClipWithEffects(inputPath, clipPath, clip, effects, settings);
            } else {
                await extractVideoClip(inputPath, clipPath, clip, settings);
            }
            
            outputCount++;
        }
   
   updateProgress(100);
}

async function processVideoClipWithEffects(inputPath, outputPath, clip, effects, settings) {
    return new Promise((resolve, reject) => {
        // Ensure proper path handling for Windows
        const normalizedInputPath = path.normalize(inputPath);
        const normalizedOutputPath = path.normalize(outputPath);
        
        // Determine output format from file extension
        const outputExt = path.parse(normalizedOutputPath).extension.toLowerCase();
        
        let command;
        
        if (effects) {
            const brightnessDecimal = effects.brightness / 100;
            const contrastDecimal = effects.contrast / 100;
            const saturationDecimal = effects.saturation / 100;
            
            let filterComplex = `scale=iw*${effects.scale}:ih*${effects.scale},rotate=${effects.rotation}*PI/180,crop=iw*0.85:ih*0.85,eq=brightness=${brightnessDecimal}:contrast=${contrastDecimal}:saturation=${saturationDecimal},hue=h=${effects.hue}`;
            
            // Add watermark if enabled
            const watermarkFilter = generateWatermarkFilter(settings.watermark);
            
            // Check if format conversion is needed
            const inputExt = path.parse(normalizedInputPath).extension.toLowerCase();
            const needsFormatConversion = inputExt !== outputExt;
            
            if (watermarkFilter) {
                // For format conversion + effects, use a more structured approach
                if (needsFormatConversion) {
                    // Apply effects first, then watermark, then format conversion
                    filterComplex += `,${watermarkFilter}`;
                    // Add format conversion at the end to ensure compatibility
                    filterComplex += ',format=yuv420p';
                    console.log('Format conversion detected - using structured filter chain');
                } else {
                    // Same format - apply watermark normally
                    filterComplex += `,${watermarkFilter}`;
                }
                console.log('Watermark filter added:', watermarkFilter);
                console.log('Final filter complex:', filterComplex);
            } else if (needsFormatConversion) {
                // No watermark but format conversion needed
                filterComplex += ',format=yuv420p';
                console.log('Format conversion detected - added pixel format conversion');
            }
            
            // For MOV files, ensure proper pixel format to prevent filter issues
            if (inputExt === '.mov' && !needsFormatConversion) {
                // Add pixel format conversion for MOV files to ensure compatibility
                filterComplex += ',format=yuv420p';
                console.log('Added pixel format conversion for MOV file');
            }
            
            command = [
                '-y',
                '-ss', clip.start.toString(),
                '-i', normalizedInputPath,
                '-t', clip.duration.toString(),
                '-vf', filterComplex,
                '-map_metadata', '-1'
            ];
            
            console.log('Full FFmpeg command:', command);
            
            // Configure codecs based on output format
            switch (outputExt) {
                case '.mp4':
                    command.push('-c:v', 'libx264', '-preset', 'fast');
                    break;
                case '.webm':
                    command.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0');
                    break;
                case '.mov':
                    command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'mov');
                    break;
                case '.avi':
                    command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'avi');
                    break;
                case '.mkv':
                    command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'matroska');
                    break;
                default:
                    command.push('-c:v', 'libx264', '-preset', 'fast');
            }
        } else {
            // For no effects, we need to handle watermark separately since we can't use -c copy with -vf
            const watermarkFilter = generateWatermarkFilter(settings.watermark);
            if (watermarkFilter) {
                command = [
                    '-y',
                    '-ss', clip.start.toString(),
                    '-i', normalizedInputPath,
                    '-t', clip.duration.toString(),
                    '-vf', watermarkFilter,
                    '-map_metadata', '-1'
                ];
                
                // Configure codecs based on output format
                switch (outputExt) {
                    case '.mp4':
                        command.push('-c:v', 'libx264', '-preset', 'fast');
                        break;
                    case '.webm':
                        command.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0');
                        break;
                    case '.mov':
                        command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'mov');
                        break;
                    case '.avi':
                        command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'avi');
                        break;
                    case '.mkv':
                        command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'matroska');
                        break;
                    default:
                        command.push('-c:v', 'libx264', '-preset', 'fast');
                        break;
                }
            } else {
                // No effects - check if watermark or audio removal is needed
                const needsReencoding = settings.watermark?.enabled || settings.removeAudio;
                
                if (needsReencoding) {
                    // Force re-encoding for watermark or audio removal
                    command = [
                        '-y',
                        '-ss', clip.start.toString(),
                        '-i', normalizedInputPath,
                        '-t', clip.duration.toString(),
                        '-map_metadata', '-1'
                    ];
                    
                    switch (outputExt) {
                        case '.mp4':
                            command.push('-c:v', 'libx264', '-preset', 'fast');
                            break;
                        case '.mov':
                            command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'mov');
                            break;
                        case '.avi':
                            command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'avi');
                            break;
                        case '.mkv':
                            command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'matroska');
                            break;
                        default:
                            command.push('-c:v', 'libx264', '-preset', 'fast');
                    }
                } else {
                    // No effects, no watermark, no audio removal - can use copy for compatible formats
                    if (outputExt === '.mp4' || outputExt === '.mov' || outputExt === '.avi' || outputExt === '.mkv') {
                        // For these formats, we need to re-encode to ensure compatibility
                        command = [
                            '-y',
                            '-ss', clip.start.toString(),
                            '-i', normalizedInputPath,
                            '-t', clip.duration.toString(),
                            '-map_metadata', '-1'
                        ];
                        
                        switch (outputExt) {
                            case '.mp4':
                                command.push('-c:v', 'libx264', '-preset', 'fast');
                                break;
                            case '.mov':
                                command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'mov');
                                break;
                            case '.avi':
                                command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'avi');
                                break;
                            case '.mkv':
                                command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'matroska');
                                break;
                        }
                    } else {
                        // For other formats, use copy
                        command = [
                            '-y',
                            '-ss', clip.start.toString(),
                            '-i', normalizedInputPath,
                            '-t', clip.duration.toString(),
                            '-c', 'copy',
                            '-map_metadata', '-1'
                        ];
                    }
                }
            }
        }
        if (settings.removeAudio) {
            command.push('-an');
        } else if (effects || (settings.watermark && settings.watermark.enabled) || 
                   (outputExt === '.mp4' || outputExt === '.mov' || outputExt === '.avi' || outputExt === '.mkv')) {
            // Configure audio codec based on output format
            switch (outputExt) {
                case '.webm':
                    command.push('-c:a', 'libopus', '-b:a', '128k');
                    break;
                case '.mkv':
                    command.push('-c:a', 'aac', '-b:a', '128k');
                    break;
                default:
                    command.push('-c:a', 'aac', '-b:a', '128k');
                    break;
            }
        }
        
        command.push(normalizedOutputPath);
        
        console.log('Processing video clip with effects:', { input: normalizedInputPath, output: normalizedOutputPath, clip, format: outputExt });
        
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
async function extractVideoClip(inputPath, outputPath, clip, settings = {}) {
   return new Promise((resolve, reject) => {
       // Ensure proper path handling for Windows
       const normalizedInputPath = path.normalize(inputPath);
       const normalizedOutputPath = path.normalize(outputPath);
       
       // Determine output format from file extension
       const outputExt = path.parse(normalizedOutputPath).extension.toLowerCase();
       
       const command = [
           '-y',
           '-ss', clip.start.toString(),
           '-i', normalizedInputPath,
           '-t', clip.duration.toString(),
           '-map_metadata', '-1'
       ];
       
       // Add watermark if enabled
       const watermarkFilter = generateWatermarkFilter(settings.watermark);
       if (watermarkFilter) {
           command.push('-vf', watermarkFilter);
       }
       
       // Check if we need to force re-encoding due to watermark or audio removal
       const needsReencoding = settings.watermark?.enabled || settings.removeAudio;
       
       if (needsReencoding) {
           // Force re-encoding for watermark or audio removal
           switch (outputExt) {
               case '.mp4':
                   command.push('-c:v', 'libx264', '-preset', 'fast');
                   break;
               case '.webm':
                   command.push('-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0');
                   break;
               case '.mov':
                   command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'mov');
                   break;
               case '.avi':
                   command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'avi');
                   break;
               case '.mkv':
                   command.push('-c:v', 'libx264', '-preset', 'fast', '-f', 'matroska');
                   break;
               default:
                   command.push('-c:v', 'libx264', '-preset', 'fast');
           }
           
           // Handle audio
           if (settings.removeAudio) {
               command.push('-an');
           } else {
               switch (outputExt) {
                   case '.webm':
                       command.push('-c:a', 'libopus', '-b:a', '128k');
                       break;
                   case '.mkv':
                       command.push('-c:a', 'aac', '-b:a', '128k');
                       break;
                   default:
                       command.push('-c:a', 'aac', '-b:a', '128k');
               }
           }
       } else {
           // No watermark or audio removal - can use copy mode
           command.push('-c:v', 'copy', '-c:a', 'copy');
       }
        
        command.push(normalizedOutputPath);
        
       console.log('Extracting video clip:', { input: normalizedInputPath, output: normalizedOutputPath, clip, format: outputExt });
       addStatusMessage(`Extracting clip ${clip.number}: ${clip.start.toFixed(1)}s to ${(clip.start + clip.duration).toFixed(1)}s (${clip.duration.toFixed(1)}s duration)`, 'info');
       
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
       // Convert FIRST approach - always convert to target format for consistent processing
       
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
       
       // Add quality settings for image conversion
       const qualitySettings = getQualitySettings(settings.imageQuality || 'high');
       const outputExt = path.parse(outputPath).extension.toLowerCase();
       
       switch (outputExt) {
           case '.jpg':
               command.push('-q:v', qualitySettings.jpgQuality || '2'); // Lower = better quality
               break;
           case '.webp':
               command.push('-quality', qualitySettings.webpQuality || '90'); // 0-100, higher = better
               break;
           case '.png':
               // PNG is lossless, no quality setting needed
               break;
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
        // Ensure proper path handling for Windows
        const normalizedInputPath = path.normalize(inputPath);
        const normalizedOutputPath = path.normalize(outputPath);
        
        // Determine output format from file extension
        const outputExt = path.parse(normalizedOutputPath).extension.toLowerCase();
        
        // Convert FIRST approach - always convert to target format for consistent processing
        let command = [
            '-y',
            '-i', normalizedInputPath,
            '-map_metadata', '-1'
        ];
        
        // Smart codec selection: Copy when safe, re-encode when necessary
        const qualitySettings = getQualitySettings(settings.videoQuality || 'high');
        const inputExt = path.parse(normalizedInputPath).extension.toLowerCase();
        const needsReencoding = needsVideoReencoding(normalizedInputPath, outputExt, settings);
        
        if (needsReencoding) {
            // Re-encode with quality settings
            switch (outputExt) {
                case '.mp4':
                    command.push('-c:v', 'libx264', '-preset', qualitySettings.preset, '-crf', qualitySettings.crf, '-movflags', '+faststart');
                    break;
                case '.webm':
                    command.push('-c:v', 'libvpx-vp9', '-crf', qualitySettings.webmCrf, '-b:v', '0');
                    break;
                case '.mov':
                    command.push('-c:v', 'libx264', '-preset', qualitySettings.preset, '-crf', qualitySettings.crf, '-f', 'mov');
                    break;
                case '.avi':
                    command.push('-c:v', 'libx264', '-preset', qualitySettings.preset, '-crf', qualitySettings.crf, '-f', 'avi');
                    break;
                case '.mkv':
                    command.push('-c:v', 'libx264', '-preset', qualitySettings.preset, '-crf', qualitySettings.crf, '-f', 'matroska');
                    break;
                default:
                    command.push('-c:v', 'libx264', '-preset', qualitySettings.preset, '-crf', qualitySettings.crf, '-movflags', '+faststart');
            }
        } else {
            // Check if we can use copy mode (no watermark, no audio removal)
            if (!settings.watermark?.enabled && !settings.removeAudio) {
                // Fast copy - no quality loss, maximum speed
                command.push('-c:v', 'copy');
                console.log('Using fast copy mode - no re-encoding needed');
            } else {
                // Force re-encoding if watermark or audio removal is enabled
                console.log('Forcing re-encoding due to watermark or audio removal');
                switch (outputExt) {
                    case '.mp4':
                        command.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
                        break;
                    case '.webm':
                        command.push('-c:v', 'libvpx-vp9', '-crf', '25', '-b:v', '0');
                        break;
                    case '.mov':
                        command.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-f', 'mov');
                        break;
                    case '.avi':
                        command.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-f', 'avi');
                        break;
                    case '.mkv':
                        command.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-f', 'matroska');
                        break;
                    default:
                        command.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23');
                }
            }
        }
        
        // Add watermark if enabled
        const watermarkFilter = generateWatermarkFilter(settings.watermark);
        if (watermarkFilter) {
            command.push('-vf', watermarkFilter);
        }
        
        if (settings.removeAudio) {
            command.push('-an');
        } else if (needsReencoding || settings.watermark?.enabled) {
            // Re-encode audio with quality settings
            switch (outputExt) {
                case '.webm':
                    command.push('-c:a', 'libopus', '-b:a', '128k');
                    break;
                case '.mkv':
                    command.push('-c:a', 'aac', '-b:a', '128k');
                    break;
                default:
                    command.push('-c:a', 'aac', '-b:a', '128k');
                    break;
            }
        } else {
            // Fast copy audio - no quality loss, maximum speed
            command.push('-c:a', 'copy');
            console.log('Using fast copy mode for audio - no re-encoding needed');
        }
        
        command.push(normalizedOutputPath);
        
        console.log('Converting video:', { input: normalizedInputPath, output: normalizedOutputPath, format: outputExt, needsReencoding });
        console.log('Full output path:', normalizedOutputPath);
        
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

// Check if video needs re-encoding
function needsVideoReencoding(inputPath, outputExt, settings) {
    const inputExt = path.parse(inputPath).extension.toLowerCase();
    
    // Always re-encode if:
    // 1. Different output format
    if (inputExt !== outputExt) {
        console.log('Re-encoding needed: Different format', inputExt, '→', outputExt);
        return true;
    }
    
    // 2. Watermark is enabled (ALWAYS force re-encoding)
    if (settings.watermark && settings.watermark.enabled) {
        console.log('Re-encoding needed: Watermark enabled');
        return true;
    }
    
    // 3. Audio removal is enabled (ALWAYS force re-encoding)
    if (settings.removeAudio) {
        console.log('Re-encoding needed: Audio removal enabled');
        return true;
    }
    
    // 4. Quality preset requires compression (only re-encode for Medium and Small)
    if (settings.videoQuality && (settings.videoQuality === 'medium' || settings.videoQuality === 'small')) {
        console.log('Re-encoding needed: Quality preset requires compression', settings.videoQuality);
        return true;
    }
    
    // 5. Same format, no effects, lossless quality = use copy (ONLY if no watermark/audio removal)
    console.log('No re-encoding needed: Using fast copy mode (no watermark/audio removal)');
    return false;
}

// Quality preset helper function
function getQualitySettings(quality) {
    const presets = {
        lossless: {
            crf: 18,           // Visually lossless
            preset: 'veryslow', // Best compression
            webmCrf: 20,       // WebM equivalent
            jpgQuality: 1,     // JPG quality (1-31, lower = better)
            webpQuality: 100,  // WebP quality (0-100, higher = better)
            description: 'Lossless: Fast copy when possible, no quality loss'
        },
        ultra: {
            crf: 20,           // Ultra high quality
            preset: 'slow',     // Better compression
            webmCrf: 22,       // WebM equivalent
            jpgQuality: 2,     // JPG quality
            webpQuality: 95,   // WebP quality
            description: 'Ultra High: Fast copy when possible, minimal quality loss'
        },
        high: {
            crf: 23,           // High quality (current default)
            preset: 'fast',     // Fast compression
            webmCrf: 25,       // WebM equivalent
            jpgQuality: 3,     // JPG quality
            webpQuality: 90,   // WebP quality
            description: 'High Quality: Good balance between quality and file size'
        },
        medium: {
            crf: 26,           // Medium quality
            preset: 'fast',     // Fast compression
            webmCrf: 28,       // WebM equivalent
            jpgQuality: 5,     // JPG quality
            webpQuality: 80,   // WebP quality
            description: 'Medium: Good compression, acceptable quality'
        },
        small: {
            crf: 30,           // Small size
            preset: 'fast',     // Fast compression
            webmCrf: 32,       // WebM equivalent
            jpgQuality: 8,     // JPG quality
            webpQuality: 70,   // WebP quality
            description: 'Small Size: Aggressive compression, smaller files'
        }
    };
    
    return presets[quality] || presets.high;
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
       settings.imageQuality = document.getElementById('imageQuality').value;
       settings.namingPattern = document.getElementById('imageNamingPattern').value;
       
       // Watermark settings for images
       settings.watermark = {
           enabled: document.getElementById('imageWatermarkEnabled').checked,
           text: document.getElementById('imageWatermarkText').value,
           font: document.getElementById('imageWatermarkFont').value,
           size: parseInt(document.getElementById('imageWatermarkSize').value),
           position: document.getElementById('imageWatermarkPosition').value,
           color: document.getElementById('imageWatermarkColor').value,
           opacity: parseInt(document.getElementById('imageWatermarkOpacity').value),
           backgroundEnabled: document.getElementById('imageWatermarkBackgroundEnabled').checked,
           backgroundColor: document.getElementById('imageWatermarkBackgroundColor').value
       };
   } else if (currentMode === 'video') {
       settings.mode = document.getElementById('videoProcessingMode').value;
       settings.intensity = document.getElementById('videoIntensity').value;
       settings.duplicates = settings.mode === 'convert-only' ? 1 : parseInt(document.getElementById('videoDuplicates').value);
       settings.videoFormat = document.getElementById('videoFormat').value;
       settings.videoQuality = document.getElementById('videoQuality').value;
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
           color: document.getElementById('videoWatermarkColor').value,
           opacity: parseInt(document.getElementById('videoWatermarkOpacity').value),
           backgroundEnabled: document.getElementById('videoWatermarkBackgroundEnabled').checked,
           backgroundColor: document.getElementById('videoWatermarkBackgroundColor').value
       };
   }
   
   return settings;
}

async function createOutputDirectory() {
    console.log('createOutputDirectory called, currentMode:', currentMode);
    console.log('selectedFiles:', selectedFiles);
    
    // For both images and videos, use the same logic - auto-create in parent directory
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
        
        const outDir = path.join(parentDir, 'MediaSpoofer_Output');
        
        // Ensure the output directory is an absolute path
        const absoluteOutDir = path.resolve(outDir);
        console.log('Output directory:', absoluteOutDir);
        
        try {
            await electronAPI.mkdir(absoluteOutDir);
            outputDirectory = absoluteOutDir;
            addStatusMessage(`📂 Output folder created: ${absoluteOutDir}`, 'info');
            console.log('Final output directory set to:', outputDirectory);
            
            const dirExists = await electronAPI.exists(absoluteOutDir);
            if (!dirExists) {
                throw new Error(`Failed to verify directory creation: ${absoluteOutDir}`);
            }
            
            const outputFolderInfo = document.getElementById('outputFolderInfo');
            const outputFolderText = document.getElementById('outputFolderText');
            if (outputFolderInfo) outputFolderInfo.style.display = 'block';
            if (outputFolderText) outputFolderText.textContent = `Output folder: ${absoluteOutDir}`;
            
            // Set the data-path attribute for the Open Output button
            const openFolderBtn = document.getElementById('openFolderBtn');
            if (openFolderBtn) {
                openFolderBtn.setAttribute('data-path', absoluteOutDir);
                openFolderBtn.disabled = false;
                console.log('Set openFolderBtn data-path to:', absoluteOutDir);
            }
            
            // Return the created directory path
            return absoluteOutDir;
        } catch (error) {
            console.error('Error creating output directory:', error);
            throw error;
        }
    } else {
        throw new Error('No files selected for output directory creation');
    }
}

// Add missing functions that are referenced but not defined

// Status message functions
function addStatusMessage(message, type = 'info') {
    try {
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        const statusContent = document.getElementById('statusContent');
        if (!statusContent) {
            console.warn('statusContent element not found');
            return;
        }
        
        // Create timestamp
        const now = new Date();
        const timestamp = now.toLocaleTimeString();
        
        // Create message element with appropriate styling
        const messageElement = document.createElement('div');
        messageElement.className = `status-line status-${type}`;
        messageElement.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${message}`;
        
        // Add message to status content
        statusContent.appendChild(messageElement);
        
        // Auto-scroll to bottom
        statusContent.scrollTop = statusContent.scrollHeight;
        
        // Show status panel if it's hidden
        const statusPanel = document.getElementById('statusPanel');
        if (statusPanel && statusPanel.style.display === 'none') {
            statusPanel.style.display = 'block';
        }
        
        // Auto-hide info messages after 5 seconds (optional)
        if (type === 'info') {
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.style.opacity = '0.7';
                }
            }, 5000);
        }
        
    } catch (error) {
        console.error('Error in addStatusMessage:', error);
    }
}

function showStatus() {
    try {
        const statusPanel = document.getElementById('statusPanel');
        if (statusPanel) {
            statusPanel.style.display = 'block';
            console.log('Status panel shown');
        } else {
            console.warn('Status panel element not found');
        }
    } catch (error) {
        console.error('Error showing status:', error);
    }
}

function hideStatus() {
    try {
        const statusPanel = document.getElementById('statusPanel');
        if (statusPanel) {
            statusPanel.style.display = 'none';
            console.log('Status panel hidden');
        } else {
            console.warn('Status panel element not found');
        }
    } catch (error) {
        console.error('Error hiding status:', error);
    }
}

// Progress tracking functions
function startProgressTracking(totalSteps) {
    totalProcessingSteps = totalSteps;
    completedSteps = 0;
    progressStartTime = Date.now();
    lastProgressUpdate = 0;
    
    if (progressUpdateInterval) {
        clearInterval(progressUpdateInterval);
    }
    
    progressUpdateInterval = setInterval(() => {
        if (completedSteps >= totalProcessingSteps) {
            stopProgressTracking();
            return;
        }
        
        const now = Date.now();
        if (now - lastProgressUpdate < 100) return; // Update max every 100ms
        
        lastProgressUpdate = now;
        const elapsed = now - progressStartTime;
        const progress = (completedSteps / totalProcessingSteps) * 100;
        
        if (completedSteps > 0) {
            const avgTimePerStep = elapsed / completedSteps;
            const remainingSteps = totalProcessingSteps - completedSteps;
            estimatedTotalTime = avgTimePerStep * remainingSteps;
            
            const remainingTime = Math.max(0, estimatedTotalTime);
            const timeText = remainingTime > 0 ? ` - ${Math.ceil(remainingTime / 1000)}s remaining` : '';
            
            updateOverallProgress(progress, `${Math.round(progress)}%${timeText}`);
        }
    }, 100);
}

function stopProgressTracking() {
    if (progressUpdateInterval) {
        clearInterval(progressUpdateInterval);
        progressUpdateInterval = null;
    }
}

function updateStepProgress(stepName, percent) {
    currentProcessingStep = stepName;
    currentStepProgress = percent;
    
    const stepProgress = document.getElementById('stepProgress');
    const stepProgressFill = document.getElementById('stepProgressFill');
    const stepProgressText = document.getElementById('stepProgressText');
    
    if (stepProgress) stepProgress.classList.add('show');
    if (stepProgressFill) stepProgressFill.style.width = `${percent}%`;
    if (stepProgressText) stepProgressText.textContent = stepName;
}

function completeProcessingStep() {
    completedSteps++;
}

// Timer functions
function startTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
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
    if (!startTime) return;
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const timeElapsed = document.getElementById('timeElapsed');
    if (timeElapsed) {
        timeElapsed.textContent = `${elapsed}s`;
    }
}

// Utility functions
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getParentDirectory(filePath) {
    // Use custom path object for proper cross-platform path handling
    try {
        // Normalize the path first to handle any mixed separators
        const normalizedPath = path.normalize(filePath);
        const parentDir = path.dirname(normalizedPath);
        
        // Ensure we return an absolute path
        if (path.isAbsolute(parentDir)) {
            return parentDir;
        } else {
            // If it's not absolute, try to resolve it
            return path.resolve(parentDir);
        }
    } catch (error) {
        console.error('Error in getParentDirectory:', error);
        // Fallback to old method if path module fails
        const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        return lastSlash >= 0 ? filePath.substring(0, lastSlash) : null;
    }
}

function extractFileName(filePath) {
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
}

function extractFileExtension(filePath) {
    const lastDot = filePath.lastIndexOf('.');
    return lastDot >= 0 ? filePath.substring(lastDot).toLowerCase() : '';
}

function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Cleanup function
async function cleanupRemainingTempDirectories(outputDir) {
    try {
        if (!outputDir) return;
        
        // This function would clean up any temporary conversion directories
        // For now, just log that cleanup was attempted
        console.log('Cleanup attempted for output directory:', outputDir);
        
        // You can implement actual cleanup logic here if needed
        // For example, removing temp files, cleaning up partial conversions, etc.
        
    } catch (error) {
        console.warn('Cleanup failed:', error);
        // Don't throw error - cleanup failure shouldn't break the main flow
    }
}

// Preview functions
function previewFileByClick(index) {
    if (index >= 0 && index < selectedFiles.length) {
        currentPreviewIndex = index;
        const file = selectedFiles[index];
        showPreview(file.path, currentMode);
        updateFileList();
        updateNavigationButtons(currentMode);
    }
}

function updatePreviewAfterFileChange(mode) {
    if (selectedFiles.length > 0 && currentPreviewIndex < selectedFiles.length) {
        const file = selectedFiles[currentPreviewIndex];
        showPreview(file.path, mode);
    }
}

function navigatePreview(mode, direction) {
    if (selectedFiles.length === 0) return;
    
    switch (direction) {
        case 'prev':
            currentPreviewIndex = currentPreviewIndex > 0 ? currentPreviewIndex - 1 : selectedFiles.length - 1;
            break;
        case 'next':
            currentPreviewIndex = currentPreviewIndex < selectedFiles.length - 1 ? currentPreviewIndex + 1 : 0;
            break;
        case 'home':
            currentPreviewIndex = 0;
            break;
        case 'end':
            currentPreviewIndex = selectedFiles.length - 1;
            break;
    }
    
    const file = selectedFiles[currentPreviewIndex];
    showPreview(file.path, mode);
    updateFileList();
    updateNavigationButtons(mode);
}

function removeFile(index) {
    if (index >= 0 && index < selectedFiles.length) {
        selectedFiles.splice(index, 1);
        
        // Adjust preview index if needed
        if (currentPreviewIndex >= selectedFiles.length) {
            currentPreviewIndex = Math.max(0, selectedFiles.length - 1);
        }
        
        updateFileList();
        updateStats();
        updateButtons();
        
        // Show preview for current file if any exist
        if (selectedFiles.length > 0) {
            showPreview(selectedFiles[currentPreviewIndex].path, currentMode);
        } else {
            clearPreview(currentMode);
        }
    }
}

// Output folder functions
function openOutputFolder() {
    const openFolderBtn = document.getElementById('openFolderBtn');
    if (openFolderBtn && openFolderBtn.hasAttribute('data-path')) {
        const path = openFolderBtn.getAttribute('data-path');
        if (path && window.electronAPI && window.electronAPI.openOutputFolder) {
            window.electronAPI.openOutputFolder(path);
        }
    }
}

// Processing functions
async function processFileInBatch(file, batchDir, batch, index, settings, convertedFilePath = null) {
    // This function handles the actual file processing in batch mode
    // It's a wrapper around the existing processFile function
    return await processFile(file, batchDir, batch, index, settings, convertedFilePath);
}

// Add missing generateOutputPathForBatch function
function generateOutputPathForBatch(file, outputDir, settings, batchNumber = 1, fileIndex = 0) {
    try {
        // Get the base filename without extension
        const baseName = path.parse(file.name).name;
        const extension = path.parse(file.name).extension;
        
        // Determine output format based on mode
        let outputFormat = extension;
        if (currentMode === 'image' && settings.imageFormat && settings.imageFormat !== 'original') {
            outputFormat = settings.imageFormat.startsWith('.') ? settings.imageFormat : '.' + settings.imageFormat;
        } else if (currentMode === 'video' && settings.videoFormat && settings.videoFormat !== 'original') {
            outputFormat = settings.videoFormat.startsWith('.') ? settings.videoFormat : '.' + settings.videoFormat;
        }
        
        // Generate unique filename using custom naming pattern or fallback
        const timestamp = Date.now();
        
        let outputName;
        
        // Generate a unique 5-digit random number for each file
        const randomId = Math.floor(10000 + Math.random() * 90000).toString();
        
        // Check if we have a custom naming pattern
        if (settings.namingPattern && settings.namingPattern.trim() !== '') {
            // Use custom naming pattern with placeholders
            let customName = settings.namingPattern;
            
            // Replace placeholders
            customName = customName.replace(/{number}/g, randomId); // {number} = 5-digit random number
            customName = customName.replace(/{timestamp}/g, timestamp.toString());
            customName = customName.replace(/{random}/g, randomId); // Keep {random} for backward compatibility
            customName = customName.replace(/{original}/g, baseName);
            customName = customName.replace(/{fileindex}/g, (fileIndex + 1).toString());
            
            outputName = `${customName}${outputFormat}`;
            
            console.log(`Custom pattern "${settings.namingPattern}" -> "${outputName}" with random ID: ${randomId}`);
        } else {
            // Default: use random number for uniqueness
            outputName = `file_${randomId}${outputFormat}`;
            console.log(`No custom pattern, using random ID: ${randomId}`);
        }
        
        // Join with output directory
        const finalPath = path.join(outputDir, outputName);
        
        return finalPath;
    } catch (error) {
        console.error('Error generating output path:', error);
        // Fallback to simple naming with random number
        const randomId = Math.floor(10000 + Math.random() * 90000).toString();
        return path.join(outputDir, `error_${randomId}${path.parse(file.name).extension}`);
    }
}

// Update navigation button states
function updateNavigationButtons(mode) {
    const prevBtn = document.querySelector(`#${mode}PreviewSection .btn:first-child`);
    const nextBtn = document.querySelector(`#${mode}PreviewSection .btn:last-child`);
    const positionDisplay = document.querySelector(`#${mode}PreviewSection .position-display`);
    
    if (prevBtn && nextBtn) {
        // Disable previous button if at first file
        prevBtn.disabled = selectedFiles.length === 0 || currentPreviewIndex === 0;
        
        // Disable next button if at last file
        nextBtn.disabled = selectedFiles.length === 0 || currentPreviewIndex === selectedFiles.length - 1;
        
        // Update button text to show just Previous/Next
        prevBtn.textContent = '← Previous';
        nextBtn.textContent = 'Next →';
        
        // Update position display
        if (positionDisplay) {
            if (selectedFiles.length > 0) {
                positionDisplay.textContent = `${currentPreviewIndex + 1}/${selectedFiles.length}`;
                positionDisplay.style.display = 'flex';
            } else {
                positionDisplay.style.display = 'none';
            }
        }
    }
}

// Convert FIRST approach: Convert files to target format immediately
async function convertFileToTargetFormat(file, outputDir, settings) {
    try {
        // Check if conversion is needed
        const inputExt = path.parse(file.path).extension.toLowerCase();
        let targetExt = inputExt;
        
        // Determine target format based on settings
        if (file.type === 'image' && settings.imageFormat && settings.imageFormat !== 'original') {
            targetExt = settings.imageFormat.startsWith('.') ? settings.imageFormat : '.' + settings.imageFormat;
        } else if (file.type === 'video' && settings.videoFormat && settings.videoFormat !== 'original') {
            targetExt = settings.videoFormat.startsWith('.') ? settings.videoFormat : '.' + settings.videoFormat;
        }
        
        // If no format change needed, return original path
        if (inputExt === targetExt) {
            console.log(`No conversion needed for ${file.name}: ${inputExt} → ${targetExt}`);
            return file.path;
        }
        
        // Create temporary conversion directory
        const tempDir = path.join(outputDir, 'temp_conversion');
        await electronAPI.mkdir(tempDir).catch(() => {}); // Ignore if already exists
        
        // Generate output path for converted file
        const baseName = path.parse(file.name).name;
        const convertedPath = path.join(tempDir, `${baseName}_converted${targetExt}`);
        
        console.log(`Converting ${file.name}: ${inputExt} → ${targetExt}`);
        console.log(`Input: ${file.path}`);
        console.log(`Output: ${convertedPath}`);
        
        // Convert file to target format
        if (file.type === 'image') {
            await convertImage(file.path, convertedPath, settings);
        } else {
            await convertVideo(file.path, convertedPath, settings);
        }
        
        console.log(`✅ Successfully converted ${file.name} to ${targetExt}`);
        return convertedPath;
        
    } catch (error) {
        console.error(`❌ Failed to convert ${file.name}:`, error);
        // Return original path if conversion fails
        return file.path;
    }
}

// Cleanup temporary conversion files
async function cleanupTempConversionFiles(outputDir) {
    try {
        const tempDir = path.join(outputDir, 'temp_conversion');
        if (await electronAPI.exists(tempDir)) {
            // Remove all files in temp directory
            const files = await electronAPI.readdir(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                await electronAPI.unlink(filePath).catch(() => {}); // Ignore errors
            }
            // Remove temp directory
            await electronAPI.rmdir(tempDir).catch(() => {}); // Ignore errors
            console.log('Cleaned up temporary conversion files');
        }
    } catch (error) {
        console.warn('Failed to cleanup temp conversion files:', error);
    }
}