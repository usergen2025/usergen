export type AvatarVisualStylePresetIcon = 'original' | 'random';

export const AVATAR_VISUAL_STYLE_PRESETS = [
  { id: 'original', label: 'Original', description: 'Keep your image as-is, only resize for video format', icon: 'original' as AvatarVisualStylePresetIcon },
  { id: 'random', label: 'Random', description: 'Let AI style it based on your script', icon: 'random' as AvatarVisualStylePresetIcon },
  { id: 'front-facing', label: 'Front-facing', description: 'simple, direct, talking-to-camera style', previewImage: '/assets/avatar-style-previews/front-facing.png' },
  { id: 'wide-angle-front', label: 'Wide-angle Front', description: 'natural creator look', previewImage: '/assets/avatar-style-previews/wide-angle-front.png' },
  { id: 'standing-with-mic', label: 'Standing With Mic', description: 'presenter / stage vibe', previewImage: '/assets/avatar-style-previews/standing-with-mic.png' },
  { id: 'side-camera-angle', label: 'Side Camera Angle', description: 'cinematic, conversational feel', previewImage: '/assets/avatar-style-previews/side-camera-angle.png' },
  { id: 'podcast-setup', label: 'Podcast Setup', description: 'studio look energy', previewImage: '/assets/avatar-style-previews/podcast-setup.png' },
] as const;

export type AvatarVisualStylePresetId = (typeof AVATAR_VISUAL_STYLE_PRESETS)[number]['id'];
