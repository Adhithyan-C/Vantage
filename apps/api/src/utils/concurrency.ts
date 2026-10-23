export async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  limit: number,
  mapper: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), inputs.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input !== undefined) results[index] = await mapper(input, index);
    }
  }));

  return results;
}
