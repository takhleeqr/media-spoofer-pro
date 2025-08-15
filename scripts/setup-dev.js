#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const platform = process.platform;
const isWindows = platform === 'win32';
const isCI = process.env.CI === 'true';

console.log('🚀 Setting up Media Spoofer Pro development environment...');
console.log(`Platform: ${platform}, CI: ${isCI}`);

async function downloadFile(url, filename) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filename);
        
        const request = https.get(url, (response) => {
            // Check if the response is successful
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }
            
            const totalSize = parseInt(response.headers['content-length'], 10);
            let downloadedSize = 0;
            
            response.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (!isCI) {
                    const progress = totalSize ? Math.round((downloadedSize / totalSize) * 100) : '?';
                    process.stdout.write(`\r📥 Downloading: ${progress}% (${(downloadedSize / 1024 / 1024).toFixed(1)}MB)`);
                }
            });
            
            response.pipe(file);
            
            file.on('finish', () => {
                if (!isCI) process.stdout.write('\n');
                file.close();
                
                // Verify file size
                const stats = fs.statSync(filename);
                if (stats.size < 1000000) { // Less than 1MB is suspicious
                    reject(new Error(`Downloaded file is too small (${stats.size} bytes). The download may have failed.`));
                    return;
                }
                
                resolve();
            });
        });
        
        request.on('error', (error) => {
            reject(error);
        });
        
        request.setTimeout(60000, () => { // 60 second timeout
            request.destroy();
            reject(new Error('Download timeout'));
        });
    });
}

