// Shared constants for all microservices
export const SERVICE_NAMES = {
  AUTH: 'auth-service',
  AI_CONTENT: 'ai-content-service',
  VOICE_AUDIO: 'voice-audio-service',
  MEDIA_MANAGEMENT: 'media-management-service',
  VIDEO_PROCESSING: 'video-processing-service',
  PAYMENT_WALLET: 'payment-wallet-service',
  NOTIFICATION: 'notification-service',
  PROJECT_MANAGEMENT: 'project-management-service',
  ANALYTICS: 'analytics-service'
} as const;

export const QUEUE_NAMES = {
  VIDEO_PROCESSING: 'video.processing',
  AI_GENERATION: 'ai.generation',
  EMAIL_NOTIFICATIONS: 'email.notifications',
  PAYMENT_PROCESSING: 'payment.processing',
  ANALYTICS_EVENTS: 'analytics.events',
  AVATAR_GENERATION: 'avatar.generation',
  VOICE_CLONING: 'voice.cloning',
  FILE_UPLOAD: 'file.upload',
  PROJECT_UPDATE: 'project.update'
} as const;

export const EXCHANGE_NAMES = {
  USER_EVENTS: 'user.events',
  PROJECT_EVENTS: 'project.events',
  PAYMENT_EVENTS: 'payment.events',
  AI_EVENTS: 'ai.events',
  NOTIFICATION_EVENTS: 'notification.events'
} as const;

export const ROUTING_KEYS = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_COMPLETED: 'project.completed',
  PROJECT_FAILED: 'project.failed',
  PAYMENT_SUCCESS: 'payment.success',
  PAYMENT_FAILED: 'payment.failed',
  AI_GENERATION_STARTED: 'ai.generation.started',
  AI_GENERATION_COMPLETED: 'ai.generation.completed',
  AI_GENERATION_FAILED: 'ai.generation.failed',
  NOTIFICATION_SEND: 'notification.send',
  FILE_UPLOADED: 'file.uploaded',
  FILE_PROCESSED: 'file.processed'
} as const;

export const HTTP_STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503
} as const;

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',
  CONFLICT_ERROR: 'CONFLICT_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  FILE_UPLOAD_ERROR: 'FILE_UPLOAD_ERROR',
  AI_SERVICE_ERROR: 'AI_SERVICE_ERROR',
  PAYMENT_ERROR: 'PAYMENT_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const;

export const FILE_TYPES = {
  IMAGE: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  VIDEO: ['video/mp4', 'video/avi', 'video/mov', 'video/webm'],
  AUDIO: ['audio/mp3', 'audio/wav', 'audio/m4a', 'audio/ogg'],
  DOCUMENT: ['application/pdf', 'text/plain', 'application/msword']
} as const;

export const FILE_SIZE_LIMITS = {
  AVATAR: 5 * 1024 * 1024, // 5MB
  VIDEO: 100 * 1024 * 1024, // 100MB
  AUDIO: 25 * 1024 * 1024, // 25MB
  IMAGE: 10 * 1024 * 1024, // 10MB
  DOCUMENT: 20 * 1024 * 1024 // 20MB
} as const;

export const CREDIT_COSTS = {
  VIDEO_CREATION: 100,
  AVATAR_GENERATION: 50,
  VOICE_CLONING: 75,
  AI_SCRIPT_GENERATION: 25,
  WATERMARK_REMOVAL: 100,
  PREMIUM_EXPORT: 50
} as const;

export const SUBSCRIPTION_PLANS = {
  FREE: {
    name: 'Free',
    credits: 100,
    price: 0,
    features: ['Basic video creation', 'Standard avatars', 'Basic voice options']
  },
  PRO: {
    name: 'Pro',
    credits: 1000,
    price: 29.99,
    features: ['Unlimited video creation', 'Premium avatars', 'Voice cloning', 'Priority support']
  },
  ENTERPRISE: {
    name: 'Enterprise',
    credits: 10000,
    price: 99.99,
    features: ['Everything in Pro', 'Custom avatars', 'API access', 'White-label options']
  }
} as const;

