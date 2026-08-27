// ============================================================
// FRAME EXTRACTOR MODULE — integrated as a Processing Type
// Uses the parent spoofer's file list, output folder, and
// Start Processing button. No separate file picker needed.
// ============================================================

// ── State ────────────────────────────────────────────────────
const FX = {
    frames: [],       // [{path, videoName, videoPath, timestamp, index, state}]
    extracting: false,
    lightboxIndex: -1,
    setupDone: false,
};

// Video extensions recognised as extractable
const FX_VIDEO_EXTS = ['mp4','mov','avi','mkv','webm','ts','m4v','3gp','mts','wmv','flv','mpeg','mpg'];

function fxToImageSrc(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    if (typeof toPreviewUrl === 'function') return toPreviewUrl(filePath);
    if (filePath.startsWith('file://')) return filePath;

    const normalizedPath = filePath.replace(/\\/g, '/');
    const fileUrl = new URL('file:///');
    fileUrl.pathname = /^[A-Za-z]:\//.test(normalizedPath)
        ? `/${normalizedPath}`
        : normalizedPath;

    return fileUrl.href;
}

// ── Get videos from parent file list ─────────────────────────
function fxGetVideos() {
    // selectedFiles in renderer.js holds file OBJECTS: { path, name, type, size, ... }
    // Access via scoped name (let in same global scope) then window fallback
    const all = (typeof selectedFiles !== 'undefined' ? selectedFiles : null)
             || window.selectedFiles || [];
    return all
        .map(f => typeof f === 'string' ? f : (f.path || ''))   // extract path string
        .filter(p => p && FX_VIDEO_EXTS.some(ext => p.toLowerCase().endsWith('.' + ext)));
}

// ── Smart Frame Count Formula ────────────────────────────────
function fxSmartFrameCount(durationSec) {
    if (durationSec <= 15)  return { count: Math.max(8, Math.round(durationSec / 1.5)), interval: 1.5 };
    if (durationSec <= 60)  return { count: Math.round(durationSec / 3),  interval: 3 };
    if (durationSec <= 300) return { count: Math.round(durationSec / 5),  interval: 5 };
    if (durationSec <= 900) return { count: Math.round(durationSec / 7),  interval: 7 };
    return { count: Math.min(200, Math.round(durationSec / 10)), interval: 10 };
}

