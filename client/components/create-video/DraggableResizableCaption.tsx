'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bold, Italic, Underline, Type, Palette, Square, ChevronDown, Check } from 'lucide-react';

interface CaptionPosition {
  x: number;
  y: number;
  scale: number;
  widthScale: number; // Width as ratio of container (0.3 to 0.8)
}

interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline';
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
}

interface DraggableResizableCaptionProps {
  captionText: string;
  position: CaptionPosition;
  style: CaptionStyle;
  onPositionChange: (position: CaptionPosition) => void;
  onStyleChange: (style: CaptionStyle) => void;
  containerWidth: number;
  containerHeight: number;
  disabled?: boolean;
}

type ResizeHandle = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

const FONT_FAMILIES = [
  { value: 'Inter', label: 'Inter' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Open Sans', label: 'Open Sans' },
  { value: 'Montserrat', label: 'Montserrat' },
  { value: 'Poppins', label: 'Poppins' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Georgia', label: 'Georgia' },
];

const COLOR_PRESETS = [
  { value: 'transparent', label: 'None', isTransparent: true },
  { value: '#FFFFFF', label: 'White' },
  { value: '#000000', label: 'Black' },
  { value: '#E86412', label: 'Orange' },
  { value: '#F12A4C', label: 'Red' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#22C55E', label: 'Green' },
  { value: '#FACC15', label: 'Yellow' },
];

// Orange accent color to match avatar overlay UI
const ACCENT_COLOR = '#E86412';

// Width scale limits (as ratio of container width)
const MIN_WIDTH_SCALE = 0.3;  // Minimum 30% of container
const MAX_WIDTH_SCALE = 0.8;  // Maximum 80% of container

// Height scale limits
const MIN_HEIGHT_SCALE = 0.05;
const MAX_HEIGHT_SCALE = 0.3;

// Safety margin to prevent edge overflow (in pixels)
const SAFETY_MARGIN = 4;

export function DraggableResizableCaption({
  captionText,
  position,
  style,
  onPositionChange,
  onStyleChange,
  containerWidth,
  containerHeight,
  disabled = false,
}: DraggableResizableCaptionProps) {
  const captionRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fontDropdownRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialPosition, setInitialPosition] = useState<CaptionPosition>(position);
  const [showToolbar, setShowToolbar] = useState(false);
  const [activeColorPicker, setActiveColorPicker] = useState<'text' | 'bg' | 'border' | null>(null);
  const [showFontDropdown, setShowFontDropdown] = useState(false);

  // Get widthScale with fallback for backwards compatibility
  const widthScale = position.widthScale ?? MAX_WIDTH_SCALE;
  
  // Caption dimensions based on scale
  const captionHeight = containerHeight * position.scale;
  const captionWidth = containerWidth * widthScale;

  // Calculate max bounds with safety margin
  const maxPixelX = Math.max(0, containerWidth - captionWidth - SAFETY_MARGIN);
  const maxPixelY = Math.max(0, containerHeight - captionHeight - SAFETY_MARGIN);

  // Clamp normalized position to strict 0-1 range
  const clampedPositionX = Math.max(0, Math.min(1, position.x));
  const clampedPositionY = Math.max(0, Math.min(1, position.y));

  // Convert normalized position to pixel position with bounds clamping
  const rawPixelX = maxPixelX * clampedPositionX;
  const rawPixelY = maxPixelY * clampedPositionY;
  const pixelX = Math.max(SAFETY_MARGIN / 2, Math.min(rawPixelX, maxPixelX));
  const pixelY = Math.max(0, Math.min(rawPixelY, maxPixelY));

  // Convert pixel position to normalized position with safety margin
  const pixelToNormalized = useCallback((px: number, py: number, scale: number, wScale: number): CaptionPosition => {
    const captionH = containerHeight * scale;
    const captionW = containerWidth * wScale;

    const maxX = Math.max(0, containerWidth - captionW - SAFETY_MARGIN);
    const maxY = Math.max(0, containerHeight - captionH - SAFETY_MARGIN);

    const clampedPx = Math.max(SAFETY_MARGIN / 2, Math.min(px, maxX));
    const clampedPy = Math.max(0, Math.min(py, maxY));

    const normX = maxX > 0 ? clampedPx / maxX : 0.5;
    const normY = maxY > 0 ? clampedPy / maxY : 0.5;

    return {
      x: Math.max(0, Math.min(1, normX)),
      y: Math.max(0, Math.min(1, normY)),
      scale,
      widthScale: wScale,
    };
  }, [containerWidth, containerHeight]);

  // Handle mouse down for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    setDragStart({ x: e.clientX - pixelX, y: e.clientY - pixelY });
    setInitialPosition(position);
    setShowToolbar(true);
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

  // Handle mouse move for dragging and resizing
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPixelX = e.clientX - dragStart.x;
        const newPixelY = e.clientY - dragStart.y;
        const newPosition = pixelToNormalized(newPixelX, newPixelY, position.scale, widthScale);
        onPositionChange(newPosition);
      } else if (isResizing && activeHandle) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        let newScale = initialPosition.scale;
        let newWidthScale = initialPosition.widthScale ?? MAX_WIDTH_SCALE;

        // Handle vertical resizing (top/bottom)
        if (activeHandle.includes('t')) {
          const scaleChange = -deltaY / containerHeight;
          newScale = Math.max(MIN_HEIGHT_SCALE, Math.min(MAX_HEIGHT_SCALE, initialPosition.scale + scaleChange));
        } else if (activeHandle.includes('b')) {
          const scaleChange = deltaY / containerHeight;
          newScale = Math.max(MIN_HEIGHT_SCALE, Math.min(MAX_HEIGHT_SCALE, initialPosition.scale + scaleChange));
        }

        // Handle horizontal resizing (left/right)
        if (activeHandle.includes('l')) {
          const widthChange = -deltaX / containerWidth;
          newWidthScale = Math.max(MIN_WIDTH_SCALE, Math.min(MAX_WIDTH_SCALE, (initialPosition.widthScale ?? MAX_WIDTH_SCALE) + widthChange));
        } else if (activeHandle.includes('r')) {
          const widthChange = deltaX / containerWidth;
          newWidthScale = Math.max(MIN_WIDTH_SCALE, Math.min(MAX_WIDTH_SCALE, (initialPosition.widthScale ?? MAX_WIDTH_SCALE) + widthChange));
        }

        // Calculate new position to keep caption in bounds
        const newCaptionW = containerWidth * newWidthScale;
        const newCaptionH = containerHeight * newScale;
        const newMaxX = Math.max(0, containerWidth - newCaptionW - SAFETY_MARGIN);
        const newMaxY = Math.max(0, containerHeight - newCaptionH - SAFETY_MARGIN);

        const newPosition = pixelToNormalized(
          newMaxX * initialPosition.x,
          newMaxY * initialPosition.y,
          newScale,
          newWidthScale
        );

        onPositionChange(newPosition);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setActiveHandle(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, activeHandle, dragStart, initialPosition, position.scale, widthScale, containerWidth, containerHeight, pixelToNormalized, onPositionChange]);

  // Close toolbar and dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideCaption = captionRef.current && captionRef.current.contains(target);
      const isInsideToolbar = toolbarRef.current && toolbarRef.current.contains(target);
      
      if (!isInsideCaption && !isInsideToolbar) {
        setShowToolbar(false);
        setActiveColorPicker(null);
        setShowFontDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle styles - use orange to match avatar overlay
  const handleBaseStyle = "absolute w-[8px] h-[8px] bg-white border-2 rounded-sm z-10";

  const handles: { position: ResizeHandle; style: string; cursor: string }[] = [
    { position: 'tl', style: 'top-[-4px] left-[-4px]', cursor: 'nwse-resize' },
    { position: 'tc', style: 'top-[-4px] left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
    { position: 'tr', style: 'top-[-4px] right-[-4px]', cursor: 'nesw-resize' },
    { position: 'ml', style: 'top-1/2 -translate-y-1/2 left-[-4px]', cursor: 'ew-resize' },
    { position: 'mr', style: 'top-1/2 -translate-y-1/2 right-[-4px]', cursor: 'ew-resize' },
    { position: 'bl', style: 'bottom-[-4px] left-[-4px]', cursor: 'nesw-resize' },
    { position: 'bc', style: 'bottom-[-4px] left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
    { position: 'br', style: 'bottom-[-4px] right-[-4px]', cursor: 'nwse-resize' },
  ];

  const toggleBold = () => {
    onStyleChange({ ...style, fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold' });
  };

  const toggleItalic = () => {
    onStyleChange({ ...style, fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic' });
  };

  const toggleUnderline = () => {
    onStyleChange({ ...style, textDecoration: style.textDecoration === 'underline' ? 'none' : 'underline' });
  };

  const handleFontSelect = (fontValue: string) => {
    onStyleChange({ ...style, fontFamily: fontValue });
    setShowFontDropdown(false);
  };

  const ColorPickerDropdown = ({ type, currentColor }: { type: 'text' | 'bg' | 'border'; currentColor: string }) => {
    const colors = type === 'text' 
      ? COLOR_PRESETS.filter(c => !c.isTransparent) 
      : COLOR_PRESETS;
    
    return (
      <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-50 min-w-[120px]">
        <div className="grid grid-cols-4 gap-1">
          {colors.map((color) => (
            <button
              key={color.value}
              onClick={() => {
                if (type === 'text') onStyleChange({ ...style, textColor: color.value });
                else if (type === 'bg') onStyleChange({ ...style, backgroundColor: color.value });
                else if (type === 'border') onStyleChange({ ...style, borderColor: color.value });
                setActiveColorPicker(null);
              }}
              className={`w-6 h-6 rounded border-2 ${currentColor === color.value ? 'border-orange-500' : 'border-gray-300'} ${color.isTransparent ? 'bg-gradient-to-br from-gray-100 via-gray-200 to-gray-100' : ''}`}
              style={{ backgroundColor: color.isTransparent ? undefined : color.value }}
              title={color.label}
            />
          ))}
        </div>
      </div>
    );
  };

  // Custom Font Dropdown Component
  const FontDropdown = () => {
    const selectedFont = FONT_FAMILIES.find(f => f.value === style.fontFamily) || FONT_FAMILIES[0];
    
    return (
      <div ref={fontDropdownRef} className="relative">
        <button
          onClick={() => setShowFontDropdown(!showFontDropdown)}
          className="h-7 px-2 text-xs border border-gray-200 rounded flex items-center gap-1 hover:bg-gray-50 bg-white min-w-[70px] justify-between"
          style={{ fontFamily: selectedFont.value }}
        >
          <span className="truncate">{selectedFont.label}</span>
          <ChevronDown className="w-3 h-3 flex-shrink-0 text-gray-500" />
        </button>
        
        {showFontDropdown && (
          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 z-50 min-w-[120px] max-h-[200px] overflow-y-auto">
            {FONT_FAMILIES.map((font) => (
              <button
                key={font.value}
                onClick={() => handleFontSelect(font.value)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-orange-50 flex items-center justify-between transition-colors ${
                  style.fontFamily === font.value ? 'bg-orange-50 text-orange-600' : 'text-gray-700'
                }`}
                style={{ fontFamily: font.value }}
              >
                <span>{font.label}</span>
                {style.fontFamily === font.value && (
                  <Check className="w-3 h-3 text-orange-500" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Floating Toolbar - positioned above caption, width matches caption */}
      {showToolbar && !disabled && (
        <div
          ref={toolbarRef}
          className="absolute z-20 bg-white rounded-lg shadow-lg border border-gray-200 p-1.5 flex items-center gap-1 overflow-x-auto"
          style={{
            left: `${pixelX}px`,
            top: `${Math.max(0, pixelY - 45)}px`,
            width: `${captionWidth}px`,
            minWidth: '200px',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Font Family - Custom Dropdown */}
          <FontDropdown />

          {/* Font Size */}
          <input
            type="number"
            value={style.fontSize}
            onChange={(e) => onStyleChange({ ...style, fontSize: Math.max(8, Math.min(72, parseInt(e.target.value) || 16)) })}
            className="w-10 h-7 px-1 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
            min={8}
            max={72}
          />

          <div className="w-px h-5 bg-gray-200 flex-shrink-0" />

          {/* Bold */}
          <button
            onClick={toggleBold}
            className={`w-7 h-7 flex items-center justify-center rounded flex-shrink-0 ${style.fontWeight === 'bold' ? 'bg-orange-100 text-orange-600' : 'hover:bg-gray-100'}`}
            title="Bold"
          >
            <Bold className="w-4 h-4" />
          </button>

          {/* Italic */}
          <button
            onClick={toggleItalic}
            className={`w-7 h-7 flex items-center justify-center rounded flex-shrink-0 ${style.fontStyle === 'italic' ? 'bg-orange-100 text-orange-600' : 'hover:bg-gray-100'}`}
            title="Italic"
          >
            <Italic className="w-4 h-4" />
          </button>

          {/* Underline */}
          <button
            onClick={toggleUnderline}
            className={`w-7 h-7 flex items-center justify-center rounded flex-shrink-0 ${style.textDecoration === 'underline' ? 'bg-orange-100 text-orange-600' : 'hover:bg-gray-100'}`}
            title="Underline"
          >
            <Underline className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-gray-200 flex-shrink-0" />

          {/* Text Color */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => {
                setActiveColorPicker(activeColorPicker === 'text' ? null : 'text');
                setShowFontDropdown(false);
              }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
              title="Text Color"
            >
              <Type className="w-4 h-4" style={{ color: style.textColor }} />
            </button>
            {activeColorPicker === 'text' && <ColorPickerDropdown type="text" currentColor={style.textColor} />}
          </div>

          {/* Background Color */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => {
                setActiveColorPicker(activeColorPicker === 'bg' ? null : 'bg');
                setShowFontDropdown(false);
              }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
              title="Background Color"
            >
              <Palette className="w-4 h-4" style={{ color: style.backgroundColor === 'transparent' ? '#9CA3AF' : style.backgroundColor }} />
            </button>
            {activeColorPicker === 'bg' && <ColorPickerDropdown type="bg" currentColor={style.backgroundColor} />}
          </div>

          {/* Border Color */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => {
                setActiveColorPicker(activeColorPicker === 'border' ? null : 'border');
                setShowFontDropdown(false);
              }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100"
              title="Border Color"
            >
              <Square className="w-4 h-4" style={{ color: style.borderColor === 'transparent' ? '#9CA3AF' : style.borderColor }} />
            </button>
            {activeColorPicker === 'border' && <ColorPickerDropdown type="border" currentColor={style.borderColor} />}
          </div>

          {/* Border Width */}
          <input
            type="number"
            value={style.borderWidth}
            onChange={(e) => onStyleChange({ ...style, borderWidth: Math.max(0, Math.min(10, parseInt(e.target.value) || 0)) })}
            className="w-8 h-7 px-1 text-xs text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-500 flex-shrink-0"
            min={0}
            max={10}
            title="Border Width (px)"
          />
        </div>
      )}

      {/* Caption Box */}
      <div
        ref={captionRef}
        className={`absolute select-none ${isDragging || isResizing ? 'cursor-grabbing' : 'cursor-grab'} ${disabled ? 'pointer-events-none opacity-50' : ''}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${captionWidth}px`,
          minHeight: `${captionHeight}px`,
        }}
        onMouseDown={handleMouseDown}
        onClick={() => setShowToolbar(true)}
      >
        {/* Caption Content */}
        <div
          className="w-full h-full flex items-center justify-center p-2 rounded-lg"
          style={{
            fontFamily: style.fontFamily,
            fontSize: `${style.fontSize}px`,
            fontWeight: style.fontWeight,
            fontStyle: style.fontStyle,
            textDecoration: style.textDecoration,
            color: style.textColor,
            backgroundColor: style.backgroundColor === 'transparent' ? 'transparent' : style.backgroundColor,
            border: style.borderWidth > 0 && style.borderColor !== 'transparent' 
              ? `${style.borderWidth}px solid ${style.borderColor}` 
              : 'none',
          }}
        >
          <span className="text-center leading-tight">
            {captionText || 'Sample caption text'}
          </span>
        </div>

        {/* Selection border - orange to match avatar overlay */}
        {showToolbar && (
          <div className="absolute inset-0 border-2 border-[#E86412] border-dashed pointer-events-none rounded-lg" />
        )}

        {/* Resize handles */}
        {!disabled && showToolbar && handles.map(({ position: handlePos, style: handleStyle, cursor }) => (
          <div
            key={handlePos}
            className={`${handleBaseStyle} ${handleStyle}`}
            style={{ cursor, borderColor: ACCENT_COLOR }}
            onMouseDown={(e) => handleResizeMouseDown(e, handlePos)}
          />
        ))}
      </div>
    </>
  );
}
