# Background Removal Script

This script uses AI to remove backgrounds from avatar videos for the Avatar Cutout style.

## Installation

Install the required Python dependencies:

```bash
pip3 install -r requirements.txt
```

Or install individually:

```bash
pip3 install rembg[new] opencv-python pillow numpy
```

## Usage

The script is automatically called by the video processing service when processing Avatar Cutout videos.

Manual usage:

```bash
python3 remove_background.py <input_video> <output_video> [model_name]
```

### Available Models

- `u2net_human_seg` (default) - Best for human subjects, recommended for avatars
- `u2net` - General purpose background removal
- `silueta` - Good for portraits
- `isnet-general-use` - General purpose

## How It Works

1. The script processes the video frame by frame
2. Each frame is processed through the rembg AI model to remove the background
3. The processed frames are combined into a video with alpha channel (transparency)
4. The output video can be overlaid on b-roll footage

## Notes

- The script requires FFmpeg to be installed
- Processing time depends on video length and resolution
- The `u2net_human_seg` model is optimized for human subjects and works best for avatar videos

