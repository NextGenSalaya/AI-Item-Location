import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';
import { pickKit } from '../store3d/static-planner.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../dist/data/${name}`, import.meta.url), 'utf8'));
const catalog = read('starter-plans.json');
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

test('Every named business selects its own starter list', () => {
  for (const kit of catalog.kits) {
    assert.equal(pickKit(kit.name, catalog.kits), kit.name);
    assert.equal(pickKit(`เปิด${kit.name} 100 ที่นั่ง`, catalog.kits), kit.name);
  }
  assert.equal(pickKit('ธุรกิจที่ไม่รองรับ xyz', catalog.kits), null);
});

test('Longer keyword wins; equal-length matches retain catalog order', () => {
  const kits = [{name:'A',match:['ชา','coffee']},{name:'B',match:['ชานม','coffee']}];
  assert.equal(pickKit('เปิดชานม', kits), 'B');
  assert.equal(pickKit('coffee', kits), 'A');
});

test('All suggested products exist and restock excludes equipment', () => {
  const valid = new Set(read('store.json').items.map(r => JSON.stringify([r[0],r[3]])));
  for (const modes of Object.values(catalog.plans)) for (const [mode, plan] of Object.entries(modes)) {
    assert.ok(plan.needs.length);
    for (const need of plan.needs) {
      if (mode === 'restock') assert.notEqual(need.kind, 'equip');
      for (const option of need.options) assert.ok(valid.has(JSON.stringify([option.item_no,option.location])));
    }
  }
});

test('Static site has all assets and never posts to a localhost backend', () => {
  assert.ok(!html.includes("fetch('/api/"));
  assert.ok(html.includes("import('./static-planner.mjs')"));
  for (const file of ['floor.png','footprint.png','thumbs.json','store.json']) {
    assert.ok(existsSync(new URL(`../dist/data/${file}`, import.meta.url)));
  }
  for (let i=0;i<100;i++) read(`details/${String(i).padStart(2,'0')}.json`);
});

test('Inline modules parse without syntax errors', () => {
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  for (const [,script] of scripts) {
    assert.doesNotThrow(() => new SourceTextModule(script));
  }
});
