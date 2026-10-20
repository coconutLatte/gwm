import * as path from 'node:path';
import type { CommitReview, ReviewFile } from './commitReview';
import { t, languageTag } from './i18n';

const escape = (value: string): string => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

export function fileStatus(file: ReviewFile): 'M' | 'U' | 'D' | 'R' {
  if (file.status.startsWith('A') || file.status.startsWith('C')) return 'U';
  if (file.status.startsWith('D')) return 'D';
  if (file.status.startsWith('R')) return 'R';
  return 'M';
}

export function reviewHtml(review: CommitReview | undefined, session: string | undefined, nonce: string): string {
  const rows = review?.files.map((file, index) => {
    const status = fileStatus(file);
    const directory = path.posix.dirname(file.afterPath);
    const lines = file.additions === null ? t('Binary file') : t('{0} lines added, {1} lines deleted', file.additions, file.deletions ?? 0);
    const statusText = { M: t('Modified'), U: t('Added'), D: t('Deleted'), R: t('Renamed') }[status];
    const filename = file.status.startsWith('R') ? `${file.beforePath} → ${file.afterPath}` : file.afterPath;
    const title = `${t('{0}: {1}', statusText, filename)}\n${lines}\n${t('File mode {0} → {1}', file.beforeMode, file.afterMode)}`;
    return `<button type="button" class="file-row status-${status}" data-index="${index}" title="${escape(title)}" aria-label="${escape(t('{0} {1}, {2}, view diff', statusText, file.afterPath, lines))}">
      <span class="filename">${escape(path.posix.basename(file.afterPath))}</span>
      <span class="directory">${directory === '.' ? '' : escape(directory)}</span>
      <span class="file-lines">${file.additions === null ? escape(t('Binary')) : `<span class="added">+${file.additions}</span> <span class="removed">−${file.deletions}</span>`}</span>
      <span class="status" aria-hidden="true">${status}</span>
    </button>`;
  }).join('') ?? '';
  const content = review ? `
    <header title="${escape(review.repository)}">
      <div class="repository">${escape(path.basename(review.repository))}<span class="muted"> · ${escape(t('{0} commits · {1} files', review.commits.length, review.files.length))}</span></div>
      <div class="totals" aria-label="${escape(t('Total: {0} lines added, {1} lines deleted', review.stats.additions, review.stats.deletions))}">
        <strong class="added">+${review.stats.additions}</strong><strong class="removed">−${review.stats.deletions}</strong><span class="muted">${escape(t('lines'))}${review.stats.binaryFiles ? ` · ${escape(t('{0} binary files', review.stats.binaryFiles))}` : ''}</span>
      </div>
      <div class="scope muted">${escape(t('Selected commits only · Uncommitted changes excluded'))}</div>
    </header>
    <section class="files" aria-label="${escape(t('Commit Review files'))}">${rows || `<p class="empty">${escape(t('The selected commits have no net changes.'))}</p>`}</section>` : `
    <div class="welcome"><p>${escape(t('Select commits from one repository to review their combined net changes.'))}</p><p class="muted">${escape(t('Only selected commits are included. Uncommitted changes are excluded.'))}</p><button type="button" id="choose">${escape(t('Select repository and commits'))}</button></div>`;
  return `<!DOCTYPE html><html lang="${languageTag()}"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style nonce="${nonce}">
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
      header { padding: 10px 12px 8px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); }
      .repository { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .muted, .directory { color: var(--vscode-descriptionForeground); }
      .totals { display: flex; align-items: baseline; gap: 10px; margin-top: 6px; font-variant-numeric: tabular-nums; }
      .added { color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b); }
      .removed { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
      .scope { font-size: 11px; margin-top: 6px; }
      button { font: inherit; }
      .file-row { width: 100%; display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 12px; background: transparent; border: none; text-align: left; color: var(--vscode-foreground); cursor: pointer; }
      .file-row:hover { background: var(--vscode-list-hoverBackground); }
      .file-row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; background: var(--vscode-list-focusBackground); }
      .filename { flex: 0 1 auto; min-width: 30px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .directory { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
      .file-lines { margin-left: auto; flex: 0 0 auto; white-space: nowrap; font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
      .status { flex: 0 0 14px; text-align: center; font-size: 12px; }
      .status-M .filename, .status-M .status { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); }
      .status-U .filename, .status-U .status { color: var(--vscode-gitDecoration-untrackedResourceForeground, #73c991); }
      .status-D .filename, .status-D .status { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
      .status-D .filename { text-decoration: line-through; }
      .status-R .filename, .status-R .status { color: var(--vscode-gitDecoration-renamedResourceForeground, #73c991); }
      .empty, .welcome { padding: 8px 12px; }
      .welcome button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 6px 12px; cursor: pointer; width: 100%; }
      .welcome button:hover { background: var(--vscode-button-hoverBackground); }
      @media (max-width: 240px) { .file-lines { display: none; } }
    </style></head><body data-review-root data-session="${session ?? ''}">${content}
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const rows = Array.from(document.querySelectorAll('.file-row'));
      for (const row of rows) {
        row.addEventListener('click', () => vscode.postMessage({ type: 'open', session: document.body.dataset.session, index: Number(row.dataset.index) }));
        row.addEventListener('keydown', event => {
          const index = rows.indexOf(row);
          const target = event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : -1;
          if (target >= 0) { event.preventDefault(); rows[target].focus(); }
        });
      }
      document.getElementById('choose')?.addEventListener('click', () => vscode.postMessage({ type: 'choose' }));
    </script></body></html>`;
}
