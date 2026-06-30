import type { StorageRef } from '../storage/storage-ref.types';

export type BrandPackagingStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'skipped';

export interface BrandPackagingMetadata {
  status: BrandPackagingStatus;
  jobId?: string;
  cornerReady?: boolean;
  endCardPlateReady?: boolean;
  processedAt?: string;
  error?: string;
  updatedAt?: string;
}

export interface LogoBrandOverlayPolicy {
  showCornerBug: boolean;
  showEndCard: boolean;
  endCardMode: 'solid' | 'gradient' | 'byteplus';
}

export interface LogoBrandMetadata {
  sourceAssetId: string;
  brandName?: string;
  /** All language/script forms of the brand from logo OCR. */
  brandNameVariants?: string[];
  /** Tagline/slogan if separable from brand name. */
  tagline?: string;
  /** Full logo OCR; same as extractedText for logos. */
  rawLogoText?: string;
  dominantColors: string[];
  backgroundType?: 'transparent' | 'solid' | 'busy' | 'unknown';
  cropBox?: { x: number; y: number; w: number; h: number };
  sourceLogo?: StorageRef;
  cornerOverlay?: StorageRef;
  endCardLogo?: StorageRef;
  endCardPlate?: StorageRef;
  /** Set when AI deems the raw mark unsuitable for top-right; Phase B may run BytePlus corner variant. */
  cornerNeedsBytePlusVariant?: boolean;
  cornerOverlaySuitable?: boolean;
  /** @deprecated use cornerOverlay */
  cornerOverlayPngUrl?: string;
  /** @deprecated use endCardLogo */
  endCardLogoPngUrl?: string;
  /** @deprecated use endCardPlate */
  endCardBackgroundUrl?: string;
  overlayPolicy: LogoBrandOverlayPolicy;
  processedAt?: string;
}

export function getCornerOverlayRef(logoBrand: LogoBrandMetadata): StorageRef | undefined {
  if (logoBrand.cornerOverlay) return logoBrand.cornerOverlay;
  if (logoBrand.cornerOverlayPngUrl) {
    return { publicUrl: logoBrand.cornerOverlayPngUrl, gcsUrl: logoBrand.cornerOverlayPngUrl };
  }
  return undefined;
}

export function getEndCardLogoRef(logoBrand: LogoBrandMetadata): StorageRef | undefined {
  if (logoBrand.endCardLogo) return logoBrand.endCardLogo;
  if (logoBrand.endCardLogoPngUrl) {
    return { publicUrl: logoBrand.endCardLogoPngUrl, gcsUrl: logoBrand.endCardLogoPngUrl };
  }
  return undefined;
}

export function getEndCardPlateRef(logoBrand: LogoBrandMetadata): StorageRef | undefined {
  if (logoBrand.endCardPlate) return logoBrand.endCardPlate;
  if (logoBrand.endCardBackgroundUrl) {
    return { publicUrl: logoBrand.endCardBackgroundUrl, gcsUrl: logoBrand.endCardBackgroundUrl };
  }
  return undefined;
}

export function logoBrandHasPackagingAssets(logoBrand: LogoBrandMetadata): boolean {
  return Boolean(
    getCornerOverlayRef(logoBrand) ||
      getEndCardLogoRef(logoBrand) ||
      getEndCardPlateRef(logoBrand),
  );
}
