import { t } from './i18n';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ReviewCommit { hash: string; parents: string[]; date: string; author: string; subject: string }
export interface ReviewFile {
  status: string; beforePath: string; afterPath: string;
  beforeOid: string; afterOid: string; beforeMode: string; afterMode: string;
  additions: number | null; deletions: number | null;
}
export interface ReviewStats { additions: number; deletions: number; binaryFiles: number }

// Never inherit an index, worktree, object directory or repository override from a terminal.
const cleanEnvironment = (): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

async function git(repository: string, args: string[], input?: Buffer, extraEnv?: NodeJS.ProcessEnv): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-optional-locks', '-C', repository, ...args], {
      env: { ...cleanEnvironment(), ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error(t('Git timed out. Select fewer commits and try again.'))); }, 60000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 128 * 1024 * 1024) { child.kill(); reject(new Error(t('Commit content exceeds 128 MB. Select fewer commits.'))); }
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || t('Git exited with code {0}.', String(code))));
    });
    child.stdin.on('error', () => {}); // A rejected patch can close stdin before all bytes are consumed.
    child.stdin.end(input);
  });
}

export async function listCommits(repository: string, limit = 200, skip = 0): Promise<ReviewCommit[]> {
  const raw = (await git(repository, ['log', '--first-parent', `--max-count=${limit}`, `--skip=${skip}`, '-z',
    '--format=%H%x00%P%x00%aI%x00%an%x00%s', 'HEAD', '--'])).toString('utf8');
  const fields = raw.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const commits: ReviewCommit[] = [];
  for (let index = 0; index + 4 < fields.length; index += 5) {
    const [hash, parents, date, author, subject] = fields.slice(index, index + 5);
    commits.push({ hash, parents: parents ? parents.split(' ') : [], date, author, subject });
  }
  return commits;
}

function parseFiles(raw: Buffer): Omit<ReviewFile, 'additions' | 'deletions'>[] {
  const fields = raw.toString('utf8').split('\0');
  const files: Omit<ReviewFile, 'additions' | 'deletions'>[] = [];
  for (let index = 0; index < fields.length && fields[index];) {
    const header = /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([A-Z][0-9]*)$/.exec(fields[index++]);
    if (!header) throw new Error(t('Cannot parse Git file changes.'));
    const [, beforeMode, afterMode, beforeOid, afterOid, status] = header;
    const beforePath = fields[index++];
    const afterPath = /^[RC]/.test(status) ? fields[index++] : beforePath;
    files.push({ status, beforePath, afterPath, beforeOid, afterOid, beforeMode, afterMode });
  }
  return files;
}

function parseLineStats(raw: Buffer): Map<string, { additions: number | null; deletions: number | null }> {
  const fields = raw.toString('utf8').split('\0');
  const stats = new Map<string, { additions: number | null; deletions: number | null }>();
  for (let index = 0; index < fields.length && fields[index];) {
    const entry = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[index++]);
    if (!entry) throw new Error(t('Cannot parse Git line statistics.'));
    let filename = entry[3];
    if (!filename) { index++; filename = fields[index++]; } // -z rename: empty path, old path, new path.
    stats.set(filename, {
      additions: entry[1] === '-' ? null : Number(entry[1]),
      deletions: entry[2] === '-' ? null : Number(entry[2]),
    });
  }
  return stats;
}

export class CommitReview {
  private constructor(
    readonly repository: string, readonly commits: ReviewCommit[],
    readonly base: string, readonly result: string, readonly files: ReviewFile[],
    readonly stats: ReviewStats,
    private readonly temporary: string, private readonly environment: NodeJS.ProcessEnv,
  ) {}

  static async create(repository: string, hashes: readonly string[]): Promise<CommitReview> {
    if (!hashes.length) throw new Error(t('Select at least one commit.'));
    if (hashes.some(hash => !/^[a-f0-9]{40,64}$/i.test(hash))) throw new Error(t('Invalid commit ID.'));
    const history = await listCommits(repository, 1000000);
    const wanted = new Set(hashes);
    let selected = history.filter(commit => wanted.has(commit.hash));
    if (selected.length !== wanted.size) throw new Error(t('Selected commits are not on the current HEAD’s first-parent history. Select them again.'));
    const newest = history.indexOf(selected[0]);
    const oldest = history.indexOf(selected.at(-1)!);
    const format = (await git(repository, ['rev-parse', '--show-object-format'])).toString().trim();
    const objects = path.resolve(repository, (await git(repository, ['rev-parse', '--git-path', 'objects'])).toString().trim());
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-commit-review-'));
    // Git's quoted path syntax also handles object paths containing a path-list separator.
    const alternate = JSON.stringify(objects);
    const environment = {
      GIT_ALTERNATE_OBJECT_DIRECTORIES: alternate,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    };
    try {
      await git(temporary, ['init', '--bare', '--template=', `--object-format=${format}`, '.'], undefined, environment);
      const run = (args: string[], input?: Buffer) => git(temporary, args, input, environment);
      const first = selected.at(-1)!;
      const base = first.parents[0] ?? (await run(['hash-object', '-w', '-t', 'tree', '--stdin'], Buffer.alloc(0))).toString().trim();
      let result: string;
      if (oldest - newest + 1 === selected.length) {
        // Adjacent commits can be compared directly, including commits that cancel each other out.
        result = selected[0].hash;
      } else {
        await run(['read-tree', base]);
        for (const commit of [...selected].reverse()) {
          const parent = commit.parents[0] ?? base;
          const patch = await run(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-renames', parent, commit.hash, '--']);
          if (!patch.length) continue;
          try {
            await run(['apply', '--cached', '--3way', '--whitespace=nowarn', '-'], patch);
          } catch {
            throw new Error(t('Cannot combine {0} “{1}” independently. It may depend on unselected commits. Select the required commits and try again.', commit.hash.slice(0, 8), commit.subject));
          }
        }
        result = (await run(['write-tree'])).toString().trim();
      }
      const options = ['-z', '-M', '--no-ext-diff', '--no-textconv', base, result, '--'];
      const rawFiles = parseFiles(await run(['diff', '--raw', '--no-abbrev', ...options]));
      const lineStats = parseLineStats(await run(['diff', '--numstat', ...options]));
      const files = rawFiles.map(file => {
        const lines = lineStats.get(file.afterPath);
        if (!lines) throw new Error(t('Cannot get line statistics for {0}.', file.afterPath));
        return { ...file, ...lines };
      });
      const stats = files.reduce<ReviewStats>((sum, file) => ({
        additions: sum.additions + (file.additions ?? 0), deletions: sum.deletions + (file.deletions ?? 0),
        binaryFiles: sum.binaryFiles + (file.additions === null ? 1 : 0),
      }), { additions: 0, deletions: 0, binaryFiles: 0 });
      return new CommitReview(repository, selected, base, result, files, stats, temporary, environment);
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async readFile(file: ReviewFile, side: 'before' | 'after'): Promise<Buffer> {
    const oid = side === 'before' ? file.beforeOid : file.afterOid;
    const mode = side === 'before' ? file.beforeMode : file.afterMode;
    if (/^0+$/.test(oid)) return Buffer.alloc(0);
    if (mode === '160000') return Buffer.from(`Subproject commit ${oid}\n`);
    return git(this.temporary, ['cat-file', 'blob', oid], undefined, this.environment);
  }

  async dispose(): Promise<void> { await fs.rm(this.temporary, { recursive: true, force: true }); }
}
