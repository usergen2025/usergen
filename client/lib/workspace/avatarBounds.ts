/** Shared avatar overlay geometry — preview (client) and export (server) must match. */

/** Normalized x/y map across asymmetric travel allowing up to 50% off-screen per edge. */

export function getAvatarPixelBounds(
  avatarW: number,
  avatarH: number,
  containerWidth: number,
  containerHeight: number,
) {
  const minX = -0.5 * avatarW;
  const maxX = containerWidth - 0.5 * avatarW;
  const minY = -0.5 * avatarH;
  const maxY = containerHeight - 0.5 * avatarH;
  return {
    minX,
    maxX,
    minY,
    maxY,
    spanX: maxX - minX,
    spanY: maxY - minY,
  };
}

export type LayoutAvatarBoxInput = {
  containerWidth: number;
  containerHeight: number;
  positionX: number;
  positionY: number;
  scale: number;
  aspectRatio: number;
};

export type LayoutAvatarBoxResult = {
  left: number;
  top: number;
  width: number;
  height: number;
  normX: number;
  normY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export function layoutAvatarBox(input: LayoutAvatarBoxInput): LayoutAvatarBoxResult {
  const height = input.containerHeight * input.scale;
  const width = height * input.aspectRatio;
  const { minX, maxX, minY, maxY, spanX, spanY } = getAvatarPixelBounds(
    width,
    height,
    input.containerWidth,
    input.containerHeight,
  );

  const clampedX = Math.max(0, Math.min(1, input.positionX));
  const clampedY = Math.max(0, Math.min(1, input.positionY));

  const left = minX + clampedX * spanX;
  const top = minY + clampedY * spanY;

  return {
    left,
    top,
    width,
    height,
    normX: clampedX,
    normY: clampedY,
    minX,
    maxX,
    minY,
    maxY,
  };
}

export function pixelsToAvatarNormalized(
  px: number,
  py: number,
  containerWidth: number,
  containerHeight: number,
  scale: number,
  aspectRatio: number,
): { x: number; y: number } {
  const avatarH = containerHeight * scale;
  const avatarW = avatarH * aspectRatio;
  const { minX, maxX, minY, maxY, spanX, spanY } = getAvatarPixelBounds(
    avatarW,
    avatarH,
    containerWidth,
    containerHeight,
  );

  const clampedPx = Math.max(minX, Math.min(px, maxX));
  const clampedPy = Math.max(minY, Math.min(py, maxY));

  return {
    x: spanX > 0 ? (clampedPx - minX) / spanX : 0.5,
    y: spanY > 0 ? (clampedPy - minY) / spanY : 0.5,
  };
}

/** Server-side pixel position from normalized coords (matches client layoutAvatarBox). */
export function avatarNormalizedToPixels(
  positionX: number,
  positionY: number,
  containerWidth: number,
  containerHeight: number,
  avatarWidthPx: number,
  avatarHeightPx: number,
): { x: number; y: number } {
  const { minX, maxX, minY, maxY, spanX, spanY } = getAvatarPixelBounds(
    avatarWidthPx,
    avatarHeightPx,
    containerWidth,
    containerHeight,
  );
  const clampedX = Math.max(0, Math.min(1, positionX));
  const clampedY = Math.max(0, Math.min(1, positionY));
  return {
    x: Math.floor(minX + clampedX * spanX),
    y: Math.floor(minY + clampedY * spanY),
  };
}
