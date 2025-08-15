// Simple test to check basic functionality
console.log('=== Simple Functionality Test ===');

// Test 1: Check if we can read files
const fs = require('fs');
const path = require('path');

console.log('\n1. Testing file operations...');

// Check if we can read the current directory
try {
    const files = fs.readdirSync('.');
    console.log('✅ Can read directory (', files.length, 'files)');
    
    // Check for important files
    const importantFiles = ['main.js', 'renderer.js', 'index.html', 'package.json'];
    importantFiles.forEach(file => {
        if (fs.existsSync(file)) {
            console.log(`✅ ${file} exists`);
        } else {
            console.log(`❌ ${file} missing`);
        }
    });
} catch (error) {
    console.log('❌ Cannot read directory:', error.message);
}

// Test 2: Check if we can create directories
console.log('\n2. Testing directory creation...');
try {
    const testDir = './test-output';
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir);
        console.log('✅ Created test directory');
    } else {
        console.log('✅ Test directory already exists');
    }
    
    // Try to write a test file
    const testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'Test content');
    console.log('✅ Can write files');
    
    // Clean up
    fs.unlinkSync(testFile);
    fs.rmdirSync(testDir);
    console.log('✅ Can delete files and directories');
} catch (error) {
    console.log('❌ Directory/file operations failed:', error.message);
}

// Test 3: Check FFmpeg
console.log('\n3. Testing FFmpeg...');
const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
const ffprobePath = path.join(__dirname, 'ffprobe.exe');

if (fs.existsSync(ffmpegPath)) {
    const stats = fs.statSync(ffmpegPath);
    console.log(`✅ ffmpeg.exe exists (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
} else {
    console.log('❌ ffmpeg.exe not found');
}

if (fs.existsSync(ffprobePath)) {
    const stats = fs.statSync(ffprobePath);
    console.log(`✅ ffprobe.exe exists (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
} else {
    console.log('❌ ffprobe.exe not found');
}

// Test 4: Check for any log files
console.log('\n4. Checking log files...');
const logFiles = [
    'start-processing-test.txt',
    'test-log.txt',
    'processing-progress.txt',
    'debug-test.txt'
];

logFiles.forEach(logFile => {
    if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        const lines = content.trim().split('\n');
        console.log(`📄 ${logFile} (${lines.length} lines)`);
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            console.log(`   Last: ${lastLine.substring(0, 100)}${lastLine.length > 100 ? '...' : ''}`);
        }
    } else {
        console.log(`❌ ${logFile} (not found)`);
    }
});

console.log('\n=== Test Complete ===');
console.log('\nIf all tests pass, the issue is likely in the UI or processing logic.');
console.log('Try running the app and check the console (F12) for detailed logs.'); 