async function setupFFmpeg() {
    try {
        if (isWindows) {
            console.log('📥 Downloading FFmpeg for Windows...');
            
            // Multiple reliable sources for Windows
            const sources = [
                'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
                'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
                'https://github.com/ffmpeg/ffmpeg/releases/download/n6.1/ffmpeg-6.1-full_build.zip'
            ];
            
            let downloadSuccess = false;
            let lastError = null;
            
            for (const sourceUrl of sources) {
                try {
                    console.log(`🔄 Trying source: ${sourceUrl}`);
                    const ffmpegZip = 'ffmpeg-win.zip';
                    
                    await downloadFile(sourceUrl, ffmpegZip);
                    
                    // Extract and copy binaries
                    console.log('📦 Extracting FFmpeg...');
                    execSync(`powershell -command "Expand-Archive -Path '${ffmpegZip}' -DestinationPath 'ffmpeg-temp' -Force"`);
                    
                    // Find and copy binaries
                    const ffmpegExe = execSync('powershell -command "Get-ChildItem -Path \'ffmpeg-temp\' -Recurse -Name \'ffmpeg.exe\' | Select-Object -First 1"', { encoding: 'utf8' }).trim();
                    const ffprobeExe = execSync('powershell -command "Get-ChildItem -Path \'ffmpeg-temp\' -Recurse -Name \'ffprobe.exe\' | Select-Object -First 1"', { encoding: 'utf8' }).trim();
                    
                    if (ffmpegExe && ffprobeExe) {
                        // Copy binaries to root directory
                        fs.copyFileSync(`ffmpeg-temp/${ffmpegExe}`, 'ffmpeg.exe');
                        fs.copyFileSync(`ffmpeg-temp/${ffprobeExe}`, 'ffprobe.exe');
                        
                        // Cleanup
                        fs.rmSync('ffmpeg-temp', { recursive: true, force: true });
                        fs.unlinkSync(ffmpegZip);
                        
                        downloadSuccess = true;
                        break;
                    } else {
                        console.log('❌ Could not find FFmpeg binaries in extracted files');
                        fs.rmSync('ffmpeg-temp', { recursive: true, force: true });
                        fs.unlinkSync(ffmpegZip);
                    }
                    
                } catch (error) {
                    console.log(`❌ Failed to download from ${sourceUrl}: ${error.message}`);
                    lastError = error;
                    
                    // Clean up failed download
                    if (fs.existsSync('ffmpeg-win.zip')) fs.unlinkSync('ffmpeg-win.zip');
                    if (fs.existsSync('ffmpeg-temp')) fs.rmSync('ffmpeg-temp', { recursive: true, force: true });
                }
            }
            
            if (!downloadSuccess) {
                throw new Error(`All download sources failed. Last error: ${lastError.message}`);
            }
            
        } else {
            console.log('📥 Downloading FFmpeg for macOS/Linux...');
            
            // Multiple reliable sources for macOS/Linux - prioritized for compatibility
            const sources = [
                // Source 1: Official Evermeet builds (most compatible with all macOS versions)
                'https://evermeet.cx/ffmpeg/getrelease/zip',
                // Source 2: BtbN shared build (better compatibility with system libraries)
                'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl-shared.zip',
                // Source 3: BtbN static build (universal Intel + Apple Silicon)
                'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.zip',
                // Source 4: Static builds from John Van Sickle (very reliable)
                'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
            ];
            
            let downloadSuccess = false;
            let lastError = null;
            
            for (const sourceUrl of sources) {
                try {
                    console.log(`🔄 Trying source: ${sourceUrl}`);
                    
                    let ffmpegZip, extractCommand;
                    
                    if (sourceUrl.includes('evermeet.cx')) {
                        ffmpegZip = 'ffmpeg-mac.zip';
                        extractCommand = 'unzip -o ffmpeg-mac.zip';
                        console.log('📱 Using Evermeet build (official macOS builds - best compatibility)');
                    } else if (sourceUrl.includes('github.com') && sourceUrl.includes('shared')) {
                        ffmpegZip = 'ffmpeg-mac-shared.zip';
                        extractCommand = 'unzip -o ffmpeg-mac-shared.zip';
                        console.log('🔄 Using BtbN shared build (better compatibility with system libraries)');
                    } else if (sourceUrl.includes('github.com')) {
                        ffmpegZip = 'ffmpeg-mac-github.zip';
                        extractCommand = 'unzip -o ffmpeg-mac-github.zip';
                        console.log('🔄 Using BtbN static build (universal Intel + Apple Silicon)');
                    } else {
                        ffmpegZip = 'ffmpeg-linux.tar.xz';
                        extractCommand = 'tar -xf ffmpeg-linux.tar.xz';
                        console.log('🔄 Using static Linux build (fallback option)');
                    }
                    
                    await downloadFile(sourceUrl, ffmpegZip);
                    
                    // Verify the downloaded file
                    const stats = fs.statSync(ffmpegZip);
                    console.log(`✅ Downloaded ${ffmpegZip} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
                    
                    // Extract
                    console.log('📦 Extracting FFmpeg...');
                    execSync(extractCommand);
                    
                    // Check if both binaries exist after extraction
                    const ffmpegExists = fs.existsSync('ffmpeg');
                    const ffprobeExists = fs.existsSync('ffprobe');
                    
                    console.log(`FFmpeg binary found: ${ffmpegExists}`);
                    console.log(`FFprobe binary found: ${ffprobeExists}`);
                    
                    // If both binaries exist, we're good
                    if (ffmpegExists && ffprobeExists) {
                        console.log('✅ Both FFmpeg and FFprobe found!');
                    } else {
                        // Try to find binaries in subdirectories
                        console.log('🔍 Searching for binaries in subdirectories...');
                        
                        // Look for ffmpeg and ffprobe in extracted directories
                        const findCommand = platform === 'win32' ? 
                            'dir /s /b ffmpeg*' : 
                            'find . -name "ffmpeg*" -o -name "ffprobe*"';
                        
                        try {
                            const foundFiles = execSync(findCommand, { encoding: 'utf8' });
                            console.log('Found files:', foundFiles);
                            
                            // Try to copy from subdirectories
                            if (!ffmpegExists) {
                                const ffmpegFiles = foundFiles.split('\n').filter(f => f.includes('ffmpeg') && !f.includes('ffprobe'));
                                if (ffmpegFiles.length > 0) {
                                    const sourcePath = ffmpegFiles[0].trim();
                                    console.log(`Copying FFmpeg from: ${sourcePath}`);
                                    fs.copyFileSync(sourcePath, './ffmpeg');
                                }
                            }
                            
                            if (!ffprobeExists) {
                                const ffprobeFiles = foundFiles.split('\n').filter(f => f.includes('ffprobe'));
                                if (ffprobeFiles.length > 0) {
                                    const sourcePath = ffprobeFiles[0].trim();
                                    console.log(`Copying FFprobe from: ${sourcePath}`);
                                    fs.copyFileSync(sourcePath, './ffprobe');
                                }
                            }
                        } catch (error) {
                            console.log('Search command failed:', error.message);
                        }
                        
                        // Check again if we found the binaries
                        const finalFfmpegExists = fs.existsSync('ffmpeg');
                        const finalFfprobeExists = fs.existsSync('ffprobe');
                        
                        if (!finalFfmpegExists || !finalFfprobeExists) {
                            console.log('❌ Still missing binaries, trying next source...');
                            // Clean up and try next source
                            if (fs.existsSync('ffmpeg')) fs.unlinkSync('ffmpeg');
                            if (fs.existsSync('ffprobe')) fs.unlinkSync('ffprobe');
                            continue;
                        }
                    }
                    
                    // Make executable
                    if (fs.existsSync('ffmpeg')) {
                        fs.chmodSync('ffmpeg', '755');
                    }
                    if (fs.existsSync('ffprobe')) {
                        fs.chmodSync('ffprobe', '755');
                    }
                    
                    // Cleanup
                    fs.unlinkSync(ffmpegZip);
                    
                    downloadSuccess = true;
                    break;
                    
                } catch (error) {
                    console.log(`❌ Failed to download from ${sourceUrl}: ${error.message}`);
                    lastError = error;
                    
                    // Clean up failed download
                    if (fs.existsSync('ffmpeg-mac.zip')) fs.unlinkSync('ffmpeg-mac.zip');
                    if (fs.existsSync('ffmpeg-mac-github.zip')) fs.unlinkSync('ffmpeg-mac-github.zip');
                    if (fs.existsSync('ffmpeg-mac-shared.zip')) fs.unlinkSync('ffmpeg-mac-shared.zip');
                    if (fs.existsSync('ffmpeg-linux.tar.xz')) fs.unlinkSync('ffmpeg-linux.tar.xz');
                    
                    // Also clean up any partial binaries
                    if (fs.existsSync('ffmpeg')) fs.unlinkSync('ffmpeg');
                    if (fs.existsSync('ffprobe')) fs.unlinkSync('ffprobe');
                }
            }
            
            if (!downloadSuccess) {
                throw new Error(`All download sources failed. Last error: ${lastError.message}`);
            }
        }
        
        console.log('✅ FFmpeg setup completed successfully!');
        
        // Verify installation
        console.log('🔍 Verifying FFmpeg installation...');
        if (isWindows) {
            execSync('ffmpeg.exe -version', { stdio: 'inherit' });
            execSync('ffprobe.exe -version', { stdio: 'inherit' });
        } else {
            execSync('./ffmpeg -version', { stdio: 'inherit' });
            execSync('./ffprobe -version', { stdio: 'inherit' });
        }
        
    } catch (error) {
        console.error('❌ Error setting up FFmpeg:', error.message);
        console.log('\n📋 Manual setup instructions:');
        console.log('1. Download FFmpeg from https://ffmpeg.org/download.html');
        console.log('2. Extract the binaries to the project root directory');
        console.log('3. Ensure ffmpeg and ffprobe are executable');
        console.log('\n💡 Alternative: Use Homebrew on macOS: brew install ffmpeg');
        console.log('💡 Alternative: Use Chocolatey on Windows: choco install ffmpeg');
        process.exit(1);
    }
}

async function main() {
    // Check if FFmpeg already exists
    const ffmpegExists = isWindows ? 
        fs.existsSync('ffmpeg.exe') : 
        fs.existsSync('ffmpeg');
    
    if (ffmpegExists && !isCI) {
        console.log('✅ FFmpeg already exists, skipping download...');
    } else {
        await setupFFmpeg();
    }
    
    console.log('\n🎉 Development environment setup complete!');
    if (!isCI) {
        console.log('You can now run: npm start');
    }
}

main().catch(console.error); 