function fxFormatDuration(sec) {
    if (sec == null || isNaN(sec)) return '';   // unknown time (scene/keyframe frames)
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2,'0')}`;
}

// ── Init (called once on first entry into extract-frames mode)
function fxSetup() {
    if (FX.setupDone) { fxRefreshEstimate(); return; }
    FX.setupDone = true;

    const lightbox = document.getElementById('fxLightbox');
    if (lightbox && lightbox.parentElement !== document.body) {
        document.body.appendChild(lightbox);
    }

    // Drop zone
    const dz = document.getElementById('fxDropZone');
    if (dz) {
        dz.addEventListener('click', () => fxSelectFiles());
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); fxHandleDrop(e); });
    }

    document.getElementById('fxSelectFilesBtn')?.addEventListener('click', fxSelectFiles);
    document.getElementById('fxSelectFolderBtn')?.addEventListener('click', fxSelectFolder);
    document.getElementById('fxClearBtn')?.addEventListener('click', fxClearVideos);
    document.getElementById('fxKeepAllBtn')?.addEventListener('click', () => fxBatchMark('keep'));
    document.getElementById('fxDeleteAllBtn')?.addEventListener('click', fxDeleteAll);
    document.getElementById('fxInvertBtn')?.addEventListener('click', fxInvertSelection);
    document.getElementById('fxFrameCountMode')?.addEventListener('change', fxRefreshEstimate);
    document.getElementById('fxMethod')?.addEventListener('change', fxOnMethodChange);
    document.getElementById('fxManualCount')?.addEventListener('input', fxRefreshEstimate);
    document.getElementById('fxInterval')?.addEventListener('input', fxRefreshEstimate);
    document.getElementById('fxSkipStart')?.addEventListener('input', fxRefreshEstimate);
    document.getElementById('fxSkipEnd')?.addEventListener('input', fxRefreshEstimate);
    document.getElementById('fxLightbox')?.addEventListener('click', fxHandleLightboxBackdropClick);

    // Lightbox keyboard nav
    document.addEventListener('keydown', fxLightboxKey);

    fxOnMethodChange();
    fxRefreshEstimate();
}



// ── Method UI toggle ─────────────────────────────────────────

function fxOnMethodChange() {
    const method = document.getElementById('fxMethod')?.value;
    const intervalGrp = document.getElementById('fxIntervalGroup');
    const sceneGrp = document.getElementById('fxSceneGroup');
    if (intervalGrp) intervalGrp.style.display = method === 'interval' ? 'block' : 'none';
    if (sceneGrp) sceneGrp.style.display = method === 'scene' ? 'block' : 'none';
    fxRefreshEstimate();
}

// ── Estimate Panel (reads from parent's selectedFiles) ───────
function fxRefreshEstimate() {
    const videos = fxGetVideos();
    if (!videos.length) { fxSetEstimate('No videos loaded above', '', ''); return; }
    const mode = document.getElementById('fxFrameCountMode')?.value;
    const method = document.getElementById('fxMethod')?.value;
    const skipStart = parseFloat(document.getElementById('fxSkipStart')?.value || 0);
    const skipEnd   = parseFloat(document.getElementById('fxSkipEnd')?.value   || 0);
    let totalFrames = 0;
    // We don't have duration without probing — use file count as rough proxy
    const count = parseInt(document.getElementById('fxManualCount')?.value || 20);
    videos.forEach(() => {
        if (mode === 'manual') {
            totalFrames += count;
        } else {
            totalFrames += 30; // safe auto default shown before probing
        }
    });
    const estMB = (totalFrames * 0.5).toFixed(1);
    fxSetEstimate(`~${totalFrames} frames`, `~${estMB} MB`, `${videos.length} video(s)`);
}


function fxSetEstimate(frames, size, videos) {
    const el = document.getElementById('fxEstimateText');
    if (el) el.innerHTML = `<b>${frames}</b> estimated &nbsp;·&nbsp; <b>${size}</b> &nbsp;·&nbsp; ${videos}`;
}

// ── Shared helpers: pipe into parent logger and progress bar ──────────────
function fxCreateBatchFolderName() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `frame_batch_${timestamp}_${randomSuffix}`;
}

function fxLog(msg, type) {
    if (typeof addStatusMessage === 'function') addStatusMessage(msg, type || 'info');
    else console.log('[FX]', msg);
}
function fxProgress(pct, text) {
    if (typeof updateOverallProgress === 'function') updateOverallProgress(pct, text);
}

// ── Extraction Engine ──────────────────────────────────────────────────────
async function fxStartExtraction() {
    // ── 1. Require output folder (same rule as all other processing types) ──
    const outBase = (typeof outputDirectory !== 'undefined' ? outputDirectory : null)
               || window.outputDirectory || null;
    if (!outBase) {
        if (typeof showStatus === 'function') showStatus();
        fxLog('❌ Please select an output folder first (click "Select Output Folder" above).', 'error');
        return;
    }

    // ── 2. Need at least one video loaded ─────────────────────────────────
    const videos = fxGetVideos();
    if (!videos.length) {
        fxLog('❌ No video files loaded. Add videos using the file picker above.', 'error');
        return;
    }
    if (FX.extracting) return;

    const batchOutputDir = outBase.replace(/\\/g, '/') + '/' + fxCreateBatchFolderName();

    try {
        await electronAPI.mkdir(batchOutputDir);
    } catch (mkdirErr) {
        if (typeof showStatus === 'function') showStatus();
        fxLog(`❌ Could not create batch folder: ${batchOutputDir}`, 'error');
        console.error('Frame batch folder creation failed:', mkdirErr);
        return;
    }

    FX.extracting = true;
    FX.frames = [];
    FX.outputDir = batchOutputDir;
    fxLog(`Batch output path: ${batchOutputDir}`, 'success');
    fxRenderGrid();
    fxHideBatchBar();

    // ── 3. Show activity log + progress bar (like other processing types) ──
    if (typeof showStatus === 'function') showStatus();
    fxLog('🎬 Starting frame extraction...', 'info');
    fxLog(`📂 Output folder: ${outBase}`, 'info');
    fxLog(`📹 ${videos.length} video(s) queued`, 'info');
    fxLog(`Batch folder: ${batchOutputDir}`, 'info');
    fxProgress(0, 'Starting extraction...');

    const startBtn = document.getElementById('startBtn');
    if (startBtn) { startBtn.textContent = '⏳ Extracting...'; startBtn.disabled = true; }

    const method      = document.getElementById('fxMethod')?.value || 'even';
    const mode        = document.getElementById('fxFrameCountMode')?.value || 'auto';
    const format      = document.getElementById('fxFormat')?.value || 'jpg';
    const quality     = parseInt(document.getElementById('fxQuality')?.value || 90);
    const res         = document.getElementById('fxResolution')?.value || 'original';
    const skipStart   = parseFloat(document.getElementById('fxSkipStart')?.value || 0);
    const skipEnd     = parseFloat(document.getElementById('fxSkipEnd')?.value   || 0);
    const interval    = parseFloat(document.getElementById('fxInterval')?.value || 5);
    const sceneThr    = parseFloat(document.getElementById('fxSceneThreshold')?.value || 0.3);
    const manualCount = parseInt(document.getElementById('fxManualCount')?.value || 20);

    electronAPI.onFrameExtractProgress(data => {
        const name = data.videoPath.split(/[\\/]/).pop();
        if (startBtn) startBtn.textContent = `⏳ ${name} — frame ${data.framesDone}...`;
    });

    let totalExtracted = 0;
    for (let vi = 0; vi < videos.length; vi++) {
        const vidPath = videos[vi];
        const vidName = vidPath.replace(/\\/g,'/').split('/').pop();
        const baseName = vidName.replace(/\.[^.]+$/, '');

        fxLog(`📹 (${vi+1}/${videos.length}) ${vidName}`, 'info');
        fxProgress(Math.round((vi / videos.length) * 85), `Extracting ${vidName}…`);
        if (startBtn) startBtn.textContent = `⏳ (${vi+1}/${videos.length}) ${vidName}`;

        let duration = 60;
        try {
            const ffpPath = window.ffprobePath || (typeof ffprobePath !== 'undefined' ? ffprobePath : '');
            const info = await electronAPI.getVideoInfo(vidPath, ffpPath);
            duration = info.duration || 60;
            fxLog(`   Duration: ${duration.toFixed(1)}s`, 'info');
        } catch(e) {
            fxLog('   ⚠️ Could not probe duration — using 60s fallback', 'warning');
        }

        const eff        = Math.max(1, duration - skipStart - skipEnd);
        const frameCount = mode === 'manual' ? manualCount : fxSmartFrameCount(eff).count;
        const outDir     = batchOutputDir.replace(/\\/g,'/') + '/frames_' + baseName;
        fxLog(`   → ~${frameCount} frames → ${outDir}`, 'info');

        try {
            const ffmPath = window.ffmpegPath || (typeof ffmpegPath !== 'undefined' ? ffmpegPath : '');
            const result = await electronAPI.extractFrames({
                ffmpegPath: ffmPath,
                videoPath:  vidPath,
                outputDir:  outDir,
                method, frameCount, interval, quality, format,
                skipStart, skipEnd,
                sceneThreshold: sceneThr,
                resolution: res,
                duration
            });
            if (result && result.files) {
                result.files.forEach((fp, idx) => {
                    // Only assign a real timestamp for methods where frame position
                    // is actually known. Scene/keyframe frames are irregular, so a
                    // computed "even" time would be fake — leave it null (3.1).
                    let ts;
                    if (method === 'interval') {
                        ts = skipStart + idx * (interval || 5);
                    } else if (method === 'scene' || method === 'keyframes') {
                        ts = null; // unknown — do not fabricate
                    } else {
                        ts = skipStart + (idx / Math.max(1, result.files.length - 1)) * eff;
                    }
                    FX.frames.push({ path: fp, videoName: vidName, videoPath: vidPath,
                                     timestamp: ts, index: FX.frames.length, state: 'keep' });
                });
                totalExtracted += result.files.length;
                fxLog(`   ✅ ${result.files.length} frames saved`, 'success');
            }
        } catch(err) {
            fxLog(`   ❌ Error: ${err.message}`, 'error');
            console.error('Frame extraction error:', err);
        }
    }

    electronAPI.removeFrameExtractProgress();
    FX.extracting = false;

    // ── 4. Wrap up — same pattern as other processing types ───────────────
    if (startBtn) { startBtn.textContent = '▶️ Extract Frames'; startBtn.disabled = false; }

    const openBtn = document.getElementById('openFolderBtn');
    if (openBtn) { openBtn.disabled = false; openBtn.setAttribute('data-path', batchOutputDir); }

    fxProgress(100, `✅ ${totalExtracted} frames extracted`);
    fxLog(`🎉 Done! ${totalExtracted} frames saved to output folder.`, 'success');
    fxLog(`💡 Review frames below — click 🗑 to permanently delete any frame you don't want. Remaining frames are your output.`, 'info');

    fxRenderGrid();
    fxShowBatchBar();
    if (FX.frames.length > 0) fxOpenLightbox(0);
}


