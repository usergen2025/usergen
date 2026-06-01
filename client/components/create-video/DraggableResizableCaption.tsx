'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Underline, Type, Palette, Square, ChevronDown, Check } from 'lucide-react';
import {
  CAPTION_HANDLE_INSET,
  estimateCaptionBoxSize,
  layoutCaptionBox,
  pixelsToCaptionNormalized,
  reclampCaptionPosition,
} from '@/lib/workspace/captionBounds';

interface CaptionPosition {
  x: number;
  y: number;
  scale: number;
  widthScale: number;
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
  /** Visible caption text (may change word-by-word during playback). */
  displayText: string;
  /** Stable text used for box sizing / bounds (longest word for word-by-word). */
  layoutText?: string;
  position: CaptionPosition;
  style: CaptionStyle;
  onPositionChange: (position: CaptionPosition) => void;
  onStyleChange: (style: CaptionStyle) => void;
  containerWidth: number;
  containerHeight: number;
  containerRef?: React.RefObject<HTMLElement | null>;
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

const ACCENT_COLOR = '#E86412';
const MIN_WIDTH_SCALE = 0.3;
const MAX_WIDTH_SCALE = 0.8;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 72;
const SNAP_THRESHOLD_PX = 10;
const SNAP_RELEASE_PX = 16;
const TOOLBAR_GAP = 6;
const TOOLBAR_MIN_WIDTH = 260;
const TOOLBAR_EST_HEIGHT = 40;

export function DraggableResizableCaption({
  displayText,
  layoutText,
  position,
  style,
  onPositionChange,
  onStyleChange,
  containerWidth,
  containerHeight,
  containerRef,
  disabled = false,
}: DraggableResizableCaptionProps) {
  const sizingText = layoutText ?? displayText;
  const captionRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const fontTriggerRef = useRef<HTMLDivElement>(null);
  const colorTextTriggerRef = useRef<HTMLDivElement>(null);
  const colorBgTriggerRef = useRef<HTMLDivElement>(null);
  const colorBorderTriggerRef = useRef<HTMLDivElement>(null);
  const prevDimsRef = useRef({ w: 0, h: 0 });

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialPosition, setInitialPosition] = useState<CaptionPosition>(position);
  const [initialStyle, setInitialStyle] = useState<CaptionStyle>(style);
  const [showToolbar, setShowToolbar] = useState(false);
  const [showVerticalGuide, setShowVerticalGuide] = useState(false);
  const [showHorizontalGuide, setShowHorizontalGuide] = useState(false);
  const lockCenterXRef = useRef(false);
  const lockCenterYRef = useRef(false);
  const [activeColorPicker, setActiveColorPicker] = useState<'text' | 'bg' | 'border' | null>(null);
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [popoutPos, setPopoutPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const [mounted, setMounted] = useState(false);
  const [measuredSize, setMeasuredSize] = useState({ w: 0, h: 0 });
  const measureRafRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (disabled) {
      setShowToolbar(false);
      setActiveColorPicker(null);
      setShowFontDropdown(false);
    }
  }, [disabled]);

  const widthScale = position.widthScale ?? MAX_WIDTH_SCALE;
  const captionWidth = containerWidth * widthScale;

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

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;

    const measure = () => {
      const w = Math.ceil(Math.max(el.offsetWidth, el.scrollWidth));
      const h = Math.ceil(Math.max(el.offsetHeight, el.scrollHeight));
      if (w > 0 && h > 0) {
        setMeasuredSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
    };

    const scheduleMeasure = () => {
      if (measureRafRef.current != null) cancelAnimationFrame(measureRafRef.current);
      measureRafRef.current = requestAnimationFrame(() => {
        measureRafRef.current = requestAnimationFrame(measure);
      });
    };

    scheduleMeasure();
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (measureRafRef.current != null) cancelAnimationFrame(measureRafRef.current);
    };
  }, [
    sizingText,
    style.fontSize,
    style.fontWeight,
    style.fontFamily,
    style.borderWidth,
    style.backgroundColor,
    widthScale,
    containerWidth,
    captionWidth,
  ]);

  const layout = layoutCaptionBox({
    containerWidth,
    containerHeight,
    positionX: position.x,
    positionY: position.y,
    widthScale,
    fontSize: style.fontSize,
    borderWidth: style.borderWidth,
    layoutText: sizingText,
    measuredWidth: measuredSize.w > 0 ? measuredSize.w : undefined,
    measuredHeight: measuredSize.h > 0 ? measuredSize.h : undefined,
  });

  const { left: pixelX, top: pixelY, width: boxW, height: boxH, maxLeft, maxTop } = layout;

  const boundsInputBase = {
    containerWidth,
    containerHeight,
    boxWidth: boxW,
    boxHeight: boxH,
    handleInset: CAPTION_HANDLE_INSET,
  };

  const pixelToNormalized = useCallback(
    (px: number, py: number, wScale: number): CaptionPosition => {
      const norm = pixelsToCaptionNormalized(px, py, boundsInputBase);
      return {
        x: Math.max(0, Math.min(1, norm.x)),
        y: Math.max(0, Math.min(1, norm.y)),
        scale: position.scale,
        widthScale: wScale,
      };
    },
    [containerWidth, containerHeight, boxW, boxH, position.scale],
  );

  useEffect(() => {
    if (containerWidth <= 0 || containerHeight <= 0 || disabled) return;
    const prev = prevDimsRef.current;
    if (prev.w === containerWidth && prev.h === containerHeight) return;

    const isInitial = prev.w === 0 && prev.h === 0;
    prevDimsRef.current = { w: containerWidth, h: containerHeight };
    if (isInitial || boxW <= 0 || boxH <= 0) return;

    const reclamped = reclampCaptionPosition(position.x, position.y, boundsInputBase);
    if (reclamped) {
      onPositionChange({
        x: reclamped.x,
        y: reclamped.y,
        scale: position.scale,
        widthScale,
      });
    }
  }, [
    containerWidth,
    containerHeight,
    boxW,
    boxH,
    disabled,
    position.x,
    position.y,
    position.scale,
    widthScale,
    onPositionChange,
  ]);

  const updateToolbarPosition = useCallback(() => {
    const captionEl = captionRef.current;
    if (!captionEl) return;

    const rect = captionEl.getBoundingClientRect();
    const pad = 8;
    const toolbarH = toolbarRef.current?.offsetHeight || TOOLBAR_EST_HEIGHT;
    const toolbarW = toolbarRef.current?.offsetWidth || TOOLBAR_MIN_WIDTH;

    // Always above the caption — clamp to viewport top only, never flip below
    let top = rect.top - toolbarH - TOOLBAR_GAP;
    top = Math.max(pad, top);

    let left = rect.left + rect.width / 2 - toolbarW / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - toolbarW - pad));

    setToolbarPos({ top, left });
  }, []);

  const popoutOpen = showFontDropdown || activeColorPicker !== null;

  useLayoutEffect(() => {
    if (!showToolbar || disabled) return;
    updateToolbarPosition();
    const raf = requestAnimationFrame(updateToolbarPosition);
    window.addEventListener('scroll', updateToolbarPosition, true);
    window.addEventListener('resize', updateToolbarPosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', updateToolbarPosition, true);
      window.removeEventListener('resize', updateToolbarPosition);
    };
  }, [showToolbar, disabled, pixelX, pixelY, boxW, boxH, updateToolbarPosition]);

  useLayoutEffect(() => {
    if (!popoutOpen) return;

    const update = () => {
      let el: HTMLElement | null = null;
      if (showFontDropdown) el = fontTriggerRef.current;
      else if (activeColorPicker === 'text') el = colorTextTriggerRef.current;
      else if (activeColorPicker === 'bg') el = colorBgTriggerRef.current;
      else if (activeColorPicker === 'border') el = colorBorderTriggerRef.current;

      if (!el) return;
      const r = el.getBoundingClientRect();
      const EST_MENU_H = 160;
      const GAP = 8;
      const PAD = 8;
      let top = r.bottom + GAP;
      if (top + EST_MENU_H > window.innerHeight - PAD && r.top > EST_MENU_H + GAP) {
        top = Math.max(PAD, r.top - EST_MENU_H - GAP);
      }
      let left = r.left;
      const panelW = 140;
      if (left + panelW > window.innerWidth - PAD) left = Math.max(PAD, window.innerWidth - panelW - PAD);
      setPopoutPos({ top, left });
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [popoutOpen, showFontDropdown, activeColorPicker]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      const local = getLocalPoint(e.clientX, e.clientY);
      setIsDragging(true);
      setDragStart({ x: local.x - pixelX, y: local.y - pixelY });
      setInitialPosition(position);
      setShowToolbar(true);
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
      setInitialStyle(style);
    },
    [disabled, position, style],
  );

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const local = getLocalPoint(e.clientX, e.clientY);
        let newPixelX = local.x - dragStart.x;
        let newPixelY = local.y - dragStart.y;

        const idealCenterX = (containerWidth - boxW) / 2;
        const idealCenterY = (containerHeight - boxH) / 2;
        const targetCenterX = Math.max(0, Math.min(idealCenterX, maxLeft));
        const targetCenterY = Math.max(0, Math.min(idealCenterY, maxTop));
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
        onPositionChange(pixelToNormalized(newPixelX, newPixelY, widthScale));
      } else if (isResizing && activeHandle) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;

        let newWidthScale = initialPosition.widthScale ?? MAX_WIDTH_SCALE;
        let newFontSize = initialStyle.fontSize;

        if (activeHandle.includes('t')) {
          const sizeChange = -deltaY / 4;
          newFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, initialStyle.fontSize + sizeChange));
        } else if (activeHandle.includes('b')) {
          const sizeChange = deltaY / 4;
          newFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, initialStyle.fontSize + sizeChange));
        }

        if (activeHandle.includes('l')) {
          const widthChange = -deltaX / containerWidth;
          newWidthScale = Math.max(
            MIN_WIDTH_SCALE,
            Math.min(MAX_WIDTH_SCALE, (initialPosition.widthScale ?? MAX_WIDTH_SCALE) + widthChange),
          );
        } else if (activeHandle.includes('r')) {
          const widthChange = deltaX / containerWidth;
          newWidthScale = Math.max(
            MIN_WIDTH_SCALE,
            Math.min(MAX_WIDTH_SCALE, (initialPosition.widthScale ?? MAX_WIDTH_SCALE) + widthChange),
          );
        }

        if (newFontSize !== initialStyle.fontSize) {
          onStyleChange({ ...style, fontSize: Math.round(newFontSize) });
        }

        const newEst = estimateCaptionBoxSize(
          containerWidth,
          newWidthScale,
          Math.round(newFontSize),
          style.borderWidth,
          sizingText,
          sizingText,
        );
        const newBoxW = Math.ceil(measuredSize.w > 0 ? measuredSize.w : newEst.w);
        const newBoxH = Math.ceil(measuredSize.h > 0 ? measuredSize.h : newEst.h);
        const reclamped = reclampCaptionPosition(initialPosition.x, initialPosition.y, {
          containerWidth,
          containerHeight,
          boxWidth: newBoxW,
          boxHeight: newBoxH,
          handleInset: CAPTION_HANDLE_INSET,
        });

        onPositionChange({
          x: reclamped?.x ?? initialPosition.x,
          y: reclamped?.y ?? initialPosition.y,
          scale: position.scale,
          widthScale: newWidthScale,
        });
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
    initialStyle,
    widthScale,
    containerWidth,
    containerHeight,
    pixelToNormalized,
    onPositionChange,
    onStyleChange,
    style,
    boxW,
    boxH,
    maxLeft,
    maxTop,
    measuredSize.w,
    measuredSize.h,
    sizingText,
    getLocalPoint,
    position.scale,
  ]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideCaption = captionRef.current?.contains(target);
      const isInsideToolbar = toolbarRef.current?.contains(target);
      const isInsidePortal = portalRef.current?.contains(target);

      if (!isInsideCaption && !isInsideToolbar && !isInsidePortal) {
        setShowToolbar(false);
        setActiveColorPicker(null);
        setShowFontDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleBaseStyle = 'absolute w-[8px] h-[8px] bg-white border-2 rounded-sm z-10';

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

  const contentStyle: React.CSSProperties = {
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}px`,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textDecoration: style.textDecoration,
    color: style.textColor,
    backgroundColor:
      style.backgroundColor === 'transparent'
        ? disabled
          ? 'rgba(0, 0, 0, 0.85)'
          : 'transparent'
        : style.backgroundColor,
    border:
      style.borderWidth > 0 && style.borderColor !== 'transparent'
        ? `${style.borderWidth}px solid ${style.borderColor}`
        : 'none',
    ...(style.backgroundColor === 'transparent' && !disabled
      ? { textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.6)' }
      : {}),
  };

  const ColorPickerPanel = ({ type, currentColor }: { type: 'text' | 'bg' | 'border'; currentColor: string }) => {
    const colors = type === 'text' ? COLOR_PRESETS.filter((c) => !c.isTransparent) : COLOR_PRESETS;

    return (
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-2 min-w-[120px]">
        <div className="grid grid-cols-4 gap-1">
          {colors.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => {
                if (type === 'text') onStyleChange({ ...style, textColor: color.value });
                else if (type === 'bg') onStyleChange({ ...style, backgroundColor: color.value });
                else if (type === 'border') onStyleChange({ ...style, borderColor: color.value });
                setActiveColorPicker(null);
              }}
              className={`w-6 h-6 rounded border-2 ${currentColor === color.value ? 'border-orange-500 ring-1 ring-orange-400/70' : 'border-gray-300'} ${color.isTransparent ? 'bg-gradient-to-br from-gray-100 via-gray-200 to-gray-100' : ''}`}
              style={{ backgroundColor: color.isTransparent ? undefined : color.value }}
              title={color.label}
            />
          ))}
        </div>
      </div>
    );
  };

  const FontListPanel = () => (
    <div className="bg-white rounded-lg shadow-lg border border-gray-200 min-w-[120px] max-h-[200px] overflow-y-auto">
      {FONT_FAMILIES.map((font) => (
        <button
          key={font.value}
          type="button"
          onClick={() => handleFontSelect(font.value)}
          className={`w-full text-left px-3 py-2 text-xs hover:bg-orange-50 flex items-center justify-between transition-colors ${
            style.fontFamily === font.value ? 'bg-orange-50 text-orange-600' : 'text-gray-700'
          }`}
          style={{ fontFamily: font.value }}
        >
          <span>{font.label}</span>
          {style.fontFamily === font.value && <Check className="w-3 h-3 text-orange-500 shrink-0" />}
        </button>
      ))}
    </div>
  );

  const selectedFont = FONT_FAMILIES.find((f) => f.value === style.fontFamily) || FONT_FAMILIES[0];

  const toolbarPopout =
    mounted &&
    popoutOpen &&
    createPortal(
      <div
        ref={portalRef}
        className="fixed z-[200] pointer-events-auto"
        style={{ top: popoutPos.top, left: popoutPos.left }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {showFontDropdown ? (
          <FontListPanel />
        ) : activeColorPicker === 'text' ? (
          <ColorPickerPanel type="text" currentColor={style.textColor} />
        ) : activeColorPicker === 'bg' ? (
          <ColorPickerPanel type="bg" currentColor={style.backgroundColor} />
        ) : activeColorPicker === 'border' ? (
          <ColorPickerPanel type="border" currentColor={style.borderColor} />
        ) : null}
      </div>,
      document.body,
    );

  const styleToggleClass = (active: boolean) =>
    `w-7 h-7 flex items-center justify-center rounded-md flex-shrink-0 transition-colors ${
      active
        ? 'bg-gradient-to-r from-[#E86412] to-[#F12A4C] text-white shadow-sm'
        : 'bg-[#FFF5F0] text-[#212121] hover:bg-[#FFE8DC] border border-[#F5D5C8]'
    }`;

  const toolbarDivider = <div className="w-px h-5 bg-[#F0E0D8] shrink-0" />;

  const toolbarPortal =
    mounted &&
    showToolbar &&
    !disabled &&
    createPortal(
      <div
        ref={toolbarRef}
        className="fixed z-[200] pointer-events-auto w-max max-w-[calc(100vw-16px)]"
        style={{
          top: toolbarPos.top,
          left: toolbarPos.left,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="rounded-lg p-[1px] shadow-lg"
          style={{ background: 'linear-gradient(180deg, #E86412 0%, #F12A4C 100%)' }}
        >
          <div className="bg-white rounded-[7px] px-1 py-1 flex flex-row items-center gap-1">
            <div ref={fontTriggerRef} className="relative inline-flex shrink-0">
              <button
                type="button"
                title="Font family"
                onClick={() => {
                  setShowFontDropdown(!showFontDropdown);
                  setActiveColorPicker(null);
                }}
                className="h-7 w-[88px] px-1.5 text-[11px] border border-[#F0E0D8] rounded-md flex items-center gap-0.5 hover:bg-[#FFF5F0] bg-white justify-between"
                style={{ fontFamily: selectedFont.value }}
              >
                <span className="truncate text-[#212121]">{selectedFont.label}</span>
                <ChevronDown className="w-3 h-3 flex-shrink-0 text-[#8B6C5C]" />
              </button>
            </div>

            <input
              type="number"
              title="Font size"
              value={style.fontSize}
              onChange={(e) =>
                onStyleChange({
                  ...style,
                  fontSize: Math.max(
                    MIN_FONT_SIZE,
                    Math.min(MAX_FONT_SIZE, parseInt(e.target.value) || 16),
                  ),
                })
              }
              className="w-9 h-7 px-1 text-[11px] text-center border border-[#F0E0D8] rounded-md focus:outline-none focus:ring-2 focus:ring-[#E86412]/40 text-[#212121] shrink-0"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
            />

            {toolbarDivider}

            <button type="button" onClick={toggleBold} className={styleToggleClass(style.fontWeight === 'bold')} title="Bold">
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={toggleItalic} className={styleToggleClass(style.fontStyle === 'italic')} title="Italic">
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={toggleUnderline}
              className={styleToggleClass(style.textDecoration === 'underline')}
              title="Underline"
            >
              <Underline className="w-3.5 h-3.5" />
            </button>

            {toolbarDivider}

            <div ref={colorTextTriggerRef} className="relative inline-flex shrink-0">
              <button
                type="button"
                title="Text color"
                onClick={() => {
                  setActiveColorPicker(activeColorPicker === 'text' ? null : 'text');
                  setShowFontDropdown(false);
                }}
                className={`${styleToggleClass(activeColorPicker === 'text')} ${
                  activeColorPicker === 'text' ? 'ring-1 ring-[#E86412]' : ''
                }`}
              >
                <Type
                  className="w-3.5 h-3.5"
                  strokeWidth={2.25}
                  style={{
                    color: style.textColor,
                    filter:
                      style.textColor === '#FFFFFF' || style.textColor?.toLowerCase() === '#fff'
                        ? 'drop-shadow(0 0 1px rgba(0,0,0,0.85))'
                        : undefined,
                  }}
                />
              </button>
            </div>
            <div ref={colorBgTriggerRef} className="relative inline-flex shrink-0">
              <button
                type="button"
                title="Background color"
                onClick={() => {
                  setActiveColorPicker(activeColorPicker === 'bg' ? null : 'bg');
                  setShowFontDropdown(false);
                }}
                className={`${styleToggleClass(activeColorPicker === 'bg')} ${
                  activeColorPicker === 'bg' ? 'ring-1 ring-[#E86412]' : ''
                }`}
              >
                <Palette
                  className="w-3.5 h-3.5"
                  strokeWidth={2}
                  style={{
                    color: style.backgroundColor === 'transparent' ? '#9CA3AF' : style.backgroundColor,
                    filter:
                      style.backgroundColor === '#FFFFFF' ||
                      style.backgroundColor?.toLowerCase() === '#fff'
                        ? 'drop-shadow(0 0 1px rgba(0,0,0,0.75))'
                        : undefined,
                  }}
                />
              </button>
            </div>
            <div ref={colorBorderTriggerRef} className="relative inline-flex shrink-0">
              <button
                type="button"
                title="Border color"
                onClick={() => {
                  setActiveColorPicker(activeColorPicker === 'border' ? null : 'border');
                  setShowFontDropdown(false);
                }}
                className={`${styleToggleClass(activeColorPicker === 'border')} ${
                  activeColorPicker === 'border' ? 'ring-1 ring-[#E86412]' : ''
                }`}
              >
                <Square
                  className="w-3.5 h-3.5"
                  strokeWidth={2}
                  style={{
                    color: style.borderColor === 'transparent' ? '#9CA3AF' : style.borderColor,
                    filter:
                      style.borderColor === '#FFFFFF' || style.borderColor?.toLowerCase() === '#fff'
                        ? 'drop-shadow(0 0 1px rgba(0,0,0,0.75))'
                        : undefined,
                  }}
                />
              </button>
            </div>

            <input
              type="number"
              title="Border width (px)"
              value={style.borderWidth}
              onChange={(e) =>
                onStyleChange({
                  ...style,
                  borderWidth: Math.max(0, Math.min(10, parseInt(e.target.value) || 0)),
                })
              }
              className="w-8 h-7 px-0.5 text-[11px] text-center border border-[#F0E0D8] rounded-md focus:outline-none focus:ring-2 focus:ring-[#E86412]/40 text-[#212121] shrink-0"
              min={0}
              max={10}
            />
          </div>
        </div>
      </div>,
      document.body,
    );

  const inset = CAPTION_HANDLE_INSET;

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
      {toolbarPopout}
      {toolbarPortal}

      {/* Hidden sizing element — uses layoutText for stable bounds */}
      <div
        aria-hidden
        className="absolute opacity-0 pointer-events-none overflow-hidden"
        style={{ left: 0, top: 0, width: captionWidth, visibility: 'hidden' }}
      >
        <div
          ref={measureRef}
          className="w-full flex items-center justify-center p-2 rounded-lg box-border"
          style={contentStyle}
        >
          <span className="text-center leading-tight">{sizingText || 'Sample caption text'}</span>
        </div>
      </div>

      <div
        ref={captionRef}
        className={`absolute select-none pointer-events-auto ${isDragging || isResizing ? 'cursor-grabbing' : 'cursor-grab'} ${disabled ? 'pointer-events-none' : ''}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${captionWidth}px`,
          maxWidth: `${Math.max(0, containerWidth - pixelX - inset)}px`,
          minHeight: `${boxH}px`,
          maxHeight: `${Math.max(0, containerHeight - pixelY - inset)}px`,
        }}
        onMouseDown={handleMouseDown}
        onClick={() => !disabled && setShowToolbar(true)}
      >
        <div className="w-full h-full flex items-center justify-center p-2 rounded-lg box-border" style={contentStyle}>
          <span className="text-center leading-tight">{displayText || 'Sample caption text'}</span>
        </div>

        {showToolbar && (
          <div className="absolute inset-0 border-2 border-[#E86412] border-dashed pointer-events-none rounded-lg" />
        )}

        {!disabled &&
          showToolbar &&
          handles.map(({ position: handlePos, style: handleStyle, cursor }) => (
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
