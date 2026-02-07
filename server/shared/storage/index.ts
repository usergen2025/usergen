/**
 * Shared Storage Module
 * 
 * Provides unified storage capabilities for all microservices:
 * - Local file storage (always)
 * - GCS cloud storage (when enabled)
 * - Fallback handling (GCS -> local)
 */

// Export types
export * from './storage.types';

// Export constants and utilities
export * from './storage.constants';

// Export services
export { GCSStorageService } from './gcs-storage.service';
export { 
  UnifiedStorageService, 
  UnifiedStorageConfig,
  createUnifiedStorageFromEnv 
} from './unified-storage.service';

// Export URL utilities for external API calls
export {
  preWarmUrl,
  preWarmUrls,
  isRetryableError,
  withRetry,
  executeWithPreWarmAndRetry,
  RETRYABLE_ERROR_PATTERNS,
} from './url-utils';

