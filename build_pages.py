"""Build the customer-facing GitHub Pages site with Python 3.10+; no API calls."""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'store3d'
OUTPUT = ROOT / 'dist'
sys.path.insert(0, str(SOURCE))
from ai_planner import plan_kit
from starter_kits import KITS

def build():
    OUTPUT.mkdir(exist_ok=True)
    # Allowlist customer-facing data. Never publish Python, secrets or review inputs.
    data = OUTPUT / 'data'
    data.mkdir(exist_ok=True)
    for name in ('store.json', 'thumbs.json', 'floor.png', 'footprint.png', 'i18n-ui.json', 'i18n-cats.json', 'i18n-kits.json', 'names-en.json'):
        shutil.copy2(SOURCE / 'data' / name, data / name)
    (data / 'details').mkdir(exist_ok=True)
    for number in range(100):
        name = f'{number:02}.json'
        json.loads((SOURCE / 'data' / 'details' / name).read_text(encoding='utf-8'))
        shutil.copy2(SOURCE / 'data' / 'details' / name, data / 'details' / name)
    catalog = {
        'kits': [{'name': name, 'match': kit['match']} for name, kit in KITS.items()],
        'plans': {name: {mode: plan_kit(name, mode) for mode in ('new', 'restock')} for name in KITS},
    }
    store = json.loads((data / 'store.json').read_text(encoding='utf-8'))
    valid_items = {(r[0], r[3]) for r in store['items']}
    for modes in catalog['plans'].values():
        for mode, plan in modes.items():
            assert plan['needs'], 'Empty starter list'
            for need in plan['needs']:
                assert mode != 'restock' or need['kind'] != 'equip'
                assert all((o['item_no'], o['location']) in valid_items for o in need['options'])
    (data / 'starter-plans.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    html = (SOURCE / 'index.html').read_text(encoding='utf-8')
    old = """    const res = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: text, shop: ai.shop }) });
    const out = await res.json().catch(() => ({ error: 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ' }));
    if (!res.ok) { ai.error = out.error || `ผิดพลาด (${res.status})`; ai.setup = !!out.setup; return; }"""
    assert html.count(old) == 1, 'Planner integration changed; update the static build'
    html = html.replace(old, "    const { planStarterList } = await import('./static-planner.mjs');\n    const out = await planStarterList(text, ai.shop);")
    html = html.replace("} catch {\n    ai.error = 'ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจว่าเปิดด้วย python store3d/serve.py';", "} catch (error) {\n    ai.error = error.message || 'โหลดชุดรายการไม่สำเร็จ กรุณาลองใหม่';")
    assert "fetch('/api/" not in html
    html = html.replace('<head>', '<head>\n<meta name="description" content="ค้นหาสินค้าและนำทางบนผัง 3D แม็คโคร สาขาศาลายา">', 1)
    html = html.replace('เช่น เปิดร้านก๋วยเตี๋ยว 100 ที่นั่ง', 'เช่น ร้านก๋วยเตี๋ยว หรือ ร้านกาแฟ')
    html = html.replace('เลือกประเภทร้าน ระบบจะจัดรายการให้', 'เลือกประเภทร้าน ระบบจะจัดชุดรายการตั้งต้นให้ (ปรับปริมาณตามการใช้งานจริง)')
    (OUTPUT / 'index.html').write_text(html, encoding='utf-8')
    shutil.copy2(SOURCE / 'static-planner.mjs', OUTPUT / 'static-planner.mjs')
    shutil.copy2(SOURCE / 'barcode-scanner.mjs', OUTPUT / 'barcode-scanner.mjs')
    (OUTPUT / 'vendor').mkdir(exist_ok=True)
    for name in ('zxing-library-0.21.3.min.js', 'ZXING-LICENSE', 'README.md'):
        shutil.copy2(SOURCE / 'vendor' / name, OUTPUT / 'vendor' / name)
    (OUTPUT / '.nojekyll').touch()
    print(f'Built {len(store["items"])} item rows; {len(KITS) * 2} starter plans; 100 detail files')

if __name__ == '__main__':
    build()
