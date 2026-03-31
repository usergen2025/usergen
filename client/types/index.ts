// Type definitions for the application

export type VideoType = 'with-avatar' | 'without-avatar';

export type AvatarCategory = 'all' | 'professional' | 'casual' | 'modern';

export interface Avatar {
  id: string;
  name: string;
  category: AvatarCategory;
  imageUrl?: string;
}

export type BRollSource = 'skip' | 'ai-generated' | 'upload' | 'stock';

export type VideoStyle = 'half-n-half' | 'alternate' | 'avatar-cutout' | 'avatar-only' | 'product-only' | 'avatar-product' | 'animated-avatar' | 'broll-only';

/** Flat shape (style page). Workspace / export use nested `style` + displayMode, positions, etc. */
export interface CaptionSettings {
  enabled: boolean;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  displayMode?: 'word-by-word' | 'full-sentence';
  applyToAll?: boolean;
  globalPosition?: { x: number; y: number; scale?: number; widthScale?: number };
  perScenePositions?: Record<number, { x: number; y: number; scale: number; widthScale: number }>;
  style?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string;
    fontStyle?: string;
    textDecoration?: string;
    textColor?: string;
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: number;
  };
}

export interface VideoCreationState {
  videoType?: VideoType;
  selectedAvatarId?: string;
  script?: string;
  voiceId?: string;
  clonedVoice?: Blob;
  bRollSource?: BRollSource;
  style?: VideoStyle;
  captionSettings?: CaptionSettings;
}

export interface RenderingStatus {
  progress: number;
  currentStage: 'dressing' | 'practicing' | 'rolling';
  funFact?: string;
}

export interface Project {
  id: string;
  title: string;
  duration: string;
  thumbnail?: string;
  status: 'draft' | 'completed' | 'processing';
  createdAt: string;
}

export interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  date: string;
  time: string;
}

export interface Notification {
  id: string;
  title: string;
  timestamp: string;
  read: boolean;
}


