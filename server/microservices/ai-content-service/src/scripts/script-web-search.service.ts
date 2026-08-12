import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { LoggerService } from '../common/logger/logger.service';
import { createConfiguredOpenAI } from '../common/openai/openai-client.util';
import { extractDomainFromUrl, normalizeWebsiteUrl } from '@shared/utils/normalize-website-url';

export type GroundedFactsResult = {
  summary: string;
  sources: Array<{ title?: string; url?: string }>;
  searchedAt: string;
  queryUsed: string;
};

export type SearchDecision = {
  needsSearch: boolean;
  reason: string;
  /** keyword_fast_path | classifier | force | always | off | disabled | empty */
  via: string;
};

/**
 * Fast-path keywords for obviously live/current topics. When these match we skip
 * the classifier LLM call. Named events without these words (e.g. "Cockroach
 * Janta Party") still reach the classifier.
 */
const LIVE_DATA_KEYWORDS =
  /\b(latest|today|yesterday|current|recent|this\s+week|this\s+month|now|live|breaking|updated|score|scores|stats|statistics|match|result|results|standings|winner|final|price|prices|stock|election|elections|news|announced|release|launched|vs\.?|versus|%\s*|percent|rupees|₹|ipl|world\s+cup|t20|odi|ceo|appointed|funding|revenue|earnings|gdp|inflation|protest|protests|demonstration|rally|movement|minister|resignation|manifesto)\b/i;

const YEAR_PATTERN = /\b20(2[4-9]|3[0-9])\b/;

