// Shared types for all microservices
export interface BaseResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  timestamp: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> extends BaseResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  mobile?: string;
  socialMediaLink?: string;
  goal?: string;
  profilePicture?: string;
  credits: number;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  AVATAR_CREATOR = 'avatar_creator'
}

export interface Project {
  id: string;
  userId: string;
  title: string;
  description?: string;
  status: ProjectStatus;
  type: ProjectType;
  settings: ProjectSettings;
  createdAt: Date;
  updatedAt: Date;
}

export enum ProjectStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum ProjectType {
  WITH_AVATAR = 'with_avatar',
  WITHOUT_AVATAR = 'without_avatar'
}

export interface ProjectSettings {
  avatar?: AvatarSettings;
  script?: ScriptSettings;
  voice?: VoiceSettings;
  broll?: BrollSettings;
  captions?: CaptionSettings;
}

export interface AvatarSettings {
  type: 'library' | 'upload' | 'ai_generated';
  avatarId?: string;
  uploadedImage?: string;
  aiPrompt?: string;
}

export interface ScriptSettings {
  content: string;
  generatedByAI: boolean;
  aiPrompt?: string;
}

export interface VoiceSettings {
  type: 'library' | 'cloned';
  voiceId?: string;
  clonedVoiceId?: string;
  volume: number;
}

export interface BrollSettings {
  type: 'ai_generated' | 'upload' | 'stock';
  content: string[];
  aiPrompt?: string;
}

export interface CaptionSettings {
  enabled: boolean;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline';
  textColor: string;
  borderColor: string;
  backgroundColor: string;
}

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  currency: string;
  status: TransactionStatus;
  description: string;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export enum TransactionType {
  CREDIT_PURCHASE = 'credit_purchase',
  VIDEO_CREATION = 'video_creation',
  AVATAR_USAGE = 'avatar_usage',
  REFERRAL_BONUS = 'referral_bonus',
  WITHDRAWAL = 'withdrawal'
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded'
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: any;
  isRead: boolean;
  createdAt: Date;
}

export enum NotificationType {
  VIDEO_READY = 'video_ready',
  AVATAR_USED = 'avatar_used',
  CREDITS_RECEIVED = 'credits_received',
  PAYMENT_SUCCESS = 'payment_success',
  SYSTEM_UPDATE = 'system_update'
}

export interface AIProcessingLog {
  id: string;
  projectId: string;
  userId: string;
  service: AIService;
  requestData: any;
  responseData: any;
  processingTime: number;
  tokensUsed?: number;
  cost?: number;
  status: 'success' | 'failed';
  error?: string;
  createdAt: Date;
}

export enum AIService {
  OPENAI = 'openai',
  ELEVENLABS = 'elevenlabs',
  RUNWAY = 'runway',
  MIDJOURNEY = 'midjourney'
}

export interface FileUpload {
  id: string;
  userId: string;
  projectId?: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  url: string;
  type: FileType;
  metadata?: any;
  createdAt: Date;
}

export enum FileType {
  AVATAR = 'avatar',
  VIDEO = 'video',
  AUDIO = 'audio',
  IMAGE = 'image',
  DOCUMENT = 'document'
}

export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  version: string;
  uptime: number;
  dependencies: {
    database: 'connected' | 'disconnected';
    redis: 'connected' | 'disconnected';
    messageQueue: 'connected' | 'disconnected';
  };
}

export interface QueueMessage {
  id: string;
  type: string;
  data: any;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  processedAt?: Date;
  failedAt?: Date;
  error?: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  retryAfter?: number;
}

export interface ApiError extends Error {
  statusCode: number;
  code: string;
  details?: any;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ServiceConfig {
  name: string;
  port: number;
  host: string;
  version: string;
  environment: string;
  database: {
    url: string;
    maxConnections: number;
  };
  redis: {
    url: string;
    maxConnections: number;
  };
  messageQueue: {
    url: string;
    exchanges: string[];
    queues: string[];
  };
  monitoring: {
    enabled: boolean;
    prometheus?: {
      port: number;
      path: string;
    };
    elk?: {
      elasticsearchUrl: string;
      index: string;
    };
    jaeger?: {
      endpoint: string;
      serviceName: string;
    };
  };
}
