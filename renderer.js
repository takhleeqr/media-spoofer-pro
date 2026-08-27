// Performance: set to true for verbose ffprobe/ffmpeg logging
const DEBUG = false;

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
// Unified mode: selectMode is a no-op (unified interface has no mode selection screen)
window.selectMode = function (mode) {
    console.log('selectMode called (no-op in unified mode)');
};

// Unified mode: goBack is a no-op (no mode selection screen to go back to)
window.goBack = function () {
    console.log('goBack called (no-op in unified mode)');
};

// UI Helper for Naming Presets
console.log('Defining updateNamingPattern function globally...');
window.updateNamingPattern = function (preset) {
    const patternInput = document.getElementById('videoNamingPattern');
    if (!patternInput) return;

    switch (preset) {
        case 'random':
            patternInput.value = 'clip_{number}';
            patternInput.disabled = true; // Let user know it's a fixed preset
            break;
        case 'original':
            patternInput.value = '{original}-{number}';
            patternInput.disabled = true;
            break;
        case 'custom':
            patternInput.disabled = false;
            // Don't change value, let user edit
            break;
    }
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

        // Return BOTH keys: `extension` (legacy shim callers) and `ext` (Node's
        // real key, used by most call sites). Missing `ext` made
        // `path.parse(name).ext` undefined, so "Keep original" output fell back to
        // an invalid ".out" extension that FFmpeg couldn't mux.
        return { name, extension, ext: extension, base: filename };
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

function toPreviewUrl(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    if (filePath.startsWith('file://')) return filePath;

    const normalizedPath = filePath.replace(/\\/g, '/');
    const fileUrl = new URL('file:///');
    fileUrl.pathname = /^[A-Za-z]:\//.test(normalizedPath)
        ? `/${normalizedPath}`
        : normalizedPath;

    return fileUrl.href;
}

function clearMediaElementSource(element) {
    if (!element) return;

    try {
        if (typeof element.pause === 'function') {
            element.pause();
        }

        element.removeAttribute('src');
        element.src = '';

        if (typeof element.load === 'function') {
            element.load();
        }
    } catch (error) {
        console.warn('Error clearing media element source:', error);
    }
}

// Unified clearPreview: hides the single preview section and both preview elements
function clearPreview(mode) {
    try {
        console.log(`Clearing preview (unified)`);
        lastShownPreviewPath = null; // allow the next showPreview to render
        const previewSection = document.getElementById('previewSection');
        if (previewSection) {
            previewSection.style.display = 'none';
        }

        const imagePreview = document.getElementById('image-preview');
        const videoPreview = document.getElementById('video-preview');
        if (imagePreview) { imagePreview.style.display = 'none'; clearMediaElementSource(imagePreview); }
        if (videoPreview) { videoPreview.style.display = 'none'; clearMediaElementSource(videoPreview); }

        const imageWatermark = document.getElementById('image-text-watermark');
        const videoWatermark = document.getElementById('video-text-watermark');
        if (imageWatermark) imageWatermark.style.display = 'none';
        if (videoWatermark) videoWatermark.style.display = 'none';

        updateNavigationButtons('media');
    } catch (error) {
        console.warn('Error clearing preview:', error);
    }
}

// Track the latest preview request to prevent race conditions
let currentPreviewRequest = null;

// Unified showPreview: automatically determines image vs video based on file extension
// Handles HEIC files by converting to temp JPEG for preview since Chromium doesn't support HEIC
function showPreview(filePath, mode) {
    try {
        // Skip if this exact file is already being previewed. Without this, the
        // repeated updateFileList() calls during processing (and the 100ms pause
        // loop) would reload the <video> and re-run HEIC conversion continuously,
        // spawning ffmpeg and piling up temp files (4.1/4.2).
        if (filePath === lastShownPreviewPath) return;
        lastShownPreviewPath = filePath;

        currentPreviewRequest = filePath; // Set current request

        console.log(`Showing preview for file:`, filePath);
        const previewSection = document.getElementById('previewSection');
        if (previewSection) {
            previewSection.style.display = 'block';
        }

        // Determine if this is an image or video based on file extension
        const ext = filePath.split('.').pop().toLowerCase();
        const imageExts = ['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'svg', 'ico', 'jfif', 'avif', 'jxl'];
        const isImage = imageExts.includes(ext);
        const isHeic = (ext === 'heic' || ext === 'heif');

        const imagePreview = document.getElementById('image-preview');
        const videoPreview = document.getElementById('video-preview');
        const previewUrl = toPreviewUrl(filePath);

        if (isImage) {
            if (videoPreview) { videoPreview.style.display = 'none'; clearMediaElementSource(videoPreview); }

            if (isHeic && imagePreview) {
                // Clear previous preview immediately to avoid confusion
                clearMediaElementSource(imagePreview);

                // HEIC is not supported by Chromium — convert to temp JPEG via FFmpeg/sips
                convertHeicForPreview(filePath).then(tempPath => {
                    // RACE CONDITION CHECK: Only update if user is still looking at this file
                    if (currentPreviewRequest !== filePath) {
                        console.log('Preview request cancelled (user switched file):', filePath);
                        return;
                    }

                    if (tempPath) {
                        imagePreview.style.display = 'block';
                        imagePreview.src = toPreviewUrl(tempPath);
                    } else {
                        // Fallback: show a placeholder message
                        imagePreview.style.display = 'block';
                        imagePreview.alt = 'HEIC preview not available';
                        clearMediaElementSource(imagePreview);
                    }
                }).catch(err => {
                    if (currentPreviewRequest !== filePath) return;
                    console.warn('HEIC preview conversion failed:', err);
                    if (imagePreview) { imagePreview.style.display = 'block'; clearMediaElementSource(imagePreview); }
                });
            } else {
                if (imagePreview) {
                    imagePreview.style.display = 'block';
                    imagePreview.src = previewUrl;
                }
            }
        } else {
            // Convert to file:// URL — raw Windows paths can crash the GPU decoder on some codecs
            if (videoPreview) {
                videoPreview.style.display = 'block';
                clearMediaElementSource(videoPreview);
                videoPreview.preload = 'metadata';
                videoPreview.removeAttribute('poster');
                videoPreview.src = previewUrl;
                videoPreview.load();
            }
            if (imagePreview) { imagePreview.style.display = 'none'; clearMediaElementSource(imagePreview); }

            // Some videos (HEVC/H.265 — e.g. Pixel .TS.mp4) can't be decoded by the
            // built-in player and render as a black box. Generate an ffmpeg poster
            // frame: use it as the <video> poster for playable clips, and swap to a
            // still image if the video can't paint a frame at all.
            const usePosterImage = async () => {
                if (currentPreviewRequest !== filePath) return;
                const poster = await generateVideoPoster(filePath);
                if (currentPreviewRequest !== filePath || !poster) return;
                const purl = toPreviewUrl(poster);
                if (imagePreview) { imagePreview.style.display = 'block'; imagePreview.src = purl; }
                if (videoPreview) videoPreview.style.display = 'none';
                if (typeof refreshPreviewGeometry === 'function') setTimeout(refreshPreviewGeometry, 60);
            };
            if (videoPreview) {
                videoPreview.addEventListener('error', usePosterImage, { once: true });
                generateVideoPoster(filePath).then(poster => {
                    if (currentPreviewRequest === filePath && poster && videoPreview) {
                        videoPreview.setAttribute('poster', toPreviewUrl(poster));
                    }
                });
                // Backup: an undecodable clip can load metadata yet never paint —
                // if there's still no frame size shortly after, fall back to the image.
                setTimeout(() => {
                    if (currentPreviewRequest === filePath && videoPreview &&
                        videoPreview.style.display !== 'none' && !videoPreview.videoWidth) {
                        usePosterImage();
                    }
                }, 1500);
            }
        }

        updateNavigationButtons('media');
    } catch (error) {
        console.warn('Error showing preview:', error);
    }
}

// Helper to identify the best video stream (largest resolution) in a HEIC file
// This avoids selecting low-res depth maps or gain maps which result in B/W output
async function getBestHeicStreamMap(filePath) {
    if (!ffprobePath) return '0:v:0'; // Fallback

    try {
        // Probe all video streams to find the largest one
        const result = await electronAPI.spawnProcess(ffprobePath, [
            '-v', 'error',
            '-show_entries', 'stream=index,width,height,pix_fmt,bit_rate,max_bit_rate,disposition:stream_tags=handler_name,variant_bitrate',
            '-select_streams', 'v',
            '-of', 'json',
            filePath
        ]);

        if (result.code !== 0) return '0:v:0';

        const data = JSON.parse(result.stdout);
        if (!data.streams || data.streams.length === 0) return '0:v:0';

        // Multi-level filtering to find the TRUE primary image

        // 1. Filter out obvious non-color formats (keep yuv, rgb, etc.)
        const isLikelyColor = (s) => !s.pix_fmt || (!s.pix_fmt.includes('gray') && !s.pix_fmt.includes('monowhite'));
        let candidates = data.streams.filter(isLikelyColor);

        if (candidates.length === 0) candidates = data.streams; // Fallback

        // 2. Score candidates based on metadata and resolution
        const scoreStream = (s) => {
            let score = (s.width || 0) * (s.height || 0); // Base score: Resolution

            // Penalty for auxiliary streams (Depth, GainMap, etc.)
            // Check handler_name in tags
            if (s.tags && s.tags.handler_name) {
                const handler = s.tags.handler_name.toLowerCase();
                if (handler.includes('depth') || handler.includes('aux') || handler.includes('gain') || handler.includes('transparency')) {
                    console.log(`[HEIC] Deprioritizing stream #${s.index} (Handler: ${s.tags.handler_name})`);
                    score -= 10000000; // Massive penalty
                }
            }

            // Bonus for "default" disposition (often set on primary item)
            if (s.disposition && s.disposition.default === 1) {
                score += 1000000; // Big bonus
            }

            // Tie-breaker: Bitrate / Data size
            // Depth maps are smooth -> low bitrate. Photos are complex -> high bitrate.
            const bitrate = parseInt(s.bit_rate || s.max_bit_rate || s.tags?.variant_bitrate || '0');
            if (bitrate > 0) {
                score += bitrate / 1000; // Small weight to break resolution ties
            }

            return score;
        };

        // Find stream with highest score
        let bestStream = candidates[0];
        let maxScore = -Infinity;

        for (const s of candidates) {
            const score = scoreStream(s);
            if (score > maxScore) {
                maxScore = score;
                bestStream = s;
            }
        }

        console.log(`[HEIC] Smart selection: Stream #${bestStream.index} (${bestStream.width}x${bestStream.height}, ${bestStream.pix_fmt}) selected. Handler: ${bestStream.tags?.handler_name || 'N/A'}`);
        return `0:${bestStream.index}`;

    } catch (e) {
        console.warn('[HEIC] Probe failed, fallback to 0:v:0', e);
        return '0:v:0';
    }
}

// Robust cross-platform HEIC to JPEG conversion
// macOS: uses sips (handles all HEIC variants including tiled/tmap)
// Windows: uses FFmpeg with careful stream selection
async function convertHeicToTemp(heicPath, purpose = 'processing') {
    try {
        // Decode a HEIC only once per run — reuse it across duplicates instead of
        // re-decoding (and leaking a new temp) every time.
        if (purpose === 'processing' && heicProcessCache.has(heicPath)) {
            const c = heicProcessCache.get(heicPath);
            if (c && await electronAPI.exists(c)) return c;
            heicProcessCache.delete(heicPath);
        }
        const baseName = heicPath.split('/').pop().split('\\').pop().replace(/\.heic$/i, '').replace(/\.heif$/i, '');
        const platform = await electronAPI.getPlatform();

        // Get temp directory from OS
        const tempDir = await electronAPI.getTempDir();
        // Use path.join via simple string concat if path module not fully available, but we use path.join below


        // Use nanoseconds/random to prevent collision in fast batches
        const uniqueSuffix = Date.now() + '_' + Math.floor(Math.random() * 10000);
        const tempFilename = `temp_${uniqueSuffix}_${baseName}.jpg`;
        const tempJpegPath = path.join(tempDir, tempFilename);

        // macOS: Use native 'sips' tool.
        // WHY?
        // 1. sips correctly handles the "Tile Grid" stitching (tmap) which FFmpeg fails at (Yellow Image).
        // 2. sips produces a JPEG that looks correct in Chrome (Preview works).
        // 3. sips DOES preserve the Depth Map in the JPEG metadata/streams.
        //    - Use -map 0:v:0 in FFmpeg (processImageSpoof) to ignore it during export.
        if (platform === 'darwin') {
            const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', heicPath, '--out', tempJpegPath];
            console.log(`[HEIC] macOS sips: Converting ${path.basename(heicPath)}`);

            const result = await electronAPI.spawnProcess('sips', args);

            if (result.code !== 0) {
                console.error('[HEIC] sips conversion failed:', result.stderr);
                // STRICT MODE: Do NOT fallback to FFmpeg.
                // FFmpeg on macOS produces Yellow/B&W images for Tiled HEIC.
                // We must rely on sips. If sips fails, we abort.
                throw new Error(`Native macOS conversion failed: ${result.stderr || 'Unknown sips error'}`);
            } else {
                console.log('[HEIC] sips conversion successful:', tempJpegPath);
                if (purpose === 'processing') { heicProcessCache.set(heicPath, tempJpegPath); }
                heicTempFiles.push(tempJpegPath);
                return tempJpegPath;
            }
        }

        // Windows/Linux: Use FFmpeg with Smart Stream Scoring
        console.log(`[HEIC] Converting ${heicPath} to ${tempJpegPath} using FFmpeg (Smart Scoring)...`);

        // Use FFmpeg on ALL platforms to ensure consistent behavior and stream selection
        // -map 0:v:0 forces the first video stream (COLOR), ignoring depth maps/gain maps (B/W)
        if (!ffmpegPath) {
            console.warn('[HEIC] FFmpeg path not initialized');
            return null;
        }

        // SMART SELECTION: Identify the correct video stream based on resolution
        // This handles cases where the main image is NOT the first stream (e.g. some Live Photos)
        const streamMap = await getBestHeicStreamMap(heicPath);
        console.log(`[HEIC] Using stream map: ${streamMap}`);

        const args = [
            '-y',
            '-i', heicPath,
            '-map', streamMap, // Dynamic selection
            '-q:v', '2',     // High quality JPEG
            '-update', '1',  // Force image update
            tempJpegPath
        ];

        await electronAPI.spawnProcess(ffmpegPath, args);
        console.log('[HEIC] FFmpeg conversion successful:', tempJpegPath);

        if (purpose === 'processing') { heicProcessCache.set(heicPath, tempJpegPath); }
        heicTempFiles.push(tempJpegPath);
        return tempJpegPath;
    } catch (error) {
        console.warn(`[HEIC] Conversion failed for ${purpose}:`, error.message || error);
        return null;
    }
}

// Convert HEIC to temp JPEG for preview display (wrapper).
// Cached by source path so re-previewing the same file doesn't re-run ffmpeg/sips
// or create a new temp file each time (4.1).
async function convertHeicForPreview(heicPath) {
    if (heicPreviewCache.has(heicPath)) {
        const cached = heicPreviewCache.get(heicPath);
        if (cached && await electronAPI.exists(cached)) return cached;
        heicPreviewCache.delete(heicPath); // temp was cleaned up; regenerate
    }
    const tempPath = await convertHeicToTemp(heicPath, 'preview');
    if (tempPath) heicPreviewCache.set(heicPath, tempPath);
    return tempPath;
}

// Extract one representative frame from a video as a temp JPG, so codecs the
// built-in player can't decode (e.g. HEVC/H.265 from Pixel .TS.mp4) still show a
// thumbnail instead of a black box. Cached per source path; concurrent calls share
// one ffmpeg run (the map holds the in-flight promise).
async function generateVideoPoster(videoPath) {
    if (videoPosterCache.has(videoPath)) {
        const prev = await videoPosterCache.get(videoPath);
        if (prev && await electronAPI.exists(prev)) return prev;
        videoPosterCache.delete(videoPath);
    }
    const job = (async () => {
        try {
            if (!ffmpegPath) return null;
            const tempDir = await electronAPI.getTempDir();
            const base = (videoPath.split(/[\\/]/).pop() || 'video').replace(/\.[^.]+$/, '');
            const uniq = Date.now() + '_' + Math.floor(Math.random() * 10000);
            const out = path.join(tempDir, `poster_${uniq}_${base}.jpg`);
            // Seek to 1s for a non-black frame; fall back to the first frame on very
            // short clips. ffmpeg auto-rotates, so the poster matches the true shape.
            const grab = async (ss) => {
                // Apply display-normalization so an anamorphic clip's poster shows
                // its true (portrait) shape — not the squished coded frame — and its
                // dimensions match the crop overlay.
                try { await spawnFFmpeg(['-y', '-ss', String(ss), '-i', videoPath, '-frames:v', '1', '-vf', SAR_NORMALIZE, '-q:v', '3', out]); } catch (e) { /* keep going */ }
                return await electronAPI.exists(out);
            };
            let ok = await grab(1);
            if (!ok) ok = await grab(0);
            if (ok) { videoPreviewTempFiles.push(out); return out; }
        } catch (e) { console.warn('Video poster generation failed:', e); }
        return null;
    })();
    videoPosterCache.set(videoPath, job);
    const res = await job;
    if (!res) videoPosterCache.delete(videoPath);
    return res;
}

// Helper function to spawn FFmpeg process securely
async function spawnFFmpeg(command) {
    try {
        if (DEBUG) console.log('Spawning FFmpeg with command:', command);

        const result = await electronAPI.spawnProcess(ffmpegPath, command);
        if (DEBUG) console.log('FFmpeg process completed successfully');
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
let currentMode = 'unified'; // unified mode: both image and video
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
let appReady = false;

// Output-path bookkeeping (prevents clips/files silently overwriting each other,
// and lets a retry clean up the partial output from its failed attempt).
let usedOutputPaths = new Set();   // every path handed out this run (lowercased)
let attemptOutputs = [];           // paths created during the current file attempt
let systemFontPath = null;         // resolved TTF path for watermark text (per-platform)
let hwEncoder = null;              // detected hardware H.264 encoder (e.g. 'h264_qsv') or null
let elapsedBeforePause = 0;        // accumulated seconds across pause/resume
let lastShownPreviewPath = null;   // guard so we don't reload/re-convert the same preview
const heicPreviewCache = new Map(); // source HEIC path -> converted temp JPEG (preview)
const videoPosterCache = new Map(); // source video path -> Promise<temp JPG poster | null>
let videoPreviewTempFiles = [];     // poster JPGs made for previews, for cleanup
const heicProcessCache = new Map(); // source HEIC path -> temp JPEG (processing, per run)
let heicTempFiles = [];             // all HEIC temp JPEGs created this run, for cleanup
let appInitializationPromise = Promise.resolve();
let imageInterfaceSetup = false;
let videoInterfaceSetup = false;

// Cross-platform FFmpeg paths
let ffmpegPath, ffprobePath;

// Probe caches (videoDurationCache and videoDARCache kept for backward compat)
const videoDurationCache = new Map();
const videoDARCache = new Map();

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

    // Resolve a font file for watermark text. drawtext needs an explicit fontfile
    // on Windows because the bundled ffmpeg has no fontconfig — without this the
    // watermark makes the whole file fail (F9).
    try {
        const fontCandidates = platform === 'win32'
            ? ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/tahoma.ttf', 'C:/Windows/Fonts/verdana.ttf']
            : platform === 'darwin'
                ? ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']
                : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'];
        for (const f of fontCandidates) {
            if (await electronAPI.exists(f)) { systemFontPath = f; break; }
        }
        console.log('Watermark font resolved to:', systemFontPath || 'NONE FOUND');
    } catch (e) {
        console.warn('Watermark font resolution failed:', e.message);
    }

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

    // Detect a working hardware H.264 encoder (QuickSync etc.) for fast shrinking.
    // Runs AFTER ffmpegPath is finalized. We verify by actually encoding a tiny
    // clip — a build listing an encoder doesn't guarantee the GPU/driver runs it.
    if (ffmpegExists) {
        try {
            const hwCandidates = ['h264_qsv', 'h264_nvenc', 'h264_amf', 'h264_mf'];
            for (const enc of hwCandidates) {
                try {
                    const r = await electronAPI.spawnProcess(ffmpegPath, [
                        '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=128x128:rate=15:duration=1',
                        '-c:v', enc, '-f', 'null', '-'
                    ]);
                    if (r && r.code === 0) { hwEncoder = enc; break; }
                } catch (e) { /* encoder unavailable on this machine — try next */ }
            }
            console.log('Hardware encoder:', hwEncoder || 'none (CPU only)');
        } catch (e) {
            console.warn('Hardware encoder detection failed:', e.message);
        }
    }
}

// Initialize app — Unified Interface (no mode selection screen)
document.addEventListener('DOMContentLoaded', async () => {
    appInitializationPromise = (async () => {
    console.log('DOM loaded, initializing unified interface...');

    // Wait a bit to ensure everything is fully loaded
    await new Promise(resolve => setTimeout(resolve, 100));

    // Initialize DOM elements (unified)
    processSection = document.getElementById('processSection');

    // Check if electronAPI is available
    if (!window.electronAPI) {
        console.error('electronAPI is not available!');
        alert('Error: electronAPI not available. Please restart the application.');
        return;
    }

    setMediaLoadingEnabled(false);

    // ── STEP 1: Wire up the UI immediately so buttons always work ──────────
    try {
        setupUnifiedInterface();
        console.log('setupUnifiedInterface() completed OK');
    } catch (uiErr) {
        console.error('setupUnifiedInterface() CRASHED:', uiErr);
    }
    try { setupPreviewKeyboardNavigation(); } catch(e) { console.error('setupPreviewKeyboardNavigation crashed:', e); }
    try { updateNavigationButtons('media'); } catch(e) { console.error('updateNavigationButtons crashed:', e); }

    // ── STEP 2: Detect FFmpeg paths in the background ─────────────────────
    try {
        await initializeFFmpegPaths();
        await checkFFmpegInstallation();
    } catch (ffErr) {
        console.warn('FFmpeg path detection failed (non-fatal):', ffErr.message || ffErr);
    }

    appReady = true;
    setMediaLoadingEnabled(true);
    console.log('Unified application initialized successfully');
    })();

    await appInitializationPromise;
});

// ── Renderer error catcher: writes to crash.log before the window dies ────
window.onerror = function(msg, src, line, col, err) {
    const text = `${msg}\n  at ${src}:${line}:${col}\n${err?.stack || ''}`;
    console.error('WINDOW.ONERROR:', text);
    try { window.electronAPI?.writeCrashLog(text); } catch(e) {}
};
window.onunhandledrejection = function(event) {
    const text = `Unhandled Promise Rejection: ${event.reason?.stack || event.reason}`;
    console.error('UNHANDLEDREJECTION:', text);
    try { window.electronAPI?.writeCrashLog(text); } catch(e) {}
};

// setupModeSelectionEventListeners is a no-op in unified mode
function setupModeSelectionEventListeners() {
    console.log('Mode selection event listeners skipped (unified mode)');
}

// Setup keyboard navigation for preview
function setupPreviewKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        if (selectedFiles.length === 0) return;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                navigatePreview('media', 'prev');
                break;
            case 'ArrowRight':
                e.preventDefault();
                navigatePreview('media', 'next');
                break;
            case 'Home':
                e.preventDefault();
                navigatePreview('media', 'home');
                break;
            case 'End':
                e.preventDefault();
                navigatePreview('media', 'end');
                break;
        }
    });
}

