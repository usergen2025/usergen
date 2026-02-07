/**
 * URL Utilities for External API Calls
 * 
 * Provides URL pre-warming and retry logic to handle timeout issues
 * when 3rd party APIs (OpenAI, FAL, BytePlus, HeyGen) try to fetch
 * files from GCS or other external storage.
 */

import * as https from 'https';
import * as http from 'http';

/**
 * Pre-warm a URL by making a GET request to ensure it's accessible and cached.
 * This helps with CDN caching and ensures the file is propagated before external APIs try to fetch it.
 * 
 * @param url - The URL to pre-warm
 * @param maxAttempts - Maximum number of attempts (default: 3)
 * @param timeoutMs - Timeout per attempt in milliseconds (default: 30000)
 * @returns true if URL was successfully pre-warmed, false otherwise
 */
export async function preWarmUrl(
  url: string, 
  maxAttempts: number = 3,
  timeoutMs: number = 30000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[URLUtils] Pre-warming URL (attempt ${attempt}/${maxAttempts}): ${url.substring(0, 100)}...`);
      
      const result = await fetchUrl(url, timeoutMs);
      
      if (result.statusCode === 200 && result.dataLength > 0) {
        console.log(`[URLUtils] ✅ URL pre-warmed successfully (${result.dataLength} bytes)`);
        return true;
      } else {
        console.warn(`[URLUtils] Pre-warm response status: ${result.statusCode}, size: ${result.dataLength}`);
      }
    } catch (error: any) {
      console.warn(`[URLUtils] Pre-warm attempt ${attempt} failed: ${error.message}`);
      if (attempt < maxAttempts) {
        // Exponential backoff: 1s, 2s, 3s
        const delay = 1000 * attempt;
        console.log(`[URLUtils] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.warn(`[URLUtils] ⚠️ Failed to pre-warm URL after ${maxAttempts} attempts: ${url.substring(0, 100)}...`);
  return false;
}

/**
 * Fetch a URL using native Node.js http/https modules
 */
function fetchUrl(url: string, timeoutMs: number): Promise<{ statusCode: number; dataLength: number }> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;
    
    const req = client.get(url, {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'UserGen/1.0 (Pre-warming)',
        'Accept': '*/*',
      },
    }, (res) => {
      let dataLength = 0;
      
      res.on('data', (chunk: Buffer) => {
        dataLength += chunk.length;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          dataLength,
        });
      });
      
      res.on('error', (err) => {
        reject(err);
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Pre-warm multiple URLs in parallel
 * 
 * @param urls - Array of URLs to pre-warm
 * @param maxAttempts - Maximum number of attempts per URL
 * @returns Object with success count and failed URLs
 */
export async function preWarmUrls(
  urls: string[], 
  maxAttempts: number = 3
): Promise<{ successCount: number; failedUrls: string[] }> {
  const results = await Promise.all(
    urls.map(async (url) => ({
      url,
      success: await preWarmUrl(url, maxAttempts),
    }))
  );

  const failedUrls = results.filter(r => !r.success).map(r => r.url);
  const successCount = results.filter(r => r.success).length;

  console.log(`[URLUtils] Pre-warmed ${successCount}/${urls.length} URLs successfully`);
  
  return { successCount, failedUrls };
}

/**
 * Error types that are considered retryable for external API calls
 */
export const RETRYABLE_ERROR_PATTERNS = [
  'timeout',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'socket hang up',
  'network error',
  'EPIPE',
  'Timeout while downloading',
  'invalid_image_url',
];

/**
 * Check if an error is retryable based on its message
 */
export function isRetryableError(error: any): boolean {
  const errorMessage = (error.message || error.toString()).toLowerCase();
  return RETRYABLE_ERROR_PATTERNS.some(pattern => 
    errorMessage.includes(pattern.toLowerCase())
  );
}

/**
 * Wrap an async function with retry logic for timeout-related failures
 * 
 * @param fn - The async function to execute
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param onRetry - Optional callback for each retry
 * @returns The result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  onRetry?: (attempt: number, error: any) => void
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }
      
      console.warn(`[URLUtils] Attempt ${attempt}/${maxRetries} failed (retryable): ${error.message}`);
      
      if (onRetry) {
        onRetry(attempt, error);
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.log(`[URLUtils] Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Execute an external API call with URL pre-warming and retry logic
 * 
 * @param urls - URLs to pre-warm before the API call
 * @param apiCall - The API call function to execute
 * @param maxRetries - Maximum retries for the API call
 * @returns The result of the API call
 */
export async function executeWithPreWarmAndRetry<T>(
  urls: string[],
  apiCall: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  // Pre-warm all URLs first
  if (urls.length > 0) {
    console.log(`[URLUtils] Pre-warming ${urls.length} URL(s) before API call...`);
    await preWarmUrls(urls, 2); // Fewer attempts for pre-warming
    
    // Small delay after pre-warming to ensure propagation
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Execute API call with retry logic
  return await withRetry(apiCall, maxRetries);
}
