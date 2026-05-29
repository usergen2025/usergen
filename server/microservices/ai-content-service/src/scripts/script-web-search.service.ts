import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { LoggerService } from '../common/logger/logger.service';
import { createConfiguredOpenAI } from '../common/openai/openai-client.util';

export type GroundedFactsResult = {
  summary: string;
  sources: Array<{ title?: string; url?: string }>;
  searchedAt: string;
  queryUsed: string;
};

const LIVE_DATA_KEYWORDS =
  /\b(latest|today|yesterday|current|recent|this\s+week|this\s+month|now|live|breaking|updated|score|scores|stats|statistics|match|result|results|standings|winner|final|price|prices|stock|election|news|announced|release|launched|vs\.?|versus|%\s*|percent|rupees|₹|ipl|world\s+cup|t20|odi|ceo|appointed|funding|revenue|earnings|gdp|inflation)\b/i;

const YEAR_PATTERN = /\b20(2[4-9]|3[0-9])\b/;

@Injectable()
export class ScriptWebSearchService {
  private openai: OpenAI | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const baseUrl = this.configService.get<string>('OPENAI_BASE_URL');
    if (apiKey) {
      this.openai = createConfiguredOpenAI(apiKey, baseUrl);
    }
  }

  isEnabled(): boolean {
    if (this.configService.get<string>('SCRIPT_WEB_SEARCH_ENABLED') === 'false') {
      return false;
    }
    const mode = (this.configService.get<string>('SCRIPT_WEB_SEARCH_MODE') || 'auto')
      .trim()
      .toLowerCase();
    return mode !== 'off' && !!this.openai;
  }

  shouldSearch(userPrompt: string, force?: boolean): boolean {
    if (!this.isEnabled()) return false;
    if (force) return true;
    const mode = (this.configService.get<string>('SCRIPT_WEB_SEARCH_MODE') || 'auto')
      .trim()
      .toLowerCase();
    if (mode === 'always') return true;
    if (mode === 'off') return false;
    const text = (userPrompt || '').trim();
    if (!text) return false;
    return LIVE_DATA_KEYWORDS.test(text) || YEAR_PATTERN.test(text);
  }

  async fetchGroundedFacts(
    userPrompt: string,
    opts?: { force?: boolean },
  ): Promise<GroundedFactsResult | null> {
    if (!this.shouldSearch(userPrompt, opts?.force)) {
      return null;
    }
    if (!this.openai) {
      this.logger.warn('[ScriptWebSearch] OpenAI client not configured', 'ScriptWebSearchService');
      return null;
    }

    const model =
      this.configService.get<string>('OPENAI_MODEL_WEB_SEARCH') ||
      this.configService.get<string>('OPENAI_MODEL_GPT4') ||
      'gpt-4o';
    const timeoutMs = Math.max(
      10000,
      parseInt(this.configService.get<string>('SCRIPT_WEB_SEARCH_TIMEOUT_MS') || '45000', 10) ||
        45000,
    );

    const researchInput = `Research factual, up-to-date information for a short social video script.

Topic / user request:
${userPrompt.trim()}

Instructions:
- Use web search to find current facts: numbers, dates, names, scores, prices, announcements.
- Prefer official, news, or reputable sources.
- If information is uncertain or conflicting, say so explicitly.
- Do not speculate or invent statistics.
- Return a concise bullet list of verified facts suitable for a voiceover script.
- End with a "Sources:" section listing URLs you relied on.`;

    try {
      const response = await Promise.race([
        this.openai.responses.create({
          model,
          tools: [{ type: 'web_search_preview' }],
          input: researchInput,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Web search timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);

      const summary = this.extractResponseText(response);
      if (!summary?.trim()) {
        this.logger.warn('[ScriptWebSearch] Empty summary from Responses API', 'ScriptWebSearchService');
        return null;
      }

      const sources = this.extractSourcesFromText(summary);
      this.logger.log(
        `[ScriptWebSearch] Grounded facts retrieved (${summary.length} chars, ${sources.length} sources)`,
        'ScriptWebSearchService',
      );

      return {
        summary: summary.trim(),
        sources,
        searchedAt: new Date().toISOString(),
        queryUsed: userPrompt.trim().slice(0, 500),
      };
    } catch (err: any) {
      this.logger.warn(
        `[ScriptWebSearch] fetchGroundedFacts failed: ${err?.message || err}`,
        'ScriptWebSearchService',
      );
      return null;
    }
  }

  /** Walk Responses API output items and concatenate assistant text. */
  private extractResponseText(response: OpenAI.Responses.Response): string {
    const chunks: string[] = [];
    const output = (response as { output?: unknown[] }).output;
    if (!Array.isArray(output)) {
      const legacy = (response as { output_text?: string }).output_text;
      return typeof legacy === 'string' ? legacy : '';
    }

    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (rec.type === 'message' && Array.isArray(rec.content)) {
        for (const part of rec.content) {
          if (!part || typeof part !== 'object') continue;
          const p = part as Record<string, unknown>;
          if (p.type === 'output_text' && typeof p.text === 'string') {
            chunks.push(p.text);
          } else if (typeof p.text === 'string') {
            chunks.push(p.text);
          }
        }
      }
    }
    return chunks.join('\n').trim();
  }

  private extractSourcesFromText(text: string): Array<{ title?: string; url?: string }> {
    const sources: Array<{ title?: string; url?: string }> = [];
    const urlRegex = /https?:\/\/[^\s)\]"']+/gi;
    const matches = text.match(urlRegex) || [];
    const seen = new Set<string>();
    for (const url of matches) {
      const clean = url.replace(/[.,;]+$/, '');
      if (seen.has(clean)) continue;
      seen.add(clean);
      sources.push({ url: clean });
    }
    return sources;
  }
}
