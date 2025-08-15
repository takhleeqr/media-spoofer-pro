// Test script to check app functionality
const fs = require('fs');
const path = require('path');

console.log('=== Media Spoofer Pro Test ===');

// Check if main files exist
const requiredFiles = [
    'main.js',
    'renderer.js',
    'preload.js',
    'index.html',
    'package.json'
];

console.log('\n1. Checking required files...');
requiredFiles.forEach(file => {
    const exists = fs.existsSync(file);
    console.log(`${exists ? '✅' : '❌'} ${file}`);
});

// Check if FFmpeg exists
console.log('\n2. Checking FFmpeg...');
const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
const ffprobePath = path.join(__dirname, 'ffprobe.exe');

const ffmpegExists = fs.existsSync(ffmpegPath);
const ffprobeExists = fs.existsSync(ffprobePath);

console.log(`${ffmpegExists ? '✅' : '❌'} ffmpeg.exe`);
console.log(`${ffprobeExists ? '✅' : '❌'} ffprobe.exe`);

// Check package.json
console.log('\n3. Checking package.json...');
try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    console.log('✅ package.json is valid JSON');
    console.log(`   Name: ${packageJson.name}`);
    console.log(`   Version: ${packageJson.version}`);
    console.log(`   Main: ${packageJson.main}`);
} catch (error) {
    console.log('❌ package.json error:', error.message);
}

// Check if node_modules exists
console.log('\n4. Checking dependencies...');
const nodeModulesExists = fs.existsSync('node_modules');
console.log(`${nodeModulesExists ? '✅' : '❌'} node_modules directory`);

if (nodeModulesExists) {
    const electronExists = fs.existsSync('node_modules/electron');
    console.log(`${electronExists ? '✅' : '❌'} electron package`);
}

// Check for any error logs
console.log('\n5. Checking for error logs...');
const logFiles = [
    'start-processing-test.txt',
    'test-log.txt',
    'processing-progress.txt',
    'debug-test.txt'
];

logFiles.forEach(logFile => {
    if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        console.log(`📄 ${logFile} (${content.length} chars)`);
        if (content.length > 0) {
            console.log(`   Last line: ${content.trim().split('\n').pop()}`);
        }
    } else {
        console.log(`❌ ${logFile} (not found)`);
    }
});

console.log('\n=== Test Complete ===');
console.log('\nTo run the app: npm start');
console.log('To test processing:');
console.log('1. Start the app');
console.log('2. Select a mode (image/video)');
console.log('3. Add some files');
console.log('4. Click "Start Processing"');
console.log('5. Check the console for debug output'); 