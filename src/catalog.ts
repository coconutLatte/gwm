import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface RequirementRepository {
  name: string;
  path: string;
  branch: string;
}

export interface Requirement {
  name: string;
  path: string;
  repositories: RequirementRepository[];
}

async function readBranch(repository: string): Promise<string | undefined> {
  const marker = path.join(repository, '.git');
  try {
    const stat = await fs.lstat(marker);
    let gitDir: string;
    if (stat.isDirectory()) {
      gitDir = marker;
    } else if (stat.isFile()) {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.readFile(marker, 'utf8'));
      if (!pointer) return undefined;
      gitDir = path.resolve(repository, pointer[1]);
    } else {
      return undefined;
    }
    const head = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
    const branch = /^ref: refs\/heads\/(.+)$/.exec(head)?.[1];
    return branch ?? (/^[a-f0-9]{40,64}$/i.test(head) ? `${head.slice(0, 8)} (detached)` : undefined);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined;
    throw error;
  }
}

/** Discover only direct child repositories, without following directory symlinks. */
export async function scanRepositories(root: string): Promise<RequirementRepository[]> {
  const children = await fs.readdir(root, { withFileTypes: true });
  const repositories: RequirementRepository[] = [];
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!child.isDirectory() || child.isSymbolicLink() || child.name.startsWith('.')) continue;
    const repositoryPath = path.join(root, child.name);
    const branch = await readBranch(repositoryPath);
    if (branch !== undefined) repositories.push({ name: child.name, path: repositoryPath, branch });
  }
  return repositories;
}

/** Scan exactly root/requirement/repository; never recurse into source or dependency trees. */
export async function scanRequirements(root: string): Promise<Requirement[]> {
  const features = await fs.readdir(root, { withFileTypes: true });
  const result: Requirement[] = [];
  for (const feature of features.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!feature.isDirectory() || feature.isSymbolicLink() || feature.name.startsWith('.')) continue;
    const featurePath = path.join(root, feature.name);
    let repositories: RequirementRepository[];
    try {
      repositories = await scanRepositories(featurePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (repositories.length) result.push({ name: feature.name, path: featurePath, repositories });
  }
  return result;
}

export function samePaths(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const paths = new Set(left.map(p => path.resolve(p)));
  return paths.size === right.length && right.every(p => paths.has(path.resolve(p)));
}

/** Recover the root after workspace folders change, without a global last-used-project setting. */
export async function findWorktreeRoot(folders: readonly string[]): Promise<string | undefined> {
  for (const folder of folders) {
    let current = path.resolve(folder);
    for (let depth = 0; depth < 8; depth++) {
      if (path.basename(current) === '.worktrees') return current;
      const candidate = path.join(current, '.worktrees');
      try {
        if ((await fs.stat(candidate)).isDirectory()) return candidate;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return undefined;
}
