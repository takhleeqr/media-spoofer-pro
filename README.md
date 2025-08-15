# Media Spoofer Pro

Professional media transformation tool for social platforms. Transform images and videos with advanced effects, format conversion, and batch processing capabilities.

## Features

### Image Processing
- **Visual Effects**: Apply various filters and effects to images
- **Format Conversion**: Convert between JPG, PNG, HEIC, WebP formats or preserve original format
- **Batch Processing**: Process multiple images simultaneously
- **Metadata Removal**: Strip EXIF data for privacy
- **Custom Naming**: Flexible file naming patterns

### Video Processing
- **Video Effects**: Apply visual effects to video clips
- **Video Splitting**: Split videos into shorter clips
- **Format Conversion**: Convert between MP4, MOV, AVI, WebM formats or preserve original format
- **Audio Management**: Remove or preserve audio tracks
- **Batch Processing**: Process multiple videos with different settings

### Processing Modes
- **Spoof**: Apply effects without splitting
- **Split**: Split videos into clips without effects
- **Spoof + Split**: Apply effects and split into clips
- **Convert**: Format conversion only

## Installation

### Prerequisites
- Node.js 18+ 
- FFmpeg (automatically downloaded during setup)

### Development vs Production

**Development (Local):**
- FFmpeg binaries are downloaded locally during `npm run setup`
- Includes all development tools and debugging capabilities
- Larger repository size due to included binaries

**Production (GitHub Builds):**
- FFmpeg binaries are downloaded during automated build process
- Optimized for distribution with smaller package sizes
- Automated installer creation for Windows and macOS

### Development Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/takhleeqr/media-spoofer-pro.git
   cd media-spoofer-pro
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup FFmpeg (automated):
   ```bash
   npm run setup
   ```
   
   Or manually download FFmpeg binaries and place them in the project root.

4. Start the application:
   ```bash
   npm start
   ```

### Building for Distribution

#### Windows
```bash
npm run build-win
```

#### macOS
```bash
npm run build-mac
```

#### Both Platforms
```bash
npm run build
```

## Security Improvements

This version includes several security enhancements:

- **Context Isolation**: Enabled for secure renderer process
- **Node Integration**: Disabled to prevent security vulnerabilities
- **Preload Script**: Secure IPC communication between processes
- **Input Validation**: Proper file path and type validation

## Bug Fixes

### Critical Fixes
- **Fixed duplicate code**: Removed duplicate import statements and variable declarations in `renderer.js`
- **Improved error handling**: Better error messages and retry logic
- **Cross-platform compatibility**: Proper FFmpeg path detection for different operating systems

### Performance Improvements
- **Batch processing**: Efficient handling of multiple files
- **Progress tracking**: Real-time progress updates
- **Memory management**: Proper cleanup of temporary files

## GitHub Actions

Automated builds are configured for:
- **macOS**: Automatic DMG installer creation
- **Windows**: Automatic NSIS installer creation
- **Release Management**: Automated release asset creation

## Usage

1. **Select Mode**: Choose between Image or Video processing
2. **Add Files**: Drag and drop or select files to process
3. **Configure Settings**: Set processing mode, effects, and output options
4. **Choose Output**: Select output folder or use default location
5. **Start Processing**: Click start to begin batch processing
6. **Monitor Progress**: Track progress in real-time
7. **Access Results**: Open output folder to view processed files

## File Formats Supported

### Images
- JPG/JPEG
- PNG
- HEIC
- WebP

### Videos
- MP4
- MOV
- AVI
- WebM

## Processing Options

### Intensity Levels
- **Light**: Subtle effects
- **Medium**: Balanced effects
- **Heavy**: Strong effects

### Duplicate Settings
- Create multiple variations of each file
- Customizable naming patterns
- Batch organization

## Troubleshooting

### FFmpeg Not Found
Ensure FFmpeg binaries are in the application folder:
- Windows: `ffmpeg.exe`, `ffprobe.exe`
- macOS/Linux: `ffmpeg`, `ffprobe`

### Processing Errors
- Check file formats are supported
- Ensure sufficient disk space
- Verify file permissions

### Performance Issues
- Reduce batch size for large files
- Close other applications
- Check available RAM

## License

MIT License - see LICENSE.txt for details

## Support

For support, contact: support@ponyagency.com

## Version History

### v1.0.0 (Current)
- Initial release
- Image and video processing
- Batch processing capabilities
- Cross-platform support
- Security improvements
- Automated build system

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Roadmap

- [ ] Additional video effects
- [ ] Audio processing capabilities
- [ ] Cloud storage integration
- [ ] Advanced metadata editing
- [ ] Plugin system for custom effects 