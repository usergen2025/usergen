import OpenAI from 'openai';

export type AssistantExtractResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'empty' | 'refusal'; refusal?: string };

/**
 * Normalize assistant message content (string, array parts, or refusal-only).
 */
export function extractAssistantText(
  message: OpenAI.Chat.ChatCompletionMessage | undefined,
): AssistantExtractResult {
  if (!message) {
    return { ok: false, reason: 'empty' };
  }

  const refusal = (message as { refusal?: string | null }).refusal;
  if (typeof refusal === 'string' && refusal.trim().length > 0) {
    return { ok: false, reason: 'refusal', refusal: refusal.trim() };
  }

  const c = message.content;
  if (c == null) {
    return { ok: false, reason: 'empty' };
  }

  if (typeof c === 'string') {
    const t = c.trim();
    return t.length > 0 ? { ok: true, text: t } : { ok: false, reason: 'empty' };
  }

  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (const part of c as Array<{ type?: string; text?: string }>) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
    const joined = parts.join('').trim();
    return joined.length > 0 ? { ok: true, text: joined } : { ok: false, reason: 'empty' };
  }

  return { ok: false, reason: 'empty' };
}

/** One-line JSON for logs when a completion is missing usable assistant text. */
export function formatCompletionDiagnostics(
  completion: OpenAI.Chat.ChatCompletion,
  label: string,
): string {
  const choice = completion.choices?.[0];
  const msg = choice?.message;
  const extracted = extractAssistantText(msg);
  const refusalFromExtract =
    extracted.ok === false && extracted.reason === 'refusal' ? extracted.refusal : undefined;
  const payload = {
    model: completion.model,
    finishReason: choice?.finish_reason,
    hasUsableText: extracted.ok === true,
    refusal: refusalFromExtract,
    usage: completion.usage,
  };
  return `${label}: ${JSON.stringify(payload)}`;
}
