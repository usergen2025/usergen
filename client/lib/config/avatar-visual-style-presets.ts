export const AVATAR_VISUAL_STYLE_PRESETS = [
  { id: 'original', label: 'Original', description: 'Keep your image as-is, only resize for video format' },
  { id: 'random', label: 'Random', description: 'Let AI style it based on your script' },
  { id: 'front-facing', label: 'Front-facing', description: 'simple, direct, talking-to-camera style' },
  { id: 'wide-angle-front', label: 'Wide-angle Front', description: 'natural creator look' },
  { id: 'standing-with-mic', label: 'Standing With Mic', description: 'presenter / stage vibe' },
  { id: 'side-camera-angle', label: 'Side Camera Angle', description: 'cinematic, conversational feel' },
  { id: 'podcast-setup', label: 'Podcast Setup', description: 'studio look energy' },
] as const;

export type AvatarVisualStylePresetId = (typeof AVATAR_VISUAL_STYLE_PRESETS)[number]['id'];
