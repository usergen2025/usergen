/**
 * Video Creation Steps Configuration
 * 
 * This file defines the order and routing for all video creation steps.
 * To change step order or add new steps, update this file.
 */

export interface VideoStep {
  step: string;
  route: string;
  label: string;
}

/**
 * Ordered list of video creation steps
 * IMPORTANT: Order matters - this defines the flow sequence
 */
export const VIDEO_CREATION_STEPS: readonly VideoStep[] = [
  {
    step: 'STYLE_SELECTION',
    route: '/create-video/style',
    label: 'Style Selection',
  },
  {
    step: 'VIDEO_TYPE',
    route: '/create-video/type',
    label: 'Video Type',
  },
  {
    step: 'AVATAR_SELECTION',
    route: '/create-video/avatar',
    label: 'Avatar Selection',
  },
  {
    step: 'SCRIPT',
    route: '/create-video/script',
    label: 'Script',
  },
  {
    step: 'VOICE',
    route: '/create-video/voice',
    label: 'Voice',
  },
  {
    step: 'BROLL_IMAGES',
    route: '/create-video/broll-images',
    label: 'B-Roll Images',
  },
  {
    step: 'BROLL_VIDEOS',
    route: '/create-video/broll-videos',
    label: 'B-Roll Videos',
  },
  {
    step: 'RENDERING',
    route: '/create-video/rendering',
    label: 'Rendering',
  },
  {
    step: 'COMPLETED',
    route: '/create-video/preview', // Preview page for completed videos
    label: 'Completed',
  },
] as const;

/**
 * Get route for a specific step
 */
export function getStepRoute(step: string): string | undefined {
  return VIDEO_CREATION_STEPS.find((s) => s.step === step)?.route;
}

/**
 * Get step index in the flow
 */
export function getStepIndex(step: string): number {
  return VIDEO_CREATION_STEPS.findIndex((s) => s.step === step);
}

/**
 * Get previous step in the flow
 */
export function getPreviousStep(currentStep: string): string | undefined {
  const index = getStepIndex(currentStep);
  return index > 0 ? VIDEO_CREATION_STEPS[index - 1].step : undefined;
}

/**
 * Get previous step route
 */
export function getPreviousRoute(currentStep: string): string | undefined {
  const prevStep = getPreviousStep(currentStep);
  return prevStep ? getStepRoute(prevStep) : undefined;
}

/**
 * Get next step in the flow
 */
export function getNextStep(currentStep: string): string | undefined {
  const index = getStepIndex(currentStep);
  return index < VIDEO_CREATION_STEPS.length - 1
    ? VIDEO_CREATION_STEPS[index + 1].step
    : undefined;
}

/**
 * Get next step route
 */
export function getNextRoute(currentStep: string): string | undefined {
  const nextStep = getNextStep(currentStep);
  return nextStep ? getStepRoute(nextStep) : undefined;
}

/**
 * Get the step to rollback to when rendering fails
 * This should be the step before RENDERING (BROLL_VIDEOS)
 */
export function getRenderingRollbackStep(): string {
  const renderingIndex = getStepIndex('RENDERING');
  // Return the step before RENDERING
  return renderingIndex > 0
    ? VIDEO_CREATION_STEPS[renderingIndex - 1].step
    : 'VOICE'; // Fallback
}

/**
 * Get the route to rollback to when rendering fails
 */
export function getRenderingRollbackRoute(): string {
  const rollbackStep = getRenderingRollbackStep();
  return getStepRoute(rollbackStep) || '/create-video/broll-videos';
}

/**
 * Check if a step exists in the flow
 */
export function isValidStep(step: string): boolean {
  return getStepIndex(step) >= 0;
}

/**
 * Get step from route path
 * Example: '/create-video/broll-videos' -> 'BROLL_VIDEOS'
 */
export function getStepFromRoute(route: string): string | undefined {
  // Normalize route - remove query params and trailing slashes
  const normalizedRoute = route.split('?')[0].replace(/\/$/, '');
  return VIDEO_CREATION_STEPS.find((s) => s.route === normalizedRoute)?.step;
}

/**
 * Get all steps as a map for quick lookup
 */
export function getStepToRouteMap(): Record<string, string> {
  return VIDEO_CREATION_STEPS.reduce(
    (acc, step) => {
      acc[step.step] = step.route;
      return acc;
    },
    {} as Record<string, string>
  );
}