// Check if FFmpeg is available
async function checkFFmpegInstallation() {
    if (!ffmpegPath || !ffprobePath) {
        console.warn('FFmpeg paths are not ready yet.');
        return;
    }

    const ffmpegExists = await electronAPI.exists(ffmpegPath);
    const ffprobeExists = await electronAPI.exists(ffprobePath);

    if (!ffmpegExists || !ffprobeExists) {
        console.warn('FFmpeg not found. Please ensure ffmpeg and ffprobe are in the app folder.');
    }
}

function setMediaLoadingEnabled(enabled) {
    const mediaDropZone = document.getElementById('mediaDropZone');
    const selectFilesBtn = document.getElementById('selectFilesBtn');
    const selectFolderBtn = document.getElementById('selectFolderBtn');

    if (selectFilesBtn) selectFilesBtn.disabled = !enabled;
    if (selectFolderBtn) selectFolderBtn.disabled = !enabled;

    if (mediaDropZone) {
        mediaDropZone.style.pointerEvents = enabled ? '' : 'none';
        mediaDropZone.style.opacity = enabled ? '' : '0.65';
    }
}

async function ensureAppReady() {
    try {
        await appInitializationPromise;
    } catch (error) {
        console.warn('App initialization failed:', error);
        return false;
    }

    return appReady;
}

// ============================================================
// UNIFIED INTERFACE SETUP
// Replaces setupModeSelection, setupImageInterface, setupVideoInterface
// ============================================================
// Associate every setting <label> with its control so clicking the label focuses
// the control and screen readers announce the pairing (F4). Done in JS to avoid
// hand-editing dozens of markup lines.
function associateLabels() {
    document.querySelectorAll('.setting-item, .checkbox-item, .bulk-rename-section .setting-item').forEach(item => {
        const label = item.querySelector('label:not([for])');
        const control = item.querySelector('select, input, textarea');
        if (label && control && control.id) label.htmlFor = control.id;
    });
}

// ===== COMPOSE UI =====
// The new "pick an output + stack options" panel is a friendly front-end that
// writes its choices into the existing (now hidden) controls, so the processing
// engine, settings reader and frame-extractor keep working unchanged.
let _cxLastMode = null;
function setV(id, val) { const el = document.getElementById(id); if (el && el.value !== undefined) el.value = val; }
function setC(id, on) { const el = document.getElementById(id); if (el) el.checked = !!on; }

function syncComposeToLegacy() {
    const outSel = document.querySelector('#cxOutput .o.on');
    const output = outSel ? outSel.getAttribute('data-out') : 'one';
    const isOn = (card) => { const c = document.querySelector(`.cx-c[data-card="${card}"]`); return c && c.classList.contains('on'); };
    const val = (id, d) => { const el = document.getElementById(id); return el ? el.value : d; };

    const makeUnique = isOn('unique');

    // Make-unique strength + copies
    setV('videoIntensity', val('cxIntensity', 'medium'));
    setV('imageIntensity', val('cxIntensity', 'medium'));
    setV('videoDuplicates', val('cxCopies', '1'));
    setV('imageDuplicates', val('cxCopies', '1'));

    // Shrink / compress
    setC('compressEnabled', isOn('shrink'));
    setV('compressSpeed', val('cxSpeed', 'fast'));
    setV('compressLevel', val('cxSqueeze', '2'));
    setV('resolution', val('cxRes', 'keep'));

    // Mirror
    setV('videoMirror', isOn('mirror') ? val('cxMirror', 'h') : 'none');

    // Remove audio
    setC('removeAudio', isOn('mute'));

    // Reframe / orientation
    setV('videoOrientation', isOn('reframe') ? val('cxOrient', 'auto') : 'auto');

    // Watermark (mirror into both video + image legacy fields)
    const wmOn = isOn('watermark');
    setC('videoWatermarkEnabled', wmOn); setC('imageWatermarkEnabled', wmOn);
    setV('videoWatermarkText', val('cxWmText', '')); setV('imageWatermarkText', val('cxWmText', ''));
    setV('videoWatermarkPosition', val('cxWmPos', 'bottom-right')); setV('imageWatermarkPosition', val('cxWmPos', 'bottom-right'));

    // Metadata
    setV('metadataMode', val('cxMeta', 'spoof'));
    setV('imageMetadataMode', val('cxMeta', 'spoof'));

    // Format + naming
    setV('videoFormat', val('cxFormat', 'original'));
    setV('imageFormat', val('cxFormat', 'original'));
    // "Keep original name" → empty pattern, which makes generateOutputPathForBatch
    // use the source's own name verbatim (clips still get _001, extra copies -2…).
    const keepName = !!(document.getElementById('cxKeepName') && document.getElementById('cxKeepName').checked);
    const namePattern = keepName ? '' : val('cxNaming', '{original}_{number}');
    setV('videoNamingPattern', namePattern);
    setV('imageNamingPattern', namePattern);
    const nameInput = document.getElementById('cxNaming');
    if (nameInput) { nameInput.disabled = keepName; nameInput.style.opacity = keepName ? '0.45' : '1'; }

    // Derive the processing mode from output + make-unique.
    let vMode;
    if (output === 'frames') vMode = 'extract-frames';
    else if (output === 'audio') vMode = 'extract-audio';
    else if (output === 'thumb') vMode = 'thumbnail';
    else if (output === 'gif') vMode = 'gif';
    else if (output === 'split') vMode = makeUnique ? 'spoof-split' : 'split-only';
    else vMode = makeUnique ? 'spoof-only' : 'convert-only';
    const iMode = makeUnique ? 'spoof-only' : 'convert-only';
    setV('imageProcessingMode', iMode);

    const vSel = document.getElementById('videoProcessingMode');
    if (vSel) {
        vSel.value = vMode;
        // Only fire change (which drives the frame-extractor + legacy visibility)
        // when the mode actually changes, to avoid thrashing.
        if (vMode !== _cxLastMode) {
            _cxLastMode = vMode;
            vSel.dispatchEvent(new Event('change'));
        }
    }
    updateComposeSummary(output, makeUnique);
    // Toggling the Crop card (or any change) refreshes its live preview overlay.
    if (typeof updateCropOverlay === 'function') updateCropOverlay();
}

function updateComposeSummary(output, makeUnique) {
    const isOn = (card) => { const c = document.querySelector(`.cx-c[data-card="${card}"]`); return c && c.classList.contains('on'); };
    const copies = parseInt((document.getElementById('cxCopies') || {}).value || '1') || 1;
    const parts = [];
    if (output === 'frames') { const s = document.getElementById('cxSummary'); if (s) s.textContent = 'Extract still frames from each video (see the frame settings below).'; return; }
    if (output === 'audio') { const s = document.getElementById('cxSummary'); if (s) s.textContent = 'Save each video’s audio track as an MP3.'; return; }
    if (output === 'thumb') { const s = document.getElementById('cxSummary'); if (s) s.textContent = 'Grab one cover frame from each video as a JPG.'; return; }
    if (output === 'gif') { const s = document.getElementById('cxSummary'); if (s) s.textContent = 'Turn each video into an animated GIF.'; return; }
    let noun = output === 'split' ? 'set of clips' : 'file';
    let lead = makeUnique ? `<b>${copies > 1 ? copies + ' unique copies' : '1 unique copy'}</b> of each ${output === 'split' ? 'video (split into clips)' : 'file'}` :
        (output === 'split' ? 'each video <b>split into clips</b>' : 'a processed <b>copy</b> of each file');
    parts.push(lead);
    if (isOn('crop')) parts.push('<b>cropped</b>');
    if (isOn('shrink')) parts.push('<b>shrunk</b>');
    if (isOn('mirror')) parts.push('<b>mirrored</b>');
    if (isOn('rotate')) parts.push('<b>rotated</b>');
    if (isOn('speed')) parts.push('<b>speed-changed</b>');
    if (isOn('trim')) parts.push('<b>trimmed</b>');
    if (isOn('loop')) parts.push('<b>looped</b>');
    if (isOn('mute')) parts.push('<b>muted</b>');
    if (isOn('reframe')) parts.push('<b>reframed</b>');
    if (isOn('watermark')) parts.push('<b>watermarked</b>');
    if (isOn('logo')) parts.push('<b>logo-stamped</b>');
    if (isOn('music')) parts.push('<b>new music</b>');
    const meta = (document.getElementById('cxMeta') || {}).value;
    if (meta === 'spoof') parts.push('with realistic phone metadata');
    const s = document.getElementById('cxSummary');
    if (s) s.innerHTML = 'You’ll get ' + parts.join(', ') + '.';
}

// Intrinsic (displayed) pixel size of whichever preview media is visible.
function getPreviewMediaDims() {
    const img = document.getElementById('image-preview');
    const vid = document.getElementById('video-preview');
    if (vid && vid.style.display !== 'none' && vid.videoWidth) return { w: vid.videoWidth, h: vid.videoHeight };
    if (img && img.style.display !== 'none' && img.naturalWidth) return { w: img.naturalWidth, h: img.naturalHeight };
    return null;
}

// Size the preview box to the media's true shape so landscape videos get a wide
// box and portrait a tall one — instead of everything squeezed into a fixed
// portrait frame. Fills the column width, capped by a max height.
function updatePreviewSize() {
    const wrap = document.querySelector('.preview-wrapper');
    if (!wrap) return;
    const dims = getPreviewMediaDims();
    if (!dims || !dims.w || !dims.h) return;
    const container = wrap.parentElement; // .preview-container
    const availW = Math.max(160, (container && container.clientWidth) || 300);
    const maxH = 440;
    let w = availW, h = w * dims.h / dims.w;
    if (h > maxH) { h = maxH; w = h * dims.w / dims.h; }
    wrap.style.width = Math.round(w) + 'px';
    wrap.style.height = Math.round(h) + 'px';
}

// Preview media became ready or the window resized — refit the box AND the crop
// overlay (which measures the box).
function refreshPreviewGeometry() {
    updatePreviewSize();
    if (typeof updateCropOverlay === 'function') updateCropOverlay();
}

// Redraw the live crop overlay: dim the trimmed edges, outline what stays, and
// show the resulting output size — mapped from source pixels onto the preview,
// which is object-fit:contain (letterboxed), so we compute the media's real rect.
function updateCropOverlay() {
    const overlay = document.getElementById('cropOverlay');
    if (!overlay) return;
    const wrapper = overlay.parentElement;
    const cropCard = document.querySelector('.cx-c[data-card="crop"]');
    const on = cropCard && cropCard.classList.contains('on');
    const info = document.getElementById('cxCropInfo');
    const dims = getPreviewMediaDims();

    if (!on || !dims) {
        overlay.style.display = 'none';
        if (on && info) info.textContent = 'Add a video, then type pixels to trim — the preview shows what stays.';
        return;
    }

    const mw = dims.w, mh = dims.h, MINKEEP = 16;
    const gv = id => Math.max(0, parseInt((document.getElementById(id) || {}).value) || 0);
    let t = gv('cxCropTop'), b = gv('cxCropBottom'), l = gv('cxCropLeft'), r = gv('cxCropRight');
    // Clamp for display so the kept box can't invert.
    t = Math.min(t, mh - MINKEEP); b = Math.min(b, Math.max(0, mh - MINKEEP - t));
    l = Math.min(l, mw - MINKEEP); r = Math.min(r, Math.max(0, mw - MINKEEP - l));
    t = Math.max(0, t); b = Math.max(0, b); l = Math.max(0, l); r = Math.max(0, r);

    const ww = wrapper.clientWidth, wh = wrapper.clientHeight;
    const scale = Math.min(ww / mw, wh / mh);
    const rw = mw * scale, rh = mh * scale;
    const ox = (ww - rw) / 2, oy = (wh - rh) / 2;
    const tp = t * scale, bp = b * scale, lp = l * scale, rp = r * scale;
    const shade = 'rgba(8,10,18,.60)';
    const set = (id, css) => { const el = document.getElementById(id); if (el) el.style.cssText = css; };
    set('cropBandTop', `position:absolute;left:${ox}px;top:${oy}px;width:${rw}px;height:${tp}px;background:${shade};`);
    set('cropBandBottom', `position:absolute;left:${ox}px;top:${oy + rh - bp}px;width:${rw}px;height:${bp}px;background:${shade};`);
    set('cropBandLeft', `position:absolute;left:${ox}px;top:${oy + tp}px;width:${lp}px;height:${rh - tp - bp}px;background:${shade};`);
    set('cropBandRight', `position:absolute;left:${ox + rw - rp}px;top:${oy + tp}px;width:${rp}px;height:${rh - tp - bp}px;background:${shade};`);
    set('cropKeep', `position:absolute;left:${ox + lp}px;top:${oy + tp}px;width:${rw - lp - rp}px;height:${rh - tp - bp}px;border:1.5px solid #6a5af9;box-shadow:0 0 0 1px rgba(255,255,255,.55);`);
    overlay.style.display = 'block';
    if (info) info.textContent = `Source ${mw}×${mh} → Result ${mw - l - r}×${mh - t - b}`;
}

// On blur, snap any over-crop back to a value that keeps ≥16px on that axis.
function clampCropInputs() {
    const dims = getPreviewMediaDims();
    if (!dims) return;
    const MINKEEP = 16;
    const clamp = (id, max) => { const el = document.getElementById(id); if (!el) return; let v = Math.max(0, parseInt(el.value) || 0); if (v > max) el.value = max; };
    clamp('cxCropTop', dims.h - MINKEEP); clamp('cxCropBottom', dims.h - MINKEEP);
    clamp('cxCropLeft', dims.w - MINKEEP); clamp('cxCropRight', dims.w - MINKEEP);
}

