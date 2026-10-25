import { describe, expect, it } from 'vitest';
import { walkthroughArrowDelta, walkthroughStepAfter } from './walkthrough';

describe('walkthrough navigation', () => {
  it('advances through six stages to Result and supports back navigation', () => {
    let step = 0;
    for (let index = 0; index < 6; index += 1) {
      step = walkthroughStepAfter(step, walkthroughArrowDelta('ArrowRight') ?? 0, 6);
    }
    expect(step).toBe(6);
    expect(walkthroughStepAfter(step, 1, 6)).toBe(6);
    expect(walkthroughStepAfter(step, walkthroughArrowDelta('ArrowLeft') ?? 0, 6)).toBe(5);
    expect(walkthroughStepAfter(0, -1, 6)).toBe(0);
  });

  it('maps only left and right arrow keys to navigation', () => {
    expect(walkthroughArrowDelta('ArrowRight')).toBe(1);
    expect(walkthroughArrowDelta('ArrowLeft')).toBe(-1);
    expect(walkthroughArrowDelta('Enter')).toBeNull();
  });
});