// ── Review Grid ───────────────────────────────────────────────
function fxRenderGrid() {
    const grid = document.getElementById('fxReviewGrid');
    if (!grid) return;
    if (!FX.frames.length) { grid.innerHTML = ''; return; }

    // Group by video name for visual separation
    let html = '';
    let lastVideo = null;
    FX.frames.forEach((fr, i) => {
        if (fr.videoName !== lastVideo) {
            if (lastVideo !== null) html += '</div>';
            html += `<div class="fx-video-group">
                <div class="fx-video-label">🎬 ${fr.videoName}</div>
                <div class="fx-grid-inner">`;
            lastVideo = fr.videoName;
        }
        const stateClass = fr.state === 'delete' ? 'fx-thumb-delete' : fr.state === 'keep' ? 'fx-thumb-keep' : '';
        const badge = fr.state === 'delete' ? '<div class="fx-badge fx-badge-del">🗑</div>' : fr.state === 'keep' ? '<div class="fx-badge fx-badge-keep">✓</div>' : '';
        html += `<div class="fx-thumb ${stateClass}" id="fxThumb${i}" onclick="fxOpenLightbox(${i})">
            <img src="${fxToImageSrc(fr.path)}" loading="lazy" draggable="false">
            ${badge}
            <div class="fx-thumb-info">${fxFormatDuration(fr.timestamp)}</div>
            <div class="fx-thumb-actions">
                <button onclick="event.stopPropagation();fxMarkFrame(${i},'keep')" class="fx-act-btn fx-keep-btn" title="Mark as favourite">⭐</button>
                <button onclick="event.stopPropagation();fxDeleteFrame(${i})" class="fx-act-btn fx-del-btn" title="Delete permanently">🗑</button>
            </div>
        </div>`;
    });
    if (lastVideo !== null) html += '</div></div>';
    grid.innerHTML = html;
    fxUpdateBatchStats();
}

