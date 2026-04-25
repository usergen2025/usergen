'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Position {
  x: number;
  y: number;
  scale: number;
}

interface DraggableResizableAvatarProps {
  avatarImageUrl: string;
  position: Position;
  onPositionChange: (position: Position) => void;
  containerWidth: number;
  containerHeight: number;
  disabled?: boolean;
}

type ResizeHandle = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

export function DraggableResizableAvatar({
  avatarImageUrl,
  position,
  onPositionChange,
  containerWidth,
  containerHeight,
  disabled = false,
}: DraggableResizableAvatarProps) {
  const avatarRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialPosition, setInitialPosition] = useState<Position>(position);
  const [showVerticalGuide, setShowVerticalGuide] = useState(false);
  const [showHorizontalGuide, setShowHorizontalGuide] = useState(false);
  const lockCenterXRef = useRef(false);
  const lockCenterYRef = useRef(false);
  
  // Dynamic aspect ratio from actual image dimensions
  // Default to 9:16 (portrait) until image loads
  const [avatarAspectRatio, setAvatarAspectRatio] = useState(9 / 16);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  // Load actual image dimensions to get correct aspect ratio
  useEffect(() => {
    if (!avatarImageUrl) return;
    
    const img = new Image();
    img.onload = () => {
      const actualRatio = img.width / img.height;
      console.log(`[DraggableResizableAvatar] Image loaded: ${img.width}x${img.height}, aspect ratio: ${actualRatio.toFixed(4)}`);
      setAvatarAspectRatio(actualRatio);
      setImageLoaded(true);
    };
    img.onerror = () => {
      console.warn('[DraggableResizableAvatar] Failed to load image, using default 9:16 aspect ratio');
      setAvatarAspectRatio(9 / 16);
      setImageLoaded(true);
    };
    img.src = avatarImageUrl;
  }, [avatarImageUrl]);
  
  // Safety margin to prevent edge overflow (in pixels)
  const SAFETY_MARGIN = 2;
  const SNAP_THRESHOLD_PX = 10;
  const SNAP_RELEASE_PX = 16;
  
  // Avatar dimensions based on scale and actual aspect ratio
  const avatarHeight = containerHeight * position.scale;
  const avatarWidth = avatarHeight * avatarAspectRatio;
  
  // Calculate max bounds for the avatar with safety margin
  // Ensure avatar stays fully inside container with a small buffer
  const maxPixelX = Math.max(0, containerWidth - avatarWidth - SAFETY_MARGIN);
  const maxPixelY = Math.max(0, containerHeight - avatarHeight - SAFETY_MARGIN);
  
  // Clamp normalized position to strict 0-1 range
  const clampedPositionX = Math.max(0, Math.min(1, position.x));
  const clampedPositionY = Math.max(0, Math.min(1, position.y));
  
  // Re-clamp position when aspect ratio changes or container resizes to ensure bounds
  useEffect(() => {
    if (!imageLoaded) return;
    
    const avatarH = containerHeight * position.scale;
    const avatarW = avatarH * avatarAspectRatio;
    const maxX = Math.max(0, containerWidth - avatarW - SAFETY_MARGIN);
    const maxY = Math.max(0, containerHeight - avatarH - SAFETY_MARGIN);
    
    // Ensure position values are clamped to 0-1 range
    const clampedX = Math.max(0, Math.min(1, position.x));
    const clampedY = Math.max(0, Math.min(1, position.y));
    
    // Calculate current pixel position from clamped normalized values
    const currentPixelX = maxX > 0 ? clampedX * maxX : 0;
    const currentPixelY = maxY > 0 ? clampedY * maxY : 0;
    
    // Double-check pixel bounds
    const finalPixelX = Math.max(0, Math.min(currentPixelX, maxX));
    const finalPixelY = Math.max(0, Math.min(currentPixelY, maxY));
    
    // Calculate new normalized position
    const newNormX = maxX > 0 ? finalPixelX / maxX : 0.5;
    const newNormY = maxY > 0 ? finalPixelY / maxY : 0.5;
    
    // Only update if position changed (to avoid infinite loops)
    if (Math.abs(newNormX - position.x) > 0.001 || Math.abs(newNormY - position.y) > 0.001) {
      console.log(`[DraggableResizableAvatar] Re-clamping position: (${position.x.toFixed(3)}, ${position.y.toFixed(3)}) -> (${newNormX.toFixed(3)}, ${newNormY.toFixed(3)})`);
      onPositionChange({ x: newNormX, y: newNormY, scale: position.scale });
    }
  }, [imageLoaded, avatarAspectRatio, containerWidth, containerHeight, position.scale, position.x, position.y, onPositionChange]);
  
  // Convert normalized position to pixel position and ensure it's within bounds
  // Use clamped position values and add safety margin
  const rawPixelX = maxPixelX * clampedPositionX;
  const rawPixelY = maxPixelY * clampedPositionY;
  const pixelX = Math.max(0, Math.min(rawPixelX, maxPixelX));
  const pixelY = Math.max(0, Math.min(rawPixelY, maxPixelY));

  // Convert pixel position to normalized position with safety margin
  const pixelToNormalized = useCallback((px: number, py: number, scale: number): Position => {
    const avatarH = containerHeight * scale;
    const avatarW = avatarH * avatarAspectRatio;
    
    // Include safety margin in max bounds calculation
    const maxX = Math.max(0, containerWidth - avatarW - SAFETY_MARGIN);
    const maxY = Math.max(0, containerHeight - avatarH - SAFETY_MARGIN);
    
    // Clamp pixel position to valid range
    const clampedPx = Math.max(0, Math.min(px, maxX));
    const clampedPy = Math.max(0, Math.min(py, maxY));
    
    // Calculate normalized position and clamp to strict 0-1 range
    const normX = maxX > 0 ? clampedPx / maxX : 0.5;
    const normY = maxY > 0 ? clampedPy / maxY : 0.5;
    
    return {
      x: Math.max(0, Math.min(1, normX)),
      y: Math.max(0, Math.min(1, normY)),
      scale,
    };
  }, [containerWidth, containerHeight, avatarAspectRatio]);

  // Handle mouse down for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragging(true);
    setDragStart({ x: e.clientX - pixelX, y: e.clientY - pixelY });
    setInitialPosition(position);
  }, [disabled, pixelX, pixelY, position]);

  // Handle mouse down for resizing
  const handleResizeMouseDown = useCallback((e: React.MouseEvent, handle: ResizeHandle) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    
    setIsResizing(true);
    setActiveHandle(handle);
    setDragStart({ x: e.clientX, y: e.clientY });
    setInitialPosition(position);
  }, [disabled, position]);

  // Handle mouse move
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        let newPixelX = e.clientX - dragStart.x;
        let newPixelY = e.clientY - dragStart.y;
        const targetCenterX = Math.max(0, (containerWidth - avatarWidth) / 2);
        const targetCenterY = Math.max(0, (containerHeight - avatarHeight) / 2);
        const dx = Math.abs(newPixelX - targetCenterX);
        const dy = Math.abs(newPixelY - targetCenterY);
        if (lockCenterXRef.current) {
          if (dx > SNAP_RELEASE_PX) lockCenterXRef.current = false;
        } else if (dx <= SNAP_THRESHOLD_PX) {
          lockCenterXRef.current = true;
        }
        if (lockCenterYRef.current) {
          if (dy > SNAP_RELEASE_PX) lockCenterYRef.current = false;
        } else if (dy <= SNAP_THRESHOLD_PX) {
          lockCenterYRef.current = true;
        }
        if (lockCenterXRef.current) newPixelX = targetCenterX;
        if (lockCenterYRef.current) newPixelY = targetCenterY;
        setShowVerticalGuide(lockCenterXRef.current);
        setShowHorizontalGuide(lockCenterYRef.current);
        const newPosition = pixelToNormalized(newPixelX, newPixelY, position.scale);
        onPositionChange(newPosition);
      } else if (isResizing && activeHandle) {
        const deltaY = e.clientY - dragStart.y;
        
        // Calculate new scale based on resize direction
        let scaleChange = 0;
        
        // Corner and edge handles affect scale
        if (activeHandle.includes('t')) {
          scaleChange = -deltaY / containerHeight;
        } else if (activeHandle.includes('b')) {
          scaleChange = deltaY / containerHeight;
        }
        
        // For corner handles, use average of both directions for uniform scaling
        if (activeHandle === 'tl' || activeHandle === 'tr' || activeHandle === 'bl' || activeHandle === 'br') {
          const deltaX = e.clientX - dragStart.x;
          const scaleChangeX = (activeHandle.includes('l') ? -deltaX : deltaX) / containerWidth;
          scaleChange = (scaleChange + scaleChangeX * avatarAspectRatio) / 2;
        }
        
        // Clamp scale between 0.15 and 0.8
        // Also ensure the avatar doesn't exceed container bounds
        const maxAllowedScale = Math.min(0.8, containerWidth / (containerHeight * avatarAspectRatio));
        const newScale = Math.max(0.15, Math.min(maxAllowedScale, initialPosition.scale + scaleChange));
        
        // Adjust position to keep the avatar in a reasonable position after resize
        const newPosition = pixelToNormalized(
          (containerWidth - containerHeight * newScale * avatarAspectRatio) * initialPosition.x,
          (containerHeight - containerHeight * newScale) * initialPosition.y,
          newScale
        );
        
        onPositionChange(newPosition);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setActiveHandle(null);
      lockCenterXRef.current = false;
      lockCenterYRef.current = false;
      setShowVerticalGuide(false);
      setShowHorizontalGuide(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, activeHandle, dragStart, initialPosition, position.scale, containerWidth, containerHeight, avatarAspectRatio, pixelToNormalized, onPositionChange, avatarWidth, avatarHeight]);

  // Handle styles
  const handleBaseStyle = "absolute w-[10px] h-[10px] bg-white border-2 border-[#E86412] rounded-sm z-10";
  
  const handles: { position: ResizeHandle; style: string; cursor: string }[] = [
    { position: 'tl', style: 'top-[-5px] left-[-5px]', cursor: 'nwse-resize' },
    { position: 'tc', style: 'top-[-5px] left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
    { position: 'tr', style: 'top-[-5px] right-[-5px]', cursor: 'nesw-resize' },
    { position: 'ml', style: 'top-1/2 -translate-y-1/2 left-[-5px]', cursor: 'ew-resize' },
    { position: 'mr', style: 'top-1/2 -translate-y-1/2 right-[-5px]', cursor: 'ew-resize' },
    { position: 'bl', style: 'bottom-[-5px] left-[-5px]', cursor: 'nesw-resize' },
    { position: 'bc', style: 'bottom-[-5px] left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
    { position: 'br', style: 'bottom-[-5px] right-[-5px]', cursor: 'nwse-resize' },
  ];

  return (
    <>
      {showVerticalGuide && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none z-10"
          style={{ left: `${containerWidth / 2}px`, width: '1px', backgroundColor: 'rgba(232,100,18,0.75)' }}
        />
      )}
      {showHorizontalGuide && (
        <div
          className="absolute left-0 right-0 pointer-events-none z-10"
          style={{ top: `${containerHeight / 2}px`, height: '1px', backgroundColor: 'rgba(232,100,18,0.75)' }}
        />
      )}
      <div
        ref={avatarRef}
        className={`absolute select-none ${isDragging || isResizing ? 'cursor-grabbing' : 'cursor-grab'} ${disabled ? 'pointer-events-none opacity-50' : ''}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${avatarWidth}px`,
          height: `${avatarHeight}px`,
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Avatar image */}
        <img
          src={avatarImageUrl}
          alt="Avatar overlay"
          className="w-full h-full object-contain pointer-events-none"
          draggable={false}
        />
        
        {/* Selection border */}
        <div className="absolute inset-0 border-2 border-[#E86412] border-dashed pointer-events-none" />
        
        {/* Resize handles */}
        {!disabled && handles.map(({ position: handlePos, style, cursor }) => (
          <div
            key={handlePos}
            className={`${handleBaseStyle} ${style}`}
            style={{ cursor }}
            onMouseDown={(e) => handleResizeMouseDown(e, handlePos)}
          />
        ))}
      </div>
    </>
  );
}
