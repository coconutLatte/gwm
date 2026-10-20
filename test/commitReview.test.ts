import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CommitReview, listCommits } from '../src/commitReview';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'commit-review-test-'));
  const repository = path.join(root, 'repo with spaces');
  await fs.mkdir(repository);
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
  git('init', '-b', 'feat/review');
  git('config', 'user.name', 'Review Test'); git('config', 'user.email', 'review@example.invalid');
  const write = (name: string, content: string | Buffer) => fs.writeFile(path.join(repository, name), content);
  const commit = (message: string) => { git('add', '-A'); git('commit', '-m', message); return git('rev-parse', 'HEAD'); };
  const state = async () => ({
    head: git('rev-parse', 'HEAD'), refs: git('show-ref'), status: git('status', '--porcelain=v1', '-uall'),
    index: (await fs.readFile(path.join(repository, '.git/index'))).toString('base64'),
    diff: git('diff', '--binary'), staged: git('diff', '--cached', '--binary'),
    objects: git('count-objects', '-v'), worktrees: git('worktree', 'list', '--porcelain'),
  });
  return { root, repository, git, write, commit, state, dispose: () => fs.rm(root, { recursive: true, force: true }) };
}

test('selected nonadjacent commits exclude skipped changes, combine repeated edits and preserve source state', async () => {
  const f = await fixture();
  try {
    await f.write('shared.txt', 'first\n' + 'context\n'.repeat(20) + 'last\n');
    await f.write('skip.txt', 'base\n'); f.commit('base');
    await f.write('shared.txt', 'selected one\n' + 'context\n'.repeat(20) + 'last\n');
    const a = f.commit('selected first');
    await f.write('skip.txt', 'must be excluded\n');
    const skippedMiddle = 'context\n'.repeat(9) + 'must be excluded too\n' + 'context\n'.repeat(10);
    await f.write('shared.txt', 'selected one\n' + skippedMiddle + 'last\n');
    const skipped = f.commit('skip me');
    await f.write('shared.txt', 'selected one\n' + skippedMiddle + 'selected last\n');
    const c = f.commit('selected third');
    await f.write('shared.txt', 'staged local\n'); f.git('add', 'shared.txt');
    await f.write('shared.txt', 'unstaged local\n'); await f.write('untracked.txt', 'untouched\n');
    const before = await f.state();
    const log = await listCommits(f.repository, 2);
    assert.deepEqual(log.map(commit => commit.hash), [c, skipped]);
    assert.equal((await listCommits(f.repository, 2, 2))[0].hash, a);
    const review = await CommitReview.create(f.repository, [c, a, a]);
    try {
      assert.deepEqual(review.commits.map(commit => commit.hash), [c, a]);
      assert.deepEqual(review.files.map(file => file.afterPath), ['shared.txt']);
      assert.deepEqual(review.stats, { additions: 2, deletions: 2, binaryFiles: 0 });
      assert.equal((await review.readFile(review.files[0], 'before')).toString(), 'first\n' + 'context\n'.repeat(20) + 'last\n');
      assert.equal((await review.readFile(review.files[0], 'after')).toString(), 'selected one\n' + 'context\n'.repeat(20) + 'selected last\n');
      assert.deepEqual(await f.state(), before);
    } finally { await review.dispose(); }
  } finally { await f.dispose(); }
});