// ── Frame Marking — keep toggle (does NOT touch disk) ────────
window.fxMarkFrame = function(i, state) {
    if (!FX.frames[i]) return;
    FX.frames[i].state = FX.frames[i].state === state ? 'pending' : state;
    fxRefreshThumb(i);
    fxUpdateBatchStats();
    if (FX.lightboxIndex === i) fxUpdateLightboxButtons();
};

// ── Frame Delete — instant remove from disk AND grid ──────────
window.fxDeleteFrame = async function(i) {
    if (!FX.frames[i]) return;
    const fr = FX.frames[i];
    try { await electronAPI.deleteFilePermanent(fr.path); }
    catch(e) { console.warn('Could not delete file:', fr.path, e); }
    FX.frames.splice(i, 1);
    FX.frames.forEach((f, idx) => f.index = idx);
    // Fix lightbox position
    if (FX.lightboxIndex >= 0) {
        if (FX.frames.length === 0) { fxCloseLightbox(); }
        else if (FX.lightboxIndex === i) { FX.lightboxIndex = Math.min(i, FX.frames.length - 1); fxShowLightboxFrame(FX.lightboxIndex); }
        else if (FX.lightboxIndex > i) { FX.lightboxIndex--; }
    }
    fxRenderGrid();
    fxUpdateBatchStats();
};

function fxRefreshThumb(i) {
    const el = document.getElementById('fxThumb' + i);
    if (!el) return;
    const fr = FX.frames[i];
    el.className = 'fx-thumb' + (fr.state === 'keep' ? ' fx-thumb-keep' : '');
    const badge = el.querySelector('.fx-badge');
    if (badge) badge.remove();
    if (fr.state === 'keep') el.insertAdjacentHTML('afterbegin', '<div class="fx-badge fx-badge-keep">⭐</div>');
}

function fxBatchMark(state) {
    FX.frames.forEach((_, i) => FX.frames[i].state = state);
    fxRenderGrid();
}

async function fxDeleteAll() {
    if (!FX.frames.length) return;
    if (!confirm(`Permanently delete all ${FX.frames.length} frames from disk? This cannot be undone.`)) return;
    for (const fr of [...FX.frames]) {
        try { await electronAPI.deleteFilePermanent(fr.path); } catch(e) {}
    }
    FX.frames = [];
    fxCloseLightbox();
    fxRenderGrid();
    fxUpdateBatchStats();
    fxLog('🗑 All frames deleted from output folder.', 'warning');
}

