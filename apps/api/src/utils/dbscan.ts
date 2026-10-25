function cosineDistance(left: number[], right: number[]): number {
  let dot = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return Math.max(0, Math.min(2, 1 - dot));
}

export function dbscan(points: number[][], eps: number, minPts: number): number[] {
  const unvisited = -2;
  const labels = points.map(() => unvisited);
  let clusterId = 0;
  const region = (pointIndex: number): number[] => points.flatMap((point, index) => {
    const origin = points[pointIndex];
    return origin && cosineDistance(origin, point) <= eps ? [index] : [];
  });

  for (let index = 0; index < points.length; index += 1) {
    if (labels[index] !== unvisited) continue;
    const neighbors = region(index);
    if (neighbors.length < minPts) {
      labels[index] = -1;
      continue;
    }
    labels[index] = clusterId;
    const queue = neighbors.filter((neighbor) => neighbor !== index);
    const queued = new Set(queue);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const neighbor = queue[cursor];
      if (neighbor === undefined) continue;
      if (labels[neighbor] === -1) {
        labels[neighbor] = clusterId;
        continue;
      }
      if (labels[neighbor] !== unvisited) continue;
      labels[neighbor] = clusterId;
      const expanded = region(neighbor);
      if (expanded.length >= minPts) {
        for (const candidate of expanded) {
          if (!queued.has(candidate)) {
            queued.add(candidate);
            queue.push(candidate);
          }
        }
      }
    }
    clusterId += 1;
  }
  return labels;
}
