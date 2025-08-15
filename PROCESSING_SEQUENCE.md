# MediaSpoofer Processing Steps & Sequence Guide

## 🔄 **Processing Flow Overview**

**CONVERT FIRST APPROACH**: Format conversion happens IMMEDIATELY when files are loaded, before any effects or processing are applied. This ensures consistent quality and processing across all file types.

**Processing Sequence:**
```
Input Files → Format Conversion → Effects/Processing → Output Files
```

---

## 📹 **Processing Mode 1: Spoof + Split (spoof-split)**

### **Sequence:**
```
Input Video → Convert to Target Format → Check Duration → Split into Clips → Apply Effects → Output Clips
```

### **Detailed Steps:**
1. **Format Conversion**: Files converted to target format immediately using `convertVideo()`
2. **Duration Check**: `getVideoDuration()` determines if video > 10 seconds
3. **If Duration > 10s**:
   - Split video into clips using `processVideoSplit()`
   - For each clip: `processVideoClipWithEffects()` applies effects to converted format
4. **If Duration ≤ 10s**:
   - Direct processing using `processSpoof()` → `processVideoSpoof()`
   - Effects applied to converted format

### **Format Conversion Stage:**
- **When**: FIRST stage - immediately when files are loaded
- **How**: `convertVideo()` converts to target format before any processing
- **Example**: MOV input → MP4 conversion → Effects applied to MP4 → MP4 output

---

## 🎨 **Processing Mode 2: Spoof (spoof-only)**

### **Sequence:**
```
Input Video → Convert to Target Format → Apply Effects → Output Video
```

### **Detailed Steps:**
1. **Format Conversion**: Files converted to target format immediately using `convertVideo()`
2. **Generate Effects**: `generateSpoofEffects()` creates random visual effects
3. **Process Video**: `processVideoSpoof()` applies effects to converted format
4. **Output**: Single video file with effects in target format

### **Format Conversion Stage:**
- **When**: FIRST stage - immediately when files are loaded
- **How**: `convertVideo()` converts to target format before effects processing
- **Example**: AVI input → WebM conversion → Effects applied to WebM → WebM output

---

## ✂️ **Processing Mode 3: Split (split-only)**

### **Sequence:**
```
Input Video → Convert to Target Format → Check Duration → Split into Clips → Output Clips
```

### **Detailed Steps:**
1. **Format Conversion**: Files converted to target format immediately using `convertVideo()`
2. **Duration Check**: `getVideoDuration()` determines if video > 10 seconds
3. **If Duration > 10s**:
   - Split video into clips using `processVideoSplit()`
   - For each clip: `extractVideoClip()` extracts clip from converted format
4. **If Duration ≤ 10s**:
   - Single output using converted file (conversion already done)

### **Format Conversion Stage:**
- **When**: FIRST stage - immediately when files are loaded
- **How**: `convertVideo()` converts to target format before splitting
- **Example**: MKV input → MP4 conversion → Split MP4 into clips → MP4 output clips

---

## 🔄 **Processing Mode 4: Convert (convert-only)**

### **Sequence:**
```
Input Video → Convert to Target Format → Output Video
```

### **Detailed Steps:**
1. **Format Conversion**: `convertVideo()` converts to target format immediately
2. **Output**: Single video file in target format

### **Format Conversion Stage:**
- **When**: FIRST stage - immediately when files are loaded
- **How**: `convertVideo()` converts to target format
- **Example**: FLV input → MP4 conversion → MP4 output

---

## 🎯 **Format Conversion Details**

### **When It Happens:**
Format conversion occurs **FIRST** (immediately when files are loaded) whenever:
1. `generateOutputPathForBatch()` detects a different output format
2. Output file extension differs from input file extension
3. User selects a different output format in the UI

### **How It Works:**
1. **Path Generation**: `generateOutputPathForBatch()` uses `settings.videoFormat` for extension
2. **Immediate Conversion**: `convertVideo()` or `convertImage()` converts files to target format first
3. **Unified Processing**: All subsequent processing (effects, splitting) uses the converted format
4. **Consistent Quality**: Effects applied to target format for best results