function fxInvertSelection() {
    FX.frames.forEach((fr, i) => {
        FX.frames[i].state = fr.state === 'keep' ? 'pending' : 'keep';
    });
    fxRenderGrid();
}

function fxUpdateBatchStats() {
    const total    = FX.frames.length;
    const starred  = FX.frames.filter(f => f.state === 'keep').length;
    const el = document.getElementById('fxBatchStats');
    if (el) el.textContent = `${total} frames in output · ${starred} starred as favourite`;
}

function fxShowBatchBar() { const el = document.getElementById('fxBatchBar'); if (el) el.style.display = 'flex'; }
function fxHideBatchBar() { const el = document.getElementById('fxBatchBar'); if (el) el.style.display = 'none'; }

async function fxOpenOutput() {
    const dir = FX.outputDir;
    if (dir) await electronAPI.openOutputFolder(dir);
}

// ── Lightbox ──────────────────────────────────────────────────
window.fxOpenLightbox = function(i) {
    const lb = document.getElementById('fxLightbox');
    FX.lightboxIndex = i;
    document.body.style.overflow = 'hidden'; // prevent page scroll shifting the fixed overlay
    fxShowLightboxFrame(i);
    if (lb) {
        lb.style.display = 'flex';
        lb.scrollTop = 0;
        lb.scrollLeft = 0;
    }
};

window.fxCloseLightbox = function() {
    const lb = document.getElementById('fxLightbox');
    if (lb) {
        lb.style.display = 'none';
        lb.scrollTop = 0;
        lb.scrollLeft = 0;
    }
    document.body.style.overflow = ''; // restore page scroll
    FX.lightboxIndex = -1;
};

function fxShowLightboxFrame(i) {
    const fr = FX.frames[i];
    if (!fr) return;
    document.getElementById('fxLightboxImg').src = fxToImageSrc(fr.path);
    const tLabel = fxFormatDuration(fr.timestamp);
    document.getElementById('fxLightboxInfo').textContent =
        `Frame ${i+1} of ${FX.frames.length} · ${fr.videoName}${tLabel ? ' · ' + tLabel : ''}`;
    fxUpdateLightboxButtons();
    // Highlight active thumb in grid (scroll only within its container, not the page)
    document.querySelectorAll('.fx-thumb').forEach(el => el.classList.remove('fx-thumb-active'));
    const active = document.getElementById('fxThumb' + i);
    if (active) {
        active.classList.add('fx-thumb-active');
        // scrollIntoView is blocked by body overflow:hidden so the page won't shift
        active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
}

function fxUpdateLightboxButtons() {
    const i = FX.lightboxIndex;
    if (i < 0) return;
    const state = FX.frames[i]?.state;
    const keepBtn = document.getElementById('fxLbKeep');
    if (keepBtn) {
        keepBtn.textContent = state === 'keep' ? '⭐ Favourited' : '⭐ Favourite';
        keepBtn.style.opacity = state === 'keep' ? '1' : '0.7';
    }
}

function fxHandleLightboxBackdropClick(event) {
    if (event.target === event.currentTarget) {
        fxCloseLightbox();
    }
}

window.fxLightboxKeep   = function() { if (FX.lightboxIndex >= 0) { fxMarkFrame(FX.lightboxIndex, 'keep'); } };
window.fxLightboxDelete = async function() { if (FX.lightboxIndex >= 0) { await fxDeleteFrame(FX.lightboxIndex); } };
window.fxLightboxPrev   = function() { if (FX.lightboxIndex > 0) { FX.lightboxIndex--; fxShowLightboxFrame(FX.lightboxIndex); } };
window.fxLightboxNext   = function() { if (FX.lightboxIndex < FX.frames.length-1) { FX.lightboxIndex++; fxShowLightboxFrame(FX.lightboxIndex); } };

function fxLightboxKey(e) {
    if (document.getElementById('fxLightbox')?.style.display === 'none') return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); fxLightboxPrev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); fxLightboxNext(); }
    if (e.key === 'Escape')     { e.preventDefault(); fxCloseLightbox(); }
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); fxLightboxKeep(); }
    if (e.key.toLowerCase() === 'd') { e.preventDefault(); fxLightboxDelete(); }
}

