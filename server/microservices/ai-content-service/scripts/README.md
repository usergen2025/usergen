# Python Scripts for AI Content Service

## Background Removal Script

The `remove_image_background.py` script uses the `rembg` library to remove backgrounds from images.

### Python Version Requirements

**⚠️ CRITICAL**: Python 3.8-3.13 is **REQUIRED**. Python 3.14+ is **NOT compatible** with `onnxruntime`, which is a required dependency of `rembg`.

### Installation

#### Option 1: Using Python 3.13 or earlier (Recommended)

1. **Install Python 3.13** (if not already installed):
   ```bash
   # macOS with Homebrew
   brew install python@3.13
   ```

2. **Create a virtual environment** with Python 3.13:
   ```bash
   cd server/microservices/ai-content-service
   python3.13 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r scripts/requirements.txt
   ```

#### Option 2: Using Python 3.14+ (Workaround - Not Recommended)

If you must use Python 3.14+, you have two options:

**Option A**: Install dependencies without onnxruntime (background removal will fail):
```bash
pip install rembg opencv-python pillow numpy
# Note: This will fail when trying to use rembg due to missing onnxruntime
```

**Option B**: Use system Python 3.13 if available:
```bash
# Check if Python 3.13 is available
python3.13 --version

# If available, create venv with it
python3.13 -m venv venv
source venv/bin/activate
pip install -r scripts/requirements.txt
```

### Usage

The script is automatically called by the `AvatarsService` when creating transparent avatar versions.

Manual usage:
```bash
python3 scripts/remove_image_background.py <input_image> <output_image> [model_name]
```

Available models:
- `u2net` - General purpose
- `u2net_human_seg` - Optimized for human portraits (default)
- `silueta` - Silhouette detection
- `isnet-general-use` - General use ISNet model

### Troubleshooting

If you see `ModuleNotFoundError: No module named 'rembg'`:
1. Ensure virtual environment is activated: `source venv/bin/activate`
2. Verify installation: `pip list | grep rembg`
3. Reinstall if needed: `pip install -r scripts/requirements.txt`