### **Supported Conversions:**
| Input → Output | Video Codec | Audio Codec | Container |
|----------------|-------------|-------------|-----------|
| **Any → Original** | Copy (No Conversion) | Copy (No Conversion) | Original Format |
| **Any → MP4** | H.264 | AAC | MP4 + faststart |
| **Any → WebM** | VP9 | Opus | WebM |
| **Any → MOV** | H.264 | AAC | QuickTime MOV |
| **Any → AVI** | H.264 | AAC | AVI |
| **Any → MKV** | H.264 | AAC | Matroska |

### **Original Format Option:**
- **When Selected**: No format conversion occurs
- **Behavior**: Input files maintain their original format
- **Use Case**: Preserve original quality when applying effects or splitting
- **Availability**: Hidden when processing type is "Convert" (format conversion only)
- **Efficiency**: Direct processing without conversion overhead
- **Quality**: Effects applied to original format for maximum quality preservation

---

## 🔧 **Audio Removal & Watermark Support**

### **✅ Audio Removal - Works in ALL Processing Types:**
- **`convertVideo()`**: `-an` flag removes audio
- **`processVideoSpoof()`**: `-an` flag removes audio  
- **`extractVideoClip()`**: `-an` flag removes audio
- **`processVideoClipWithEffects()`**: `-an` flag removes audio

### **✅ Watermark - Works in ALL Processing Types:**
- **`convertVideo()`**: `-vf` with watermark filter
- **`processVideoSpoof()`**: `-vf` with effects + watermark filter
- **`extractVideoClip()`**: `-vf` with watermark filter
- **`processVideoClipWithEffects()`**: `-vf` with effects + watermark filter

### **Implementation:**
```javascript
// Add watermark if enabled
const watermarkFilter = generateWatermarkFilter(settings.watermark);
if (watermarkFilter) {
    command.push('-vf', watermarkFilter);
}

// Handle audio removal
if (settings.removeAudio) {
    command.push('-an');
}
```

---

## 📋 **Real-World Example: 10 Videos (5 MP4, 5 MOV) → MP4 Output**

### **Scenario:**
- **Input**: 5 MP4 files + 5 MOV files
- **Output Format**: MP4 selected
- **Processing Mode**: Any mode selected

### **What Happens:**
1. **MP4 Files**: Processed and output as MP4 (no conversion needed)
2. **MOV Files**: Converted to MP4 with H.264 encoding
3. **All Processing Modes**: Apply effects, split, or convert as requested
4. **Format Conversion**: Happens automatically for MOV files

### **Result:**
All 10 output files will be MP4 format, regardless of their original format.

### **Alternative with "Original" Option:**
If user selects "Original" as output format:
1. **MP4 Files**: Processed and output as MP4 (no conversion)
2. **MOV Files**: Processed and output as MOV (no conversion)
3. **Result**: Mixed output formats - MP4 files remain MP4, MOV files remain MOV

---

## 🚀 **Key Benefits**

✅ **Convert FIRST Approach** - Format conversion happens immediately for consistent processing  
✅ **Highest Quality Outputs** - Effects applied to target format for best results  
✅ **Universal Support** - Works across all processing modes  
✅ **Processing Consistency** - All files processed in same format for uniform effects  
✅ **Feature Consistency** - Audio removal & watermark work everywhere  
✅ **Cross-Platform** - Proper container formats for compatibility  

---

## 🔍 **Technical Implementation**

### **Core Functions:**
- **`generateOutputPathForBatch()`**: Determines output format
- **`convertVideo()`**: Handles format conversion
- **`processVideoSpoof()`**: Effects + format conversion
- **`extractVideoClip()`**: Clip extraction + format conversion
- **`processVideoClipWithEffects()`**: Effects + clip extraction + format conversion

### **FFmpeg Integration:**
- **Codec Selection**: Automatic based on output extension
- **Container Format**: Automatic based on output extension
- **Audio Handling**: Automatic codec selection per format
- **Metadata**: Stripped for privacy (`-map_metadata -1`)

---

*This implementation ensures that format conversion, audio removal, and watermarking work consistently across all processing modes, providing a seamless user experience.*
