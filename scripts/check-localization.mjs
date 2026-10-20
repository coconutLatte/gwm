import * as fs from 'node:fs/promises';
import * as assert from 'node:assert/strict';
import ts from 'typescript';

export async function checkLocalization() {
  const keys = new Set();
  for (const name of await fs.readdir('src')) {
    if (!name.endsWith('.ts')) continue;
    const source = ts.createSourceFile(name, await fs.readFile(`src/${name}`, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
        assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), `Use a literal localization key: ${name}`);
        keys.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const manifestKeys = [...new Set(JSON.stringify(manifest).match(/%[^%]+%/g))].map(key => key.slice(1, -1)).sort();
  const english = JSON.parse(await fs.readFile('package.nls.json', 'utf8'));
  assert.deepEqual(Object.keys(english).sort(), manifestKeys, 'Manifest localization keys must match');
  for (const name of await fs.readdir('l10n')) {
    if (!/^bundle\.l10n\..+\.json$/.test(name)) continue;
    const bundle = JSON.parse(await fs.readFile(`l10n/${name}`, 'utf8'));
    assert.deepEqual(Object.keys(bundle).sort(), [...keys].sort(), `Missing or unused strings in ${name}`);
    for (const [key, value] of Object.entries(bundle)) {
      assert.ok(typeof value === 'string' && value.trim(), `Empty translation: ${key}`);
      const placeholders = text => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
      assert.deepEqual(placeholders(value), placeholders(key), `Placeholder mismatch: ${key}`);
    }
    const locale = name.slice('bundle.l10n.'.length, -'.json'.length);
    const localizedManifest = JSON.parse(await fs.readFile(`package.nls.${locale}.json`, 'utf8'));
    assert.deepEqual(Object.keys(localizedManifest).sort(), manifestKeys, `Missing manifest translations for ${locale}`);
  }
  console.log(`Localization checked: ${keys.size} runtime strings and ${manifestKeys.length} manifest strings.`);
}
