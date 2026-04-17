/**
 * Concatenate scene voiceovers from project.script JSON for HeyGen v3 (script + voice_id).
 */
export function aggregateVoiceoversFromScript(script: unknown): string {
  if (script == null) return '';
  if (typeof script === 'string') {
    try {
      const parsed = JSON.parse(script);
      return aggregateVoiceoversFromScript(parsed);
    } catch {
      return script.trim();
    }
  }
  const o = script as Record<string, unknown>;
  const scenes = (o.scenes ?? o) as unknown;
  if (Array.isArray(scenes)) {
    return scenes
      .map((s: { voiceover?: string; text?: string }) =>
        (s?.voiceover ?? s?.text ?? '').toString().trim(),
      )
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}
