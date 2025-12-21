#!/usr/bin/env python3
"""
Remove background from a single image using AI model (rembg)
Requires: pip install rembg opencv-python pillow numpy onnxruntime
"""
import sys
import os
from rembg import remove, new_session

def remove_background_from_image(input_path, output_path, model_name='u2net_human_seg'):
    """
    Remove background from a single image using rembg
    """
    print(f"[BackgroundRemoval] Processing image: {input_path}")
    
    if not os.path.exists(input_path):
        raise Exception(f"Input image not found: {input_path}")
    
    # Create rembg session
    print(f"[BackgroundRemoval] Initializing rembg session with model: {model_name}")
    session = new_session(model_name)
    
    try:
        # Read input image
        with open(input_path, 'rb') as f:
            input_data = f.read()
        
        # Remove background
        output_data = remove(input_data, session=session)
        
        # Save output image (PNG preserves alpha channel)
        with open(output_path, 'wb') as f:
            f.write(output_data)
        
        print(f"[BackgroundRemoval] ✅ Background removal complete: {output_path}")
        return output_path
    except Exception as e:
        print(f"[BackgroundRemoval] Error: {e}")
        raise

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python remove_image_background.py <input_image> <output_image> [model_name]")
        print("Available models: u2net, u2net_human_seg, silueta, isnet-general-use")
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else 'u2net_human_seg'
    
    try:
        remove_background_from_image(input_path, output_path, model_name)
        print("Success!")
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