function setupComposeUI() {
    const compose = document.getElementById('composeUI');
    if (!compose) return;

    // Crop card: wire the 4 inputs + preview-media load events to the live overlay.
    ['cxCropTop', 'cxCropBottom', 'cxCropLeft', 'cxCropRight'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', updateCropOverlay);
            el.addEventListener('change', () => { clampCropInputs(); updateCropOverlay(); });
        }
    });
    const vp = document.getElementById('video-preview');
    const ip = document.getElementById('image-preview');
    if (vp) vp.addEventListener('loadedmetadata', refreshPreviewGeometry);
    if (ip) ip.addEventListener('load', refreshPreviewGeometry);
    window.addEventListener('resize', refreshPreviewGeometry);

    // Buttery scrolling: flag the body while the page is actively scrolling so the
    // CSS can suspend hover-lifts/transitions that would otherwise repaint under
    // the cursor and stutter the scroll. Cleared shortly after scrolling stops.
    let _scrollIdle;
    const onScroll = () => {
        document.body.classList.add('is-scrolling');
        clearTimeout(_scrollIdle);
        _scrollIdle = setTimeout(() => document.body.classList.remove('is-scrolling'), 140);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });

    // Move the frame-extractor panel INTO the compose options column so it flows
    // below the output selector when "Extract frames" is chosen (no overlap).
    const fxPanel = document.getElementById('fxPanel');
    const legacy = document.getElementById('legacySettings');
    if (fxPanel && compose) {
        try { compose.appendChild(fxPanel); } catch (e) { /* ignore */ }
    }
    // Move the activity log into the workspace grid so it picks up the new panel
    // styling and its grid slot (and clears the fixed action bar).
    const ui = document.getElementById('unifiedInterface');
    const logSec = document.getElementById('activityLogSection');
    if (ui && logSec && logSec.parentNode !== ui) {
        try { ui.appendChild(logSec); } catch (e) { /* ignore */ }
    }
    // Lift the stats row out of the fixed action bar to the top of the workspace.
    const stats = document.getElementById('statsGrid');
    if (ui && stats && stats.parentNode !== ui) {
        try { ui.insertBefore(stats, ui.firstChild); } catch (e) { /* ignore */ }
    }
    if (legacy) legacy.style.display = 'none';

    // Platform presets — a macro that flips on Reframe and sets shape + format.
    const PLATFORM_PRESETS = {
        tiktok:  { orient: 'portrait-blur', format: 'mp4' },
        reels:   { orient: 'portrait-blur', format: 'mp4' },
        shorts:  { orient: 'portrait-blur', format: 'mp4' },
        youtube: { orient: 'landscape-blur', format: 'mp4' },
    };
    const platformSel = document.getElementById('cxPlatform');
    if (platformSel) {
        platformSel.addEventListener('change', () => {
            const p = PLATFORM_PRESETS[platformSel.value];
            const reframeCard = document.querySelector('.cx-c[data-card="reframe"]');
            if (platformSel.value === 'none') {
                if (reframeCard) reframeCard.classList.remove('on');
            } else if (p) {
                if (reframeCard) reframeCard.classList.add('on');
                const o = document.getElementById('cxOrient'); if (o) o.value = p.orient;
                const f = document.getElementById('cxFormat'); if (f) f.value = p.format;
            }
            syncComposeToLegacy();
        });
    }

    // File pickers for logo overlay + replace-audio
    const logoPick = document.getElementById('cxLogoPick');
    if (logoPick) logoPick.addEventListener('click', async () => {
        try {
            const paths = await electronAPI.selectFiles([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]);
            if (paths && paths[0]) {
                window._morphLogoPath = paths[0];
                const n = document.getElementById('cxLogoName'); if (n) n.textContent = paths[0].split(/[\\/]/).pop();
                const c = document.querySelector('.cx-c[data-card="logo"]'); if (c) c.classList.add('on');
                syncComposeToLegacy();
            }
        } catch (e) { console.warn('logo pick failed', e); }
    });
    const musicPick = document.getElementById('cxMusicPick');
    if (musicPick) musicPick.addEventListener('click', async () => {
        try {
            const paths = await electronAPI.selectFiles([{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'] }]);
            if (paths && paths[0]) {
                window._morphMusicPath = paths[0];
                const n = document.getElementById('cxMusicName'); if (n) n.textContent = paths[0].split(/[\\/]/).pop();
                const c = document.querySelector('.cx-c[data-card="music"]'); if (c) c.classList.add('on');
                syncComposeToLegacy();
            }
        } catch (e) { console.warn('music pick failed', e); }
    });

    // Output segmented control
    document.querySelectorAll('#cxOutput .o').forEach(o => {
        o.addEventListener('click', () => {
            document.querySelectorAll('#cxOutput .o').forEach(x => x.classList.remove('on'));
            o.classList.add('on');
            const out = o.getAttribute('data-out');
            // Options don't apply to frame/audio extraction; hide the options step.
            const optStep = document.getElementById('cxOptionsStep');
            const fxNote = document.getElementById('cxFxNote');
            const noOpts = (out === 'frames' || out === 'audio' || out === 'thumb' || out === 'gif');
            if (optStep) optStep.style.display = noOpts ? 'none' : 'block';
            if (fxNote) fxNote.style.display = out === 'frames' ? 'block' : 'none';
            syncComposeToLegacy();
        });
    });

    // Card toggles (skip static cards that are always on)
    document.querySelectorAll('.cx-c:not(.static) .cx-ch').forEach(h => {
        h.addEventListener('click', () => { h.closest('.cx-c').classList.toggle('on'); syncComposeToLegacy(); });
    });

    // Any control change re-syncs
    compose.querySelectorAll('select, input').forEach(el => {
        el.addEventListener('change', syncComposeToLegacy);
        el.addEventListener('input', syncComposeToLegacy);
    });

    syncComposeToLegacy();
}

function setupUnifiedInterface() {
    console.log('Setting up unified interface...');
    associateLabels();
    setupComposeUI();

    // Show/hide the shrink controls with the checkbox.
    const compressEnabled = document.getElementById('compressEnabled');
    const compressControls = document.getElementById('compressControls');
    if (compressEnabled && compressControls) {
        const sync = () => { compressControls.style.display = compressEnabled.checked ? 'block' : 'none'; };
        compressEnabled.addEventListener('change', sync);
        sync();
    }

    // --- Unified drop zone & buttons ---
    const mediaDropZone = document.getElementById('mediaDropZone');
    const selectFilesBtn = document.getElementById('selectFilesBtn');
    const selectFolderBtn = document.getElementById('selectFolderBtn');
    const clearFilesBtn = document.getElementById('clearFilesBtn');

    // Unified file select (accepts all media types)
    if (selectFilesBtn) {
        selectFilesBtn.addEventListener('click', () => {
            console.log('Select Files button clicked (unified)');
            selectFiles('mixed');
        });
    }

    // Unified folder select
    if (selectFolderBtn) {
        selectFolderBtn.addEventListener('click', () => {
            console.log('Select Folder button clicked (unified)');
            selectFolder('mixed');
        });
    }

    // Clear all files
    if (clearFilesBtn) {
        clearFilesBtn.addEventListener('click', () => {
            console.log('Clear Files button clicked');
            clearFiles();
        });
    }

    // Unified drag & drop
    if (mediaDropZone) {
        mediaDropZone.addEventListener('click', () => {
            console.log('Media drop zone clicked');
            selectFiles('mixed');
        });
        // Keyboard operable: Enter/Space opens the file browser (F6).
        mediaDropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectFiles('mixed');
            }
        });
        mediaDropZone.addEventListener('dragover', handleDragOver);
        mediaDropZone.addEventListener('dragleave', handleDragLeave);
        mediaDropZone.addEventListener('drop', (e) => handleDrop(e, 'mixed'));
    }

    // --- Set default values for both panels ---
    const imgDup = document.getElementById('imageDuplicates');
    const imgInt = document.getElementById('imageIntensity');
    if (imgDup) imgDup.value = 1;
    if (imgInt) imgInt.value = 'medium';

    const vidMode = document.getElementById('videoProcessingMode');
    const vidDup = document.getElementById('videoDuplicates');
    const vidInt = document.getElementById('videoIntensity');
    if (vidMode) vidMode.value = 'spoof-only';
    if (vidDup) vidDup.value = 1;
    if (vidInt) vidInt.value = 'medium';

    // --- Image settings change handlers (same as original) ---
    const imageProcessingMode = document.getElementById('imageProcessingMode');
    const imageIntensityGroup = document.getElementById('imageIntensityGroup');
    const imageDuplicatesGroup = document.getElementById('imageDuplicatesGroup');
    const imageRotationGroup = document.getElementById('imageRotationGroup');

    if (imageProcessingMode) {
        imageProcessingMode.addEventListener('change', () => {
            const mode = imageProcessingMode.value;
            if (mode === 'convert-only') {
                if (imageIntensityGroup) imageIntensityGroup.style.display = 'none';
                if (imageDuplicatesGroup) imageDuplicatesGroup.style.display = 'none';
                if (imageRotationGroup) imageRotationGroup.style.display = 'none';
            } else {
                if (imageIntensityGroup) imageIntensityGroup.style.display = 'block';
                if (imageDuplicatesGroup) imageDuplicatesGroup.style.display = 'block';
                if (imageRotationGroup) imageRotationGroup.style.display = 'block';
            }

            const imageFormat = document.getElementById('imageFormat');
            if (imageFormat) {
                const originalOption = imageFormat.querySelector('option[value="original"]');
                if (originalOption) {
                    if (mode === 'convert-only') {
                        originalOption.style.display = 'none';
                        if (imageFormat.value === 'original') imageFormat.value = 'jpg';
                    } else {
                        originalOption.style.display = 'block';
                    }
                }
            }
        });

        // Initialize visibility based on current value
        const mode = imageProcessingMode.value;
        const imageFormat = document.getElementById('imageFormat');
        if (imageFormat && mode === 'convert-only') {
            const o = imageFormat.querySelector('option[value="original"]');
            if (o) { o.style.display = 'none'; if (imageFormat.value === 'original') imageFormat.value = 'jpg'; }
        }
        if (imageRotationGroup) imageRotationGroup.style.display = mode === 'convert-only' ? 'none' : 'block';
    }

    // --- Video settings change handlers (same as original) ---
    const videoProcessingMode = document.getElementById('videoProcessingMode');
    const videoIntensityGroup = document.getElementById('videoIntensityGroup');
    const clipLengthGroup = document.getElementById('clipLengthGroup');
    const videoDuplicatesGroup = document.getElementById('videoDuplicatesGroup');
    const videoRotationGroup = document.getElementById('videoRotationGroup');

    const updateVideoUIVisibility = (mode) => {
        if (mode === 'convert-only') {
            if (videoIntensityGroup) videoIntensityGroup.style.display = 'none';
            if (videoDuplicatesGroup) videoDuplicatesGroup.style.display = 'none';
            if (clipLengthGroup) clipLengthGroup.style.display = 'none';
            if (videoRotationGroup) videoRotationGroup.style.display = 'none';
        } else if (mode === 'spoof-only') {
            if (videoIntensityGroup) videoIntensityGroup.style.display = 'block';
            if (videoDuplicatesGroup) videoDuplicatesGroup.style.display = 'block';
            if (clipLengthGroup) clipLengthGroup.style.display = 'none';
            if (videoRotationGroup) videoRotationGroup.style.display = 'block';
        } else if (mode === 'split-only') {
            if (videoIntensityGroup) videoIntensityGroup.style.display = 'none';
            if (videoDuplicatesGroup) videoDuplicatesGroup.style.display = 'block';
            if (clipLengthGroup) clipLengthGroup.style.display = 'block';
            if (videoRotationGroup) videoRotationGroup.style.display = 'none';
        } else if (mode === 'extract-frames' || mode === 'mute') {
            // Frame extraction / mute don't use effect intensity, duplicates,
            // clip length, or rotation.
            if (videoIntensityGroup) videoIntensityGroup.style.display = 'none';
            if (videoDuplicatesGroup) videoDuplicatesGroup.style.display = 'none';
            if (clipLengthGroup) clipLengthGroup.style.display = 'none';
            if (videoRotationGroup) videoRotationGroup.style.display = 'none';
        } else {
            // spoof-split or any other mode
            if (videoIntensityGroup) videoIntensityGroup.style.display = 'block';
            if (videoDuplicatesGroup) videoDuplicatesGroup.style.display = 'block';
            if (clipLengthGroup) clipLengthGroup.style.display = 'block';
            if (videoRotationGroup) videoRotationGroup.style.display = 'block';
        }
    };

    if (videoProcessingMode) {
        videoProcessingMode.addEventListener('change', () => {
            const mode = videoProcessingMode.value;
            updateVideoUIVisibility(mode);

            const videoFormat = document.getElementById('videoFormat');
            if (videoFormat) {
                const originalOption = videoFormat.querySelector('option[value="original"]');
                if (originalOption) {
                    if (mode === 'convert-only') {
                        originalOption.style.display = 'none';
                        if (videoFormat.value === 'original') videoFormat.value = 'mp4';
                    } else {
                        originalOption.style.display = 'block';
                    }
                }
            }
        });

        // Initialize for default mode (spoof-only)
        updateVideoUIVisibility('spoof-only');
        const videoFormat = document.getElementById('videoFormat');
        if (videoFormat) {
            const o = videoFormat.querySelector('option[value="original"]');
            if (o) o.style.display = 'block';
        }
        if (videoRotationGroup) videoRotationGroup.style.display = 'block';
    }

    // --- Watermark UI for both panels ---
    const imageWatermarkUI = setupWatermarkUI('image');
    window.imageWatermarkUI = imageWatermarkUI;

    const videoWatermarkUI = setupWatermarkUI('video');
    window.videoWatermarkUI = videoWatermarkUI;

    // --- Processing controls ---
    setupProcessingControls();

    imageInterfaceSetup = true;
    videoInterfaceSetup = true;

    console.log('Unified interface setup complete');
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
                updateWatermarkSizeForMedia: () => { },
                updateWatermarkPreview: () => { }
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
            updateWatermarkSizeForMedia: () => { },
            updateWatermarkPreview: () => { }
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

            // Persistent on-screen confirmation of where files will go (F2).
            const outputFolderInfo = document.getElementById('outputFolderInfo');
            const outputFolderText = document.getElementById('outputFolderText');
            if (outputFolderInfo) outputFolderInfo.style.display = 'block';
            if (outputFolderText) { outputFolderText.textContent = folderPath; outputFolderText.title = folderPath; }

            // Let the user open the folder right away (S5), and re-check Start (F3).
            const openFolderBtn = document.getElementById('openFolderBtn');
            if (openFolderBtn) {
                openFolderBtn.setAttribute('data-path', folderPath);
                openFolderBtn.disabled = false;
            }
            updateButtons();
            showStatus();
        }
    } catch (error) {
        addStatusMessage('Error selecting output folder: ' + error.message, 'error');
    }
}

