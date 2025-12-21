import * as crypto from 'crypto';

export interface AudioGenerationConfig {
  voiceId: string;
  voiceType: 'CLONED' | 'SYNTHETIC' | 'PRESET';
  scriptHash: string;
  modelId: string;
  outputFormat: string;
  scenesCount: number;
  generatedAt: string;
  audioFilesCount: number;
}

/**
 * Hash script content to detect changes
 * Normalizes script structure and creates deterministic hash
 */
export function hashScript(script: string | object | null | undefined): string {
  if (!script) {
    return '';
  }

  // Parse script if string
  const scriptObj = typeof script === 'string' ? JSON.parse(script) : script;

  // Extract scenes and normalize structure
  const scenes = scriptObj.scenes || scriptObj.scene_plan || [];
  const scenesData = scenes
    .map((s: any) => ({
      sceneNumber: s.scene_number || s.sceneNumber || null,
      voiceover: s.voiceover || '',
      timeRange: s.time_range || s.timeRange || null,
    }))
    .sort((a: any, b: any) => {
      // Sort by scene number for consistency
      const numA = a.sceneNumber || 0;
      const numB = b.sceneNumber || 0;
      return numA - numB;
    });

  // Create deterministic hash
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(scenesData))
    .digest('hex');

  return hash;
}

/**
 * Build audio generation config from project data
 */
export function buildAudioGenerationConfig(
  voiceId: string | null | undefined,
  voiceType: 'CLONED' | 'SYNTHETIC' | 'PRESET' | null | undefined,
  script: string | object | null | undefined,
  modelId: string = 'eleven_multilingual_v2',
  outputFormat: string = 'mp3_44100_128',
  audioFilesCount: number = 0,
): AudioGenerationConfig | null {
  if (!voiceId || !voiceType) {
    return null;
  }

  const scriptObj = typeof script === 'string' ? (script ? JSON.parse(script) : null) : script;
  const scenes = scriptObj?.scenes || scriptObj?.scene_plan || [];
  const scenesWithVoiceover = scenes.filter((s: any) => s.voiceover);

  return {
    voiceId,
    voiceType,
    scriptHash: hashScript(script),
    modelId,
    outputFormat,
    scenesCount: scenesWithVoiceover.length,
    generatedAt: new Date().toISOString(),
    audioFilesCount,
  };
}

/**
 * Check if audio should be regenerated
 * Returns true if regeneration is needed, false if existing audio is still valid
 */
export function shouldRegenerateAudio(
  currentConfig: AudioGenerationConfig | null,
  storedConfig: AudioGenerationConfig | null,
  existingAudioFiles: any[] | null | undefined,
): boolean {
  // If no existing audio, must generate
  if (!existingAudioFiles || existingAudioFiles.length === 0) {
    return true;
  }

  // If no current config, must generate (shouldn't happen, but safety check)
  if (!currentConfig) {
    return true;
  }

  // If no stored config, must generate (first time)
  if (!storedConfig) {
    return true;
  }

  // Compare critical fields
  if (currentConfig.voiceId !== storedConfig.voiceId) {
    return true; // Voice changed
  }

  if (currentConfig.voiceType !== storedConfig.voiceType) {
    return true; // Voice type changed
  }

  if (currentConfig.scriptHash !== storedConfig.scriptHash) {
    return true; // Script content changed
  }

  if (currentConfig.scenesCount !== storedConfig.scenesCount) {
    return true; // Scene structure changed
  }

  if (currentConfig.modelId !== storedConfig.modelId) {
    return true; // Model changed
  }

  if (currentConfig.outputFormat !== storedConfig.outputFormat) {
    return true; // Format changed
  }

  // Validate that audio files count matches expected count
  if (existingAudioFiles.length !== storedConfig.audioFilesCount) {
    return true; // Audio files count mismatch (some might be missing)
  }

  // All configs match, no regeneration needed
  return false;
}

