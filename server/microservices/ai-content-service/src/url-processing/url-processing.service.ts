import { Injectable } from '@nestjs/common';
import { LoggerService } from '../common/logger/logger.service';
import { CheerioProvider, ExtractedUrlContent } from './providers/cheerio.provider';

export interface ProcessedUrl {
  id: string;
  url: string;
  success: boolean;
  content?: ExtractedUrlContent;
  contextSummary?: string;
  error?: string;
}

@Injectable()
export class UrlProcessingService {
  constructor(
    private readonly logger: LoggerService,
    private readonly cheerioProvider: CheerioProvider,
  ) {}

  /**
   * Process a single URL and extract its content
   */
  async processUrl(url: string, id?: string): Promise<ProcessedUrl> {
    const processedId = id || `url-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.logger.log(`Processing URL: ${url}`, 'UrlProcessingService');
    
    try {
      const content = await this.cheerioProvider.extractContent(url);
      const contextSummary = await this.cheerioProvider.extractForScriptContext(url);
      
      this.logger.log(`Successfully processed URL: ${url} (${content.metadata.contentLength} chars)`, 'UrlProcessingService');
      
      return {
        id: processedId,
        url,
        success: true,
        content,
        contextSummary,
      };
    } catch (error: any) {
      this.logger.error(`Failed to process URL ${url}: ${error.message}`, error.stack, 'UrlProcessingService');
      
      return {
        id: processedId,
        url,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process multiple URLs in parallel
   */
  async processUrls(urls: Array<{ id: string; url: string }>): Promise<ProcessedUrl[]> {
    const results = await Promise.allSettled(
      urls.map(({ id, url }) => this.processUrl(url, id))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        id: urls[index].id,
        url: urls[index].url,
        success: false,
        error: result.reason?.message || 'Unknown error',
      };
    });
  }

  /**
   * Extract content from URLs and format for script generation context
   * Returns a formatted string suitable for inclusion in LLM prompts
   */
  async extractUrlsForScriptContext(urls: Array<{ id: string; url: string }>): Promise<{
    processedUrls: ProcessedUrl[];
    combinedContext: string;
  }> {
    const processedUrls = await this.processUrls(urls);
    
    // Build combined context from all successful extractions
    let combinedContext = '';
    
    const successfulUrls = processedUrls.filter(p => p.success && p.contextSummary);
    
    if (successfulUrls.length > 0) {
      combinedContext = '=== WEBSITE CONTENT CONTEXT ===\n\n';
      
      successfulUrls.forEach((processed, index) => {
        combinedContext += `--- Source ${index + 1}: ${processed.url} ---\n`;
        combinedContext += processed.contextSummary;
        combinedContext += '\n\n';
      });
      
      combinedContext += '=== END WEBSITE CONTENT ===\n';
    }
    
    return {
      processedUrls,
      combinedContext,
    };
  }
}
