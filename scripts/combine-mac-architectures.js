const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Combining macOS architectures into universal app...');

const distDir = path.join(__dirname, '..', 'dist');
const x64Dir = path.join(distDir, 'mac-x64');
const arm64Dir = path.join(distDir, 'mac-arm64');
const universalDir = path.join(distDir, 'mac');

// Check if both architectures exist
if (!fs.existsSync(x64Dir) || !fs.existsSync(arm64Dir)) {
    console.error('❌ Both x64 and arm64 builds must exist');
    process.exit(1);
}

// Create universal directory
if (fs.existsSync(universalDir)) {
    fs.rmSync(universalDir, { recursive: true, force: true });
}
fs.mkdirSync(universalDir, { recursive: true });

// Copy x64 build as base
console.log('📋 Copying x64 build as base...');
execSync(`cp -R "${x64Dir}/"* "${universalDir}/"`, { stdio: 'inherit' });

// Copy arm64 binary into universal app
console.log('📋 Adding arm64 binary...');
const x64App = path.join(universalDir, 'Media Spoofer Pro.app');
const arm64App = path.join(arm64Dir, 'Media Spoofer Pro.app');

if (fs.existsSync(x64App) && fs.existsSync(arm64App)) {
    // Use lipo to create universal binary
    const x64Binary = path.join(x64App, 'Contents', 'MacOS', 'Media Spoofer Pro');
    const arm64Binary = path.join(arm64App, 'Contents', 'MacOS', 'Media Spoofer Pro');
    const universalBinary = path.join(x64App, 'Contents', 'MacOS', 'Media Spoofer Pro');
    
    if (fs.existsSync(x64Binary) && fs.existsSync(arm64Binary)) {
        console.log('🔗 Creating universal binary with lipo...');
        execSync(`lipo -create "${x64Binary}" "${arm64Binary}" -output "${universalBinary}"`, { stdio: 'inherit' });
        
        // Verify universal binary
        console.log('✅ Verifying universal binary...');
        execSync(`lipo -info "${universalBinary}"`, { stdio: 'inherit' });
        
        console.log('🎉 Universal macOS app created successfully!');
        console.log('📁 Universal app location:', universalDir);
        
        // List contents to verify
        console.log('📋 Contents of universal directory:');
        execSync(`ls -la "${universalDir}"`, { stdio: 'inherit' });
        
    } else {
        console.error('❌ Could not find main binaries');
        process.exit(1);
    }
} else {
    console.error('❌ Could not find app bundles');
    process.exit(1);
}

console.log('✅ macOS universal build completed!');
