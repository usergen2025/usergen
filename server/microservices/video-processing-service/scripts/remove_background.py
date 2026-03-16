#!/usr/bin/env python3
"""
Remove background from video using AI model (rembg)
Requires: pip install rembg opencv-python pillow numpy onnxruntime

OUTPUT: Creates a directory with PNG frames (preserving alpha) and a metadata file.
The calling code should use the PNG sequence directly for overlay operations.

CPU THROTTLING: This script uses CPU throttling to prevent 100% CPU usage.
This helps avoid VM flagging for suspicious activity (crypto mining detection).
"""
import sys
import os
from pathlib import Path
import cv2
import numpy as np
from rembg import remove, new_session
import tempfile
import shutil
import json
import time

# CPU throttling settings
# Process N frames, then sleep for X seconds to reduce average CPU usage
CPU_THROTTLE_BATCH_SIZE = 5  # Process 5 frames at a time
CPU_THROTTLE_SLEEP_SECONDS = 0.3  # Sleep 0.3 seconds after each batch

# Limit ONNX runtime threads to reduce CPU pressure
os.environ['OMP_NUM_THREADS'] = '2'  # Limit OpenMP threads
os.environ['ONNXRUNTIME_EXECUTION_THREAD_NUMS'] = '2'  # Limit ONNX threads

