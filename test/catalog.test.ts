import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanRequirements, scanRepositories, findWorktreeRoot, samePaths } from '../src/catalog';
import { repositoryVisibilityResetCommands, scmSelectionModeCommands } from '../src/scmVisibility';

test('resets stale SCM visibility when multiple repositories are selected', () => {
  assert.deepEqual(repositoryVisibilityResetCommands('multiple'), [
    scmSelectionModeCommands.single,
    scmSelectionModeCommands.multiple,
  ]);
  assert.deepEqual(repositoryVisibilityResetCommands('single'), [scmSelectionModeCommands.multiple]);
});

test('discovers linked worktrees and ordinary repos without following symlinks or nested dependencies', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'requirement-catalog-'));
  try {
    const root = path.join(temporary, '.worktrees');
    const metadata = path.join(temporary, 'git metadata', 'worktrees', 'api');
    await fs.mkdir(metadata, { recursive: true });
    await fs.writeFile(path.join(metadata, 'HEAD'), 'ref: refs/heads/feat/feature-a\n');
    const api = path.join(root, 'feature-a', 'api');
    await fs.mkdir(api, { recursive: true });
    await fs.writeFile(path.join(api, '.git'), `gitdir: ${path.relative(api, metadata)}\n`);
    const web = path.join(root, 'another feature', 'web');
    await fs.mkdir(path.join(web, '.git'), { recursive: true });
    await fs.writeFile(path.join(web, '.git/HEAD'), 'a'.repeat(40) + '\n');
    await fs.mkdir(path.join(root, 'empty', 'not-a-repo'), { recursive: true });
    await fs.mkdir(path.join(root, 'invalid', 'fake'), { recursive: true });
    await fs.writeFile(path.join(root, 'invalid', 'fake', '.git'), 'not a gitdir pointer');
    await fs.symlink(path.join(root, 'feature-a'), path.join(root, 'symlink-feature'));
    await fs.symlink(web, path.join(root, 'feature-a', 'symlink-repo'));
    await fs.mkdir(path.join(root, '.hidden', 'repo', '.git'), { recursive: true });
    await fs.writeFile(path.join(root, '.hidden', 'repo', '.git/HEAD'), 'ref: refs/heads/main\n');
    const features = await scanRequirements(root);
    // Main scanning must not accidentally include linked worktrees from a hidden child.
    const mainRepo = path.join(temporary, 'api');
    await fs.mkdir(path.join(mainRepo, '.git'), { recursive: true });
    await fs.writeFile(path.join(mainRepo, '.git/HEAD'), 'ref: refs/heads/gray\n');
    await fs.symlink(web, path.join(temporary, 'linked-main-repo'));
    assert.deepEqual(await scanRepositories(temporary), [{ name: 'api', path: mainRepo, branch: 'gray' }]);
    assert.deepEqual(features.map(feature => feature.name), ['another feature', 'feature-a']);
    assert.deepEqual(features[1].repositories, [{ name: 'api', path: api, branch: 'feat/feature-a' }]);
    assert.equal(features[0].repositories[0].branch, 'aaaaaaaa (detached)');
    assert.equal(await findWorktreeRoot([temporary]), root);
    assert.equal(await findWorktreeRoot([api]), root);
    assert.equal(await findWorktreeRoot([root]), root);
    assert.ok(samePaths([api, web], [web, api]));
    assert.ok(!samePaths([api, web], [api]));
    assert.ok(!samePaths([api, api], [api, web]));
    await assert.rejects(scanRequirements(path.join(temporary, 'missing')), { code: 'ENOENT' });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
