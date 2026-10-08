import { describe, it, expect, vi } from 'vitest';
import { fetchWithRetry } from '../src/utils/rateLimit';

describe('fetchWithRetry', () => {
  it('200 on the first try', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const sleep = vi.fn();
    const res = await fetchWithRetry(fetchFn, 'http://x', { timeoutMs: 1000, maxRetries: 2, sleep });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(0);
    expect(res.ok).toBe(true);
  });

  it('429 then 200', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('wait', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await fetchWithRetry(fetchFn, 'http://x', { timeoutMs: 1000, maxRetries: 2, sleep });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it('status 500 every time with maxRetries 2', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await fetchWithRetry(fetchFn, 'http://x', { timeoutMs: 1000, maxRetries: 2, sleep });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(500);
  });

  it('status 404', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    const sleep = vi.fn();
    const res = await fetchWithRetry(fetchFn, 'http://x', { timeoutMs: 1000, maxRetries: 2, sleep });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(0);
    expect(res.status).toBe(404);
  });

  it('fetch throws every time with maxRetries 1', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(fetchWithRetry(fetchFn, 'http://x', { timeoutMs: 1000, maxRetries: 1, sleep }))
      .rejects.toThrow('network');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('429 with header Retry-After "2" then 200', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('wait', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await fetchWithRetry(fetchFn, 'http://x', { timeoutMs: 1000, maxRetries: 2, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
  });
});
