import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class DevTools {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.contexts = new Set();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.executionContextCreated') this.contexts.add(message.params.context.id);
      if (message.method === 'Runtime.executionContextDestroyed') this.contexts.delete(message.params.executionContextId);
      if (message.method === 'Runtime.executionContextsCleared') this.contexts.clear();
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) { this.pending.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); }
      }
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const client = new DevTools(socket); await client.send('Runtime.enable'); return client;
  }
  send(method, params = {}) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)); }, 3000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, contextId) {
    const result = await this.send('Runtime.evaluate', { expression, contextId, returnByValue: true });
    if (result.exceptionDetails) return undefined;
    return result.result.value;
  }
  close() { this.socket.close(); }
}

export async function checkReviewUi(port, fixture, locale = 'en') {
  const clients = new Map();
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      try { await fs.access(path.join(fixture, 'ui-ready')); break; } catch {}
      await delay(100);
    }
    let found;
    while (Date.now() < deadline && !found) {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => []);
      for (const target of targets.filter(target => target.webSocketDebuggerUrl && ['page', 'iframe'].includes(target.type))) {
        let client = clients.get(target.id);
        if (!client) { client = await DevTools.connect(target.webSocketDebuggerUrl); clients.set(target.id, client); }
        for (const context of client.contexts) {
          const result = await client.evaluate(`(() => {
            if (!document.body?.hasAttribute('data-review-root') || !document.querySelector('.totals')) return null;
            return { language: document.documentElement.lang, body: document.body.textContent, scope: document.querySelector('.scope').textContent,
              totalLabel: document.querySelector('.totals').getAttribute('aria-label'),
              totals: document.querySelector('.totals').textContent, rows: Array.from(document.querySelectorAll('.file-row')).map(row => ({
              name: row.querySelector('.filename').textContent, status: row.querySelector('.status').textContent,
              strike: getComputedStyle(row.querySelector('.filename')).textDecorationLine,
              color: getComputedStyle(row.querySelector('.status')).color,
              lines: row.querySelector('.file-lines').textContent,
            })), icons: document.querySelectorAll('.codicon, img, svg').length };
          })()`, context).catch(() => undefined);
          if (result) { found = { client, context, result }; break; }
        }
        if (found) break;
      }
      if (!found) await delay(100);
    }
    assert.ok(found, 'Review webview did not render in VS Code');
    const { client, context, result } = found;
    assert.match(result.totals, /\+3/); assert.match(result.totals, /−4/);
    assert.equal(result.language, locale === 'zh-cn' ? 'zh-CN' : 'en');
    assert.equal(result.scope, locale === 'zh-cn' ? '仅勾选提交 · 不含未提交改动' : 'Selected commits only · Uncommitted changes excluded');
    assert.equal(result.totalLabel, locale === 'zh-cn' ? '总计增加 3 行，删除 4 行' : 'Total: 3 lines added, 4 lines deleted');
    if (locale !== 'zh-cn') assert.doesNotMatch(result.body, /[\u4e00-\u9fff]/, 'English/fallback UI contains untranslated Chinese');
    assert.deepEqual(result.rows.map(row => [row.name, row.status]), [['aggregate.txt', 'M'], ['deleted.txt', 'D'], ['new.txt', 'U']]);
    assert.equal(result.rows[1].strike, 'line-through'); assert.equal(result.rows[0].strike, 'none');
    assert.equal(result.icons, 0);
    assert.notEqual(result.rows[0].color, result.rows[1].color);
    assert.notEqual(result.rows[1].color, result.rows[2].color);
    // Capture the actual VS Code window for visual review; no user profile is opened in this run.
    for (const candidate of clients.values()) {
      try {
        const screenshot = await candidate.send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(path.join(fixture, 'review-ui.png'), Buffer.from(screenshot.data, 'base64')); break;
      } catch {}
    }
    await client.evaluate(`document.querySelector('.status-D').click()`, context);
    await fs.writeFile(path.join(fixture, 'ui-result.json'), JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    await fs.writeFile(path.join(fixture, 'ui-result.json'), JSON.stringify({ ok: false, error: error.message }));
    throw error;
  } finally { for (const client of clients.values()) client.close(); }
}
