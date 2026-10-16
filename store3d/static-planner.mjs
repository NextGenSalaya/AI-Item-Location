// A deterministic starter-list planner for public static hosting. No API keys.
export function pickKit(request, kits) {
  const named = kits.filter(k => request.includes(k.name) || request.includes(k.name.replace('ร้าน', '')));
  if (named.length) return named.reduce((a, b) => b.name.length > a.name.length ? b : a).name;
  let best = null, length = 0;
  for (const kit of kits) for (const keyword of kit.match) {
    if (request.includes(keyword) && keyword.length > length) {
      best = kit.name; length = keyword.length;
    }
  }
  return best;
}

let catalogPromise;
export async function planStarterList(request, shop) {
  if (!catalogPromise) {
    catalogPromise = fetch(new URL('./data/starter-plans.json', import.meta.url))
      .then(r => { if (!r.ok) throw new Error('โหลดชุดรายการไม่สำเร็จ กรุณาลองใหม่'); return r.json(); })
      .catch(error => { catalogPromise = null; throw error; });
  }
  const catalog = await catalogPromise;
  const name = pickKit(String(request).trim().slice(0, 500), catalog.kits);
  if (!name) throw new Error('ยังไม่มีชุดรายการสำหรับธุรกิจนี้ ลองเลือกประเภทร้านที่แสดงด้านบน');
  const mode = shop === 'restock' ? 'restock' : 'new';
  return structuredClone(catalog.plans[name][mode]);
}
