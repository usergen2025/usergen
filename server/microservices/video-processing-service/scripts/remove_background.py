#!/usr/bin/env python3
"""
Remove background from video using AI model (rembg)
Requires: pip install rembg opencv-python pillow numpy onnxruntime
"""
import sys
import os
from pathlib import Path
import cv2
import numpy as np
from rembg import remove, new_session
import tempfile
import shutil

def remove_background_from_video(input_path, output_path, model_name='u2net_human_seg'):
    """
    Remove background from video using rembg
    Processes video frame by frame and creates output with alpha channel
    """
    print(f"[BackgroundRemoval] Processing video: {input_path}")
    
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
    
    # Create temporary directory for processed frames
    temp_dir = tempfile.mkdtemp(prefix='bg_removal_')
    processed_dir = os.path.join(temp_dir, 'processed')
    os.makedirs(processed_dir, exist_ok=True)
    
    frame_count = 0
    
    try:
        print("🎬 Processing video frame-by-frame and removing background...")
        
        # Process each frame
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            frame_path = os.path.join(processed_dir, f'frame_{frame_count:06d}.png')
            
            # Remove background using rembg
            try:
                # Save frame temporarily
                temp_frame = os.path.join(temp_dir, f'temp_{frame_count}.png')
                cv2.imwrite(temp_frame, frame)
                
                # Process with rembg - use the session we created
                with open(temp_frame, 'rb') as f:
                    input_data = f.read()
                    # Use session parameter instead of model_name
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
            if frame_count % 30 == 0:
                print(f"[BackgroundRemoval] Processed {frame_count}/{total_frames} frames...")
        
        cap.release()
        
        if frame_count == 0:
            raise Exception("No frames were processed")
        
        print(f"[BackgroundRemoval] Creating output video with alpha channel...")
        
        # Use FFmpeg image2 demuxer (BEST for PNG sequences with alpha)
        # This is more reliable than concat for preserving alpha channel
        import subprocess
        
        # Get absolute path to processed directory
        abs_processed_dir = os.path.abspath(processed_dir)
        
        # Use image2 demuxer with pattern matching - preserves alpha perfectly
        # Explicitly tell FFmpeg to read RGBA from PNG and convert to YUVA420p
        # This ensures alpha channel is properly preserved (fixes black background issue)
        # Add thread limit to prevent excessive CPU usage
        max_threads = int(os.environ.get('FFMPEG_MAX_THREADS', '4'))
        ffmpeg_cmd = [
            'ffmpeg',
            '-threads', str(max_threads),  # Limit CPU threads to prevent crypto-mining detection
            '-y',
            '-framerate', str(fps),  # Input frame rate
            '-i', os.path.join(abs_processed_dir, 'frame_%06d.png'),  # Input pattern
            # First ensure RGBA is read from PNG, then convert to YUVA420p (preserves alpha)
            '-vf', 'format=rgba,format=yuva420p',  # Explicitly read RGBA, then convert to YUV with alpha
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-pix_fmt', 'yuva420p',  # YUV with alpha channel - CRITICAL
            '-r', str(fps),  # Output frame rate
            output_path
        ]
        
        # Wrap with nice/ionice if available (for process priority management)
        use_nice = os.environ.get('FFMPEG_USE_NICE', 'true').lower() == 'true'
        use_ionice = os.environ.get('FFMPEG_USE_IONICE', 'true').lower() == 'true'
        nice_priority = int(os.environ.get('FFMPEG_NICE_PRIORITY', '10'))
        
        if use_ionice:
            ffmpeg_cmd = ['ionice', '-c', '3'] + ffmpeg_cmd
        if use_nice:
            ffmpeg_cmd = ['nice', '-n', str(nice_priority)] + ffmpeg_cmd
        
        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"[BackgroundRemoval] FFmpeg error: {result.stderr}")
            raise Exception(f"FFmpeg failed: {result.stderr}")
        
        print(f"[BackgroundRemoval] ✅ Background removal complete: {output_path}")
        return output_path
        
    except Exception as e:
        print(f"[BackgroundRemoval] Error: {e}")
        raise
    finally:
        # Cleanup temporary files
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

