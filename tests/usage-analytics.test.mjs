import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dist/usage-analytics.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
function browser(href) {
  const scripts = [];
  const timers = new Map(); let tid = 0;
  const context = {
    URL, window: { location: { href } },
    setTimeout: fn => { timers.set(++tid, fn); return tid; },
    clearTimeout: id => timers.delete(id),
    document: { createElement: () => ({}), head: { appendChild: s => scripts.push(s) } }
  };
  return {context, scripts, run: () => runInNewContext(source, context),
    tick: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(fn => fn()); }};
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

test('Language records initial choice and real changes, not repeated render calls', () => {
  const b = browser('https://nextgensalaya.github.io/AI-Item-Location/'); b.run();
  const a = b.context.window.makroUsage;
  a.language('th'); a.language('th'); a.language('unknown'); a.language('en');
  const events = b.context.window.dataLayer.filter(a => a[0] === 'event');
  assert.deepEqual(Array.from(events, a => a[2].ui_language), ['th', 'en']);
  assert.ok(events.every(a => a[1] === 'app_language'));
});

test('Search waits for settled input, deduplicates, counts unique products and flushes on selection', () => {
  const b = browser('https://nextgensalaya.github.io/AI-Item-Location/'); b.run();
  const a = b.context.window.makroUsage;
  a.catalog([['1', 'น้ำปลา ตรา A', '8851234567890'], ['2', 'น้ำปลา ตรา B', '8851234567891']]);
  a.language('th');
  a.search('น้ำ', ['1', '2']); a.search('น้ำปลา', ['1', '1', '2']);
  assert.equal(b.context.window.dataLayer.filter(a => a[1] === 'product_search').length, 0);
  a.select('1', 'น้ำปลา'); b.tick();
  a.search('น้ำปลา', ['1', '2']); b.tick(); a.select('1', 'น้ำปลา');
  const events = b.context.window.dataLayer.filter(a => a[0] === 'event');
  assert.deepEqual(Array.from(events, e => e[1]), ['app_language', 'product_search', 'product_search_select']);
  assert.equal(events[1][2].safe_search_term, 'น้ำปลา');
  assert.equal(events[1][2].result_count, 2);
  assert.equal(events[2][2].product_name, 'น้ำปลา ตรา A');
  a.search('น้ำปลา', ['1']); a.search('', []); b.tick();
  assert.equal(b.context.window.dataLayer.filter(a => a[1] === 'product_search').length, 1);
});

test('Search never sends arbitrary personal input or unknown numeric codes', () => {
  const b = browser('https://nextgensalaya.github.io/AI-Item-Location/'); b.run();
  const a = b.context.window.makroUsage;
  a.catalog([['1', 'น้ำปลา ตรา A', '8851234567890']]); a.english({'1': 'Fish Sauce Brand A'});
  a.language('en');
  for (const q of ['person@example.com', '0812345678', 'โทรหาสมชาย', 'น้ำปลา 0812345678']) { a.search(q, ['1']); b.tick(); }
  a.search('Fish Sauce', ['1']); b.tick();
  a.search('8851234567890', ['1']); b.tick();
  a.search('unmatched private text', []); b.tick();
  const serialized = JSON.stringify(b.context.window.dataLayer);
  for (const text of ['person@example.com', '0812345678', 'โทรหาสมชาย', '8851234567890', 'unmatched private text']) assert.ok(!serialized.includes(text));
  const events = b.context.window.dataLayer.filter(a => a[1] === 'product_search');
  assert.equal(events[4][2].safe_search_term, 'fish sauce');
  assert.equal(events[5][2].safe_search_term, 'น้ำปลา ตรา A');
  assert.equal(events[6][2].search_status, 'no_results');
});

test('Static build connects tracking to user actions without tracking render-time searches', () => {
  assert.ok(html.includes('window.makroUsage?.catalog(data.items)'));
  assert.ok(html.includes('window.makroUsage?.language(lang)'));
  assert.ok(html.includes("window.makroUsage?.search($('#q').value"));
  assert.ok(html.includes('search(state.q).includes(it)'));
  assert.ok(!html.includes('function search(q) {\n  window.makroUsage'));
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
