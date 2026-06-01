/** Shared caption overlay geometry — preview (client) and burn-in (server) must match. */

export const CAPTION_SAFETY_MARGIN = 4;
export const CAPTION_HANDLE_INSET = 4;
export const CAPTION_TOOLBAR_HEIGHT = 45;

export function longestWord(text: string): string {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return text || 'Sample';
  return words.reduce((a, b) => (a.length >= b.length ? a : b), words[0]);
}

export function estimateCaptionBoxSize(
  containerWidth: number,
  widthScale: number,
  fontSize: number,
  borderWidth: number,
  captionText: string,
  layoutText?: string,
): { w: number; h: number } {
  const w = containerWidth * widthScale;
  const padding = 16;
  const lineHeight = fontSize * 1.35;
  const textForWidth = layoutText ?? captionText ?? 'Sample';
  const textForHeight = captionText || layoutText || 'Sample';
  const charsPerLine = Math.max(8, Math.floor((w - padding) / (fontSize * 0.55)));
  const lines = Math.max(1, Math.ceil(textForHeight.length / charsPerLine));
  const longestLineChars = Math.max(textForWidth.length, Math.ceil(textForHeight.length / lines));
  const estimatedTextWidth = longestLineChars * fontSize * 0.55;
  const effectiveW = Math.min(w, Math.max(w * 0.5, estimatedTextWidth + padding));
  const h = padding + lineHeight * lines + borderWidth * 2 + 4;
  return { w: effectiveW, h };
}

export type CaptionBoundsInput = {
  containerWidth: number;
  containerHeight: number;
  positionX: number;
  positionY: number;
  boxWidth: number;
  boxHeight: number;
  handleInset?: number;
  safetyMargin?: number;
};

export type CaptionBoundsResult = {
  left: number;
  top: number;
  maxLeft: number;
  maxTop: number;
  normX: number;
  normY: number;
};

export type LayoutCaptionBoxInput = {
  containerWidth: number;
  containerHeight: number;
  positionX: number;
  positionY: number;
  widthScale: number;
  fontSize?: number;
  borderWidth?: number;
  layoutText?: string;
  measuredWidth?: number;
  measuredHeight?: number;
  handleInset?: number;
  safetyMargin?: number;
};

export type LayoutCaptionBoxResult = CaptionBoundsResult & {
  width: number;
  height: number;
};

/** Top-left pixel position + normalized storage coords within the safe region. */
export function computeCaptionBounds(input: CaptionBoundsInput): CaptionBoundsResult {
  const {
    containerWidth,
    containerHeight,
    positionX,
    positionY,
    boxWidth,
    boxHeight,
    handleInset = CAPTION_HANDLE_INSET,
    safetyMargin = CAPTION_SAFETY_MARGIN,
  } = input;

  const inset = handleInset + safetyMargin;
  const maxLeft = Math.max(0, containerWidth - boxWidth - inset);
  const maxTop = Math.max(0, containerHeight - boxHeight - inset);

  const clampedX = Math.max(0, Math.min(1, positionX));
  const clampedY = Math.max(0, Math.min(1, positionY));

  const left = Math.max(0, Math.min(maxLeft, maxLeft * clampedX));
  const top = Math.max(0, Math.min(maxTop, maxTop * clampedY));

  const normX = maxLeft > 0 ? left / maxLeft : 0.5;
  const normY = maxTop > 0 ? top / maxTop : 0.5;

  return {
    left,
    top,
    maxLeft,
    maxTop,
    normX: Math.max(0, Math.min(1, normX)),
    normY: Math.max(0, Math.min(1, normY)),
  };
}

export function layoutCaptionBox(input: LayoutCaptionBoxInput): LayoutCaptionBoxResult {
  const widthScale = Math.max(0.3, Math.min(0.9, input.widthScale ?? 0.8));
  const width = input.containerWidth * widthScale;
  const estimated = estimateCaptionBoxSize(
    input.containerWidth,
    widthScale,
    input.fontSize ?? 16,
    input.borderWidth ?? 0,
    input.layoutText ?? 'Sample',
    input.layoutText,
  );
  const height = Math.ceil(
    input.measuredHeight && input.measuredHeight > 0
      ? input.measuredHeight
      : estimated.h,
  );
  const boxWidth = Math.ceil(
    input.measuredWidth && input.measuredWidth > 0 ? input.measuredWidth : width,
  );
  const boxHeight = height;

  const bounds = computeCaptionBounds({
    containerWidth: input.containerWidth,
    containerHeight: input.containerHeight,
    positionX: input.positionX,
    positionY: input.positionY,
    boxWidth,
    boxHeight,
    handleInset: input.handleInset,
    safetyMargin: input.safetyMargin,
  });

  return {
    ...bounds,
    width: boxWidth,
    height: boxHeight,
  };
}

export function pixelsToCaptionNormalized(
  px: number,
  py: number,
  input: Omit<CaptionBoundsInput, 'positionX' | 'positionY'>,
): { x: number; y: number } {
  const {
    containerWidth,
    containerHeight,
    boxWidth,
    boxHeight,
    handleInset = CAPTION_HANDLE_INSET,
    safetyMargin = CAPTION_SAFETY_MARGIN,
  } = input;

  const inset = handleInset + safetyMargin;
  const maxLeft = Math.max(0, containerWidth - boxWidth - inset);
  const maxTop = Math.max(0, containerHeight - boxHeight - inset);

  const clampedPx = Math.max(0, Math.min(px, maxLeft));
  const clampedPy = Math.max(0, Math.min(py, maxTop));

  return {
    x: maxLeft > 0 ? clampedPx / maxLeft : 0.5,
    y: maxTop > 0 ? clampedPy / maxTop : 0.5,
  };
}

/** Returns normalized position if stored coords are out of bounds after resize; null if no change needed. */
export function reclampCaptionPosition(
  positionX: number,
  positionY: number,
  input: Omit<CaptionBoundsInput, 'positionX' | 'positionY'>,
): { x: number; y: number } | null {
  const bounds = computeCaptionBounds({
    ...input,
    positionX,
    positionY,
  });
  if (
    Math.abs(bounds.normX - positionX) > 0.001 ||
    Math.abs(bounds.normY - positionY) > 0.001
  ) {
    return { x: bounds.normX, y: bounds.normY };
  }
  return null;
}
