/**
 * FAL API Error Handling
 * Based on: https://docs.fal.ai/model-apis/errors
 */

export enum FalErrorType {
  INTERNAL_SERVER_ERROR = 'internal_server_error',
  GENERATION_TIMEOUT = 'generation_timeout',
  DOWNSTREAM_SERVICE_ERROR = 'downstream_service_error',
  DOWNSTREAM_SERVICE_UNAVAILABLE = 'downstream_service_unavailable',
  CONTENT_POLICY_VIOLATION = 'content_policy_violation',
  FEATURE_NOT_SUPPORTED = 'feature_not_supported',
  IMAGE_TOO_LARGE = 'image_too_large',
  IMAGE_TOO_SMALL = 'image_too_small',
  IMAGE_LOAD_ERROR = 'image_load_error',
  FILE_DOWNLOAD_ERROR = 'file_download_error',
  FILE_TOO_LARGE = 'file_too_large',
  ONE_OF = 'one_of',
  SEQUENCE_TOO_SHORT = 'sequence_too_short',
  SEQUENCE_TOO_LONG = 'sequence_too_long',
  GREATER_THAN = 'greater_than',
  LESS_THAN = 'less_than',
  NETWORK_ERROR = 'network_error',
  REQUEST_NOT_FOUND = 'request_not_found',
  INVALID_RESPONSE = 'invalid_response',
  VALIDATION_ERROR = 'validation_error',
  UNEXPECTED_ERROR = 'unexpected_error',
  INSUFFICIENT_BALANCE = 'insufficient_balance',
  AUTHENTICATION_ERROR = 'authentication_error',
  INVALID_REQUEST = 'invalid_request',
}

export interface FalErrorDetail {
  loc: string[];
  msg: string;
  type: string;
  url: string;
  ctx?: Record<string, any>;
  input?: any;
}

export interface FalErrorResponse {
  detail: FalErrorDetail[];
}

/**
 * Custom error class for FAL API errors
 */
export class FalProviderError extends Error {
  constructor(
    public readonly type: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly errors: FalErrorDetail[],
    public readonly context?: Record<string, any>,
  ) {
    const primaryError = errors[0];
    super(primaryError?.msg || `FAL API error: ${type}`);
    this.name = 'FalProviderError';
    Object.setPrototypeOf(this, FalProviderError.prototype);
  }

  /**
   * Check if error is retryable
   */
  isRetryable(): boolean {
    return this.retryable;
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    const primaryError = this.errors[0];
    if (!primaryError) return 'An unknown error occurred';

    // Map error types to user-friendly messages
    switch (primaryError.type) {
      case FalErrorType.CONTENT_POLICY_VIOLATION:
        return 'The prompt contains content that violates our usage policies. Please modify your prompt.';
      case FalErrorType.GENERATION_TIMEOUT:
        return 'Image generation timed out. Please try again with a simpler prompt.';
      case FalErrorType.DOWNSTREAM_SERVICE_UNAVAILABLE:
        return 'The image generation service is temporarily unavailable. Please try again later.';
      case FalErrorType.IMAGE_TOO_LARGE:
        return `Image size exceeds limits. Maximum: ${this.context?.max_width}x${this.context?.max_height}px`;
      case FalErrorType.IMAGE_TOO_SMALL:
        return `Image size is too small. Minimum: ${this.context?.min_width}x${this.context?.min_height}px`;
      case FalErrorType.ONE_OF:
        return `Invalid value. Allowed values: ${this.context?.expected?.join(', ')}`;
      case FalErrorType.INTERNAL_SERVER_ERROR:
        return 'An internal server error occurred. Please try again.';
      case FalErrorType.DOWNSTREAM_SERVICE_ERROR:
        return 'A service error occurred. Please try again.';
      case FalErrorType.FEATURE_NOT_SUPPORTED:
        return 'The requested feature is not supported for this model.';
      case FalErrorType.NETWORK_ERROR:
        return 'Network error: Unable to connect to the image generation service.';
      case FalErrorType.REQUEST_NOT_FOUND:
        return 'The generation request was not found.';
      case FalErrorType.INSUFFICIENT_BALANCE:
        return 'FAL account balance has been exhausted. Please top up your balance at fal.ai/dashboard/billing to continue using FAL models.';
      case FalErrorType.AUTHENTICATION_ERROR:
        return 'Authentication failed. Please check your FAL API key configuration.';
      case FalErrorType.INVALID_REQUEST:
        return primaryError.msg || 'Invalid request. Please check your input parameters.';
      default:
        return primaryError.msg || 'An error occurred during image generation';
    }
  }
}

