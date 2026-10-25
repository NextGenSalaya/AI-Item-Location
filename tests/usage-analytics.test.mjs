import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/usage-analytics.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
function browser(href) {
  const scripts = [];
  const context = {
    URL, window: { location: { href } },
    document: { createElement: () => ({}), head: { appendChild: s => scripts.push(s) } }
  };
  return {context, scripts, run: () => runInNewContext(source, context)};
}

test('Usage tracking is limited to the exact production app, not previews or other projects', () => {
  for (const url of ['http://localhost:8765/', 'http://127.0.0.1:8767/',
    'https://example.com/AI-Item-Location/', 'https://nextgensalaya.github.io/other/',
    'https://nextgensalaya.github.io/AI-Item-Location-copy/',
    'http://nextgensalaya.github.io/AI-Item-Location/']) {
    const b = browser(url); b.run();
    assert.equal(b.scripts.length, 0);
    assert.equal(b.context.window.dataLayer, undefined);
  }
});

test('Production reports one page load with canonical URL and no search/referrer details', () => {
  assert.equal((html.match(/src="\.\/usage-analytics.js"/g) || []).length, 1);
  for (const suffix of ['?q=private-search#barcode', 'index.html']) {
    const b = browser('https://nextgensalaya.github.io/AI-Item-Location/' + suffix);
    b.run(); b.run();
    assert.equal(b.scripts.length, 1);
    assert.equal(b.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-3G89YCPEFP');
    assert.equal(b.scripts[0].async, true);
    assert.equal(b.scripts[0].referrerPolicy, 'no-referrer');
    const calls = b.context.window.dataLayer.map(args => Array.from(args));
    assert.equal(calls.length, 2);
    assert.equal(calls[1][0], 'config');
    assert.equal(calls[1][1], 'G-3G89YCPEFP');
    const config = calls[1][2];
    assert.equal(config.page_location, 'https://nextgensalaya.github.io/AI-Item-Location/');
    assert.equal(config.page_referrer, '');
    assert.equal(config.allow_google_signals, false);
    assert.equal(config.allow_ad_personalization_signals, false);
    assert.ok(!JSON.stringify(calls).includes('private-search'));
  }
});
