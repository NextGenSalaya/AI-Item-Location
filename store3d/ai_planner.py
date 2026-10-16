"""AI shopping-list planner: turns "เปิดร้านก๋วยเตี๋ยว 100 ที่นั่ง" into a list of real items from this store.

Claude searches the store's own item data through a tool, then returns a structured list.
Every item it returns is checked against the data here, so nothing invented reaches the map.

Credentials: the Anthropic SDK reads ANTHROPIC_API_KEY (or an `ant auth login` profile).
"""
import json
import os
import re
from pathlib import Path

try:
    import anthropic
    from anthropic import beta_tool
except ImportError:
    anthropic = None
    # Static builds use only plan_kit and never call the external AI service.
    def beta_tool(function):
        return function

HERE = Path(__file__).parent
MODEL = "claude-opus-5-5"

_store = json.loads((HERE / "data" / "store.json").read_text(encoding="utf-8"))
_thumbs_path = HERE / "data" / "thumbs.json"
_titles = {k: v[0] for k, v in json.loads(_thumbs_path.read_text(encoding="utf-8")).items()} if _thumbs_path.exists() else {}


def _norm(s: str) -> str:
    """Lower-case and drop Thai tone marks (their order varies in the data)."""
    return re.sub(r"\s+", " ", re.sub("[็-์]", "", s.lower()))


ITEMS = [
    {"item_no": no, "name": desc, "barcode": bc, "location": loc, "bay": bay, "shelf": shelf,
     "_text": _norm(desc + " " + _titles.get(no, ""))}
    for no, desc, bc, loc, bay, shelf in (row[:6] for row in _store["items"])
]
_by_key = {(it["item_no"], it["location"]): it for it in ITEMS}
_by_no = {}
for it in ITEMS:
    if it["bay"] or it["item_no"] not in _by_no:
        _by_no[it["item_no"]] = it


def search(query: str, limit: int = 12) -> list[dict]:
    toks = [t for t in _norm(query).split(" ") if t]
    if not toks:
        return []
    hits = [it for it in ITEMS if all(t in it["_text"] for t in toks)]
    # on the map first, then the branch's own item name matching (not only the longer Makro PRO title), then shorter
    hits.sort(key=lambda it: (not it["bay"], not all(t in _norm(it["name"]) for t in toks), len(it["name"])))
    seen, out = set(), []
    for it in hits:
        if it["item_no"] in seen:
            continue
        seen.add(it["item_no"])
        out.append(it)
        if len(out) == limit:
            break
    return out


OWN_BRAND = re.compile(r"aro|เอโร่|savepak|save pak|เซพแพ็ค|เซฟแพ็ค|เซพแพค", re.I)   # Makro's own brands
is_own = lambda it: bool(OWN_BRAND.search(it["name"]))
_BRAND_PREFIX = re.compile(r"^[#\s]*(?:(?:aro|เอโร่|เอโร|savepak|save pak|เซพแพ็ค|เซฟแพ็ค|เซพแพค)[\s_\-/x]*)+(?:fz|n|r|gold|โกลด์)?[\s_\-]*", re.I)


def is_head(it, kw: str) -> bool:
    """The item *is* the thing searched for: its name (after any own-brand prefix, or after the
    first word = brand) starts with the keyword - not just mentions it (ketchup is not a tomato)."""
    k = _norm(kw)
    name = _norm(it["name"])
    words = name.split(" ")
    return (name.startswith(k) or _BRAND_PREFIX.sub("", name).startswith(k)
            or any(w.startswith(k) for w in words[1:2]))


def options_for(keywords: list[str], n: int = 3) -> list[dict]:
    """Up to n candidate items for one need: keywords tried in order, Makro own brands first within each keyword.
    A keyword may exclude words with a leading minus, e.g. "เตาแก๊ส -ปืน"."""
    out, seen = [], set()
    for kw in keywords:
        words = kw.split()
        inc = " ".join(w for w in words if not w.startswith("-"))
        exc = [_norm(w[1:]) for w in words if w.startswith("-")]
        hits = [it for it in search(inc, 40) if not any(e in _norm(it["name"]) for e in exc)]
        head = inc.split()[0] if inc else ""
        # on the map > really is the item > Makro own brand; stable sort keeps the search ranking inside
        hits.sort(key=lambda it: (not it["bay"], not is_head(it, head), not is_own(it)))
        for it in hits:
            if it["item_no"] not in seen:
                seen.add(it["item_no"]); out.append(it)
            if len(out) == n:
                return out
    return out


@beta_tool
def search_products(query: str) -> str:
    """Search this store's product list (Thai or English item names). Returns up to 12 matching items.

    Use short keywords (1-2 words) such as "เส้นเล็ก", "น้ำปลา", "ชามเมลามีน", "ถุงร้อน".
    All words must appear in the item name, so search again with fewer or different words if nothing comes back.

    Args:
        query: Keywords to look for in item names.
    """
    found = search(query)
    if not found:
        return json.dumps({"query": query, "results": [], "note": "no match - try a shorter or different keyword"},
                          ensure_ascii=False)
    return json.dumps({"query": query, "results": [
        {"item_no": it["item_no"], "name": it["name"], "location": it["location"],
         "on_map": bool(it["bay"])} for it in found]}, ensure_ascii=False)


