const { spawn } = require('child_process');
const path = require('path');

// Test FFmpeg installation
async function testFFmpeg() {
    const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
    const ffprobePath = path.join(__dirname, 'ffprobe.exe');
    
    console.log('Testing FFmpeg installation...');
    console.log('FFmpeg path:', ffmpegPath);
    console.log('FFprobe path:', ffprobePath);
    
    // Test FFmpeg version
    try {
        const result = await new Promise((resolve, reject) => {
            const child = spawn(ffmpegPath, ['-version']);
            let stdout = '';
            let stderr = '';
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr, code });
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
                }
            });
            
            child.on('error', (error) => {
                reject(error);
            });
        });
        
        console.log('✅ FFmpeg is working!');
        console.log('Version info:', result.stdout.split('\n')[0]);
        
    } catch (error) {
        console.error('❌ FFmpeg test failed:', error.message);
    }
}

testFFmpeg(); 