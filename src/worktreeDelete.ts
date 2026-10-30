import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(directory: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', directory, ...args], { encoding: 'utf8' });
  return result.stdout;
}

async function removeLinkedWorktree(repository: string): Promise<void> {
  const marker = path.join(repository, '.git');
  let stat;
  try {
    stat = await fs.lstat(marker);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isFile()) return;

  const commonDirectory = path.resolve(repository, (await git(repository, ['rev-parse', '--git-common-dir'])).trim());
  const mainRepository = path.dirname(commonDirectory);
  await git(mainRepository, ['worktree', 'remove', '--force', repository]);
}

/** Remove a complete requirement directory and clean linked-worktree metadata first. */
export async function deleteRequirementWorktree(requirement: string, repositories: readonly string[]): Promise<void> {
  for (const repository of repositories) await removeLinkedWorktree(repository);
  await fs.rm(requirement, { recursive: true, force: true });
}
