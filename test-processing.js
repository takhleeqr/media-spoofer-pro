// Test script to check processing functionality
const fs = require('fs');
const path = require('path');

console.log('=== Testing Processing Functionality ===');

// Check if the app is running and processing files
function checkProcessingStatus() {
    console.log('\n1. Checking processing logs...');
    
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
                console.log(`   Last line: ${lines[lines.length - 1]}`);
            }
        } else {
            console.log(`❌ ${logFile} (not found)`);
        }
    });
}

// Check if output directories exist
function checkOutputDirectories() {
    console.log('\n2. Checking output directories...');
    
    const outputDirs = [
        'output',
        'MediaSpoofer_Output',
        'test-output'
    ];
    
    outputDirs.forEach(dir => {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            console.log(`📁 ${dir} (${files.length} items)`);
            if (files.length > 0) {
                console.log(`   Items: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
            }
        } else {
            console.log(`❌ ${dir} (not found)`);
        }
    });
}

// Check if FFmpeg is working
function testFFmpeg() {
    console.log('\n3. Testing FFmpeg...');
    
    const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
    const ffprobePath = path.join(__dirname, 'ffprobe.exe');
    
    if (fs.existsSync(ffmpegPath)) {
        console.log('✅ ffmpeg.exe exists');
        const stats = fs.statSync(ffmpegPath);
        console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
    } else {
        console.log('❌ ffmpeg.exe not found');
    }
    
    if (fs.existsSync(ffprobePath)) {
        console.log('✅ ffprobe.exe exists');
        const stats = fs.statSync(ffprobePath);
        console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
    } else {
        console.log('❌ ffprobe.exe not found');
    }
}

// Check for any error files
function checkErrorFiles() {
    console.log('\n4. Checking for error files...');
    
    const errorPatterns = [
        'error*.txt',
        '*.log',
        'debug*.txt'
    ];
    
    const files = fs.readdirSync('.');
    const errorFiles = files.filter(file => 
        file.includes('error') || 
        file.includes('.log') || 
        file.includes('debug')
    );
    
    if (errorFiles.length > 0) {
        console.log('Found error/debug files:');
        errorFiles.forEach(file => {
            console.log(`   📄 ${file}`);
        });
    } else {
        console.log('No error files found');
    }
}

// Main test function
function runTests() {
    checkProcessingStatus();
    checkOutputDirectories();
    testFFmpeg();
    checkErrorFiles();
    
    console.log('\n=== Test Complete ===');
    console.log('\nTo test processing:');
    console.log('1. Start the app: npm start');
    console.log('2. Select image mode');
    console.log('3. Add an image file');
    console.log('4. Select output folder');
    console.log('5. Click "Start Processing"');
    console.log('6. Check console (F12) for detailed logs');
    console.log('7. Run this test again to see what changed');
}

runTests(); 