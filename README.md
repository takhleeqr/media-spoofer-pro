# Media Spoofer Pro

Professional media transformation for social platforms with cross-platform support.

## 🚀 Features

- Cross-platform compatibility (Windows, macOS, Linux)
- Built-in FFmpeg binaries for seamless operation
- Professional media processing capabilities
- Electron-based desktop application

## 🛠️ Development Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Git

### Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd MediaSpooferApp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup FFmpeg (automated)**
   ```bash
   npm run setup
   ```
   This will automatically download and configure FFmpeg for your platform.
   
4. **Start development server**
   ```bash
   npm start
   ```

### Manual FFmpeg Setup (if automated setup fails)

#### Windows
```bash
# Option 1: Download from official source
# Visit https://ffmpeg.org/download.html and download Windows builds
# Extract ffmpeg.exe and ffprobe.exe to the project root

# Option 2: Use Chocolatey
choco install ffmpeg
# Then copy from C:\ProgramData\chocolatey\bin\ffmpeg.exe
```

#### macOS
```bash
# Option 1: Use Homebrew
brew install ffmpeg
# Then copy from /usr/local/bin/ffmpeg

# Option 2: Download from official source
# Visit https://ffmpeg.org/download.html and download macOS builds
```

#### Linux
```bash
# Option 1: Use package manager
sudo apt update && sudo apt install ffmpeg  # Ubuntu/Debian
sudo yum install ffmpeg                     # CentOS/RHEL

# Option 2: Download from official source
# Visit https://ffmpeg.org/download.html and download Linux builds
```

## 🏗️ Building for Distribution

### Local Builds

#### Windows
```bash
npm run build-win
```

#### macOS
```bash
npm run build-mac
```

#### All Platforms
```bash
npm run build
```

### GitHub Actions (Recommended)

The project includes a comprehensive GitHub Actions workflow that automatically:

1. **Builds for both Windows and macOS**
2. **Downloads appropriate FFmpeg binaries for each platform**
3. **Creates installers with embedded FFmpeg**
4. **Releases cross-platform packages**

#### How it works:

1. **Push to main branch**: Triggers build and test
2. **Create a release**: Automatically builds and packages both platforms
3. **Download installers**: Users get platform-specific installers with FFmpeg included

#### Workflow Features:

- **Multi-source FFmpeg downloads** with fallbacks
- **Automatic binary verification** to ensure integrity
- **Cross-platform compatibility** testing
- **Seamless user experience** - no manual FFmpeg installation needed

## 📦 Package Contents

Each platform-specific installer includes:

- **Media Spoofer Pro application**
- **FFmpeg binary** (platform-specific)
- **FFprobe binary** (platform-specific)
- **All necessary dependencies**

## 🔧 Configuration

### package.json Build Settings

The `package.json` includes optimized build configurations:

```json
{
  "build": {
    "extraResources": [
      "ffmpeg.exe",
      "ffprobe.exe", 
      "ffmpeg",
      "ffprobe"
    ],
    "win": {
      "target": "nsis",
      "icon": "logo.png"
    },
    "mac": {
      "target": "dmg",
      "icon": "logo.png",
      "defaultArch": "universal"
    }
  }
}
```

### Platform-Specific Settings

- **Windows**: NSIS installer with desktop shortcuts
- **macOS**: Universal DMG with hardened runtime
- **Linux**: AppImage support (configurable)

## 🚀 Deployment

### GitHub Releases

1. **Create a new release** on GitHub
2. **Tag with version** (e.g., v1.0.0)
3. **GitHub Actions automatically**:
   - Builds both platforms
   - Includes FFmpeg binaries
   - Creates installers
   - Uploads to release assets

### Manual Distribution

Build artifacts are available in the `dist/` directory after building:

```
dist/
├── Media Spoofer Pro Setup.exe    # Windows installer
├── Media Spoofer Pro.dmg          # macOS installer
└── linux-unpacked/                # Linux unpacked files
```

## 🐛 Troubleshooting

### FFmpeg Issues

- **Download failures**: The setup script tries multiple sources automatically
- **Binary not found**: Ensure FFmpeg binaries are in the project root
- **Permission errors**: Make sure binaries are executable (chmod +x on Unix systems)

### Build Issues

- **Platform-specific errors**: Check that you're building on the target platform
- **Missing dependencies**: Run `npm install` and `npm run setup`
- **Electron builder errors**: Check the `package.json` build configuration

### Common Solutions

```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install
npm run setup

# Force rebuild
npm run build -- --force

# Check FFmpeg installation
./ffmpeg -version  # Unix
ffmpeg.exe -version # Windows
```

## 📋 Requirements

### Development
- Node.js 18+
- npm 8+
- Git

### Runtime
- Windows 10+ / macOS 10.15+ / Linux (glibc 2.17+)
- 4GB RAM minimum
- 500MB disk space

### Build
- Windows: Windows 10+ with PowerShell
- macOS: macOS 10.15+ with Xcode Command Line Tools
- Linux: Ubuntu 18.04+ or equivalent

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test on multiple platforms
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE.txt](LICENSE.txt) for details.

## 🆘 Support

- **Issues**: Create a GitHub issue
- **Documentation**: Check this README and inline code comments
- **Community**: Join our discussions

---

**Built with ❤️ by Pony Agency** 