test('contiguous commits show net rename, deletion, binary and mode changes; root and empty net changes work', async () => {
  const f = await fixture();
  try {
    await f.write('old name 中文.txt', 'original\n'); await f.write('deleted.txt', 'remove\n');
    await f.write('mode.sh', 'echo test\n'); await f.write('image.bin', Buffer.from([0, 1, 2]));
    const root = f.commit('root');
    const rootReview = await CommitReview.create(f.repository, [root]);
    try {
      assert.ok(rootReview.files.every(file => file.status === 'A'));
      assert.deepEqual(rootReview.stats, { additions: 3, deletions: 0, binaryFiles: 1 });
      assert.equal((await rootReview.readFile(rootReview.files[0], 'before')).length, 0);
    } finally { await rootReview.dispose(); }
    f.git('mv', 'old name 中文.txt', 'new name 中文.txt');
    await fs.rm(path.join(f.repository, 'deleted.txt'));
    await fs.chmod(path.join(f.repository, 'mode.sh'), 0o755);
    await f.write('image.bin', Buffer.from([0, 4, 5]));
    const a = f.commit('rename and delete');
    await f.write('new-file.txt', 'new\n'); const b = f.commit('add');
    const review = await CommitReview.create(f.repository, [b, a]);
    try {
      const renamed = review.files.find(file => file.status.startsWith('R'))!;
      assert.equal(renamed.beforePath, 'old name 中文.txt'); assert.equal(renamed.afterPath, 'new name 中文.txt');
      assert.equal(renamed.additions, 0); assert.equal(renamed.deletions, 0);
      const deleted = review.files.find(file => file.status === 'D')!;
      assert.equal((await review.readFile(deleted, 'after')).length, 0);
      assert.equal(deleted.deletions, 1);
      const binary = review.files.find(file => file.afterPath === 'image.bin')!;
      assert.deepEqual(await review.readFile(binary, 'after'), Buffer.from([0, 4, 5]));
      assert.equal(binary.additions, null); assert.equal(binary.deletions, null);
      assert.deepEqual(review.stats, { additions: 1, deletions: 1, binaryFiles: 1 });
      const mode = review.files.find(file => file.afterPath === 'mode.sh')!;
      assert.equal(mode.beforeMode, '100644'); assert.equal(mode.afterMode, '100755');
    } finally { await review.dispose(); }
    await f.write('temporary.txt', 'temporary\n'); const add = f.commit('add temporary');
    await fs.rm(path.join(f.repository, 'temporary.txt')); const remove = f.commit('remove temporary');
    const empty = await CommitReview.create(f.repository, [add, remove]);
    try {
      assert.equal(empty.files.length, 0);
      assert.deepEqual(empty.stats, { additions: 0, deletions: 0, binaryFiles: 0 });
    } finally { await empty.dispose(); }
  } finally { await f.dispose(); }
});

test('a skipped dependency fails without changing the original repo; invalid selections are rejected', async () => {
  const f = await fixture();
  try {
    await f.write('file.txt', 'base\n'); f.commit('base');
    await f.write('selected.txt', 'selected\n'); const a = f.commit('independent');
    await f.write('file.txt', 'dependency\n'); f.commit('skipped dependency');
    await f.write('file.txt', 'dependent result\n'); const c = f.commit('dependent');
    const before = await f.state();
    await assert.rejects(CommitReview.create(f.repository, [a, c]), /Select the required commits/);
    await assert.rejects(CommitReview.create(f.repository, []), /at least/);
    await assert.rejects(CommitReview.create(f.repository, ['HEAD']), /Invalid/);
    await assert.rejects(CommitReview.create(f.repository, ['0'.repeat(40)]), /first-parent/);
    assert.deepEqual(await f.state(), before);
  } finally { await f.dispose(); }
});

test('merge commits use their first-parent changes', async () => {
  const f = await fixture();
  try {
    await f.write('base.txt', 'base\n'); f.commit('base'); f.git('checkout', '-b', 'side');
    await f.write('side.txt', 'merged\n'); f.commit('side commit'); f.git('checkout', 'feat/review');
    await f.write('main.txt', 'main\n'); f.commit('main commit'); f.git('merge', '--no-ff', 'side', '-m', 'merge side');
    const [merge] = await listCommits(f.repository);
    assert.equal(merge.parents.length, 2);
    const review = await CommitReview.create(f.repository, [merge.hash]);
    try { assert.deepEqual(review.files.map(file => file.afterPath), ['side.txt']); }
    finally { await review.dispose(); }
  } finally { await f.dispose(); }
});
