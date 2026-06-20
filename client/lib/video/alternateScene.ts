export type AlternateSceneRole = 'b-roll' | 'avatar';

/** Resolve ALTERNATE scene role from script type, with odd/even fallback for legacy scripts. */
export function getAlternateSceneRole(
  scene: { type?: string } | undefined,
  sceneNumber: number,
): AlternateSceneRole {
  const sceneType = (scene?.type || '').toLowerCase();
  if (sceneType === 'avatar') return 'avatar';
  if (sceneType === 'b-roll' || sceneType === 'broll' || sceneType === 'half-n-half') {
    return 'b-roll';
  }
  return sceneNumber % 2 === 1 ? 'b-roll' : 'avatar';
}

export function isAlternateAvatarScene(
  scene: { type?: string } | undefined,
  sceneNumber: number,
): boolean {
  return getAlternateSceneRole(scene, sceneNumber) === 'avatar';
}

export function isAlternateBrollScene(
  scene: { type?: string } | undefined,
  sceneNumber: number,
): boolean {
  return getAlternateSceneRole(scene, sceneNumber) === 'b-roll';
}

/** Map API job type to WebSocket queue type. */
export function getVideoJobQueueType(
  type?: string,
): 'video-generation' | 'avatar-video-generation' | 'scene-composite' {
  if (type === 'avatar') return 'avatar-video-generation';
  if (type === 'scene') return 'scene-composite'; // legacy half-n-half composite
  return 'video-generation';
}
