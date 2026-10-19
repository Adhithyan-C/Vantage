import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DemoBannerContent } from './DemoBanner';

describe('DemoBanner', () => {
  it('shows its recorded-run notice only when demo mode is true', () => {
    const demo = renderToString(<DemoBannerContent demo />);
    const live = renderToString(<DemoBannerContent demo={false} />);
    expect(demo).toContain('role="status"');
    expect(demo).toContain('Demo mode: you are viewing a recorded run. No live search or AI calls are being made.');
    expect(live).toBe('');
  });
});