// File selection functions
async function selectFiles(mode) {
    try {
        if (!(await ensureAppReady())) {
            addStatusMessage('App is still initializing. Please wait a moment and try again.', 'warning');
            return;
        }

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
        let filters;
        if (mode === 'mixed') {
            filters = [
                { name: 'All Media', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'svg', 'ico', 'jfif', 'avif', 'jxl', 'raw', 'cr2', 'nef', 'arw', 'dng', 'mp4', 'mov', 'avi', 'webm', 'ts', 'mkv', 'flv', 'wmv', 'm4v', '3gp', 'ogv', 'mts', 'm2ts', 'vob', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'mpg', 'mpeg', 'mxf', 'f4v'] },
                { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'svg', 'ico', 'jfif', 'avif', 'jxl', 'raw', 'cr2', 'nef', 'arw', 'dng'] },
                { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'webm', 'ts', 'mkv', 'flv', 'wmv', 'm4v', '3gp', 'ogv', 'mts', 'm2ts', 'vob', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'mpg', 'mpeg', 'mxf', 'f4v'] },
                { name: 'All Files', extensions: ['*'] }
            ];
        } else if (mode === 'image') {
            filters = [
                { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp', 'bmp', 'gif', 'tiff', 'tif', 'svg', 'ico', 'jfif', 'avif', 'jxl', 'raw', 'cr2', 'nef', 'arw', 'dng'] },
                { name: 'All Files', extensions: ['*'] }
            ];
        } else {
            filters = [
                { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'webm', 'ts', 'mkv', 'flv', 'wmv', 'm4v', '3gp', 'ogv', 'mts', 'm2ts', 'vob', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'mpg', 'mpeg', 'mxf', 'f4v'] },
                { name: 'All Files', extensions: ['*'] }
            ];
        }

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
        if (!(await ensureAppReady())) {
            addStatusMessage('App is still initializing. Please wait a moment and try again.', 'warning');
            return;
        }

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
                // For mixed mode, accept all media files
                const allImageExts = ['.jpg', '.jpeg', '.png', '.heic', '.webp', '.bmp', '.gif', '.tiff', '.tif', '.svg', '.ico', '.jfif', '.avif', '.jxl', '.raw', '.cr2', '.nef', '.arw', '.dng'];
                const allVideoExts = ['.mp4', '.mov', '.avi', '.webm', '.ts', '.mkv', '.flv', '.wmv', '.m4v', '.3gp', '.ogv', '.mts', '.m2ts', '.vob', '.asf', '.rm', '.rmvb', '.divx', '.xvid', '.mpg', '.mpeg', '.mxf', '.f4v'];

                const filteredFiles = filePaths.filter(filePath => {
                    const extension = (path.parse(filePath).ext || "").toLowerCase();
                    if (mode === 'mixed') {
                        return allImageExts.includes(extension) || allVideoExts.includes(extension);
                    } else if (mode === 'image') {
                        return allImageExts.includes(extension);
                    } else {
                        return allVideoExts.includes(extension);
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
    if (!(await ensureAppReady())) {
        addStatusMessage('App is still initializing. Please wait a moment and try again.', 'warning');
        return;
    }

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

        // Always auto-detect file type from extension in unified mode
        let fileType = getFileType(fileExtension);

        // Special handling for files that might have incorrect extensions
        if (fileType === 'unknown') {
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
    // Show preview for the first file (auto-detect type from file object)
    if (selectedFiles.length > 0) {
        showPreview(selectedFiles[0].path, selectedFiles[0].type || 'image');
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

    if (!(await ensureAppReady())) {
        addStatusMessage('App is still initializing. Please wait a moment and try again.', 'warning');
        return;
    }

    const files = Array.from(e.dataTransfer.files);
    const filePaths = files.map(file => file.path);
    await addFiles(filePaths, mode);
}

// UI update functions
// Escape user-controlled strings (file names) before putting them in innerHTML.
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function updateFileList() {
    const fileList = document.getElementById('mediaFileList');

    if (!fileList) {
        console.warn('mediaFileList element not found');
        return;
    }

    if (selectedFiles.length === 0) {
        fileList.innerHTML = '<div class="empty-state">No files selected</div>';
        return;
    }

    fileList.innerHTML = selectedFiles.map((file, index) => `
        <div class="file-item ${index === currentPreviewIndex ? 'active' : ''}" onclick="previewFileByClick(${index})" style="cursor: pointer;">
            <div class="file-info">
                <div class="file-icon ${file.type}">
                    ${file.type === 'image'
                        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/></svg>'
                        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>'}
                </div>
                <div class="file-details">
                    <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
            </div>
            <div class="file-actions">
                <button class="btn btn-danger btn-sm" onclick="removeFile(${index}); event.stopPropagation();" title="Remove file" ${isProcessing ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"/></svg>
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

    updatePreviewAfterFileChange('media');
    updateNavigationButtons('media');
    updatePanelRelevance();
}

// Dim the settings panel whose media type isn't in the queue, so the user's eye
// goes to the settings that actually apply (S3). Never fully disabled — they can
// still pre-configure before adding files.
function updatePanelRelevance() {
    const anyFiles = selectedFiles.length > 0;
    const hasImages = selectedFiles.some(f => f.type === 'image');
    const hasVideos = selectedFiles.some(f => f.type === 'video');
    const apply = (el, relevant) => {
        if (!el) return;
        const off = anyFiles && !relevant;
        el.style.opacity = off ? '0.5' : '';
        el.style.transition = 'opacity 0.2s';
    };
    apply(document.getElementById('photoSettingsSection'), hasImages);
    apply(document.getElementById('videoSettingsSection'), hasVideos);
}

function updateStats() {
    const totalEl     = document.getElementById('totalFiles');
    const processedEl = document.getElementById('processedFiles');
    const outputEl    = document.getElementById('outputFiles');
    const statsGrid   = document.getElementById('statsGrid');

    // Show distinct files finished (not file×duplicate operations), so "Processed"
    // never exceeds "Total Files" (2.1). "Output Files" still shows total produced.
    const completedFiles = selectedFiles.filter(f => f.status === 'completed').length;
    if (totalEl)     totalEl.textContent     = selectedFiles.length;
    if (processedEl) processedEl.textContent = completedFiles;
    if (outputEl)    outputEl.textContent    = outputCount;

    if (statsGrid) {
        if (selectedFiles.length > 0) {
            statsGrid.classList.add('show');
        } else {
            statsGrid.classList.remove('show');
            resetStats();
        }
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
    const clearBtn = document.getElementById('clearFilesBtn');
    const selectBtn = document.getElementById('selectFilesBtn');

    // Start needs both files AND an output folder (F3) — don't present a ready
    // button that silently does nothing.
    const hasOutput = !!outputDirectory;
    if (startBtn) {
        startBtn.disabled = !hasFiles || !hasOutput || isProcessing;
        startBtn.title = !hasFiles ? 'Add files first'
            : !hasOutput ? 'Choose an output folder first'
            : 'Start processing';
    }
    if (pauseBtn) pauseBtn.disabled = !isProcessing;
    if (stopBtn) stopBtn.disabled = !isProcessing;
    if (clearBtn) clearBtn.disabled = isProcessing;
    if (selectBtn) selectBtn.disabled = isProcessing;

    // Inline hint next to Start when it's blocked by a missing output folder.
    const startHint = document.getElementById('startHint');
    if (startHint) {
        if (hasFiles && !hasOutput && !isProcessing) {
            startHint.textContent = '⬅ Choose an output folder first';
            startHint.style.display = 'inline';
        } else {
            startHint.style.display = 'none';
        }
    }

    const selectOutputBtn = document.getElementById('selectOutputBtn');
    if (selectOutputBtn) {
        selectOutputBtn.style.display = 'inline-block';
    }
}

// Overall progress bar functions
// Format a number of seconds as a short human duration: "45s", "1m 05s", "1h 02m".
function fmtDuration(totalSec) {
    totalSec = Math.max(0, Math.round(totalSec));
    if (totalSec < 60) return `${totalSec}s`;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m ${String(s).padStart(2, '0')}s`;
}

// Update the run dock's progress: big % on the left, live meta (elapsed / left)
// on the right, and the bar fill. `meta` is the right-hand line; `pctLabel`
// overrides the big number (e.g. "Ready"/"Done").
function updateOverallProgress(percent, meta, pctLabel) {
    const overallProgress = document.getElementById('overallProgress');
    const fill = document.getElementById('overallProgressFill');
    const pctEl = document.getElementById('overallProgressPct');
    const metaEl = document.getElementById('overallProgressMeta');
    const legacyText = document.getElementById('overallProgressText');

    if (overallProgress) overallProgress.classList.add('show');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (pctEl) pctEl.textContent = pctLabel != null ? pctLabel : `${Math.round(percent)}%`;
    if (metaEl) metaEl.textContent = meta || '';
    if (legacyText) legacyText.textContent = meta || '';
}

function hideOverallProgress() {
    const overallProgress = document.getElementById('overallProgress');
    if (overallProgress) overallProgress.classList.remove('show');
}

// Processing functions with real progress tracking
// Verify each produced file actually exists and isn't empty, so a broken/0-byte
// output (ffmpeg can occasionally exit 0 on remux edge cases) is caught and
// retried instead of counted as success. Intentional temp files are skipped.
async function verifyOutputs(paths) {
    for (const p of (paths || [])) {
        const base = String(p).split(/[\\/]/).pop() || '';
        if (/^(temp_master_|temp_)/i.test(base)) continue; // intentional temp, deleted on purpose
        let ok = false;
        try {
            if (await electronAPI.exists(p)) {
                ok = true;
                try {
                    const st = await electronAPI.getFileStats(p);
                    if (st && typeof st.size === 'number' && st.size === 0) ok = false;
                } catch (e) { /* exists is enough if stats fail */ }
            }
        } catch (e) { ok = false; }
        if (!ok) throw new Error(`Output was not created correctly: ${base}`);
    }
}

async function startProcessing() {
    // Make sure the hidden legacy controls reflect the compose UI before we read them.
    if (document.getElementById('composeUI')) { try { syncComposeToLegacy(); } catch (e) { console.warn('compose sync failed:', e); } }
    // If frame extractor mode is active, route to extractor instead
    if (window._fxExtractMode) { fxStartExtraction(); return; }

    if (isProcessing) return;

    // Prevent processing if outputDirectory is not set
    if (!outputDirectory) {
        addStatusMessage(`❌ Please select an output folder before starting processing.`, 'error');
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
    elapsedBeforePause = 0;

    // Clear all probe caches to ensure fresh data
    videoProbeCache.clear();
    videoDurationCache.clear();
    videoDARCache.clear();
    keyframeCache.clear();

    // Reset per-run output-name bookkeeping so uniqueness is scoped to this run.
    usedOutputPaths.clear();
    attemptOutputs = [];
    heicProcessCache.clear();

    // Preflight: make sure FFmpeg is actually available before we start, so a
    // missing binary produces one clear message instead of every file failing (F25).
    try {
        if (!ffmpegPath || !(await electronAPI.exists(ffmpegPath))) {
            addStatusMessage('❌ FFmpeg was not found. Please make sure ffmpeg.exe is in the app folder.', 'error');
            isProcessing = false;
            updateButtons();
            return;
        }
    } catch (e) {
        addStatusMessage(`❌ Could not verify FFmpeg: ${e.message}`, 'error');
        isProcessing = false;
        updateButtons();
        return;
    }

    // Reset file statuses
    selectedFiles.forEach(file => {
        file.progress = 0;
        file.status = 'waiting';
    });

    updateButtons();
    showStatus();
    updateFileList();

    // Ensure status panel is visible
    const statusPanel = document.getElementById('activityLogSection');
    if (statusPanel) {
        statusPanel.style.display = 'block';
        console.log('Status panel made visible');
    }

    // In unified mode, get settings for both types and compute max duplicates
    const imageFiles = selectedFiles.filter(f => f.type === 'image');
    const videoFiles = selectedFiles.filter(f => f.type === 'video');
    const imageSettings = imageFiles.length > 0 ? getProcessingSettings('image') : null;
    const videoSettings = videoFiles.length > 0 ? getProcessingSettings('video') : null;
    const maxDuplicates = Math.max(
        imageSettings ? imageSettings.duplicates : 1,
        videoSettings ? videoSettings.duplicates : 1
    );
    totalBatches = maxDuplicates;

    // Preflight: warn/stop if the output drive is low on space (rough estimate:
    // total input size × copies, with headroom for re-encoding).
    try {
        const totalIn = selectedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
        const est = totalIn * Math.max(1, maxDuplicates) * 1.3;
        const fs2 = await electronAPI.getFreeSpace(outputDirectory);
        if (fs2 && fs2.ok && fs2.free != null) {
            const gb = (n) => (n / 1073741824).toFixed(1);
            if (fs2.free < totalIn) {
                addStatusMessage(`❌ Not enough free space on the output drive (${gb(fs2.free)} GB free, need at least ~${gb(est)} GB). Free up space or pick another folder.`, 'error');
                isProcessing = false; updateButtons(); return;
            } else if (fs2.free < est) {
                addStatusMessage(`⚠️ Output drive is low on space (${gb(fs2.free)} GB free, ~${gb(est)} GB may be needed). Continuing — keep an eye on it.`, 'warning');
            }
        }
    } catch (e) { /* non-fatal: skip the space check */ }

    // Preflight: a watermark needs a font file, which we couldn't find. Fail fast
    // with one clear message instead of every watermarked file failing (2.3).
    const wantsWatermark = (imageSettings && imageSettings.watermark && imageSettings.watermark.enabled) ||
        (videoSettings && videoSettings.watermark && videoSettings.watermark.enabled);
    if (wantsWatermark && !systemFontPath) {
        addStatusMessage('❌ Watermark is on but no system font was found, so text cannot be drawn. Disable the watermark or install a font (e.g. Arial).', 'error');
        isProcessing = false;
        updateButtons();
        return;
    }

    // True number of operations = sum of each file's own duplicate count (5.2),
    // so the progress % and ETA aren't biased by the batch-wide maximum.
    const totalSteps = selectedFiles.reduce((sum, f) => {
        const s = f.type === 'image' ? imageSettings : videoSettings;
        return sum + (s ? s.duplicates : 1);
    }, 0);
    startProgressTracking(totalSteps);

    addStatusMessage('🚀 Starting media processing...', 'info');
    addStatusMessage(`📊 Processing ${imageFiles.length} images + ${videoFiles.length} videos with up to ${maxDuplicates} duplicates`, 'info');

    // Start timer
    startTimer();
    updateOverallProgress(0, 'Starting...');

    // Declare outputDir at function scope so it's accessible throughout
    let outputDir;
    // Every batch_* folder created this run, so "Open folder" can jump straight to
    // the run's own output instead of the root the user picked.
    const createdBatchDirs = [];

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

        updateOverallProgress(5, 'Starting batch processing...');

        // Process files in batches
        for (let batch = 1; batch <= maxDuplicates; batch++) {
            if (!isProcessing) break;

            currentBatch = batch;

            // Create unique batch directory with a millisecond timestamp AND the
            // batch number, so quick successive batches can't collide (F20).
            const timestamp = `${String(batch).padStart(2, '0')}_${new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')}`;
            addStatusMessage(`\n📁 Processing Batch ${batch} of ${maxDuplicates} (${timestamp})...`, 'info');
            updateOverallProgress(((batch - 1) / maxDuplicates) * 80 + 5, `Processing Batch ${batch} of ${maxDuplicates}`);

            // Ensure we're using the absolute path for batch directory creation
            const batchDir = path.resolve(outputDir, 'batch_' + timestamp);
            createdBatchDirs.push(batchDir);
            // Point "Open folder" at this run's folder as soon as it exists, so it
            // works correctly even mid-run (not the root from before the run).
            if (batch === 1) {
                const ofb = document.getElementById('openFolderBtn');
                if (ofb) { ofb.setAttribute('data-path', batchDir); ofb.disabled = false; }
            }
            console.log('Created batch directory path:', batchDir);
            const batchDirExists = await electronAPI.exists(batchDir);
            console.log('Batch directory exists check result:', batchDirExists);
            addStatusMessage(`🔍 Creating batch directory: ${batchDir}`, 'info');
            if (!batchDirExists) {
                try {
                    await electronAPI.mkdir(batchDir);
                    // No delay needed — mkdir is synchronous on the OS level
                } catch (error) {
                    console.error('Failed to create batch directory:', error.message);
                    throw error;
                }
            }

            // Process the files in this batch. Several run at once (bounded pool)
            // so slow steps (probe, encode, disk writes) overlap — each batch
            // finishes much faster on multi-core machines. PARALLEL_FILES caps how
            // many run concurrently so a weak laptop isn't overwhelmed.
            const PARALLEL_FILES = Math.max(1, Math.min(3, parseInt(window._morphParallel) || 2));

            // Per-file work — the whole retry/verify/status flow for ONE file.
            const processOneFile = async (i) => {
                if (!isProcessing) return;

                const file = selectedFiles[i];

                // Per-file duplicate limit: only make as many copies as THIS file's
                // own duplicate count, not the batch-wide maximum (F5).
                const fileDupSettings = file.type === 'image' ? imageSettings : videoSettings;
                if (batch > (fileDupSettings ? fileDupSettings.duplicates : 1)) {
                    return;
                }

                // Handle pause - IMPROVED: Don't interrupt current processing
                while (isPaused && isProcessing) {
                    file.status = 'paused';
                    updateFileList();
                    await sleep(100); // Reduced sleep time for better responsiveness
                }

                if (!isProcessing) return;

                // Update file status for current batch
                file.status = `processing (batch ${batch})`;

                // Update step progress for real-time tracking
                const stepName = `Processing ${file.name} (Batch ${batch})`;
                updateStepProgress(stepName, 0);

                const fileProgressInBatch = (i / selectedFiles.length) * (1 / maxDuplicates) * 100;
                const batchProgress = ((batch - 1) / maxDuplicates) * 100;
                file.progress = batchProgress + fileProgressInBatch;

                updateFileList();

                // IMPROVED: Retry logic for failed files
                let retryCount = 0;
                const maxRetries = 2;
                let success = false;

                while (!success && retryCount <= maxRetries && isProcessing) {
                    // Track what this attempt writes so a retry can clean up after
                    // a failure instead of leaving orphan/duplicate files (F6).
                    // Kept on the file object so parallel files don't clobber each
                    // other's list.
                    file._attemptOutputs = [];
                    try {
                        addStatusMessage(`🔄 Processing file in batch directory: ${batchDir}`, 'info');
                        console.log('Processing file in batch directory:', batchDir);

                        // Update step progress to show processing
                        updateStepProgress(stepName, 25);

                        // Use pre-computed settings (avoid re-reading DOM per file).
                        // processFile / generateOutputPathForBatch read file.type
                        // directly, so no shared currentMode toggling is needed —
                        // that makes concurrent files safe.
                        const fileSettings = file.type === 'image' ? imageSettings : videoSettings;
                        await processFile(file, batchDir, batch, i, fileSettings);

                        // Verify the outputs actually exist and aren't empty — a
                        // 0-byte/broken file must not be reported as success.
                        await verifyOutputs(file._attemptOutputs);

                        // Update step progress to show completion
                        updateStepProgress(stepName, 100);
                        completeProcessingStep();

                        success = true;
                        addStatusMessage(`✅ Processed: ${file.name} (Batch ${batch} - ${timestamp})`, 'success');
                    } catch (error) {
                        // Always clean up this attempt's partial output first.
                        for (const p of (file._attemptOutputs || [])) {
                            try { await electronAPI.unlink(p); if (outputCount > 0) outputCount--; } catch (e) { /* may not exist */ }
                            usedOutputPaths.delete(p.toLowerCase());
                        }
                        file._attemptOutputs = [];

                        // If the user pressed Stop, this isn't a failure — bail quietly.
                        if (!isProcessing) { file.status = 'cancelled'; break; }

                        console.error(`Error processing ${file.name}:`, error);

                        // Don't waste retries on errors that will never succeed
                        // (unsupported/corrupt input, bad codec, missing file).
                        const msg = String(error && error.message || '');
                        const permanent = /unsupported|invalid data|no such file|could not read|too short to split|unknown (encoder|mode)|incompatible|not (found|created correctly)/i.test(msg);

                        retryCount++;
                        if (!permanent && retryCount <= maxRetries) {
                            addStatusMessage(`⚠️ Retry ${retryCount}/${maxRetries} for ${file.name}: ${error.message}`, 'warning');
                            await sleep(400);
                        } else {
                            const why = permanent ? 'can’t be processed' : `failed after ${maxRetries} retries`;
                            addStatusMessage(`❌ ${file.name} ${why}: ${error.message}`, 'error');
                            file.status = 'failed';
                            file.error = error.message;
                            break;
                        }
                    }
                }

                if (success) {
                    processedCount++;
                    file.status = 'completed';
                    file.progress = 100;
                } else if (file.status === 'failed') {
                    // A failed file still finished its task — count it so the overall
                    // progress / ETA reaches 100% instead of stalling. (Success is
                    // already counted inside the try via completeProcessingStep.)
                    completeProcessingStep();
                }

                updateFileList();
                updateStats();
            };

            // Run the files through a bounded worker pool: PARALLEL_FILES tasks in
            // flight at once, each pulling the next index when it finishes. Stops
            // pulling new work the moment the user hits Stop.
            let nextIndex = 0;
            const runWorker = async () => {
                while (isProcessing) {
                    const i = nextIndex++;
                    if (i >= selectedFiles.length) break;
                    await processOneFile(i);
                }
            };
            const workers = [];
            for (let w = 0; w < Math.min(PARALLEL_FILES, selectedFiles.length); w++) {
                workers.push(runWorker());
            }
            await Promise.all(workers);

            // Batch completed
            addStatusMessage(`✅ Batch ${batch} completed`, 'success');
        }

        // Processing completed successfully
        if (isProcessing) {
            stopProgressTracking();

            // Count successful and failed files
            const successFiles = selectedFiles.filter(f => f.status === 'completed');
            const failedFiles = selectedFiles.filter(f => f.status === 'failed');

            // Final readout: total time taken + how many produced.
            const totalSec = elapsedBeforePause + (Date.now() - startTime) / 1000;
            const madeText = `${outputCount} file${outputCount === 1 ? '' : 's'} made in ${fmtDuration(totalSec)}`;
            updateOverallProgress(100,
                failedFiles.length ? `${madeText} · ${failedFiles.length} failed` : madeText,
                '✅ Done');

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

            addStatusMessage(`📂 Output saved to: ${outputDirectory || outputDir}`, 'info');
            console.log('Final status - outputDirectory:', outputDirectory, 'outputDir:', outputDir);

            // Final cleanup: Remove any remaining temporary conversion directories
            await cleanupRemainingTempDirectories(outputDirectory || outputDir);

            const openFolderBtn = document.getElementById('openFolderBtn');
            if (openFolderBtn) {
                openFolderBtn.disabled = false;
                // Open the folder this run actually created. One batch → open that
                // batch_* folder directly (what the user asked for). Multiple batches
                // (duplicates) → open the root so all of them are visible at once.
                const runFolder = createdBatchDirs.length === 1
                    ? createdBatchDirs[0]
                    : (outputDirectory || outputDir);
                openFolderBtn.setAttribute('data-path', runFolder);
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
        // Bank the elapsed time of this segment so resume continues, not resets (F24).
        if (startTime) elapsedBeforePause += Math.floor((Date.now() - startTime) / 1000);
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

    // Actually terminate the running ffmpeg (the renderer never held a real
    // process handle, so the old currentProcess.kill() was dead code — F4).
    if (electronAPI.killActiveProcesses) {
        electronAPI.killActiveProcesses().catch(err => console.warn('Failed to kill ffmpeg:', err));
    }
    currentProcess = null;

    // Clean up any temporary conversion directories and files that might exist
    if (outputDirectory) {
        cleanupRemainingTempDirectories(outputDirectory).catch(error => {
            console.warn('Cleanup failed during stop:', error);
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
    }

    hideStatus();
    hideOverallProgress();
    resetStats();
    updateButtons();
}

// File processing logic with progress updates
async function processFile(file, outputDir, batch, index, settings) {
    const updateProgress = (percent) => {
        file.progress = percent;
        // Targeted UI update: only touch this file's progress bar, not the entire list
        const progressFill = document.getElementById(`progress-${index}`);
        const progressText = document.getElementById(`progress-text-${index}`);
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressText) progressText.textContent = percent >= 100 ? 'Done' : `${Math.round(percent)}%`;
    };

    updateProgress(10);

    switch (settings.mode) {
        case 'spoof-split':
            await processSpoofAndSplit(file, outputDir, settings, updateProgress, index);
            break;
        case 'spoof-only':
            await processSpoof(file, outputDir, settings, updateProgress, index);
            break;
        case 'split-only':
            if (file.type === 'video') {
                await processSplitOnly(file, outputDir, settings, updateProgress, index);
            } else {
                const outputPath = generateOutputPathForBatch(file, outputDir, settings, null, index);
                await electronAPI.copyFile(file.path, outputPath);
                outputCount++;
                updateProgress(100);
            }
            break;
        case 'convert-only':
            await processConvert(file, outputDir, settings, updateProgress, index);
            break;
        case 'extract-audio':
            if (file.type === 'video') {
                await processExtractAudio(file, outputDir, settings, updateProgress, index);
            } else {
                // No audio in an image — skip it (don't report a false success).
                throw new Error(`${file.name} is an image and has no audio to extract.`);
            }
            break;
        case 'thumbnail':
            if (file.type === 'video') {
                await processThumbnail(file, outputDir, settings, updateProgress, index);
            } else {
                throw new Error(`${file.name} is already an image — no cover frame to grab.`);
            }
            break;
        case 'gif':
            if (file.type === 'video') {
                await processGif(file, outputDir, settings, updateProgress, index);
            } else {
                throw new Error(`${file.name} is an image — GIF conversion is for videos.`);
            }
            break;
        case 'mute':
            if (file.type === 'video') {
                await processMuteVideo(file, outputDir, settings, updateProgress, index);
            } else {
                // Images have no audio — just copy them through unchanged.
                const outputPath = generateOutputPathForBatch(file, outputDir, { ...settings, videoFormat: 'original' }, null, index);
                await electronAPI.copyFile(file.path, outputPath);
                outputCount++;
                updateProgress(100);
            }
            break;
        default:
            // Never silently report success for a mode we don't handle (F16).
            throw new Error(`Unknown processing mode: "${settings.mode}". Nothing was produced for ${file.name}.`);
    }
}

// Overlay coordinates for a corner/center logo (24px margin).
function logoOverlayXY(pos) {
    const m = 24;
    switch (pos) {
        case 'bottom-left': return `${m}:H-h-${m}`;
        case 'top-right': return `W-w-${m}:${m}`;
        case 'top-left': return `${m}:${m}`;
        case 'center': return `(W-w)/2:(H-h)/2`;
        default: return `W-w-${m}:H-h-${m}`;
    }
}

// Post-processing pass for one-file video: stamp a logo PNG and/or replace the
// audio with a music track. Runs as an extra ffmpeg pass so it composes with any
// main processing without complicating the main command. Rewrites in place.
async function applyExtrasPass(outputPath, settings) {
    const ext = (path.parse(outputPath).ext || '.mp4').toLowerCase();
    const replaceInPlace = async (tmp) => {
        try { await electronAPI.unlink(outputPath); } catch (e) {}
        await electronAPI.copyFile(tmp, outputPath);
        try { await electronAPI.unlink(tmp); } catch (e) {}
    };

    if (settings.logoPath) {
        const tmp = outputPath.slice(0, -ext.length) + '__logo' + ext;
        const cmd = [
            '-y', '-i', outputPath, '-i', settings.logoPath,
            '-filter_complex', `[1:v]scale=iw*0.18:-1[wm];[0:v][wm]overlay=${logoOverlayXY(settings.logoPos)}[vo]`,
            '-map', '[vo]', '-map', '0:a?', '-c:a', 'copy',
            ...videoEncodeArgs(ext, settings, false),
            tmp
        ];
        console.log('Logo overlay pass:', cmd.join(' '));
        await spawnFFmpeg(cmd);
        await replaceInPlace(tmp);
    }

    if (settings.musicPath) {
        const tmp = outputPath.slice(0, -ext.length) + '__mus' + ext;
        const cmd = [
            '-y', '-i', outputPath, '-i', settings.musicPath,
            '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
            '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000', '-shortest',
            tmp
        ];
        console.log('Replace-audio pass:', cmd.join(' '));
        await spawnFFmpeg(cmd);
        await replaceInPlace(tmp);
    }
}

// Grab a single cover frame (from the middle of the clip) as a JPEG.
async function processThumbnail(file, outputDir, settings, updateProgress, fileIndex = 0) {
    const probe = await probeVideo(file.path);
    const t = probe.ok ? Math.max(0, Math.min((probe.duration || 2) - 0.1, (probe.duration || 2) / 2)) : 0;
    const outputPath = generateOutputPathForBatch(file, outputDir, { ...settings, videoFormat: 'jpg' }, null, fileIndex);
    updateProgress(30);
    const command = [
        '-y', '-ss', String(t), '-i', file.path, '-frames:v', '1',
        '-vf', `${SAR_NORMALIZE},format=yuvj420p`, '-q:v', '2',
        outputPath
    ];
    console.log('Thumbnail command:', command.join(' '));
    await spawnFFmpeg(command);
    outputCount++;
    updateProgress(100);
}

// Turn a video into an optimized (palette) animated GIF.
async function processGif(file, outputDir, settings, updateProgress, fileIndex = 0) {
    const outputPath = generateOutputPathForBatch(file, outputDir, { ...settings, videoFormat: 'gif' }, null, fileIndex);
    updateProgress(30);
    const fps = 12, width = 480;
    const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`;
    const command = ['-y', '-i', file.path, '-vf', vf, '-loop', '0', outputPath];
    console.log('GIF command:', command.join(' '));
    await spawnFFmpeg(command);
    outputCount++;
    updateProgress(100);
}

// Extract the audio track to an MP3.
async function processExtractAudio(file, outputDir, settings, updateProgress, fileIndex = 0) {
    const outputPath = generateOutputPathForBatch(file, outputDir, { ...settings, videoFormat: 'mp3' }, null, fileIndex);
    updateProgress(30);
    const command = [
        '-y', '-i', file.path,
        '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', '-ar', '48000',
        '-map_metadata', '-1',
        outputPath
    ];
    console.log('Extract audio command:', command.join(' '));
    await spawnFFmpeg(command);
    outputCount++;
    updateProgress(100);
}

// Remove audio only — copies the video stream untouched and drops the audio.
// Instant (no re-encode), keeps the original container/quality.
async function processMuteVideo(file, outputDir, settings, updateProgress, fileIndex = 0) {
    // Force the output container to match the source so we can stream-copy.
    const muteSettings = { ...settings, videoFormat: 'original' };
    const outputPath = generateOutputPathForBatch(file, outputDir, muteSettings, null, fileIndex);
    const outExt = (path.parse(outputPath).ext || '').toLowerCase();

    updateProgress(30);
    const command = [
        '-y',
        '-i', file.path,
        '-c:v', 'copy',
        '-an',
        ...metadataArgs(muteSettings, outExt),
        outputPath
    ];
    console.log('Mute (remove audio) command:', command.join(' '));
    await spawnFFmpeg(command);
    outputCount++;
    updateProgress(100);
}

// Processing mode implementations
async function processSpoof(file, outputDir, settings, updateProgress, fileIndex = 0) {
    const outputPath = generateOutputPathForBatch(file, outputDir, settings, null, fileIndex);
    const effects = generateSpoofEffects(settings.intensity, settings.enableRotation !== false);

    console.log('processSpoof called with file type:', file.type, 'file path:', file.path);

    updateProgress(30);

    if (file.type === 'image') {
        console.log('Processing as IMAGE');
        await processImageSpoof(file.path, outputPath, effects, settings, updateProgress);
    } else {
        console.log('Processing as VIDEO');
        await processVideoSpoof(file.path, outputPath, effects, settings, updateProgress);
        if (settings.logoPath || settings.musicPath) await applyExtrasPass(outputPath, settings);
    }

    outputCount++;
    updateProgress(100);
}

async function processSpoofAndSplit(file, outputDir, settings, updateProgress, fileIndex = 0) {
    if (file.type === 'video') {
        // Cut into clips AND spoof each clip INDIVIDUALLY, so every clip gets its
        // own unique visual fingerprint (crop/tilt/colour) plus its own device
        // metadata. Previously we spoofed one "master" then copied clips out of it,
        // which made every clip an identical sibling — the opposite of the goal.
        addStatusMessage('Splitting and making each clip unique…', 'info');
        await processVideoSplit(file, outputDir, settings, true, updateProgress, fileIndex);
    } else {
        // For images, just spoof
        await processSpoof(file, outputDir, settings, updateProgress, fileIndex);
    }
}

async function processSplitOnly(file, outputDir, settings, updateProgress, fileIndex = 0) {
    if (file.type === 'video') {
        const duration = await getVideoDuration(file.path);

        if (duration > 10) {
            // Split video into clips
            await processVideoSplit(file, outputDir, settings, false, updateProgress, fileIndex);
        } else {
            // For videos under 10 seconds - process with watermark and audio removal
            const outputPath = generateOutputPathForBatch(file, outputDir, settings, null, fileIndex);

            // Check if watermark or audio removal is needed
            if (settings.watermark && settings.watermark.enabled || settings.removeAudio) {
                // Process with watermark/audio removal
                await processVideoClipWithEffects(file.path, outputPath, { start: 0, duration: duration, number: 1 }, null, settings);
            } else {
                // Just copy the file to final output
                await electronAPI.copyFile(file.path, outputPath);
            }

            outputCount++;
            updateProgress(100);
        }
    }
}



async function processConvert(file, outputDir, settings, updateProgress, fileIndex = 0) {
    const outputPath = generateOutputPathForBatch(file, outputDir, settings, null, fileIndex);

    updateProgress(30);

    if (file.type === 'image') {
        await convertImage(file.path, outputPath, settings);
    } else {
        await convertVideo(file.path, outputPath, settings);
        if (settings.logoPath || settings.musicPath) await applyExtrasPass(outputPath, settings);
    }

    outputCount++;
    updateProgress(100);
}

// ===== UNIFIED VIDEO PROBE (Optimization: single ffprobe call) =====
// Cache stores { duration, dar } per normalized path
const videoProbeCache = new Map();

/**
 * Unified video probe: returns { duration, dar } from a SINGLE ffprobe call.
 * Replaces the old separate getVideoDuration() + getVideoDAR() which spawned
 * two ffprobe processes per video.
 */
async function probeVideo(videoPath) {
    const normalizedPath = path.normalize(videoPath);

    // Check cache first
    if (videoProbeCache.has(normalizedPath)) {
        if (DEBUG) console.log('probeVideo: cache hit for', normalizedPath);
        return videoProbeCache.get(normalizedPath);
    }

    try {
        if (DEBUG) console.log('probeVideo: probing', normalizedPath);

        // Single ffprobe call that gets BOTH duration AND stream info
        const command = [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'format=duration',
            '-show_entries', 'stream=width,height,display_aspect_ratio,sample_aspect_ratio,color_transfer,color_primaries',
            '-show_entries', 'stream_tags=rotate',
            '-show_entries', 'stream_side_data=rotation',
            '-of', 'json',
            normalizedPath
        ];

        const result = await electronAPI.spawnProcess(ffprobePath, command);

        let duration = 90; // default
        let dar = null;
        let anamorphic = false; // true when pixels are non-square (SAR != 1:1)
        let hdr = false;        // true for HLG / PQ (Dolby Vision) / BT.2020 sources
        let ok = false;         // did ffprobe actually read this file?

        if (result.code === 0) {
            const data = JSON.parse(result.stdout);
            ok = true;

            // --- Extract duration ---
            if (data.format && data.format.duration) {
                duration = parseFloat(data.format.duration) || 90;
            }

            // --- Extract DAR (same logic as old getVideoDAR) ---
            if (data.streams && data.streams[0]) {
                const stream = data.streams[0];
                let width = parseInt(stream.width);
                let height = parseInt(stream.height);
                let darStr = stream.display_aspect_ratio;
                const sar = stream.sample_aspect_ratio;

                // Detect non-square pixels: a sample aspect ratio other than 1:1
                // (e.g. HandBrake anamorphic output) is what causes stretched
                // thumbnails after a stream-copy split.
                if (sar && sar.includes(':')) {
                    const [sN, sD] = sar.split(':').map(Number);
                    if (sN > 0 && sD > 0 && Math.abs(sN / sD - 1) > 0.01) {
                        anamorphic = true;
                    }
                }

                // Detect HDR (iPhone HLG / Dolby Vision PQ, or BT.2020) so we can
                // tone-map to SDR instead of producing washed-out colours.
                const transfer = (stream.color_transfer || '').toLowerCase();
                const primaries = (stream.color_primaries || '').toLowerCase();
                if (transfer === 'smpte2084' || transfer === 'arib-std-b67' || primaries === 'bt2020') {
                    hdr = true;
                }

                // 1. Get Rotation from tags or side data
                let rotation = 0;
                if (stream.tags && stream.tags.rotate) {
                    rotation = parseInt(stream.tags.rotate);
                } else if (stream.side_data_list) {
                    const sideData = stream.side_data_list.find(sd => sd.rotation !== undefined);
                    if (sideData) rotation = Math.round(sideData.rotation);
                }

                // 2. Transpose dimensions if rotated
                if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) {
                    if (DEBUG) console.log(`Detected rotation ${rotation}°, swapping visual dimensions.`);
                    [width, height] = [height, width];
                    if (darStr && darStr.includes(':')) {
                        const [n, d] = darStr.split(':').map(Number);
                        darStr = `${d}:${n}`;
                    }
                }

                // 3. Fallback for missing DAR
                if (!darStr || !darStr.includes(':')) {
                    darStr = `${width}:${height}`;
                }

                let [num, den] = darStr.split(':').map(Number);
                const actualRatio = width / height;
                const darRatio = num / den;

                if (DEBUG) console.log(`Visual Analysis: ${width}x${height}, DAR: ${darStr}, SAR: ${sar}`);

                // 4. Stretched portrait detection (Type 1)
                if (width > height && darRatio < 1.0) {
                    num = 9; den = 16;
                } else if (height > width && darRatio > 1.0) {
                    num = 16; den = 9;
                }

                // 5. Stretched portrait detection (Type 2 - SAR mismatch)
                if (sar && sar !== '1:1' && sar.includes(':')) {
                    const [sNum, sDen] = sar.split(':').map(Number);
                    const visualRatio = actualRatio * (sNum / sDen);
                    if (visualRatio < 1.0 && actualRatio >= 1.0) {
                        num = 9; den = 16;
                    }
                }

                dar = { ratio: `${num}:${den}`, decimal: num / den };
            }
        }

        const probeResult = { duration, dar, anamorphic, hdr, ok };
        videoProbeCache.set(normalizedPath, probeResult);
        return probeResult;

    } catch (error) {
        console.warn('probeVideo failed:', error.message);
        const fallback = { duration: 90, dar: null, anamorphic: false, hdr: false, ok: false };
        videoProbeCache.set(normalizedPath, fallback);
        return fallback;
    }
}

// Backward-compatible wrappers (now zero-cost via cache)
async function getVideoDuration(videoPath) {
    const probe = await probeVideo(videoPath);
    return probe.duration;
}

async function getVideoDAR(videoPath) {
    const probe = await probeVideo(videoPath);
    return probe.dar;
}

// ===== KEYFRAME PROBE (for accurate fast-copy splitting) =====
// Stream copy (-c copy) can ONLY cut a video on keyframes. If we cut at
// arbitrary times, ffmpeg extends each clip to the next keyframe, so clips
// balloon far past the target length (the "15-second clip" bug). This probe
// returns the keyframe timestamps so the splitter can plan cuts that land on
// them and stay on the fast copy path.
const keyframeCache = new Map();
async function getKeyframeTimes(videoPath) {
    const normalizedPath = path.normalize(videoPath);
    if (keyframeCache.has(normalizedPath)) return keyframeCache.get(normalizedPath);

    try {
        // Read packet flags only (demux, no decode -> fast). Keyframe packets
        // carry 'K' in their flags field.
        const command = [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'packet=pts_time,dts_time,flags',
            '-of', 'csv=print_section=0',
            normalizedPath
        ];

        const result = await electronAPI.spawnProcess(ffprobePath, command);
        if (result.code !== 0) { keyframeCache.set(normalizedPath, null); return null; }

        const times = [];
        for (const line of result.stdout.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parts = trimmed.split(',');
            const flags = parts[parts.length - 1] || '';
            if (!flags.includes('K')) continue; // not a keyframe
            let t = parseFloat(parts[0]);        // pts_time
            if (isNaN(t)) t = parseFloat(parts[1]); // fall back to dts_time
            if (!isNaN(t)) times.push(t);
        }
        times.sort((a, b) => a - b);

        const out = times.length ? times : null;
        keyframeCache.set(normalizedPath, out);
        if (DEBUG) console.log(`getKeyframeTimes: ${times.length} keyframes in ${path.basename(normalizedPath)}`);
        return out;
    } catch (e) {
        console.warn('getKeyframeTimes failed:', e.message);
        keyframeCache.set(normalizedPath, null);
        return null;
    }
}


function generateSpoofEffects(intensity, enableRotation = true) {
    if (!intensity) return null;

    const ranges = {
        light: { rotation: 1, brightness: 3, contrast: [98, 102], saturation: [99, 105], hue: 3 },
        medium: { rotation: 3, brightness: 6, contrast: [95, 105], saturation: [98, 108], hue: 6 },
        heavy: { rotation: 5, brightness: 10, contrast: [90, 110], saturation: [95, 115], hue: 10 }
    };

    const range = ranges[intensity] || ranges.medium;

    return {
        rotation: enableRotation ? ((Math.random() * range.rotation * 2) - range.rotation) : 0,
        enableRotation: enableRotation,
        brightness: (Math.random() * range.brightness * 2) - range.brightness,
        contrast: range.contrast[0] + (Math.random() * (range.contrast[1] - range.contrast[0])),
        saturation: range.saturation[0] + (Math.random() * (range.saturation[1] - range.saturation[0])),
        hue: (Math.random() * range.hue * 2) - range.hue,
        // The Golden Scale: 1.08x total (approx 8% zoom)
        // This covers up to 5 degrees of rotation without black gaps
        scale: 1.08 + (Math.random() * 0.02)
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

    // Escape text for drawtext. It's wrapped in single quotes below; inside
    // ffmpeg single quotes everything is literal except a single quote itself,
    // which must be closed-escaped-reopened as '\'' . We also set expansion=none
    // (later) so %, {} etc. are treated literally (F15).
    const escapedText = String(text).replace(/'/g, "'\\''");

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

    // fontfile is required on Windows (no fontconfig in the bundled ffmpeg). The
    // path is escaped for filtergraph syntax (drive-colon must become \: ) — F9.
    let fontArg = '';
    if (systemFontPath) {
        const escFont = systemFontPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        fontArg = `:fontfile=${escFont}`;
    }

    // Build the drawtext filter. Opacity is applied to the text color too (was
    // previously only applied to the background box).
    let filter = `drawtext=text='${escapedText}'${fontArg}:fontsize=${fontSize}:fontcolor=${colorString}@${opacityDecimal.toFixed(3)}:expansion=none:${positionString}:enable='between(t,0,999999)'`;

    // Add background if enabled
    if (backgroundEnabled && backgroundColor) {
        const bgRgb = hexToRgb(backgroundColor);
        const bgColorString = `0x${bgRgb.r.toString(16).padStart(2, '0')}${bgRgb.g.toString(16).padStart(2, '0')}${bgRgb.b.toString(16).padStart(2, '0')}`;
        filter += `:box=1:boxcolor=${bgColorString}@${opacityDecimal}:boxborderw=5`;
    }

    return filter;
}

/**
 * Metadata Engine — realistic device metadata / keep / strip.
 *
 * "Realistic" builds a COHERENT set of tags from a randomly chosen real device
 * profile (all of make/model/software/handlers/brand match one real phone) and,
 * critically, suppresses the tool fingerprints that flag a file as edited/AI —
 * the `Lavf...` encoder tag and the `x264 core ...` string baked into the video
 * bitstream — via bitexact. This makes an AI-generated or re-encoded clip look
 * like it came straight off a phone.
 */
const DEVICE_PROFILES = [
    { make: 'Apple',  apple: true,  models: ['iPhone 15 Pro', 'iPhone 15', 'iPhone 14 Pro', 'iPhone 14', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 12'], software: ['18.1', '17.5.1', '17.4.1', '17.1.2', '16.6.1', '16.5'], vHandler: 'Core Media Video', aHandler: 'Core Media Audio' },
    { make: 'Google', apple: false, models: ['Pixel 8 Pro', 'Pixel 8', 'Pixel 7 Pro', 'Pixel 7', 'Pixel 6a'], software: ['14', '13'], vHandler: 'VideoHandle', aHandler: 'SoundHandle' },
    { make: 'samsung', apple: false, models: ['SM-S928B', 'SM-S918B', 'SM-G991B', 'SM-A546B'], software: ['14', '13'], vHandler: 'VideoHandle', aHandler: 'SoundHandle' },
];

// Plausible capture locations (ISO 6709), lightly jittered so they're not identical.
const META_LOCATIONS = [
    { lat: 34.0522, lon: -118.2437, alt: 89 },   // Los Angeles
    { lat: 40.7128, lon: -74.0060, alt: 10 },    // New York
    { lat: 51.5074, lon: -0.1278, alt: 11 },     // London
    { lat: 25.7617, lon: -80.1918, alt: 2 },     // Miami
    { lat: 33.4484, lon: -112.0740, alt: 331 },  // Phoenix
];

function pad2(n) { return String(n).padStart(2, '0'); }

// Pick one coherent device profile with concrete model/software/date/location.
function pickDeviceProfile() {
    const prof = DEVICE_PROFILES[Math.floor(Math.random() * DEVICE_PROFILES.length)];
    const model = prof.models[Math.floor(Math.random() * prof.models.length)];
    const software = prof.software[Math.floor(Math.random() * prof.software.length)];

    // Random capture time within the last ~18 months.
    const now = Date.now();
    const when = new Date(now - Math.floor(Math.random() * 550 * 24 * 3600 * 1000));
    const createdUTC = when.toISOString().replace(/\.\d+Z$/, '.000000Z');
    // Local-style timestamp with a plausible negative tz offset (e.g. -0700).
    const tzHours = [4, 5, 6, 7, 8][Math.floor(Math.random() * 5)];
    const local = new Date(when.getTime() - tzHours * 3600 * 1000);
    const createdLocal = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}T${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}-${pad2(tzHours)}00`;

    const L = META_LOCATIONS[Math.floor(Math.random() * META_LOCATIONS.length)];
    const jLat = (L.lat + (Math.random() * 0.02 - 0.01));
    const jLon = (L.lon + (Math.random() * 0.02 - 0.01));
    const sign = (v, d) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(d)}`;
    const location = `${sign(jLat, 4)}${sign(jLon, 4)}${sign(L.alt, 3)}/`;

    return { make: prof.make, apple: prof.apple, model, software, vHandler: prof.vHandler, aHandler: prof.aHandler, createdUTC, createdLocal, location };
}

// Build the ffmpeg metadata arguments for a given output extension.
// mode: 'keep' | 'strip' | 'spoof' (from settings.metadataMode).
function metadataArgs(settings, outputExt) {
    const ext = (outputExt || '').toLowerCase();
    const mode = settings.metadataMode || 'spoof';

    if (mode === 'keep') return ['-map_metadata', '0'];
    if (mode === 'strip') return ['-map_metadata', '-1'];

    // --- spoof: realistic device metadata ---
    const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
    const mp4Exts = ['.mp4', '.mov', '.m4v'];
    const isImage = imageExts.includes(ext);
    const isMp4 = mp4Exts.includes(ext);
    // Pick a FRESH device profile for every output so N copies never share the
    // same phone/date/GPS (that identical fingerprint is exactly what the feature
    // exists to avoid). Each clip/copy therefore looks like a distinct capture.
    const p = pickDeviceProfile();

    // Clear source tags, and suppress the Lavf muxer encoder tag via bitexact.
    const args = ['-map_metadata', '-1', '-fflags', '+bitexact'];
    args.push('-metadata', `make=${p.make}`);
    args.push('-metadata', `model=${p.model}`);
    args.push('-metadata', `software=${p.software}`);
    args.push('-metadata', `creation_time=${p.createdUTC}`);

    if (isImage) {
        // ffmpeg's EXIF-writing for stills is limited; set what it will carry.
        args.push('-metadata', `DateTimeOriginal=${p.createdUTC}`);
        return args;
    }

    if (isMp4) {
        if (p.apple) {
            args.push('-metadata', `com.apple.quicktime.make=${p.make}`);
            args.push('-metadata', `com.apple.quicktime.model=${p.model}`);
            args.push('-metadata', `com.apple.quicktime.software=${p.software}`);
            args.push('-metadata', `com.apple.quicktime.creationdate=${p.createdLocal}`);
            if (p.location) args.push('-metadata', `com.apple.quicktime.location.ISO6709=${p.location}`);
        } else {
            args.push('-metadata', `com.android.version=${p.software}`);
            if (p.location) {
                args.push('-metadata', `location=${p.location}`);
                args.push('-metadata', `location-eng=${p.location}`);
            }
        }
    }

    // Per-stream handler names (harmless if a stream is absent).
    args.push('-metadata:s:v', `handler_name=${p.vHandler}`);
    if (!settings.removeAudio) args.push('-metadata:s:a', `handler_name=${p.aHandler}`);

    if (isMp4) {
        args.push('-brand', 'mp42');                       // Apple-style major brand
        args.push('-movflags', 'use_metadata_tags+faststart'); // custom keys + moov at front
    }
    return args;
}

// Universal "un-stretch" filter: converts non-square pixels to square pixels by
// scaling width by the sample aspect ratio, then stamping SAR=1. For normal
// (square-pixel) video this is an identity scale and costs nothing visually.
// This is what stops HandBrake/anamorphic videos from producing stretched thumbnails.
// Normalize non-square pixels to square by EXPANDING the deficient axis — the
// same way browsers/players compute a video's display size. This makes ffmpeg's
// working frame identical to what the in-app preview shows (e.g. an anamorphic
// 1080x1080 SAR 9:16 clip → 1080x1920, not 606x1080), so Crop pixel values match
// the preview exactly and posters/thumbnails aren't squished. Square-pixel
// sources (SAR 1) are unchanged. `\,` escapes the commas inside if() so the whole
// thing stays one filter in the chain.
const _SE = "(if(gt(sar\\,0)\\,sar\\,1))"; // effective SAR; undefined (0:1) treated as square (1)
const SAR_NORMALIZE =
    "scale=w='trunc(if(lt(" + _SE + "\\,1)\\,iw\\,iw*" + _SE + ")/2)*2'" +
    ":h='trunc(if(lt(" + _SE + "\\,1)\\,ih/" + _SE + "\\,ih)/2)*2'" +
    ",setsar=1";

// Optional downscale that caps the LONG edge and never upscales (keeps aspect).
// '' when the user keeps the original resolution.
function resolutionFilter(settings) {
    const map = { '1080': 1920, '1080p': 1920, '720': 1280, '720p': 1280, '480': 854, '480p': 854 };
    const long = map[settings && settings.resolution];
    if (!long) return '';
    return `scale='if(gt(iw,ih),min(iw\\,${long}),-2)':'if(gt(iw,ih),-2,min(ih\\,${long}))':flags=lanczos`;
}

// Optional mirror/flip.
function mirrorFilter(settings) {
    if (!settings) return '';
    if (settings.mirror === 'h' || settings.mirror === 'horizontal') return 'hflip';
    if (settings.mirror === 'v' || settings.mirror === 'vertical') return 'vflip';
    return '';
}

// Optional 90/180/270 rotation.
function rotateFilter(settings) {
    const r = settings && settings.rotate;
    if (r === '90' || r === 'cw') return 'transpose=1';
    if (r === '270' || r === 'ccw') return 'transpose=2';
    if (r === '180') return 'transpose=1,transpose=1';
    return '';
}

// Optional crop — trim pixels off each edge (like HandBrake). Changes the real
// output dimensions (no padding/black bars). Coordinates are in the SOURCE's
// displayed pixels, which is exactly what the live preview shows. trunc(...)*2
// keeps width/height even for yuv420p; no commas so it drops into a filter chain.
function cropFilter(settings) {
    const c = settings && settings.crop;
    if (!c || !c.enabled) return '';
    const t = Math.max(0, parseInt(c.top) || 0);
    const b = Math.max(0, parseInt(c.bottom) || 0);
    const l = Math.max(0, parseInt(c.left) || 0);
    const r = Math.max(0, parseInt(c.right) || 0);
    if (!(t || b || l || r)) return '';
    // Crash-proof for ANY input size: width/height are floored at 2 and kept even
    // (yuv420p); the x/y offsets are clamped with ow/oh so x+ow<=iw, y+oh<=ih even
    // if a crop exceeds a particular file's dimensions in a mixed batch. The "\,"
    // escapes the comma inside max()/min() so it stays one filter in the chain.
    const w = `max(2\\,trunc((iw-${l}-${r})/2)*2)`;
    const h = `max(2\\,trunc((ih-${t}-${b})/2)*2)`;
    return `crop=${w}:${h}:min(${l}\\,iw-ow):min(${t}\\,ih-oh)`;
}

// Optional speed change — video timestamps (setpts) and audio tempo (atempo).
function speedFactor(settings) {
    const s = parseFloat(settings && settings.speed);
    return (!s || isNaN(s) || s === 1) ? 0 : s;
}
function speedVideoFilter(settings) {
    const s = speedFactor(settings);
    return s ? `setpts=${(1 / s).toFixed(5)}*PTS` : '';
}
function speedAudioFilter(settings) {
    const s = speedFactor(settings);
    if (!s) return '';
    const c = Math.max(0.5, Math.min(2, s)); // atempo valid range
    return `atempo=${c.toFixed(3)}`;
}

// Trim + loop input arguments (one-file output). Returns args to place BEFORE the
// input (-ss start / -stream_loop N) and the duration to cap AFTER it (-t).
function inputTrimLoopArgs(settings) {
    const pre = [];
    let t = null;
    if (settings && settings.trim && settings.trim.enabled) {
        const s = Math.max(0, parseFloat(settings.trim.start) || 0);
        const e = parseFloat(settings.trim.end);
        if (s > 0) pre.push('-ss', String(s));
        if (!isNaN(e) && e > s) t = +(e - s).toFixed(3);
    }
    if (settings && settings.loop && settings.loop.enabled) {
        const n = parseInt(settings.loop.count) || 0;
        if (n > 0) pre.unshift('-stream_loop', String(n));
    }
    return { pre, t };
}

// HDR (HLG / Dolby Vision PQ / BT.2020) -> SDR BT.709 tone-map. iPhone HDR video
// looks washed-out/dark if simply squashed to 8-bit; this maps it properly.
const HDR_TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv:dither=error_diffusion';

// Container muxer flags (format + fast-start). Fast-start (moov atom at the
// front) makes mp4/mov play/upload instantly; the spoof metadata path adds its
// own combined -movflags, so we only add faststart here when it won't.
function containerArgs(outputExt, settings) {
    const args = [];
    if (outputExt === '.mov') args.push('-f', 'mov');
    else if (outputExt === '.avi') args.push('-f', 'avi');
    else if (outputExt === '.mkv') args.push('-f', 'matroska');
    const isMp4 = ['.mp4', '.mov', '.m4v'].includes(outputExt);
    if (isMp4 && settings.metadataMode !== 'spoof') args.push('-movflags', '+faststart');
    return args;
}

// Video codec + quality/compression arguments.
// - "Shrink" mode (settings.compress): pick the encoder by speed preference —
//   the hardware chip (QuickSync etc.) when "fast", libx264 when "smaller/slower"
//   or when no chip is available — and map a 0-4 "squeeze" dial to quality.
// - Otherwise: honor the plain quality preset (F10).
// Always tags BT.709 colour (prevents washed/greenish SDR output) and sets an
// H.264 profile/level for broad device compatibility.
function videoEncodeArgs(outputExt, settings, hdr = false) {
    const args = [];
    const isWebm = outputExt === '.webm';
    const compress = !!settings.compress;
    const squeeze = Math.max(0, Math.min(4, settings.compressLevel != null ? settings.compressLevel : 2));
    // "smaller/slower" mode = user explicitly wants max-quality software libx264.
    // Everything else defaults to the GPU chip (QuickSync/NVENC) for speed — the
    // big win on this weak Intel HD 620 (5-10x faster than libx264).
    const forceQuality = settings.encodeMode === 'quality';
    // Base visual quality from the preset when NOT shrinking (roughly matches
    // libx264 CRF 20/23/26 for high/medium/low).
    const q = getQualitySettings(settings.videoQuality || 'high');
    const baseCrf = q.crf != null ? q.crf : 23;
    const useGpu = !isWebm && !forceQuality && (hwEncoder === 'h264_qsv' || hwEncoder === 'h264_nvenc');
    let usedLibx264 = false;

    if (isWebm) {
        // VP9 (software). Multi-threaded rows + good deadline keep it from crawling.
        const vpCrf = compress ? [28, 31, 33, 36, 38][squeeze] : (q.webmCrf != null ? q.webmCrf : 30);
        args.push('-c:v', 'libvpx-vp9', '-crf', String(vpCrf), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4');
    } else if (useGpu && hwEncoder === 'h264_qsv') {
        // DEFAULT: Intel QuickSync (hardware). Fast on weak laptops. When shrinking,
        // use the squeeze dial; otherwise map the quality preset to a comparable
        // global_quality (QSV gq ~= libx264 CRF + a couple points).
        const gq = compress ? [22, 25, 28, 31, 34][squeeze] : Math.max(18, Math.min(40, baseCrf + 2));
        args.push('-c:v', 'h264_qsv', '-global_quality', String(gq), '-preset', 'faster', '-profile:v', 'high', '-g', '60', '-pix_fmt', 'nv12');
        args.push(...containerArgs(outputExt, settings));
    } else if (useGpu && hwEncoder === 'h264_nvenc') {
        // DEFAULT: NVIDIA NVENC (hardware).
        const cq = compress ? [22, 25, 28, 31, 34][squeeze] : Math.max(18, Math.min(40, baseCrf + 2));
        args.push('-c:v', 'h264_nvenc', '-rc', 'vbr', '-cq', String(cq), '-preset', 'p5', '-profile:v', 'high', '-g', '60', '-pix_fmt', 'yuv420p');
        args.push(...containerArgs(outputExt, settings));
    } else {
        // Software libx264 — used for webm fallback, "smaller/slower" quality mode,
        // or when no hardware chip is available. Compress -> higher CRF.
        const crf = compress ? [20, 23, 26, 28, 30][squeeze] : baseCrf;
        const preset = compress ? (forceQuality ? 'veryslow' : 'veryfast') : (forceQuality ? 'slow' : (q.preset || 'fast'));
        // ~2s keyframe interval keeps GOPs dense so Spoof+Split's fast copy can
        // find a keyframe in every 6-8s window (avoids re-encoding clips).
        args.push('-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high', '-level', '4.2', '-g', '60', '-keyint_min', '30', '-pix_fmt', 'yuv420p');
        args.push(...containerArgs(outputExt, settings));
        usedLibx264 = true;
    }

    // Force constant frame rate so re-encoded VFR sources (iPhone / screen
    // recordings) don't drift audio out of sync and platforms don't re-transcode.
    if (!isWebm) args.push('-fps_mode', 'cfr');

    // Tag BT.709 for SDR/tone-mapped HDR output (prevents colour drift). VP9/webm
    // carries colour tags in-stream too; harmless there.
    args.push('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv');

    // Strip the "x264 core ..." fingerprint SEI in realistic-metadata mode. Only
    // libx264 writes that SEI (hardware encoders don't), and bitexact is a libx264 flag.
    if (settings.metadataMode === 'spoof' && usedLibx264) {
        args.push('-flags:v', '+bitexact');
    }
    return args;
}

// Audio arguments, chosen once so we never emit conflicting -c:a flags (F26).
// Standardize to stereo 48kHz (what social platforms expect; also downmixes 5.1
// so centre-channel dialogue isn't lost).
function audioEncodeArgs(outputExt, settings) {
    if (settings.removeAudio) return ['-an'];
    // aresample=async keeps audio locked to the (now CFR) video; atempo matches a
    // speed change so audio pitch/length track the video.
    const atempo = speedAudioFilter(settings);
    const af = (atempo ? atempo + ',' : '') + 'aresample=async=1:first_pts=0';
    const common = ['-ac', '2', '-ar', '48000', '-af', af];
    if (outputExt === '.webm') return ['-c:a', 'libopus', '-b:a', '128k', ...common];
    return ['-c:a', 'aac', '-b:a', '160k', ...common];
}

// Correct pixel format per image codec. PNG rejects yuv420p, so it must use an
// RGB format (F8); JPG/WebP use yuv420p.
function imagePixFmt(outputExt) {
    if (outputExt === '.png') return 'rgb24';
    // JPEG is full-range: yuvj420p avoids the washed-out contrast of limited-range yuv420p.
    if (outputExt === '.jpg' || outputExt === '.jpeg') return 'yuvj420p';
    return 'yuv420p';
}

/**
 * Master Filter Engine: Unifies all processing modes (Spoof, Split, Convert)
 * into a single-pass, crash-proof architecture.
 *
 * @param {object} settings - Processing settings
 * @param {object|null} effects - Spoof effects (null for convert/split only)
 * @param {object|null} originalDAR - Display Aspect Ratio from ffprobe (null for images)
 * @param {boolean} isImage - If true, preserves the original image dimensions
 *                            instead of forcing into a 1080p container
 */
function buildMasterFilter(settings, effects, originalDAR, isImage = false, hdr = false) {

    // --- IMAGE PATH: preserve original dimensions, just apply spoof effects ---
    if (isImage) {
        let filterComplex = '';

        if (effects) {
            // Base spoof scale for DNA uniqueness
            let scaleVal = (effects.scale || 1.08);

            // ROTATION-AWARE SCALE: mathematically guarantees zero black corners
            // When a W×H rectangle is rotated by angle θ, the minimum scale to
            // ensure no black in corners when cropping back to W×H from center is:
            //   s = cos(|θ|) + max(W/H, H/W) · sin(|θ|)
            // Since image dims are unknown at build time, we use R=1.78 (16:9 ratio)
            // as a safe worst-case for standard photo formats.
            if (effects.enableRotation && effects.rotation !== 0) {
                const absRad = Math.abs(effects.rotation * Math.PI / 180);
                const R = 1.78; // max standard aspect ratio (16:9)
                const rotScale = Math.cos(absRad) + R * Math.sin(absRad);
                scaleVal = Math.max(scaleVal, rotScale);
            }

            // Use FFmpeg's iw/ih (input width/height) expressions
            filterComplex = `scale=trunc(iw*${scaleVal.toFixed(6)}/2)*2:trunc(ih*${scaleVal.toFixed(6)}/2)*2`;

            if (effects.enableRotation && effects.rotation !== 0) {
                const rotateRad = (effects.rotation * Math.PI / 180).toFixed(6);
                // ow=iw:oh=ih keeps output canvas same size as scaled-up input.
                // The rotation-aware scale guarantees the crop region is fully
                // covered by the rotated content — no black corners.
                filterComplex += `,rotate=${rotateRad}:ow=iw:oh=ih:fillcolor=black`;
            }

            // Crop back to original dimensions from center with DNA offset
            const offXPct = (Math.random() * 0.01 - 0.005).toFixed(6);
            const offYPct = (Math.random() * 0.01 - 0.005).toFixed(6);
            filterComplex += `,crop=trunc(iw/${scaleVal.toFixed(6)}/2)*2:trunc(ih/${scaleVal.toFixed(6)}/2)*2:(iw-ow)/2+trunc(iw*${offXPct}):(ih-oh)/2+trunc(ih*${offYPct})`;

            const brightness = (effects.brightness / 100).toFixed(3);
            const contrast = (effects.contrast / 100).toFixed(3);
            const saturation = (effects.saturation / 100).toFixed(3);
            const hue = (effects.hue || 0).toFixed(3);
            filterComplex += `,eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation},hue=h=${hue}`;
        } else {
            // Convert-only for images: no dimension change
            filterComplex = `scale=trunc(iw/2)*2:trunc(ih/2)*2`;
        }

        // Watermark + SAR fix (pixel format is set on the command via -pix_fmt so
        // PNG output isn't forced into an incompatible yuv420p — see F8).
        const watermarkFilter = generateWatermarkFilter(settings.watermark);
        if (watermarkFilter) {
            filterComplex += `,${watermarkFilter}`;
        }
        filterComplex += `,setsar=1:1`;

        return filterComplex;
    }

    // --- VIDEO PATH ---
    // Design: AUTO preserves the source's true shape/resolution exactly (no forced
    // box, no crop). Force Portrait/Landscape FITS the content into the target with
    // padding (no crop, no over-zoom). Spoof "DNA" (zoom+tilt+colour) is applied to
    // the content and cropped back to the SOURCE size, so it never over-zooms.
    const targetOrientation = settings.orientation || 'auto';
    const parts = [];

    // 0. HDR -> SDR tone-map for iPhone HLG / Dolby Vision (rendered flat/washed
    //    out otherwise). Gated on the probe detecting an HDR transfer (P1).
    if (hdr) {
        parts.push(HDR_TONEMAP);
    }

    // 1. Normalize non-square pixels to square, preserving the true display shape.
    parts.push(SAR_NORMALIZE);

    // 1a. Crop edges (HandBrake-style). Done here — on the natural displayed frame
    //     that the preview shows — so pixel values match what the user set. Runs
    //     before spoof/reframe/scale so everything downstream sees the cropped frame.
    const crp = cropFilter(settings);
    if (crp) parts.push(crp);

    // 1b. Explicit 90/180/270 rotation (before everything else so downstream
    //     steps see the rotated frame).
    const rot = rotateFilter(settings);
    if (rot) parts.push(rot);

    // 2. Spoof DNA — oversize, optional tilt, crop back to the SOURCE dimensions.
    //    The scale is rotation-aware so a tilt never leaves black corners (P2).
    if (effects) {
        let S = (effects.scale || 1.08);
        if (effects.enableRotation && effects.rotation !== 0) {
            const absRad = Math.abs(effects.rotation * Math.PI / 180);
            const R = 1.78; // worst-case aspect (16:9) — dims unknown at build time
            S = Math.max(S, Math.cos(absRad) + R * Math.sin(absRad));
        }
        const s = S.toFixed(6);
        parts.push(`scale=trunc(iw*${s}/2)*2:trunc(ih*${s}/2)*2`);
        if (effects.enableRotation && effects.rotation !== 0) {
            const rotateRad = (effects.rotation * Math.PI / 180).toFixed(6);
            parts.push(`rotate=${rotateRad}:ow=iw:oh=ih:fillcolor=black`);
        }
        const offX = (Math.random() * 0.01 - 0.005).toFixed(6);
        const offY = (Math.random() * 0.01 - 0.005).toFixed(6);
        parts.push(`crop=trunc(iw/${s}/2)*2:trunc(ih/${s}/2)*2:(iw-ow)/2+trunc(iw*${offX}):(ih-oh)/2+trunc(ih*${offY})`);
        const brightness = (effects.brightness / 100).toFixed(3);
        const contrast = (effects.contrast / 100).toFixed(3);
        const saturation = (effects.saturation / 100).toFixed(3);
        const hue = (effects.hue || 0).toFixed(3);
        parts.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`, `hue=h=${hue}`);
    }

    // 3. Forced orientation: FIT into the target box (no crop). AUTO skips this and
    //    keeps the source shape. Two fill styles: black bars, or a blurred zoomed
    //    copy of the video behind the fitted content (nice for Reels/TikTok).
    const forcedModes = ['portrait', 'landscape', 'portrait-blur', 'landscape-blur'];
    if (forcedModes.includes(targetOrientation)) {
        const isPortrait = targetOrientation.startsWith('portrait');
        const targetW = isPortrait ? 1080 : 1920;
        const targetH = isPortrait ? 1920 : 1080;
        if (targetOrientation.endsWith('-blur')) {
            // Split the (already spoofed) frame: one copy is scaled to COVER and
            // blurred as the background, the other is fitted on top, centred.
            parts.push(
                `split[__b][__f];` +
                `[__b]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},gblur=sigma=20[__bg];` +
                `[__f]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease[__fg];` +
                `[__bg][__fg]overlay=(W-w)/2:(H-h)/2`
            );
        } else {
            parts.push(
                `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
                `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`
            );
        }
    }

    // 4. Mirror / flip (before watermark so text stays readable).
    const mir = mirrorFilter(settings);
    if (mir) parts.push(mir);

    // 5. Optional downscale (cap the long edge; never upscale).
    const res = resolutionFilter(settings);
    if (res) parts.push(res);

    // 5b. Speed change (video side) — audio is retimed in audioEncodeArgs.
    const spd = speedVideoFilter(settings);
    if (spd) parts.push(spd);

    // 6. Watermark
    const watermarkFilter = generateWatermarkFilter(settings.watermark);
    if (watermarkFilter) parts.push(watermarkFilter);

    // 7. Square pixels + 8-bit 4:2:0 output for universal compatibility.
    parts.push('setsar=1', 'format=yuv420p');

    return parts.join(',');
}

async function processImageSpoof(inputPath, outputPath, effects, settings, updateProgress) {
    // HEIC PRE-CONVERSION: Convert HEIC/HEIF to temp JPEG first
    let actualInput = inputPath;
    const ext = (path.parse(inputPath).ext || "").toLowerCase();

    // Fallback logic
    let needsMap = false;
    let fallbackMap = '0:v:0';

    if (ext === '.heic' || ext === '.heif') {
        console.log('[HEIC] Detected HEIC input, pre-converting to temp JPEG...');
        const tempPath = await convertHeicToTemp(inputPath, 'spoof');
        if (tempPath) {
            actualInput = tempPath;
            console.log('[HEIC] Using pre-converted JPEG:', actualInput);
        } else {
            console.error('[HEIC] Pre-conversion failed!');

            // STRICT MODE for macOS:
            // If sips fails, we MUST NOT fall back to FFmpeg, because FFmpeg produces B/W/Garbage.
            // We should error out to let the user know something is wrong with sips/file access.
            const platform = await electronAPI.getPlatform();
            if (platform === 'darwin') {
                throw new Error('HEIC Conversion Failed: Native sips tool failed to convert image. Check logs for details.');
            }

            console.warn('[HEIC] Falling back to FFmpeg Smart Selection (Windows/Linux behavior).');
            needsMap = true;
            fallbackMap = await getBestHeicStreamMap(inputPath);
            console.log('[HEIC] Fallback Stream Map:', fallbackMap);
        }
    }

    if (!effects) {
        return convertImage(actualInput, outputPath, settings);
    }

    console.log('[ImageSpoof] Applied Effects:', JSON.stringify(effects));

    updateProgress(50);

    return new Promise((resolve, reject) => {
        // Use the Master Filter Engine — isImage=true preserves original photo dimensions
        const filterComplex = buildMasterFilter(settings, effects, null, true);

        const command = [
            '-y',
            '-i', actualInput,
        ];

        // If we are using raw HEIC fallback, apply the calculated map
        if (needsMap) {
            command.push('-map', fallbackMap);
        } else {
            // FORCE standard video stream 0:v:0 for JPEGs too
            // This prevents FFmpeg from auto-selecting embedded depth maps/masks
            // that might be preserved in the JPEG metadata by sips.
            command.push('-map', '0:v:0');
        }

        const imgExt = (path.parse(outputPath).ext || "").toLowerCase();
        command.push(
            '-vf', filterComplex,
            '-pix_fmt', imagePixFmt(imgExt),
            ...metadataArgs(settings, imgExt)
        );

        // Apply the image quality preset (previously ignored in spoof mode — 1.2).
        const q = getQualitySettings(settings.imageQuality || 'high');
        if (imgExt === '.jpg' || imgExt === '.jpeg') command.push('-q:v', String(q.jpgQuality != null ? q.jpgQuality : 3));
        else if (imgExt === '.webp') command.push('-quality', String(q.webpQuality != null ? q.webpQuality : 90));

        command.push(outputPath);

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

    return new Promise(async (resolve, reject) => {
        // Ensure proper path handling for Windows
        const normalizedInputPath = path.normalize(inputPath);
        const normalizedOutputPath = path.normalize(outputPath);

        // Determine output format from file extension
        const outputExt = (path.parse(normalizedOutputPath).ext || "").toLowerCase();

        // Single probe: DAR + HDR flag
        const srcProbe = await probeVideo(normalizedInputPath);
        const originalDAR = srcProbe.dar;
        if (DEBUG) console.log('Original video DAR:', originalDAR ? `${originalDAR.ratio} (${originalDAR.decimal})` : 'unknown', 'HDR:', srcProbe.hdr);

        // Use the Master Filter Engine (Single-Pass Everything)
        const filterComplex = buildMasterFilter(settings, effects, originalDAR, false, srcProbe.hdr);

        const _tl = inputTrimLoopArgs(settings);
        const command = [
            '-y',
            ..._tl.pre,
            '-i', normalizedInputPath,
            ...(_tl.t ? ['-t', String(_tl.t)] : []),
            '-vf', filterComplex,
            ...metadataArgs(settings, outputExt)
        ];

        if (DEBUG) console.log('Single-Pass Video Spoof Filter:', filterComplex);

        if (DEBUG) console.log('Full FFmpeg command:', command);

        // Quality-aware video codec (F10) + non-conflicting audio (F26)
        command.push(...videoEncodeArgs(outputExt, settings, srcProbe.hdr));
        command.push(...audioEncodeArgs(outputExt, settings));

        command.push(normalizedOutputPath);

        if (DEBUG) console.log('Processing video spoof:', { input: normalizedInputPath, output: normalizedOutputPath, format: outputExt });

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


async function processVideoSplit(file, outputDir, settings, applySpoof = false, updateProgress, fileIndex = 0) {
    const probe = await probeVideo(file.path); // single probe: duration, DAR, anamorphic
    if (!probe.ok) {
        // Don't fabricate a 90s timeline for an unreadable file (F18).
        throw new Error(`Could not read video "${file.name}" — it may be corrupt or an unsupported format.`);
    }
    const duration = probe.duration;
    const originalDAR = probe.dar;
    console.log('Video splitting:', { filePath: file.path, duration, applySpoof, anamorphic: probe.anamorphic, settings });
    addStatusMessage(`Processing video: ${duration.toFixed(2)} seconds total`, 'info');

    // Determine clip length target based on settings.
    // minLen/maxLen define the acceptable window a keyframe cut may land in;
    // idealFor() is the preferred length we aim the cut at.
    const clipLengthSetting = settings.clipLength || '6-8';
    let minLen, maxLen, idealFor;

    switch (clipLengthSetting) {
        case '8':
            minLen = 6.5; maxLen = 9.5; idealFor = () => 8;
            break;
        case '10':
            minLen = 8; maxLen = 12; idealFor = () => 10;
            break;
        case '15':
            minLen = 12; maxLen = 18; idealFor = () => 15;
            break;
        default: // '6-8' (each clip independently randomised 6-8s)
            minLen = 6; maxLen = 8; idealFor = () => 6 + Math.random() * 2;
    }

    // Determine fast copy eligibility (Proposal 1: Split Only Speedup).
    // Fast copy is only safe when NOT spoofing, NOT watermarking, NOT forcing
    // orientation — AND the source has square pixels. Anamorphic/HandBrake video
    // (non-1:1 SAR) must be re-encoded to square pixels or its clips get stretched
    // thumbnails (F3).
    // Mirror, rotate, speed, downscale, or shrink/compress all require a re-encode too.
    const _needsFilter = mirrorFilter(settings) || rotateFilter(settings) || speedVideoFilter(settings) || resolutionFilter(settings) || cropFilter(settings) || settings.compress;
    const useFastCopy = !applySpoof &&
        (!settings.watermark || !settings.watermark.enabled) &&
        (settings.orientation === 'auto') &&
        !probe.anamorphic &&
        !_needsFilter;

    if (probe.anamorphic && !applySpoof) {
        addStatusMessage('Non-square pixels detected — re-encoding to square pixels so thumbnails are correct.', 'info');
    }

    // For non-spoof re-encodes, decide whether to reframe (watermark or forced
    // orientation) or just fix pixel shape while preserving the original framing.
    const reframe = (settings.watermark && settings.watermark.enabled) ||
        (settings.orientation && settings.orientation !== 'auto');
    const minimalSplitFilter = [
        probe.hdr ? HDR_TONEMAP : null,
        SAR_NORMALIZE,
        cropFilter(settings) || null,
        rotateFilter(settings) || null,
        mirrorFilter(settings) || null,
        resolutionFilter(settings) || null,
        speedVideoFilter(settings) || null,
        'format=yuv420p'
    ].filter(Boolean).join(',');

    // For the fast copy path we must cut on keyframes. Probe their positions so
    // we can plan cuts that land on them; a clip only falls back to a precise
    // re-encode when no keyframe fits its target window (sparse-keyframe video).
    let keyframes = null;
    if (useFastCopy) {
        keyframes = await getKeyframeTimes(file.path);
        if (!keyframes || keyframes.length < 2) {
            console.warn('SplitOnly: keyframe data unavailable, using precise re-encode for accuracy');
            keyframes = null;
        } else {
            console.log(`SplitOnly: keyframe-aware fast copy (${keyframes.length} keyframes)`);
        }
    }

    const EPS = 0.05;
    const isKeyframe = (t) => keyframes && keyframes.some(k => Math.abs(k - t) <= EPS);
    // Nearest keyframe to (start + ideal) that falls within [start+minLen, start+maxLen].
    const pickKeyframe = (start, ideal) => {
        if (!keyframes) return null;
        const lo = start + minLen, hi = start + maxLen, target = start + ideal;
        let best = null, bestDiff = Infinity;
        for (const k of keyframes) {
            if (k <= start + EPS) continue;
            if (k < lo - EPS || k > hi + EPS) continue;
            const d = Math.abs(k - target);
            if (d < bestDiff) { bestDiff = d; best = k; }
        }
        return best;
    };

    // Build the clip plan.
    const clips = [];
    let startTime = 0;
    let clipNumber = 1;

    while (duration - startTime > 0.5) {
        const ideal = idealFor();
        let endTime;
        let needsReencode;

        if (keyframes) {
            const kf = pickKeyframe(startTime, ideal);
            if (kf !== null && isKeyframe(startTime)) {
                // Start and end both on keyframes -> clean, instant stream copy.
                endTime = kf; needsReencode = false;
            } else if (kf !== null) {
                // A keyframe fits the window but our start isn't one (we're
                // recovering after a sparse patch). Re-encode this clip to
                // re-align the chain back onto keyframes.
                endTime = kf; needsReencode = true;
            } else {
                // No keyframe in the acceptable window (sparse region): the only
                // way to hit the target length is a precise re-encode.
                endTime = Math.min(startTime + ideal, duration);
                needsReencode = true;
            }
        } else {
            // Spoof path, or fast-copy probe failed: always cut precisely.
            endTime = Math.min(startTime + ideal, duration);
            needsReencode = true;
        }

        endTime = Math.min(endTime, duration);
        if (endTime - startTime < 3) break; // Skip a too-short tail

        clips.push({
            start: startTime,
            duration: endTime - startTime,
            needsReencode,
            number: clipNumber++
        });

        startTime = endTime;
    }

    // Don't report success when the video was too short to make even one clip (F19).
    if (clips.length === 0) {
        throw new Error(`"${file.name}" is too short to split into clips (${duration.toFixed(1)}s). No output was produced.`);
    }

    console.log('Clips created:', clips.length, clips);
    addStatusMessage(`Created ${clips.length} clips: ${clips.map(c => `${c.duration.toFixed(1)}s`).join(', ')}`, 'info');

    if (useFastCopy) {
        const reencoded = clips.filter(c => c.needsReencode).length;
        if (reencoded > 0) {
            console.log(`SplitOnly: ${clips.length - reencoded} clips via fast copy, ${reencoded} re-encoded (sparse keyframes)`);
        }
    }

    // Process each clip
    for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const clipPath = generateOutputPathForBatch(file, outputDir, settings, clip.number, fileIndex);

        // Update progress based on clip progress
        const clipProgress = (i / clips.length) * 80 + 10; // 10-90%
        updateProgress(clipProgress);

        // A clip uses the fast copy path only when the whole job is copy-eligible
        // AND this clip's boundaries land on keyframes. Sparse-keyframe clips are
        // flagged needsReencode so they get a precise cut instead of ballooning.
        const clipCanCopy = useFastCopy && !clip.needsReencode;

        if (clipCanCopy) {
            // FAST PATH: Stream Copy (start and end are both keyframes).
            const clipExt = (path.parse(clipPath).ext || "").toLowerCase();
            const command = [
                '-y',
                '-ss', clip.start.toString(),
                '-i', file.path,
                '-t', clip.duration.toString(),
                '-c', 'copy',
                ...metadataArgs(settings, clipExt),
                clipPath
            ];

            // Audio handling for stream copy
            // If removing audio, we can just use -an
            if (settings.removeAudio) {
                // Find index of '-c' 'copy' and replace/append
                // Actually -an overrides -c:a copy usually, but safely:
                command.splice(command.indexOf('copy') + 1, 0, '-an');
            }

            console.log('Fast Split (keyframe copy):', command.join(' '));
            await spawnFFmpeg(command);
        } else {
            // PRECISE PATH: Re-encode (Spoofing / Watermarking / Exact Cuts /
            // anamorphic normalization / sparse-keyframe clips).
            if (applySpoof) {
                const effects = generateSpoofEffects(settings.intensity, settings.enableRotation !== false);
                await processVideoClipWithEffects(file.path, clipPath, clip, effects, settings, originalDAR, null, probe.hdr);
            } else {
                // Split-only re-encode: reframe (watermark/forced orientation) uses
                // the master filter; otherwise just fix pixel shape and keep framing.
                const filterOverride = reframe ? null : minimalSplitFilter;
                await processVideoClipWithEffects(file.path, clipPath, clip, null, settings, originalDAR, filterOverride, probe.hdr);
            }
        }

        outputCount++;
    }

    updateProgress(100);
}

async function processVideoClipWithEffects(inputPath, outputPath, clip, effects, settings, originalDAR = null, filterOverride = null, hdr = false) {
    return new Promise(async (resolve, reject) => {
        // Ensure proper path handling for Windows
        const normalizedInputPath = path.normalize(inputPath);
        const normalizedOutputPath = path.normalize(outputPath);

        // Determine output format from file extension
        const outputExt = (path.parse(normalizedOutputPath).ext || "").toLowerCase();

        // If DAR wasn't passed, probe it once
        const dar = originalDAR || await getVideoDAR(normalizedInputPath);

        // Use the caller's minimal filter when provided (split re-encode that must
        // preserve framing), otherwise the full Master Filter Engine.
        const filterComplex = filterOverride || buildMasterFilter(settings, effects, dar, false, hdr);

        const command = [
            '-y',
            '-ss', clip.start.toString(),
            '-i', normalizedInputPath,
            '-t', clip.duration.toString(),
            '-vf', filterComplex,
            ...metadataArgs(settings, outputExt),
            // Quality-aware video codec (F10) + non-conflicting audio (F26)
            ...videoEncodeArgs(outputExt, settings, hdr),
            ...audioEncodeArgs(outputExt, settings)
        ];

        command.push(normalizedOutputPath);
        console.log('Single-Pass Clip Extraction:', command.join(' '));
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

async function convertImage(inputPath, outputPath, settings) {
    let effectiveInputPath = inputPath;
    const originalExt = (path.parse(inputPath).ext || "").toLowerCase();

    // macOS HEIC FIX: Pre-convert using sips to ensure correct color stream (matches Finder)
    const platform = await electronAPI.getPlatform();
    if (platform === 'darwin' && (originalExt === '.heic' || originalExt === '.heif')) {
        console.log('[Export] macOS HEIC detected, pre-converting with sips...');
        const tempHeicJpg = await convertHeicToTemp(inputPath, 'export-sips-preconvert');
        if (tempHeicJpg) {
            effectiveInputPath = tempHeicJpg;
        } else {
            // STRICT MODE: If sips fails, throw error. Do not allow B/W fallback.
            throw new Error('HEIC Conversion Failed: Native sips tool failed. Check logs.');
        }
    }

    // Windows/Linux: Smart FFmpeg Stream Selection (only if input is still HEIC)
    // If pre-converted on macOS, effectiveInputPath is .jpg, so this block is skipped
    const currentExt = (path.parse(effectiveInputPath).ext || "").toLowerCase();
    let streamMap = '0:v:0';

    if (currentExt === '.heic' || currentExt === '.heif') {
        streamMap = await getBestHeicStreamMap(effectiveInputPath);
        console.log(`[Image] Smart selection for ${path.basename(effectiveInputPath)}: ${streamMap}`);
    }

    return new Promise((resolve, reject) => {
        // Convert FIRST approach - always convert to target format for consistent processing

        let command = [
            '-y',
            '-i', effectiveInputPath,
        ];

        // For HEIC/HEIF, force selection of the BEST video stream (color)
        // If pre-converted (macOS), currentExt is .jpg, so this block is SKIPPED
        if (currentExt === '.heic' || currentExt === '.heif') {
            command.push('-map', streamMap);
        } else {
            // FORCE standard video stream 0:v:0 for other images (including sips JPEGs)
            // This prevents FFmpeg from auto-selecting embedded depth maps/masks
            command.push('-map', '0:v:0');
        }

        const outputExt = (path.parse(outputPath).ext || "").toLowerCase();

        command.push(
            '-pix_fmt', imagePixFmt(outputExt),
            ...metadataArgs(settings, outputExt)
        );

        // Always normalize to even dimensions with square pixels (SAR_NORMALIZE
        // fixes non-square-pixel sources; identity for normal images). Watermark
        // is prepended when enabled.
        const watermarkFilter = generateWatermarkFilter(settings.watermark);
        const finalFilter = watermarkFilter
            ? `${watermarkFilter},${SAR_NORMALIZE}`
            : SAR_NORMALIZE;
        command.push('-vf', finalFilter);

        // Add quality settings for image conversion
        const qualitySettings = getQualitySettings(settings.imageQuality || 'high');

        switch (outputExt) {
            case '.jpg':
            case '.jpeg':
                command.push('-q:v', String(qualitySettings.jpgQuality != null ? qualitySettings.jpgQuality : 2)); // Lower = better quality
                break;
            case '.webp':
                command.push('-quality', String(qualitySettings.webpQuality != null ? qualitySettings.webpQuality : 90)); // 0-100, higher = better
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
    return new Promise(async (resolve, reject) => {
        // Ensure proper path handling for Windows
        const normalizedInputPath = path.normalize(inputPath);
        const normalizedOutputPath = path.normalize(outputPath);
        const outputExt = (path.parse(normalizedOutputPath).ext || "").toLowerCase();

        // 1. Smart Re-encoding Decision
        const probe = await probeVideo(normalizedInputPath);
        let needsReencoding = needsVideoReencoding(normalizedInputPath, outputExt, settings);

        // Force re-encode if orientation lock is active (Portrait/Landscape or blurred)
        const isForcedOrientation = settings.orientation && settings.orientation !== 'auto';
        if (isForcedOrientation) needsReencoding = true;

        // Force re-encode for non-square pixels, else a stream-copy remux keeps the
        // stretched-thumbnail problem (F13). (Plain HDR is left as-is on copy — a
        // faithful remux — and only tone-mapped when we're re-encoding anyway.)
        if (probe.anamorphic) needsReencoding = true;

        // Shrink / mirror / rotate / speed / downscale also require a real re-encode.
        if (settings.compress || mirrorFilter(settings) || rotateFilter(settings) || speedVideoFilter(settings) || resolutionFilter(settings) || cropFilter(settings)) needsReencoding = true;

        const _tl = inputTrimLoopArgs(settings);
        let command = ['-y', ..._tl.pre, '-i', normalizedInputPath,
            ...(_tl.t ? ['-t', String(_tl.t)] : []),
            ...metadataArgs(settings, outputExt)
        ];

        if (needsReencoding) {
            console.log('ConvertOnly: Re-encoding required for filters/orientation/pixel-shape.');
            // Reframe only when the user forced orientation or added a watermark;
            // otherwise just fix pixel shape and keep the original framing.
            const reframe = isForcedOrientation || (settings.watermark && settings.watermark.enabled);
            const filterComplex = reframe
                ? buildMasterFilter(settings, null, probe.dar, false, probe.hdr)
                : [probe.hdr ? HDR_TONEMAP : null, SAR_NORMALIZE, cropFilter(settings) || null, rotateFilter(settings) || null, mirrorFilter(settings) || null, resolutionFilter(settings) || null, speedVideoFilter(settings) || null, 'format=yuv420p'].filter(Boolean).join(',');
            command.push('-vf', filterComplex);

            // Quality-aware codec (F10) + non-conflicting audio (F26)
            command.push(...videoEncodeArgs(outputExt, settings, probe.hdr));
            command.push(...audioEncodeArgs(outputExt, settings));
        } else {
            console.log('ConvertOnly: Using Fast Stream Copy (Remuxing).');
            command.push('-c:v', 'copy');
            // Keep audio as-is (copy) or drop it — no re-encode on the fast path.
            command.push(...(settings.removeAudio ? ['-an'] : ['-c:a', 'copy']));
        }

        command.push(normalizedOutputPath);

        spawnFFmpeg(command).then(result => {
            currentProcess = null;
            if (result.code === 0) resolve();
            else reject(new Error(`Video conversion failed`));
        }).catch(error => {
            currentProcess = null;
            reject(new Error(`Video conversion failed: ${error.message}`));
        });
    });
}

// Check if video needs re-encoding
function needsVideoReencoding(inputPath, outputExt, settings) {
    const inputExt = (path.parse(inputPath).ext || "").toLowerCase();

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

    // 3. Audio removal is enabled - but we can use copy mode for video if no watermark
    // (This check is now handled in convertVideo function to allow fast copy when only removing audio)
    // Audio removal alone doesn't require video re-encoding, only remuxing

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
// getProcessingSettings now accepts a fileType parameter ('image' or 'video')
// to determine which settings panel to read from. In unified mode, each file
// is processed with settings from its respective panel.
function getProcessingSettings(fileType) {
    const settings = {
        mode: null,
        intensity: null,
        duplicates: 1,
        removeAudio: false,
        clipLength: '6-8'
    };

    // Determine which settings to use based on fileType parameter
    const useImageSettings = fileType === 'image';
    const useVideoSettings = fileType === 'video';

    if (useImageSettings) {
        settings.mode = document.getElementById('imageProcessingMode').value;
        settings.intensity = document.getElementById('imageIntensity').value;
        settings.duplicates = settings.mode === 'convert-only' ? 1 : parseInt(document.getElementById('imageDuplicates').value);
        settings.imageFormat = document.getElementById('imageFormat').value;
        settings.imageQuality = document.getElementById('imageQuality').value;
        settings.namingPattern = document.getElementById('imageNamingPattern').value;

        // Rotation setting for images (only relevant for spoof modes)
        const imageRotationCheckbox = document.getElementById('imageRotationEnabled');
        settings.enableRotation = imageRotationCheckbox ? imageRotationCheckbox.checked : true;

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

        // Metadata strategy for images (realistic / keep / strip)
        const imageMetaSelect = document.getElementById('imageMetadataMode');
        settings.metadataMode = imageMetaSelect ? imageMetaSelect.value : 'strip';
        settings.metaProfile = settings.metadataMode === 'spoof' ? pickDeviceProfile() : null;
    } else if (useVideoSettings) {
        settings.mode = document.getElementById('videoProcessingMode').value;
        settings.intensity = document.getElementById('videoIntensity').value;
        settings.duplicates = settings.mode === 'convert-only' ? 1 : parseInt(document.getElementById('videoDuplicates').value);
        settings.videoFormat = document.getElementById('videoFormat').value;
        settings.videoQuality = document.getElementById('videoQuality').value;
        settings.removeAudio = document.getElementById('removeAudio').checked;
        settings.clipLength = document.getElementById('clipLength').value;
        settings.namingPattern = document.getElementById('videoNamingPattern').value;

        // Rotation setting for videos (only relevant for spoof modes)
        const videoRotationCheckbox = document.getElementById('videoRotationEnabled');
        settings.enableRotation = videoRotationCheckbox ? videoRotationCheckbox.checked : true;

        // Orientation setting for videos
        const videoOrientationSelect = document.getElementById('videoOrientation');
        settings.orientation = videoOrientationSelect ? videoOrientationSelect.value : 'auto';

        // Shrink / compress settings
        const compressEl = document.getElementById('compressEnabled');
        settings.compress = compressEl ? compressEl.checked : false;
        const speedEl = document.getElementById('compressSpeed');
        settings.encodeMode = speedEl ? speedEl.value : 'fast'; // 'fast' (chip) | 'quality' (cpu, smaller)
        const levelEl = document.getElementById('compressLevel');
        settings.compressLevel = levelEl ? parseInt(levelEl.value) : 2;
        const resEl = document.getElementById('resolution');
        settings.resolution = resEl ? resEl.value : 'keep';

        // Mirror / flip
        const mirrorEl = document.getElementById('videoMirror');
        settings.mirror = mirrorEl ? mirrorEl.value : 'none';

        // Rotate + Speed (read straight from the compose cards)
        const rotCard = document.querySelector('.cx-c[data-card="rotate"]');
        settings.rotate = (rotCard && rotCard.classList.contains('on'))
            ? ((document.getElementById('cxRotate') || {}).value || 'none') : 'none';
        const spdCard = document.querySelector('.cx-c[data-card="speed"]');
        settings.speed = (spdCard && spdCard.classList.contains('on'))
            ? parseFloat((document.getElementById('cxSpeedVal') || {}).value || '1') : 1;

        // Crop — trim pixels off each edge (HandBrake-style; changes output dims)
        const cropCard = document.querySelector('.cx-c[data-card="crop"]');
        settings.crop = {
            enabled: !!(cropCard && cropCard.classList.contains('on')),
            top: parseInt((document.getElementById('cxCropTop') || {}).value) || 0,
            bottom: parseInt((document.getElementById('cxCropBottom') || {}).value) || 0,
            left: parseInt((document.getElementById('cxCropLeft') || {}).value) || 0,
            right: parseInt((document.getElementById('cxCropRight') || {}).value) || 0
        };

        // Trim + Loop (one-file output)
        const trimCard = document.querySelector('.cx-c[data-card="trim"]');
        settings.trim = {
            enabled: !!(trimCard && trimCard.classList.contains('on')),
            start: (document.getElementById('cxTrimStart') || {}).value,
            end: (document.getElementById('cxTrimEnd') || {}).value
        };
        const loopCard = document.querySelector('.cx-c[data-card="loop"]');
        settings.loop = {
            enabled: !!(loopCard && loopCard.classList.contains('on')),
            count: (document.getElementById('cxLoopCount') || {}).value
        };

        // Logo overlay + Replace audio (paths chosen via the file pickers)
        const logoCard = document.querySelector('.cx-c[data-card="logo"]');
        settings.logoPath = (logoCard && logoCard.classList.contains('on') && window._morphLogoPath) ? window._morphLogoPath : null;
        settings.logoPos = (document.getElementById('cxLogoPos') || {}).value || 'bottom-right';
        const musicCard = document.querySelector('.cx-c[data-card="music"]');
        settings.musicPath = (musicCard && musicCard.classList.contains('on') && window._morphMusicPath) ? window._morphMusicPath : null;

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

        // Metadata Strategy (New)
        const metadataModeSelect = document.getElementById('metadataMode');
        settings.metadataMode = metadataModeSelect ? metadataModeSelect.value : 'spoof';
        // Pick ONE coherent device profile per file so all clips of a video share it.
        settings.metaProfile = settings.metadataMode === 'spoof' ? pickDeviceProfile() : null;
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
            if (outputFolderText) { outputFolderText.textContent = absoluteOutDir; outputFolderText.title = absoluteOutDir; }

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

        // Create message element with a high-contrast (dark-on-light) style (F1).
        // Build with textContent so file names in messages can't inject markup.
        const messageElement = document.createElement('div');
        messageElement.className = `status-message ${type}`;
        const tsSpan = document.createElement('span');
        tsSpan.className = 'timestamp';
        tsSpan.textContent = `[${timestamp}] `;
        messageElement.appendChild(tsSpan);
        messageElement.appendChild(document.createTextNode(message));

        // Add message to status content
        statusContent.appendChild(messageElement);

        // Auto-scroll to bottom
        statusContent.scrollTop = statusContent.scrollHeight;

        // Show status panel if it's hidden
        const statusPanel = document.getElementById('activityLogSection');
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
        const statusPanel = document.getElementById('activityLogSection');
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
        const statusPanel = document.getElementById('activityLogSection');
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
        if (isPaused) return; // freeze the readout while paused

        const now = Date.now();
        if (now - lastProgressUpdate < 250) return; // refresh ~4x/sec
        lastProgressUpdate = now;

        // Elapsed spans pause/resume via elapsedBeforePause (seconds) + the current
        // running segment. The dock's percentage is the real combined share of ALL
        // file-tasks finished, so it reflects the whole job, not just one file.
        const elapsedSec = elapsedBeforePause + (Date.now() - startTime) / 1000;
        const progress = (completedSteps / totalProcessingSteps) * 100;
        const doneText = `${completedSteps} of ${totalProcessingSteps} done`;

        if (completedSteps > 0) {
            const avgPerStep = elapsedSec / completedSteps;
            const remainingSec = Math.max(0, avgPerStep * (totalProcessingSteps - completedSteps));
            estimatedTotalTime = remainingSec * 1000;
            updateOverallProgress(progress,
                `${doneText} · ${fmtDuration(elapsedSec)} elapsed · ~${fmtDuration(remainingSec)} left`);
        } else {
            // First file still running — no basis for an estimate yet.
            updateOverallProgress(0,
                `${doneText} · ${fmtDuration(elapsedSec)} elapsed · estimating…`, '0%');
        }
    }, 250);
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

    // Mark the start of the current running segment. Accumulated time from
    // previous segments lives in elapsedBeforePause (F24).
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

    const elapsed = elapsedBeforePause + Math.floor((Date.now() - startTime) / 1000);
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

        // Actually remove leftover temp artifacts (5.1): master files from
        // Spoof+Split and any stray debug/temp images. Scans the output dir and
        // its immediate batch_* subdirectories.
        const tempRegex = /^(temp_master_|temp_|DEBUG_sips_output_)/i;
        const dirsToScan = [outputDir];
        try {
            for (const entry of await electronAPI.readdir(outputDir)) {
                if (/^batch_/i.test(entry)) dirsToScan.push(path.join(outputDir, entry));
            }
        } catch (e) { /* readdir may fail; scan just the root */ }

        for (const dir of dirsToScan) {
            let entries = [];
            try { entries = await electronAPI.readdir(dir); } catch (e) { continue; }
            for (const name of entries) {
                if (tempRegex.test(name)) {
                    try { await electronAPI.unlink(path.join(dir, name)); } catch (e) { /* ignore */ }
                }
            }
        }
        // Also remove the HEIC temp JPEGs we created in the OS temp dir this run.
        for (const tmp of heicTempFiles) {
            try { if (await electronAPI.exists(tmp)) await electronAPI.unlink(tmp); } catch (e) { /* ignore */ }
        }
        heicTempFiles = [];
        heicProcessCache.clear();

        console.log('Temp cleanup complete for:', outputDir);
    } catch (error) {
        console.warn('Cleanup failed:', error);
        // Don't throw - cleanup failure shouldn't break the main flow
    }
}

// Preview functions
function previewFileByClick(index) {
    if (index >= 0 && index < selectedFiles.length) {
        currentPreviewIndex = index;
        const file = selectedFiles[index];
        showPreview(file.path, file.type);
        updateFileList();
        updateNavigationButtons('media');
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
    showPreview(file.path, file.type);
    updateFileList();
    updateNavigationButtons('media');
}

function removeFile(index) {
    // Don't let the queue be mutated mid-run — it desyncs the loop index and
    // progress bars from the files actually being processed (F21).
    if (isProcessing) {
        addStatusMessage('⚠️ Cannot remove files while processing. Stop first.', 'warning');
        return;
    }
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
            const file = selectedFiles[currentPreviewIndex];
            showPreview(file.path, file.type);
        } else {
            clearPreview('media');
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

// Strip characters illegal in Windows filenames and trim trailing dots/spaces (F17).
function sanitizeFileName(name) {
    let s = String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').trim();
    if (s.length > 120) s = s.slice(0, 120);
    return s || 'file';
}

// Build a UNIQUE output path.
// Split modes pass the sequential clip number as `clipNumber`; single-output
// modes pass null. Uniqueness is enforced against every path handed out this run
// (usedOutputPaths) so clips/files never silently overwrite each other (F2), and
// each path is recorded in attemptOutputs so a failed attempt's partial files can
// be cleaned up before a retry (F6). Filenames are sanitized (F17).
function generateOutputPathForBatch(file, outputDir, settings, clipNumber = null, fileIndex = 0) {
    let baseName, outputFormat;
    // Use THIS file's own type (not a shared global) so parallel files can't
    // race each other's mode when running concurrently.
    const fileMode = file && file.type ? file.type : currentMode;
    // Sensible fallback extension when "Keep original" can't read one from the
    // source name — a real container FFmpeg can mux, never a bogus ".out".
    const defaultExt = fileMode === 'image' ? '.jpg' : '.mp4';
    try {
        baseName = sanitizeFileName(path.parse(file.name).name);
        outputFormat = path.parse(file.name).ext || defaultExt;
        if (fileMode === 'image' && settings.imageFormat && settings.imageFormat !== 'original') {
            outputFormat = settings.imageFormat.startsWith('.') ? settings.imageFormat : '.' + settings.imageFormat;
        } else if (fileMode === 'video' && settings.videoFormat && settings.videoFormat !== 'original') {
            outputFormat = settings.videoFormat.startsWith('.') ? settings.videoFormat : '.' + settings.videoFormat;
        }
        // Last-resort guard: an empty/whitespace/".out" ext is unwritable.
        if (!outputFormat || outputFormat === '.' || /^\.out$/i.test(outputFormat)) outputFormat = defaultExt;
    } catch (e) {
        baseName = 'file';
        outputFormat = defaultExt;
    }

    const isClip = Number.isInteger(clipNumber) && clipNumber > 0;
    const seq = isClip ? String(clipNumber).padStart(3, '0') : '';

    let stem;
    if (settings.namingPattern && settings.namingPattern.trim() !== '') {
        const pattern = settings.namingPattern;
        const randomId = Math.floor(10000 + Math.random() * 90000).toString();
        let customName = pattern
            .replace(/{number}/g, isClip ? seq : String(fileIndex + 1))
            .replace(/{timestamp}/g, Date.now().toString())
            .replace(/{random}/g, randomId)
            .replace(/{original}/g, baseName)
            .replace(/{fileindex}/g, String(fileIndex + 1));
        // A pattern with no dynamic token collides for every clip/file — keep distinct.
        if (!/\{(number|timestamp|random)\}/.test(pattern)) {
            customName += isClip ? `_${seq}` : `_${fileIndex + 1}`;
        }
        stem = sanitizeFileName(customName);
    } else {
        stem = isClip ? `${baseName}_${seq}` : baseName;
    }

    // Guarantee uniqueness against everything handed out this run.
    let finalName = `${stem}${outputFormat}`;
    let candidate = path.join(outputDir, finalName);
    let n = 2;
    while (usedOutputPaths.has(candidate.toLowerCase())) {
        finalName = `${stem}-${n}${outputFormat}`;
        candidate = path.join(outputDir, finalName);
        n++;
    }
    usedOutputPaths.add(candidate.toLowerCase());
    // Record this path against THIS file (parallel-safe) and, for backwards
    // compatibility, the shared list when a file bucket isn't present.
    if (file && Array.isArray(file._attemptOutputs)) file._attemptOutputs.push(candidate);
    else attemptOutputs.push(candidate);
    return candidate;
}

// Update navigation button states (unified preview section)
function updateNavigationButtons(mode) {
    const prevBtn = document.getElementById('previewPrevBtn');
    const nextBtn = document.getElementById('previewNextBtn');
    const positionDisplay = document.querySelector('#previewSection .position-display');

    if (prevBtn && nextBtn) {
        prevBtn.disabled = selectedFiles.length === 0 || currentPreviewIndex === 0;
        nextBtn.disabled = selectedFiles.length === 0 || currentPreviewIndex === selectedFiles.length - 1;
        prevBtn.textContent = '← Previous';
        nextBtn.textContent = 'Next →';

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

// (sleep is defined earlier in the file)
