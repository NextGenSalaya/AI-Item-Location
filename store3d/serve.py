"""Local server for the 3D store viewer: python serve.py [port]
Like `python -m http.server`, but tells the browser to re-check files, so edits show up on a plain refresh,
and serves the AI shopping-list planner at POST /api/plan (needs ANTHROPIC_API_KEY, see ai_planner.py).
Listens on this computer only (127.0.0.1), since the AI endpoint spends API credit."""
import json
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/api/review":       # category review page (review.html) saves the answers here
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                answers = {str(k)[:200]: v for k, v in dict(req.get("answers", {})).items()
                           if isinstance(v, dict) and v.get("action") in ("ok", "move")}
            except (ValueError, TypeError, AttributeError):
                return self._json(400, {"error": "bad request"})
            (here / "data" / "review_answers.json").write_text(json.dumps(answers, ensure_ascii=False, indent=1), encoding="utf-8")
            return self._json(200, {"saved": len(answers)})
        if self.path != "/api/plan":
            return self._json(404, {"error": "not found"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            text = str(req.get("request", "")).strip()[:500]
            mode = "restock" if req.get("shop") == "restock" else "new"
        except (ValueError, TypeError):
            return self._json(400, {"error": "คำขอไม่ถูกต้อง"})
        if not text:
            return self._json(400, {"error": "กรุณาพิมพ์ประเภทร้านหรือธุรกิจ"})
        try:
            import anthropic
            import ai_planner
        except ImportError:
            return self._json(503, {"error": "ยังไม่ได้ติดตั้ง anthropic: python -m pip install anthropic"})
        t0 = time.time()
        try:
            result = ai_planner.plan_auto(text, mode)
        except anthropic.AuthenticationError:
            return self._json(503, {"error": "API key ไม่ถูกต้อง ตรวจสอบ ANTHROPIC_API_KEY", "setup": True})
        except anthropic.RateLimitError:
            return self._json(429, {"error": "มีการใช้งานถี่เกินไป ลองใหม่อีกสักครู่"})
        except anthropic.APIConnectionError:
            return self._json(502, {"error": "เชื่อมต่อ Claude API ไม่ได้ ตรวจสอบอินเทอร์เน็ต"})
        except anthropic.APIStatusError as e:
            return self._json(502, {"error": f"Claude API ตอบกลับผิดพลาด ({e.status_code})"})
        except ValueError as e:
            return self._json(422, {"error": str(e)})
        except Exception as e:   # incl. the SDK's TypeError when no credentials are configured at all
            if "authentication method" in str(e):
                return self._json(503, {"error": "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บนเครื่องนี้", "setup": True})
            print("/api/plan failed:", repr(e), flush=True)
            return self._json(500, {"error": f"เกิดข้อผิดพลาด: {type(e).__name__}"})
        result["seconds"] = round(time.time() - t0, 1)
        print(f"/api/plan {text!r}: {len(result['needs'])} needs, {result.get('searches', 0)} searches, "
              f"{result.get('mode')} {result.get('usage', '')}, {result['seconds']}s", flush=True)
        return self._json(200, result)


here = Path(__file__).parent
sys.path.insert(0, str(here))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f"Serving on http://localhost:{port}")
ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(here))).serve_forever()