// ── Video Mode Switcher ───────────────────────────────────────
// IDs of all standard video settings groups to hide in extract-frames mode
const FX_HIDE_GROUPS = [
    'videoIntensityGroup','videoDuplicatesGroup','videoRotationGroup',
    'videoQualityGroup','clipLengthGroup',
    'videoWatermarkSettings'
];
// Parent section IDs (entire settings-group blocks) to hide
const FX_HIDE_SECTIONS = [
    // We hide by adding display:none to the parent settings-group divs
    // They are identified via their h4 text — we'll use data attrs instead
];

function fxEnterExtractMode() {
    const panel = document.getElementById('fxPanel');
    const videoSection = document.getElementById('videoProcessingMode')?.closest('.section');
    // Keep the Processing Mode settings-group visible (user must be able to switch back)
    const modeGroup = document.getElementById('videoProcessingMode')?.closest('.settings-group');

    if (videoSection) {
        const groups = Array.from(videoSection.querySelectorAll('.settings-group, .bulk-rename-section'))
            .filter(g => g !== modeGroup && (!panel || !panel.contains(g)));
        groups.forEach(g => { g.style.display = 'none'; g._fxHidden = true; });
        FX_HIDE_GROUPS.forEach(id => {
            const el = document.getElementById(id);
            if (el && (!panel || !panel.contains(el))) { el.style.display = 'none'; el._fxHidden = true; }
        });
    }

    // Also hide image settings section (not relevant for video frame extraction)
    const imageSections = document.querySelectorAll('.section');
    imageSections.forEach(sec => {
        const h3 = sec.querySelector('h3');
        if (h3 && (h3.textContent.includes('Image') || h3.textContent.includes('Photo'))) {
            sec.style.display = 'none'; sec._fxHidden = true;
        }
    });

    if (panel) panel.style.display = 'block';

    // Set a global flag so renderer.js startBtn handler skips normal processing
    window._fxExtractMode = true;

    // Also override onclick in case renderer uses that (belt + suspenders)
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn._fxOrigText = startBtn.textContent;
        startBtn.textContent = 'Extract Frames';
        startBtn.disabled = false;
        startBtn.title = 'Extract frames from the loaded videos';
    }

    // Hide Pause/Stop — not relevant for extraction
    ['pauseBtn','stopBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el._fxWas = el.style.display; el.style.display = 'none'; }
    });

    // Collapse settings-row to one centred full-width column (image column is hidden)
    const settingsRow = document.querySelector('.settings-row');
    if (settingsRow) {
        settingsRow._fxCols = settingsRow.style.gridTemplateColumns;
        settingsRow.style.gridTemplateColumns = '1fr';
        settingsRow.style.maxWidth = '680px';
        settingsRow.style.margin = '0 auto';
        settingsRow._fxWasChanged = true;
    }

    fxSetup();
    fxRefreshEstimate();
}

function fxExitExtractMode() {
    window._fxExtractMode = false;

    const videoSection = document.getElementById('videoProcessingMode')?.closest('.section');
    if (videoSection) {
        videoSection.querySelectorAll('.settings-group, .bulk-rename-section').forEach(g => {
            if (g._fxHidden) { g.style.display = ''; g._fxHidden = false; }
        });
        FX_HIDE_GROUPS.forEach(id => {
            const el = document.getElementById(id);
            if (el && el._fxHidden) { el.style.display = ''; el._fxHidden = false; }
        });
    }

    // Restore image sections
    document.querySelectorAll('.section').forEach(sec => {
        if (sec._fxHidden) { sec.style.display = ''; sec._fxHidden = false; }
    });

    // Restore settings-row layout
    const settingsRow = document.querySelector('.settings-row');
    if (settingsRow && settingsRow._fxWasChanged) {
        settingsRow.style.gridTemplateColumns = settingsRow._fxCols || '';
        settingsRow.style.maxWidth = '';
        settingsRow.style.margin = '';
        settingsRow._fxWasChanged = false;
    }

    const panel = document.getElementById('fxPanel');
    if (panel) panel.style.display = 'none';

    // Restore Start button text
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.textContent = startBtn._fxOrigText || 'Start Processing';
        startBtn.title = '';
    }

    // Restore Pause/Stop
    ['pauseBtn','stopBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el._fxWas !== undefined) { el.style.display = el._fxWas; }
    });
}


// Called by renderer.js existing videoProcessingMode change handler — or we hook it here
function fxHookVideoModeDropdown() {
    const sel = document.getElementById('videoProcessingMode');
    if (!sel) return;
    sel.addEventListener('change', () => {
        if (sel.value === 'extract-frames') fxEnterExtractMode();
        else fxExitExtractMode();
    });
}

// ── Init on DOM ready ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    fxHookVideoModeDropdown();
});
