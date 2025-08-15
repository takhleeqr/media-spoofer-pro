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
            console.log('📥 Setting up FFmpeg for macOS/Linux...');
            
            // For macOS/Linux, try Homebrew first, then Evermeet.cx
            try {
                console.log('🍺 Trying Homebrew installation...');
                execSync('brew install ffmpeg', { stdio: 'inherit' });
                console.log('✅ FFmpeg installed via Homebrew');
            } catch (error) {
                console.log('❌ Homebrew failed, trying Evermeet.cx...');
                await manualFFmpegDownload();
            }

            async function manualFFmpegDownload() {
                console.log('🔄 Downloading FFmpeg from Evermeet.cx...');
                try {
                    // Download FFmpeg and FFprobe from Evermeet.cx (proven working source)
                    await downloadFile('https://evermeet.cx/ffmpeg/get/ffmpeg', 'ffmpeg.zip');
                    await downloadFile('https://evermeet.cx/ffmpeg/get/ffprobe', 'ffprobe.zip');
                    
                    // Extract the binaries
                    console.log('📦 Extracting FFmpeg binaries...');
                    execSync('unzip -q ffmpeg.zip');
                    execSync('unzip -q ffprobe.zip');
                    
                    // Find and copy the actual binary files
                    console.log('🔍 Setting up FFmpeg binaries...');
                    
                    // Look for ffmpeg binary
                    const ffmpegPath = execSync('find . -name "ffmpeg" -type f | head -1', { encoding: 'utf8' }).trim();
                    if (ffmpegPath) {
                        fs.copyFileSync(ffmpegPath, './ffmpeg');
                        console.log(`FFmpeg copied from: ${ffmpegPath}`);
                    } else {
                        throw new Error('FFmpeg not found after extraction');
                    }
                    
                    // Look for ffprobe binary
                    const ffprobePath = execSync('find . -name "ffprobe" -type f | head -1', { encoding: 'utf8' }).trim();
                    if (ffprobePath) {
                        fs.copyFileSync(ffprobePath, './ffprobe');
                        console.log(`FFprobe copied from: ${ffprobePath}`);
                    } else {
                        throw new Error('FFprobe not found after extraction');
                    }
                    
                    // Make executable
                    fs.chmodSync('ffmpeg', '755');
                    fs.chmodSync('ffprobe', '755');
                    
                    // Cleanup
                    fs.unlinkSync('ffmpeg.zip');
                    fs.unlinkSync('ffprobe.zip');
                    
                    console.log('✅ FFmpeg downloaded from Evermeet.cx successfully');
                } catch (error) {
                    console.log(`❌ Evermeet.cx download failed: ${error.message}`);
                    throw new Error('All FFmpeg setup methods failed');
                }
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