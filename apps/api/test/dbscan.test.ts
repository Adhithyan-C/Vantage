import { describe, expect, it } from 'vitest';
import { dbscan } from '../src/utils/dbscan';

describe('dbscan', () => {
  it('finds two clusters and leaves a distant point as noise', () => {
    expect(dbscan([[1, 0], [0.99, 0.01], [0, 1], [0.01, 0.99], [-1, 0]], 0.05, 2))
      .toEqual([0, 0, 1, 1, -1]);
  });

  it('counts the point itself and assigns a border point to the first cluster', () => {
    const points = [
      [1, 0],
      [Math.cos(Math.PI / 18), Math.sin(Math.PI / 18)],
      [Math.cos(-Math.PI / 18), Math.sin(-Math.PI / 18)],
      [Math.cos(Math.PI / 9), Math.sin(Math.PI / 9)],
    ];
    expect(dbscan(points, 0.02, 3)).toEqual([0, 0, 0, 0]);
    expect(dbscan([[1, 0]], 0, 1)).toEqual([0]);
  });

  it('is deterministic for the same points', () => {
    const points = [[1, 0], [0.99, 0.01], [0, 1], [0.01, 0.99]];
    expect(dbscan(points, 0.05, 2)).toEqual(dbscan(points, 0.05, 2));
  });
});