SYSTEM = """You are a purchasing assistant at a wholesale store (Makro, Salaya branch). A customer describes a business they \
are opening or running, and you build a practical shopping list from items this branch actually stocks.

Work like this:
- List only the core items the business needs to open: main ingredients, essential seasonings, and the \
serving/take-away supplies it cannot run without. Leave out nice-to-haves.
- Find each need with search_products, using short Thai keywords (try a synonym or a shorter word when a search \
returns nothing). Only list items that a search returned, and copy item_no and location exactly.
- Prefer items with on_map = true and sizes that suit a business (bulk/catering packs).
- Prefer Makro's own brands (ARO / เอโร่, Savepak / เซพแพ็ค) when one fits the need.
- When the customer is restocking an existing shop, list only consumables (ingredients, packaging, cleaning
  supplies) - no equipment. When opening a new shop, also include the essential equipment.
- Aim for 10-15 items. Put needs you could not find in this branch into "missing".
- Write summary, reason and quantity in Thai. quantity is a short practical suggestion for a first purchase, \
scaled to the business size the customer gave."""

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "1-2 sentences in Thai about the list"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "item_no": {"type": "string"},
                    "location": {"type": "string"},
                    "reason": {"type": "string"},
                    "quantity": {"type": "string"},
                },
                "required": ["item_no", "location", "reason", "quantity"],
                "additionalProperties": False,
            },
        },
        "missing": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "items", "missing"],
    "additionalProperties": False,
}

_client = None


def plan(request: str) -> dict:
    """Run the planner. Returns {"summary", "items": [...], "missing", "usage"}; raises anthropic errors."""
    global _client
    if anthropic is None:
        raise RuntimeError("Install the anthropic package to use the optional Claude planner")
    _client = _client or anthropic.Anthropic()
    runner = _client.beta.messages.tool_runner(
        model=MODEL,
        max_tokens=16000,
        max_iterations=20,
        system=SYSTEM,
        tools=[search_products],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": request}],
    )
    final, searches, usage = None, 0, {"input_tokens": 0, "output_tokens": 0}
    for message in runner:
        final = message
        searches += sum(1 for b in message.content if b.type == "tool_use")
        usage["input_tokens"] += message.usage.input_tokens
        usage["output_tokens"] += message.usage.output_tokens
    if final is None or final.stop_reason == "refusal":
        raise ValueError("ไม่สามารถจัดรายการสำหรับคำขอนี้ได้ ลองอธิบายธุรกิจใหม่อีกครั้ง")
    if final.stop_reason == "max_tokens":
        raise ValueError("คำตอบยาวเกินไป ลองระบุธุรกิจให้แคบลง")
    text = next((b.text for b in final.content if b.type == "text"), "")
    data = json.loads(text)

    # keep only items that really exist here; repair a wrong location from the item number
    items, dropped = [], []
    for it in data["items"]:
        row = _by_key.get((it["item_no"], it["location"])) or _by_no.get(it["item_no"])
        if not row:
            dropped.append(it["item_no"])
            continue
        items.append({"item_no": row["item_no"], "location": row["location"], "name": row["name"],
                      "bay": row["bay"], "shelf": row["shelf"], "reason": it["reason"], "quantity": it["quantity"]})
    return {"summary": data["summary"], "items": items, "missing": data["missing"],
            "searches": searches, "dropped": dropped, "usage": usage, "model": final.model}


def has_credentials() -> bool:
    """True when the SDK can authenticate (API key / token in the environment, or an `ant auth login` profile)."""
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    return (Path.home() / ".config" / "anthropic").exists()


def _opt(it):
    return {"item_no": it["item_no"], "location": it["location"], "name": it["name"],
            "bay": it["bay"], "shelf": it["shelf"], "own": is_own(it)}


MODE_TEXT = {"new": "เปิดร้านใหม่", "restock": "เติมของร้านเดิม"}


def plan_kit(request: str, mode: str = "new") -> dict:
    """No-API list: the needs of a known kind of shop (starter_kits.py), each with up to 3 options from this
    branch (Makro own brands first). mode "new" includes equipment, "restock" only consumables."""
    from starter_kits import KITS, needs_for, pick_kit
    name = pick_kit(request)
    if not name:
        raise ValueError("ยังไม่มีชุดรายการสำหรับธุรกิจนี้ ลองพิมพ์ประเภทร้าน เช่น " + ", ".join(KITS))
    needs, missing = [], []
    for kind, what, keywords, qty, why in needs_for(name, mode):
        opts = options_for(keywords)
        if not opts:
            missing.append(what)
            continue
        needs.append({"what": what, "kind": kind, "quantity": qty, "reason": why, "options": [_opt(o) for o in opts]})
    own = sum(1 for n in needs if n["options"][0]["own"])
    return {"summary": f"{MODE_TEXT[mode]} · {name} {len(needs)} รายการ (Own Brand ARO / Savepak {own} รายการ)",
            "needs": needs, "missing": missing, "mode": "kit", "kit": name, "shop": mode}


def plan_auto(request: str, mode: str = "new") -> dict:
    """Claude when credentials are set up, otherwise the starter kit. Both return the same shape (needs + options)."""
    if not has_credentials():
        return plan_kit(request, mode)
    r = plan(f"{request}\n(ลูกค้า: {MODE_TEXT[mode]})")
    needs = [{"what": it["name"], "kind": "food", "quantity": it["quantity"], "reason": it["reason"],
              "options": [_opt(_by_key[(it["item_no"], it["location"])])]} for it in r["items"]]
    return {"summary": r["summary"], "needs": needs, "missing": r["missing"], "mode": "ai", "shop": mode,
            "usage": r["usage"], "searches": r["searches"]}


if __name__ == "__main__":     # check every starter kit against this branch's items (no API call)
    import sys
    from starter_kits import KITS
    for kit in (sys.argv[1:] or KITS):
        r = plan_kit(kit, "new")
        print(f"== {r['summary']} | missing {r['missing']}")
        for n in r["needs"]:
            o = n["options"]
            print(f"   [{n['kind']:<6}] {n['what']:<22} " + " || ".join(
                f"{x['name']}{' *' if x['own'] else ''}{'' if x['bay'] else ' (no map)'}" for x in o))
