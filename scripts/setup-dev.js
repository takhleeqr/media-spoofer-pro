#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const platform = process.platform;
const isWindows = platform === 'win32';

console.log('🚀 Setting up Media Spoofer Pro development environment...');

async function downloadFile(url, filename) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filename);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', reject);
    });
}

async function setupFFmpeg() {
    try {
        if (isWindows) {
            console.log('📥 Downloading FFmpeg for Windows...');
            
            // Download FFmpeg for Windows
            const ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
            const ffmpegZip = 'ffmpeg-win.zip';
            
            await downloadFile(ffmpegUrl, ffmpegZip);
            
            // Extract and copy binaries
            console.log('📦 Extracting FFmpeg...');
            execSync(`powershell -command "Expand-Archive -Path '${ffmpegZip}' -DestinationPath 'ffmpeg-temp' -Force"`);
            
            // Copy binaries to root directory
            fs.copyFileSync('ffmpeg-temp/ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe', 'ffmpeg.exe');
            fs.copyFileSync('ffmpeg-temp/ffmpeg-master-latest-win64-gpl/bin/ffprobe.exe', 'ffprobe.exe');
            
            // Cleanup
            fs.rmSync('ffmpeg-temp', { recursive: true, force: true });
            fs.unlinkSync(ffmpegZip);
            
        } else {
            console.log('📥 Downloading FFmpeg for macOS/Linux...');
            
            // Download FFmpeg for macOS/Linux
            const ffmpegUrl = 'https://evermeet.cx/ffmpeg/getrelease/zip';
            const ffmpegZip = 'ffmpeg.zip';
            
            await downloadFile(ffmpegUrl, ffmpegZip);
            
            // Extract
            execSync(`unzip -o ${ffmpegZip}`);
            
            // Make executable
            fs.chmodSync('ffmpeg', '755');
            fs.chmodSync('ffprobe', '755');
            
            // Cleanup
            fs.unlinkSync(ffmpegZip);
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
        process.exit(1);
    }
}

async function main() {
    // Check if FFmpeg already exists
    const ffmpegExists = isWindows ? 
        fs.existsSync('ffmpeg.exe') : 
        fs.existsSync('ffmpeg');
    
    if (ffmpegExists) {
        console.log('✅ FFmpeg already exists, skipping download...');
    } else {
        await setupFFmpeg();
    }
    
    console.log('\n🎉 Development environment setup complete!');
    console.log('You can now run: npm start');
}

main().catch(console.error); 