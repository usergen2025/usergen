import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ExtractedUrlContent {
  url: string;
  title?: string;
  description?: string;
  mainContent: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  images: Array<{ src: string; alt?: string }>;
  metadata: {
    extractedAt: string;
    contentLength: number;
  };
}

@Injectable()
export class CheerioProvider {
  /**
   * Extract content from a URL using Cheerio
   */
  async extractContent(url: string): Promise<ExtractedUrlContent> {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        maxRedirects: 5,
      });

      const $ = cheerio.load(response.data);

      // Remove script, style, and nav elements
      $('script, style, nav, footer, header, aside, .advertisement, .ad, #ad, .sidebar').remove();

      // Extract title
      const title = $('title').first().text().trim() || 
                   $('meta[property="og:title"]').attr('content') ||
                   $('h1').first().text().trim();

      // Extract description
      const description = $('meta[name="description"]').attr('content') ||
                         $('meta[property="og:description"]').attr('content') ||
                         $('p').first().text().trim().substring(0, 300);

      // Extract headings
      const headings: string[] = [];
      $('h1, h2, h3').each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length < 200) {
          headings.push(text);
        }
      });

      // Extract main content
      // Try to find main content area
      let mainContent = '';
      const contentSelectors = ['main', 'article', '.content', '#content', '.post', '.entry', '.page-content', 'body'];
      
      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          mainContent = element.text().trim();
          if (mainContent.length > 100) {
            break;
          }
        }
      }

      // Clean up the content
      mainContent = mainContent
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim()
        .substring(0, 10000); // Limit content length

      // Extract links
      const links: Array<{ text: string; href: string }> = [];
      $('a[href]').slice(0, 20).each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
          links.push({ text: text.substring(0, 100), href });
        }
      });

      // Extract images
      const images: Array<{ src: string; alt?: string }> = [];
      $('img[src]').slice(0, 10).each((_, el) => {
        const src = $(el).attr('src');
        const alt = $(el).attr('alt');
        if (src) {
          // Make relative URLs absolute
          const absoluteSrc = src.startsWith('http') ? src : new URL(src, url).toString();
          images.push({ src: absoluteSrc, alt });
        }
      });

      return {
        url,
        title,
        description,
        mainContent,
        headings: headings.slice(0, 10),
        links,
        images,
        metadata: {
          extractedAt: new Date().toISOString(),
          contentLength: mainContent.length,
        },
      };
    } catch (error: any) {
      console.error(`[CheerioProvider] Failed to extract content from ${url}:`, error.message);
      throw new Error(`Failed to extract content from URL: ${error.message}`);
    }
  }

  /**
   * Extract a summarized version of content suitable for LLM context
   */
  async extractForScriptContext(url: string): Promise<string> {
    const content = await this.extractContent(url);
    
    // Build a structured summary for LLM
    let summary = '';
    
    if (content.title) {
      summary += `Page Title: ${content.title}\n`;
    }
    
    if (content.description) {
      summary += `Description: ${content.description}\n`;
    }
    
    if (content.headings.length > 0) {
      summary += `\nKey Sections:\n`;
      content.headings.forEach(h => {
        summary += `- ${h}\n`;
      });
    }
    
    if (content.mainContent) {
      summary += `\nMain Content:\n${content.mainContent.substring(0, 3000)}`;
      if (content.mainContent.length > 3000) {
        summary += '... [content truncated]';
      }
    }
    
    return summary;
  }
}
