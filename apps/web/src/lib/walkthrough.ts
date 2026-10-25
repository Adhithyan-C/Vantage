export function walkthroughStepAfter(currentStep: number, delta: number, stageCount: number): number {
  return Math.max(0, Math.min(stageCount, currentStep + delta));
}

export function walkthroughArrowDelta(key: string): -1 | 1 | null {
  if (key === 'ArrowRight') return 1;
  if (key === 'ArrowLeft') return -1;
  return null;
}
