import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deleteRequirementWorktree } from '../src/worktreeDelete';

test('removes linked worktrees and their Git metadata before deleting the requirement', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-delete-test-'));
  try {
    const main = path.join(root, 'main');
    const requirement = path.join(root, '.worktrees', 'feature-a');
    const linked = path.join(requirement, 'api');
    await fs.mkdir(main, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { encoding: 'utf8' }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', 'Worktree Test');
    git('config', 'user.email', 'worktree@example.invalid');
    await fs.writeFile(path.join(main, 'README.md'), 'test\n');
    git('add', 'README.md');
    git('commit', '-m', 'initial');
    await fs.mkdir(path.dirname(linked), { recursive: true });
    git('worktree', 'add', '-b', 'feature-a', linked);

    await deleteRequirementWorktree(requirement, [linked]);

    await assert.rejects(fs.stat(requirement), { code: 'ENOENT' });
    assert.equal(git('worktree', 'list', '--porcelain').includes(linked), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('removes ordinary repositories inside a requirement directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinary-delete-test-'));
  try {
    const requirement = path.join(root, 'feature-a');
    const repository = path.join(requirement, 'api');
    await fs.mkdir(path.join(repository, '.git'), { recursive: true });
    await deleteRequirementWorktree(requirement, [repository]);
    await assert.rejects(fs.stat(requirement), { code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
