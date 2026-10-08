export async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  options: { headers?: Record<string, string>; timeoutMs: number; maxRetries: number; sleep?: (ms: number) => Promise<void> }
): Promise<Response> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const totalAttempts = options.maxRetries + 1;
  let lastResult: Response | Error | undefined;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetchFn(url, { headers: options.headers, signal: controller.signal });
      clearTimeout(timer);
      lastResult = response;

      if (response.ok) {
        return response;
      }

      if (response.status === 429 || response.status >= 500) {
        // Retryable
      } else {
        // Non-retryable
        return response;
      }
    } catch (err: any) {
      clearTimeout(timer);
      lastResult = err;
    }

    if (attempt < totalAttempts - 1) {
      let delay = Math.min(500 * Math.pow(2, attempt), 30000);
      if (lastResult instanceof Response) {
        const retryAfter = lastResult.headers.get('Retry-After');
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!Number.isNaN(seconds)) {
            delay = Math.min(seconds * 1000, 30000);
          }
        }
      }
      await sleep(delay);
    }
  }

  if (lastResult instanceof Error) {
    throw lastResult;
  }
  return lastResult as Response;
}