const CLASSIFIER_SYSTEM = `You decide whether a short social-video topic needs live web research before writing a script.

Return ONLY compact JSON: {"needsSearch":boolean,"reason":"short why"}

needsSearch=true when the topic likely refers to:
- a real organisation, movement, political party, person, place-linked event, protest, sports result, price, or news story
- anything that could be misread as wordplay or a generic metaphor if not researched (e.g. a satirical party name that sounds like animals + "party")
- current facts, scores, dates, announcements, elections

needsSearch=false for evergreen how-tos, generic lifestyle tips, fictional stories, or topics that need no external facts.

When unsure, prefer needsSearch=true.`;

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

  /** Sync keyword / mode check only — prefer `decideShouldSearch` for auto mode. */
  matchesKeywordFastPath(userPrompt: string): boolean {
    const text = (userPrompt || '').trim();
    if (!text) return false;
    return LIVE_DATA_KEYWORDS.test(text) || YEAR_PATTERN.test(text);
  }

  /**
   * @deprecated Prefer `decideShouldSearch` (async). Kept for sync call sites that
   * only need the keyword fast path / mode flags without the classifier.
   */
  shouldSearch(userPrompt: string, force?: boolean): boolean {
    if (!this.isEnabled()) return false;
    if (force) return true;
    const mode = (this.configService.get<string>('SCRIPT_WEB_SEARCH_MODE') || 'auto')
      .trim()
      .toLowerCase();
    if (mode === 'always') return true;
    if (mode === 'off') return false;
    return this.matchesKeywordFastPath(userPrompt);
  }

  /**
   * Decide whether to run web search:
   * 1. force / always / off / disabled short-circuit
   * 2. keyword fast path → search immediately (no classifier cost)
   * 3. otherwise ask a cheap classifier model
   */
  async decideShouldSearch(
    userPrompt: string,
    force?: boolean,
  ): Promise<SearchDecision> {
    if (!this.isEnabled()) {
      return { needsSearch: false, reason: 'web search disabled', via: 'disabled' };
    }
    if (force) {
      return { needsSearch: true, reason: 'forced by caller', via: 'force' };
    }

    const mode = (this.configService.get<string>('SCRIPT_WEB_SEARCH_MODE') || 'auto')
      .trim()
      .toLowerCase();
    if (mode === 'always') {
      return { needsSearch: true, reason: 'SCRIPT_WEB_SEARCH_MODE=always', via: 'always' };
    }
    if (mode === 'off') {
      return { needsSearch: false, reason: 'SCRIPT_WEB_SEARCH_MODE=off', via: 'off' };
    }

    const text = (userPrompt || '').trim();
    if (!text) {
      return { needsSearch: false, reason: 'empty prompt', via: 'empty' };
    }

    if (this.matchesKeywordFastPath(text)) {
      return {
        needsSearch: true,
        reason: 'matched live-data keyword or year fast path',
        via: 'keyword_fast_path',
      };
    }

    const classified = await this.classifyNeedsSearch(text);
    return {
      needsSearch: classified.needsSearch,
      reason: classified.reason,
      via: 'classifier',
    };
  }

  private async classifyNeedsSearch(
    userPrompt: string,
  ): Promise<{ needsSearch: boolean; reason: string }> {
    if (!this.openai) {
      return { needsSearch: false, reason: 'OpenAI client not configured' };
    }

    const model =
      this.configService.get<string>('OPENAI_MODEL_WEB_SEARCH_CLASSIFIER') ||
      this.configService.get<string>('OPENAI_MODEL_MINI') ||
      'gpt-4o-mini';
    const timeoutMs = Math.max(
      3000,
      parseInt(
        this.configService.get<string>('SCRIPT_WEB_SEARCH_CLASSIFIER_TIMEOUT_MS') || '8000',
        10,
      ) || 8000,
    );

    try {
      const completion = await Promise.race([
        this.openai.chat.completions.create({
          model,
          temperature: 0,
          max_tokens: 80,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: CLASSIFIER_SYSTEM },
            {
              role: 'user',
              content: `Video topic:\n${userPrompt.trim().slice(0, 1000)}`,
            },
          ],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Search classifier timed out after ${timeoutMs}ms`)),
            timeoutMs,
          ),
        ),
      ]);

      const raw = completion.choices?.[0]?.message?.content?.trim() || '';
      const parsed = this.parseClassifierJson(raw);
      this.logger.log(
        `[ScriptWebSearch] Classifier → needsSearch=${parsed.needsSearch} (${parsed.reason})`,
        'ScriptWebSearchService',
      );
      return parsed;
    } catch (err: any) {
      // Prefer searching when the gate fails so named real-world topics are not
      // silently turned into pun scripts (cost of an occasional extra search).
      this.logger.warn(
        `[ScriptWebSearch] Classifier failed (${err?.message || err}); defaulting to needsSearch=true`,
        'ScriptWebSearchService',
      );
      return {
        needsSearch: true,
        reason: `classifier error; defaulting to search (${err?.message || 'unknown'})`,
      };
    }
  }

  private parseClassifierJson(raw: string): { needsSearch: boolean; reason: string } {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as {
        needsSearch?: unknown;
        reason?: unknown;
      };
      const needsSearch = obj.needsSearch === true || obj.needsSearch === 'true';
      const reason =
        typeof obj.reason === 'string' && obj.reason.trim()
          ? obj.reason.trim().slice(0, 200)
          : needsSearch
            ? 'classifier suggested search'
            : 'classifier suggested skip';
      return { needsSearch, reason };
    } catch {
      // If the model returned prose with a clear yes, treat as search.
      const lower = raw.toLowerCase();
      if (/\bneedssearch"?\s*:\s*true\b/.test(lower) || /\byes\b/.test(lower)) {
        return { needsSearch: true, reason: 'classifier unparsed; inferred true' };
      }
      return { needsSearch: true, reason: 'classifier unparsed; defaulting to search' };
    }
  }

  isUrlAssetSearchEnabled(): boolean {
    return this.configService.get<string>('SCRIPT_WEB_SEARCH_ON_URL_ASSET') !== 'false';
  }

  extractDomain(url: string): string {
    return extractDomainFromUrl(url);
  }

  buildWebsiteResearchPrompt(normalizedUrl: string, domain: string, userPrompt?: string): string {
    const topicLine = userPrompt?.trim()
      ? `\nUser's video topic / request:\n${userPrompt.trim()}\n`
      : '';
    return `Research the company or brand at this website for a short marketing video script.

Website URL: ${normalizedUrl}
Domain: ${domain}
${topicLine}
Extract and return:
- Official company/brand name and tagline (if found)
- Products or services offered and key features
- Target audience and brand tone/voice
- Location or market focus if relevant
- Any notable recent news or announcements (only if verified)

Instructions:
- Use web search; prefer the official site and reputable sources.
- Do not invent facts, statistics, or product details.
- If information is limited, say what is uncertain.
- Return concise bullet points suitable for a voiceover script.
- End with a "Sources:" section listing URLs you relied on.`;
  }

  async fetchGroundedFactsForWebsite(
    url: string,
    userPrompt?: string,
  ): Promise<GroundedFactsResult | null> {
    if (!this.isEnabled() || !this.openai) return null;

    const normalizedUrl = normalizeWebsiteUrl(url) || url;
    const domain = this.extractDomain(normalizedUrl);

    const primary = await this.runSearchRequest(
      this.buildWebsiteResearchPrompt(normalizedUrl, domain, userPrompt),
      `website:${normalizedUrl}`,
    );
    if (primary?.summary?.trim()) return primary;

    const fallbackPrompt = `Research the company or brand associated with domain "${domain}" for a marketing video script.
${userPrompt?.trim() ? `Video topic: ${userPrompt.trim()}\n` : ''}
Find: brand name, products/services, key features, target audience, brand tone.
Use web search. Do not invent facts. End with Sources: URLs.`;

    return this.runSearchRequest(fallbackPrompt, `domain:${domain}`);
  }

  private async runSearchRequest(
    researchInput: string,
    queryLabel: string,
  ): Promise<GroundedFactsResult | null> {
    if (!this.openai) return null;

    const model =
      this.configService.get<string>('OPENAI_MODEL_WEB_SEARCH') ||
      this.configService.get<string>('OPENAI_MODEL_GPT4') ||
      'gpt-4o';
    const timeoutMs = Math.max(
      10000,
      parseInt(this.configService.get<string>('SCRIPT_WEB_SEARCH_TIMEOUT_MS') || '45000', 10) ||
        45000,
    );
    // Prefer the current web_search tool; fall back to preview if the API rejects it.
    const toolTypeEnv = (this.configService.get<string>('SCRIPT_WEB_SEARCH_TOOL') || 'web_search')
      .trim()
      .toLowerCase();
    const toolType =
      toolTypeEnv === 'web_search_preview' || toolTypeEnv === 'preview'
        ? 'web_search_preview'
        : 'web_search';

    try {
      const response = await this.createSearchResponse(
        model,
        researchInput,
        toolType,
        timeoutMs,
      );

      const summary = this.extractResponseText(response);
      if (!summary?.trim()) {
        this.logger.warn(
          `[ScriptWebSearch] Empty search summary for ${queryLabel}`,
          'ScriptWebSearchService',
        );
        return null;
      }

      const usedSearch = this.responseUsedWebSearch(response);
      const sources = this.mergeSources(
        this.extractSourcesFromText(summary),
        this.extractSourcesFromAnnotations(response),
      );

      const preview = summary.trim().replace(/\s+/g, ' ').slice(0, 220);
      this.logger.log(
        `[ScriptWebSearch] Grounded facts for ${queryLabel}: chars=${summary.length} sources=${sources.length} web_search_call=${usedSearch} preview="${preview}"`,
        'ScriptWebSearchService',
      );
      if (sources.length) {
        this.logger.log(
          `[ScriptWebSearch] Sources: ${sources
            .map((s) => s.url)
            .filter(Boolean)
            .slice(0, 5)
            .join(' | ')}`,
          'ScriptWebSearchService',
        );
      }

      return {
        summary: summary.trim(),
        sources,
        searchedAt: new Date().toISOString(),
        queryUsed: queryLabel.slice(0, 500),
      };
    } catch (err: any) {
      this.logger.warn(
        `[ScriptWebSearch] Search failed for ${queryLabel}: ${err?.message || err}`,
        'ScriptWebSearchService',
      );
      return null;
    }
  }

  private async createSearchResponse(
    model: string,
    researchInput: string,
    toolType: 'web_search' | 'web_search_preview',
    timeoutMs: number,
  ): Promise<OpenAI.Responses.Response> {
    if (!this.openai) {
      throw new Error('OpenAI client not configured');
    }

    const buildParams = (type: 'web_search' | 'web_search_preview') => ({
      model,
      // Force a hosted web-search tool call — without this the model may answer
      // from priors and invent a punny brief for names like "Cockroach Janta Party".
      tools: [
        {
          type,
          search_context_size: 'high' as const,
        },
      ],
      tool_choice:
        type === 'web_search_preview'
          ? ({ type: 'web_search_preview' } as const)
          : ('required' as const),
      input: researchInput,
    });

    const run = (type: 'web_search' | 'web_search_preview') =>
      Promise.race([
        this.openai!.responses.create(buildParams(type)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Web search timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);

    try {
      return await run(toolType);
    } catch (err: any) {
      // Older accounts / proxies may only accept the preview tool name.
      if (toolType === 'web_search') {
        const msg = String(err?.message || err || '');
        if (/web_search|unknown_tool|invalid.*tool|tool_choice/i.test(msg)) {
          this.logger.warn(
            `[ScriptWebSearch] web_search rejected (${msg.slice(0, 120)}); retrying with web_search_preview`,
            'ScriptWebSearchService',
          );
          return await run('web_search_preview');
        }
      }
      throw err;
    }
  }

  /** True when the Responses payload includes at least one completed web_search_call. */
  private responseUsedWebSearch(response: OpenAI.Responses.Response): boolean {
    const output = (response as { output?: unknown[] }).output;
    if (!Array.isArray(output)) return false;
    return output.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item as { type?: string }).type === 'web_search_call',
    );
  }

  private isWeakGrounding(result: GroundedFactsResult): boolean {
    const summary = result.summary.trim();
    if (summary.length < 280) return true;
    if (!result.sources.length) return true;
    // Thin joke/pun brief with no concrete news markers.
    const looksLikePunOnly =
      /\b(concept|imaginary|fictional|joke|mazak|pun|metaphor|creative idea)\b/i.test(summary) &&
      !/\b(protest|movement|party|minister|election|founded|announced|delhi|jantar|neet|resign)\b/i.test(
        summary,
      );
    return looksLikePunOnly;
  }

  private buildTopicResearchPrompt(userPrompt: string, stricter = false): string {
    const strictExtra = stricter
      ? `
STRICT RETRY — previous answer was too thin or lacked sources:
- You MUST use web search and cite real URLs.
- Open news / Wikipedia / reputable pages for the exact named phrase.
- If it is a real organisation or protest movement, say so in the first bullet.
- Never describe it only as a joke, pun, or imaginary "concept".`
      : '';

    return `Research factual, up-to-date information for a short social video script.

Topic / user request:
${userPrompt.trim()}
${strictExtra}

Instructions:
- You MUST use the web search tool. Do not answer from memory alone.
- First determine whether the topic refers to a real organisation, political/satirical party, protest movement, person, place-linked event, sports result, price, or news story — even if the name sounds metaphorical or like wordplay (e.g. animal names + "party").
- If a real-world meaning exists, research THAT meaning and state it clearly in the first bullets (who/what, where, when, why it matters).
- Do NOT invent a literal pun interpretation (e.g. insects literally throwing a party) when a real named entity or news story exists.
- Prefer official, news, or reputable sources (national newspapers, wire services, Wikipedia when corroborated).
- Include concrete details: names of people/orgs, locations, dates, demands/outcomes when available.
- If information is uncertain or conflicting, say so explicitly.
- Do not speculate or invent statistics.
- Return a concise bullet list of verified facts suitable for a voiceover script (aim for at least 6–10 solid bullets).
- End with a "Sources:" section listing the URLs you relied on.`;
  }

  async fetchGroundedFacts(
    userPrompt: string,
    opts?: { force?: boolean; alreadyDecided?: boolean },
  ): Promise<GroundedFactsResult | null> {
    if (!opts?.alreadyDecided) {
      const decision = await this.decideShouldSearch(userPrompt, opts?.force);
      if (!decision.needsSearch) {
        this.logger.log(
          `[ScriptWebSearch] Skipping search via=${decision.via}: ${decision.reason}`,
          'ScriptWebSearchService',
        );
        return null;
      }
      this.logger.log(
        `[ScriptWebSearch] Running search via=${decision.via}: ${decision.reason}`,
        'ScriptWebSearchService',
      );
    }

    if (!this.openai) {
      this.logger.warn('[ScriptWebSearch] OpenAI client not configured', 'ScriptWebSearchService');
      return null;
    }

    const label = userPrompt.trim().slice(0, 500);
    const primary = await this.runSearchRequest(this.buildTopicResearchPrompt(userPrompt), label);

    if (primary && !this.isWeakGrounding(primary)) {
      return primary;
    }

    if (primary) {
      this.logger.warn(
        `[ScriptWebSearch] Weak grounding (chars=${primary.summary.length}, sources=${primary.sources.length}); retrying with stricter prompt`,
        'ScriptWebSearchService',
      );
    } else {
      this.logger.warn(
        `[ScriptWebSearch] Primary search empty; retrying with stricter prompt`,
        'ScriptWebSearchService',
      );
    }

    const retry = await this.runSearchRequest(
      this.buildTopicResearchPrompt(userPrompt, true),
      `${label} [retry]`,
    );

    if (retry && !this.isWeakGrounding(retry)) {
      return retry;
    }

    // Prefer the richer of the two thin results over returning null — script gen
    // still gets something, and searchAttemptedButEmpty stays false when any text exists.
    if (retry && primary) {
      return retry.summary.length >= primary.summary.length ? retry : primary;
    }
    return retry || primary;
  }

  /** Walk Responses API output items and concatenate assistant text. */
  private extractResponseText(response: OpenAI.Responses.Response): string {
    const legacy = (response as { output_text?: string }).output_text;
    if (typeof legacy === 'string' && legacy.trim()) {
      return legacy.trim();
    }

    const chunks: string[] = [];
    const output = (response as { output?: unknown[] }).output;
    if (!Array.isArray(output)) {
      return '';
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

  private extractSourcesFromAnnotations(
    response: OpenAI.Responses.Response,
  ): Array<{ title?: string; url?: string }> {
    const sources: Array<{ title?: string; url?: string }> = [];
    const output = (response as { output?: unknown[] }).output;
    if (!Array.isArray(output)) return sources;

    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (rec.type !== 'message' || !Array.isArray(rec.content)) continue;
      for (const part of rec.content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        if (!Array.isArray(p.annotations)) continue;
        for (const ann of p.annotations) {
          if (!ann || typeof ann !== 'object') continue;
          const a = ann as Record<string, unknown>;
          const url = typeof a.url === 'string' ? a.url : undefined;
          if (!url) continue;
          sources.push({
            url: url.replace(/[.,;]+$/, ''),
            title: typeof a.title === 'string' ? a.title : undefined,
          });
        }
      }
    }
    return sources;
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

  private mergeSources(
    ...lists: Array<Array<{ title?: string; url?: string }>>
  ): Array<{ title?: string; url?: string }> {
    const merged: Array<{ title?: string; url?: string }> = [];
    const seen = new Set<string>();
    for (const list of lists) {
      for (const s of list) {
        const url = s.url?.replace(/[.,;]+$/, '');
        if (!url || seen.has(url)) continue;
        seen.add(url);
        merged.push({ ...s, url });
      }
    }
    return merged;
  }
}
