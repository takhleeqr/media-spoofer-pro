# Morph

A Windows-first desktop app (Electron) for preparing videos and images for social media — spoof/uniquify copies, split long videos into clips, crop and reframe, shrink with the GPU, convert formats, and extract frames, audio, thumbnails, or GIFs.

*A Thrive app.*

## Features

- **Compose workflow** — pick an output (one file each, split into clips, extract frames/audio, cover thumbnail, animated GIF) then stack options.
- **Make unique** — each copy gets its own subtle visual fingerprint and realistic phone metadata.
- **Crop edges** (HandBrake-style) with a live preview — trims real pixels, changes the output size, no black bars.
- **Shrink / compress** using the machine's GPU (Intel QuickSync / NVIDIA NVENC) with a software fallback.
- **Transforms** — mirror, rotate, speed, trim, loop, reframe (portrait/landscape, black-bar or blurred fill).
- **Correct handling** of anamorphic video, HDR→SDR, VFR→CFR audio sync, and square-pixel normalization.
- **Light / dark** theme.

## Running from source

```bash
npm install
npm start
```

FFmpeg (`ffmpeg.exe` / `ffprobe.exe`) is not committed to the repo — it is downloaded during the build and expected next to the app at runtime.

## Building the Windows app

```bash
npm run build-win
```

The installer is written to `dist/`. Continuous builds run on GitHub Actions (see `.github/workflows/build.yml`), which builds natively on a Windows runner and uploads the installer as an artifact.

## License

Private project. All rights reserved.
