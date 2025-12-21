/**
 * Video Creation Steps Configuration (Backend)
 * 
 * This file defines the order of video creation steps for backend logic.
 * Should match the frontend configuration in client/lib/config/video-steps.ts
 */

/**
 * Ordered list of video creation steps
 * IMPORTANT: Order matters - this defines the flow sequence
 */
export const VIDEO_CREATION_STEPS = [
  'STYLE_SELECTION',
  'VIDEO_TYPE',
  'AVATAR_SELECTION',
  'SCRIPT',
  'VOICE',
  'BROLL_IMAGES',
  'BROLL_VIDEOS',
  'RENDERING',
  'COMPLETED',
] as const;

/**
 * Get step index in the flow
 */
export function getStepIndex(step: string): number {
  return VIDEO_CREATION_STEPS.indexOf(step as any);
}

/**
 * Get previous step in the flow
 */
export function getPreviousStep(currentStep: string): string | undefined {
  const index = getStepIndex(currentStep);
  return index > 0 ? VIDEO_CREATION_STEPS[index - 1] : undefined;
}

/**
 * Get next step in the flow
 */
export function getNextStep(currentStep: string): string | undefined {
  const index = getStepIndex(currentStep);
  return index < VIDEO_CREATION_STEPS.length - 1
    ? VIDEO_CREATION_STEPS[index + 1]
    : undefined;
}

/**
 * Get the step to rollback to when rendering fails
 * This should be the step before RENDERING (BROLL_VIDEOS)
 */
export function getRenderingRollbackStep(): string {
  const renderingIndex = getStepIndex('RENDERING');
  // Return the step before RENDERING
  return renderingIndex > 0
    ? VIDEO_CREATION_STEPS[renderingIndex - 1]
    : 'VOICE'; // Fallback
}

/**
 * Check if a step exists in the flow
 */
export function isValidStep(step: string): boolean {
  return getStepIndex(step) >= 0;
}

