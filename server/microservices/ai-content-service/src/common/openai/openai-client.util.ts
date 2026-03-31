import OpenAI from 'openai';

/**
 * Build OpenAI client with optional OPENAI_BASE_URL (proxies / Azure-style endpoints).
 */
export function createConfiguredOpenAI(
  apiKey: string,
  openAiBaseUrl?: string,
): OpenAI {
  const trimmed = openAiBaseUrl?.trim();
  const baseURL = trimmed ? trimmed.replace(/\/$/, '') : undefined;
  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}
