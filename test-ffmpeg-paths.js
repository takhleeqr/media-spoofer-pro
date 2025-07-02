// Test script to verify FFmpeg path resolution
const path = require('path');

// Simulate the path resolution logic from renderer.js
function testFFmpegPathResolution() {
    console.log('Testing FFmpeg path resolution...\n');
    
    // Test cases for different scenarios
    const testCases = [
        {
            name: 'Development Windows',
            platform: 'win32',
            appPath: 'C:/Users/NABEEL KAMBOH/Desktop/MediaSpooferApp',
            isDev: true
        },
        {
            name: 'Development macOS',
            platform: 'darwin',
            appPath: '/Users/user/Desktop/MediaSpooferApp',
            isDev: true
        },
        {
            name: 'Production Windows',
            platform: 'win32',
            appPath: 'C:/Users/NABEEL KAMBOH/AppData/Local/Programs/Media Spoofer Pro/resources/app.asar',
            isDev: false
        },
        {
            name: 'Production macOS',
            platform: 'darwin',
            appPath: '/Applications/Media Spoofer Pro.app/Contents/Resources/app.asar',
            isDev: false
        }
    ];
    
    testCases.forEach(testCase => {
        console.log(`=== ${testCase.name} ===`);
        console.log(`Platform: ${testCase.platform}`);
        console.log(`App Path: ${testCase.appPath}`);
        console.log(`Is Dev: ${testCase.isDev}`);
        
        let ffmpegPath, ffprobePath;
        
        if (testCase.isDev) {
            // Development: look in app folder
            if (testCase.platform === 'win32') {
                ffmpegPath = testCase.appPath + '/ffmpeg.exe';
                ffprobePath = testCase.appPath + '/ffprobe.exe';
            } else {
                ffmpegPath = testCase.appPath + '/ffmpeg';
                ffprobePath = testCase.appPath + '/ffprobe';
            }
        } else {
            // Production: look in resources folder
            if (testCase.platform === 'win32') {
                // For Windows production, the appPath points to the app.asar file
                // We need to go up one level to the app directory, then into resources
                const appDir = testCase.appPath.replace('/app.asar', '').replace('\\app.asar', '');
                ffmpegPath = appDir + '/resources/ffmpeg.exe';
                ffprobePath = appDir + '/resources/ffprobe.exe';
            } else {
                // For macOS production, the appPath points to the app bundle
                // We need to go into Contents/Resources
                const appDir = testCase.appPath.replace('/app.asar', '').replace('\\app.asar', '');
                ffmpegPath = appDir + '/resources/ffmpeg';
                ffprobePath = appDir + '/resources/ffprobe';
            }
        }
        
        console.log(`FFmpeg Path: ${ffmpegPath}`);
        console.log(`FFprobe Path: ${ffprobePath}`);
        console.log('');
    });
}

testFFmpegPathResolution(); 