export const AI_SERVICE_CONFIGS = {
  OPENAI: {
    baseUrl: 'https://api.openai.com/v1',
    models: {
      GPT4: 'gpt-4',
      GPT35: 'gpt-3.5-turbo',
      DALL_E_3: 'dall-e-3',
      DALL_E_2: 'dall-e-2'
    },
    maxTokens: 4096,
    temperature: 0.7
  },
  ELEVENLABS: {
    baseUrl: 'https://api.elevenlabs.io/v1',
    models: {
      MULTILINGUAL: 'eleven_multilingual_v2',
      ENGLISH: 'eleven_monolingual_v1'
    },
    voiceSettings: {
      stability: 0.5,
      similarityBoost: 0.75
    }
  },
  RUNWAY: {
    baseUrl: 'https://api.runwayml.com/v1',
    models: {
      GEN2: 'gen2',
      GEN3: 'gen3'
    }
  }
} as const;

export const NOTIFICATION_TEMPLATES = {
  VIDEO_READY: {
    subject: 'Your video is ready!',
    template: 'video-ready',
    priority: 'high'
  },
  AVATAR_USED: {
    subject: 'Someone used your avatar',
    template: 'avatar-used',
    priority: 'medium'
  },
  CREDITS_RECEIVED: {
    subject: 'Credits added to your account',
    template: 'credits-received',
    priority: 'low'
  },
  PAYMENT_SUCCESS: {
    subject: 'Payment successful',
    template: 'payment-success',
    priority: 'high'
  },
  SYSTEM_UPDATE: {
    subject: 'System update available',
    template: 'system-update',
    priority: 'low'
  }
} as const;

export const CACHE_KEYS = {
  USER_PROFILE: (userId: string) => `user:profile:${userId}`,
  USER_CREDITS: (userId: string) => `user:credits:${userId}`,
  PROJECT_DETAILS: (projectId: string) => `project:details:${projectId}`,
  AI_PROCESSING_STATUS: (projectId: string) => `ai:status:${projectId}`,
  FILE_METADATA: (fileId: string) => `file:metadata:${fileId}`,
  RATE_LIMIT: (identifier: string) => `rate_limit:${identifier}`,
  SESSION: (sessionId: string) => `session:${sessionId}`,
  OTP: (identifier: string) => `otp:${identifier}`
} as const;

export const CACHE_TTL = {
  USER_PROFILE: 1800, // 30 minutes
  USER_CREDITS: 300, // 5 minutes
  PROJECT_DETAILS: 3600, // 1 hour
  AI_PROCESSING_STATUS: 60, // 1 minute
  FILE_METADATA: 7200, // 2 hours
  RATE_LIMIT: 3600, // 1 hour
  SESSION: 86400, // 24 hours
  OTP: 300 // 5 minutes
} as const;

export const DATABASE_CONSTANTS = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  DEFAULT_SORT_ORDER: 'desc',
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000 // 1 second
} as const;

export const MONITORING_METRICS = {
  REQUEST_COUNT: 'http_requests_total',
  REQUEST_DURATION: 'http_request_duration_seconds',
  ERROR_COUNT: 'http_errors_total',
  ACTIVE_CONNECTIONS: 'active_connections',
  DATABASE_CONNECTIONS: 'database_connections',
  QUEUE_SIZE: 'queue_size',
  PROCESSING_TIME: 'processing_time_seconds',
  AI_API_CALLS: 'ai_api_calls_total',
  AI_API_DURATION: 'ai_api_duration_seconds',
  FILE_UPLOADS: 'file_uploads_total',
  FILE_UPLOAD_SIZE: 'file_upload_size_bytes'
} as const;

export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  VERBOSE: 'verbose'
} as const;

export const ENVIRONMENTS = {
  LOCAL: 'local',
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  PRODUCTION: 'production'
} as const;

export const STORAGE_TYPES = {
  LOCAL: 'local',
  S3: 's3',
  GCS: 'gcs',
  AZURE: 'azure'
} as const;

export const MONITORING_SERVICES = {
  PROMETHEUS: 'prometheus',
  ELK: 'elk',
  JAEGER: 'jaeger',
  GRAFANA: 'grafana'
} as const;
