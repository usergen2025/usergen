'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  layoutAvatarBox,
  pixelsToAvatarNormalized,
} from '@/lib/workspace/avatarBounds';

interface Position {
  x: number;
  y: number;
  scale: number;
}

interface DraggableResizableAvatarProps {
  avatarImageUrl: string;
  position: Position;
  onPositionChange: (position: Position) => void;
  onAspectRatioChange?: (aspectRatio: number) => void;
  containerWidth: number;
  containerHeight: number;
  containerRef?: React.RefObject<HTMLElement | null>;
  disabled?: boolean;
}

type ResizeHandle = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

export function DraggableResizableAvatar({
  avatarImageUrl,
  position,
  onPositionChange,
  onAspectRatioChange,
  containerWidth,
  containerHeight,
  containerRef,
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

  const [avatarAspectRatio, setAvatarAspectRatio] = useState(9 / 16);

  useEffect(() => {
    if (!avatarImageUrl) return;

    const img = new Image();
    img.onload = () => {
      const ratio = img.width / img.height;
      setAvatarAspectRatio(ratio);
      onAspectRatioChange?.(ratio);
    };
    img.onerror = () => {
      setAvatarAspectRatio(9 / 16);
      onAspectRatioChange?.(9 / 16);
    };
    img.src = avatarImageUrl;
  }, [avatarImageUrl, onAspectRatioChange]);

  const SNAP_THRESHOLD_PX = 10;
  const SNAP_RELEASE_PX = 16;

  const layout = layoutAvatarBox({
    containerWidth,
    containerHeight,
    positionX: position.x,
    positionY: position.y,
    scale: position.scale,
    aspectRatio: avatarAspectRatio,
  });

  const { left: pixelX, top: pixelY, width: avatarWidth, height: avatarHeight, minX, maxX, minY, maxY } =
    layout;

  const getLocalPoint = useCallback(
    (clientX: number, clientY: number) => {
      const cr = containerRef?.current?.getBoundingClientRect();
      if (cr) {
        return { x: clientX - cr.left, y: clientY - cr.top };
      }
      return { x: clientX, y: clientY };
    },
    [containerRef],
  );

  const pixelToNormalized = useCallback(
    (px: number, py: number, scale: number): Position => {
      const norm = pixelsToAvatarNormalized(
        px,
        py,
        containerWidth,
        containerHeight,
        scale,
        avatarAspectRatio,
      );
      return { x: norm.x, y: norm.y, scale };
    },
    [containerWidth, containerHeight, avatarAspectRatio],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      const local = getLocalPoint(e.clientX, e.clientY);
      setIsDragging(true);
      setDragStart({ x: local.x - pixelX, y: local.y - pixelY });
      setInitialPosition(position);
    },
    [disabled, getLocalPoint, pixelX, pixelY, position],
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, handle: ResizeHandle) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      setIsResizing(true);
      setActiveHandle(handle);
      setDragStart({ x: e.clientX, y: e.clientY });
      setInitialPosition(position);
    },
    [disabled, position],
  );

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const local = getLocalPoint(e.clientX, e.clientY);
        let newPixelX = local.x - dragStart.x;
        let newPixelY = local.y - dragStart.y;

        const idealCenterX = (containerWidth - avatarWidth) / 2;
        const idealCenterY = (containerHeight - avatarHeight) / 2;
        const targetCenterX = Math.max(minX, Math.min(idealCenterX, maxX));
        const targetCenterY = Math.max(minY, Math.min(idealCenterY, maxY));
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
        onPositionChange(pixelToNormalized(newPixelX, newPixelY, position.scale));
      } else if (isResizing && activeHandle) {
        const deltaY = e.clientY - dragStart.y;
        let scaleChange = 0;

        if (activeHandle.includes('t')) {
          scaleChange = -deltaY / containerHeight;
        } else if (activeHandle.includes('b')) {
          scaleChange = deltaY / containerHeight;
        }

        if (
          activeHandle === 'tl' ||
          activeHandle === 'tr' ||
          activeHandle === 'bl' ||
          activeHandle === 'br'
        ) {
          const deltaX = e.clientX - dragStart.x;
          const scaleChangeX =
            (activeHandle.includes('l') ? -deltaX : deltaX) / containerWidth;
          scaleChange = (scaleChange + scaleChangeX * avatarAspectRatio) / 2;
        }

        const maxAllowedScale = Math.min(
          0.8,
          containerWidth / (containerHeight * avatarAspectRatio),
        );
        const newScale = Math.max(
          0.15,
          Math.min(maxAllowedScale, initialPosition.scale + scaleChange),
        );

        const newLayout = layoutAvatarBox({
          containerWidth,
          containerHeight,
          positionX: initialPosition.x,
          positionY: initialPosition.y,
          scale: newScale,
          aspectRatio: avatarAspectRatio,
        });

        onPositionChange(
          pixelToNormalized(
            newLayout.minX + initialPosition.x * (newLayout.maxX - newLayout.minX),
            newLayout.minY + initialPosition.y * (newLayout.maxY - newLayout.minY),
            newScale,
          ),
        );
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
  }, [
    isDragging,
    isResizing,
    activeHandle,
    dragStart,
    initialPosition,
    position.scale,
    containerWidth,
    containerHeight,
    avatarAspectRatio,
    pixelToNormalized,
    onPositionChange,
    avatarWidth,
    avatarHeight,
    minX,
    maxX,
    minY,
    maxY,
    getLocalPoint,
  ]);

  const handleBaseStyle =
    'absolute w-[10px] h-[10px] bg-white border-2 border-[#E86412] rounded-sm z-10';

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
          style={{
            left: `${containerWidth / 2}px`,
            width: '1px',
            backgroundColor: 'rgba(232,100,18,0.75)',
          }}
        />
      )}
      {showHorizontalGuide && (
        <div
          className="absolute left-0 right-0 pointer-events-none z-10"
          style={{
            top: `${containerHeight / 2}px`,
            height: '1px',
            backgroundColor: 'rgba(232,100,18,0.75)',
          }}
        />
      )}
      <div
        ref={avatarRef}
        className={`absolute select-none pointer-events-auto ${isDragging || isResizing ? 'cursor-grabbing' : 'cursor-grab'} ${disabled ? 'pointer-events-none' : ''}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${avatarWidth}px`,
          height: `${avatarHeight}px`,
        }}
        onMouseDown={handleMouseDown}
      >
        <img
          src={avatarImageUrl}
          alt="Avatar overlay"
          className="w-full h-full object-contain pointer-events-none"
          draggable={false}
        />
        <div className="absolute inset-0 border-2 border-[#E86412] border-dashed pointer-events-none" />
        {!disabled &&
          handles.map(({ position: handlePos, style, cursor }) => (
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
