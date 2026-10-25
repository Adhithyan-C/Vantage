import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

interface ResolveCliPathOptions {
  cwd?: string;
  initCwd?: string;
  purpose?: 'input' | 'output';
  exists?: (path: string) => boolean;
}

export function resolveCliPath(filePath: string, options: ResolveCliPathOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  if (isAbsolute(filePath)) return resolve(filePath);

  const roots = [...new Set([options.initCwd ?? process.env.INIT_CWD, cwd].filter((root): root is string => Boolean(root)))];
  const candidates = roots.map((root) => resolve(root, filePath));
  const exists = options.exists ?? existsSync;
  const isAvailable = (candidate: string) => exists(options.purpose === 'output' ? dirname(candidate) : candidate);

  return candidates.find(isAvailable) ?? candidates[0] ?? resolve(cwd, filePath);
}