def remove_background_from_video(input_path, output_path, model_name='u2net_human_seg'):
    """
    Remove background from video using rembg
    Processes video frame by frame and creates PNG sequence with alpha channel.
    
    IMPORTANT: Since libx264 doesn't support alpha channels, we output:
    1. A directory of PNG frames with alpha (primary output for overlay)
    2. A WebM video with VP9 codec (supports alpha) as fallback
    3. A metadata JSON file with sequence info
    """
    print(f"[BackgroundRemoval] Processing video: {input_path}")
    print(f"[BackgroundRemoval] Output path: {output_path}")
    
    # Open video
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise Exception(f"Failed to open video: {input_path}")
    
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    print(f"[BackgroundRemoval] Video properties: {width}x{height} @ {fps}fps, {total_frames} frames")
    
    # Create rembg session ONCE (reuse for all frames - much faster!)
    print(f"[BackgroundRemoval] Initializing rembg session with model: {model_name}")
    session = new_session(model_name)
    
    # Create output directory for PNG sequence (persistent, not temp)
    output_base = os.path.splitext(output_path)[0]
    png_dir = output_base + '_frames'
    os.makedirs(png_dir, exist_ok=True)
    
    # Create temp directory for processing
    temp_dir = tempfile.mkdtemp(prefix='bg_removal_')
    
    frame_count = 0
    
    try:
        print("[BackgroundRemoval] 🎬 Processing video frame-by-frame and removing background...")
        
        # Process each frame
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            frame_path = os.path.join(png_dir, f'frame_{frame_count:06d}.png')
            
            # Remove background using rembg
            try:
                # Save frame temporarily
                temp_frame = os.path.join(temp_dir, f'temp_{frame_count}.png')
                cv2.imwrite(temp_frame, frame)
                
                # Process with rembg - use the session we created
                with open(temp_frame, 'rb') as f:
                    input_data = f.read()
                    output_data = remove(input_data, session=session)
                
                # Save processed frame with alpha channel (PNG preserves alpha)
                with open(frame_path, 'wb') as f:
                    f.write(output_data)
                
                # Clean up temp frame
                if os.path.exists(temp_frame):
                    os.remove(temp_frame)
                
            except Exception as e:
                print(f"[BackgroundRemoval] Error processing frame {frame_count}: {e}")
                # Fallback: use original frame with full opacity
                rgba_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA)
                rgba_frame[:, :, 3] = 255  # Full opacity
                cv2.imwrite(frame_path, rgba_frame)
            
            frame_count += 1
            
            # CPU throttling: sleep after processing a batch of frames
            if frame_count % CPU_THROTTLE_BATCH_SIZE == 0:
                time.sleep(CPU_THROTTLE_SLEEP_SECONDS)
            
            if frame_count % 30 == 0:
                progress = (frame_count / total_frames) * 100
                print(f"[BackgroundRemoval] Progress: {frame_count}/{total_frames} frames ({progress:.1f}%)")
        
        cap.release()
        
        if frame_count == 0:
            raise Exception("No frames were processed")
        
        print(f"[BackgroundRemoval] ✅ Processed {frame_count} frames with alpha channel")
        
        # Save metadata file for the compositor to use
        metadata = {
            'png_dir': png_dir,
            'pattern': 'frame_%06d.png',
            'fps': fps,
            'width': width,
            'height': height,
            'total_frames': frame_count,
            'has_alpha': True
        }
        
        metadata_path = output_base + '_metadata.json'
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"[BackgroundRemoval] Metadata saved: {metadata_path}")
        
        # Now create WebM video with VP9 (supports alpha) for direct use
        import subprocess
        
        webm_output = output_base + '.webm'
        
        print(f"[BackgroundRemoval] Creating WebM video with alpha channel...")
        ffmpeg_cmd = [
            'ffmpeg',
            '-y',
            '-framerate', str(fps),
            '-i', os.path.join(png_dir, 'frame_%06d.png'),
            '-c:v', 'libvpx-vp9',
            '-pix_fmt', 'yuva420p',
            '-b:v', '2M',
            '-crf', '30',
            '-auto-alt-ref', '0',
            '-r', str(fps),
            webm_output
        ]
        
        print(f"[BackgroundRemoval] FFmpeg command: {' '.join(ffmpeg_cmd)}")
        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"[BackgroundRemoval] WebM creation failed: {result.stderr}")
            print(f"[BackgroundRemoval] ⚠️ Will use PNG sequence directly for overlay")
        else:
            print(f"[BackgroundRemoval] ✅ WebM video created: {webm_output}")
            # Verify alpha channel
            verify_cmd = ['ffprobe', '-v', 'error', '-select_streams', 'v:0', 
                         '-show_entries', 'stream=pix_fmt', '-of', 'default=noprint_wrappers=1:nokey=1', 
                         webm_output]
            verify_result = subprocess.run(verify_cmd, capture_output=True, text=True)
            pix_fmt = verify_result.stdout.strip()
            print(f"[BackgroundRemoval] Output pixel format: {pix_fmt}")
            if 'yuva' in pix_fmt or 'rgba' in pix_fmt:
                print(f"[BackgroundRemoval] ✅ Alpha channel verified!")
            else:
                print(f"[BackgroundRemoval] ⚠️ Alpha channel may not be preserved, using PNG sequence")
        
        # Also create a "marker" file at the original output path to indicate where the real files are
        # This helps the compositor find the right files
        with open(output_path, 'w') as f:
            f.write(f"# This is a marker file - actual output is in:\n")
            f.write(f"WEBM={webm_output}\n")
            f.write(f"PNG_DIR={png_dir}\n")
            f.write(f"METADATA={metadata_path}\n")
        
        print(f"[BackgroundRemoval] ✅ Background removal complete!")
        print(f"[BackgroundRemoval] Output files:")
        print(f"[BackgroundRemoval]   - PNG sequence: {png_dir}/frame_XXXXXX.png")
        print(f"[BackgroundRemoval]   - WebM video: {webm_output}")
        print(f"[BackgroundRemoval]   - Metadata: {metadata_path}")
        
        return webm_output
        
    except Exception as e:
        print(f"[BackgroundRemoval] ❌ Error: {e}")
        raise
    finally:
        # Cleanup temp directory (but keep PNG sequence!)
        try:
            shutil.rmtree(temp_dir)
        except:
            pass

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python remove_background.py <input_video> <output_video> [model_name]")
        print("Available models: u2net, u2net_human_seg, silueta, isnet-general-use")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else 'u2net_human_seg'
    
    if not os.path.exists(input_path):
        print(f"Error: Input video not found: {input_path}")
        sys.exit(1)
    
    try:
        remove_background_from_video(input_path, output_path, model_name)
        print("Success!")
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
