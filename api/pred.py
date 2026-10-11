"""Vercel serverless proxy untuk lookup reward PRED Gift Box.

Kenapa ada file ini:
    Browser yang tidak bisa menjangkau www.pred.app secara langsung (pemblokiran
    DNS/ISP, ad-blocker, atau CSP) tetap bisa memakai tool ini, karena request
    keluar dari server Vercel, bukan dari perangkat pengunjung.

Route:  /api/pred

    GET /api/pred
        -> { "id": "<campaign_id>", "name": "...", "end_date": "..." }

    GET /api/pred?wallet_address=0x...
        -> { "eligible": true, "tier": "Tier 1", "reward_value": "200", "reward_type": "USD" }

    GET /api/pred?campaign_id=<id>&wallet_address=0x...
        -> sama, tanpa perlu lookup campaign aktif lagi

Read-only. Tidak ada autentikasi, tidak menyimpan apa pun.
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

PRED = "https://www.pred.app"
TIMEOUT = 20
UA = "pred-giftbox-checker/1.0 (+https://github.com/BADAKKAKITIGA/pred-giftbox-checker)"


def _pred_get(path):
    """GET ke pred.app, balikin (status, payload)."""
    req = urllib.request.Request(
        PRED + path,
        headers={"Accept": "application/json", "Origin": PRED, "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read().decode("utf-8", "replace")
        return resp.status, json.loads(raw)


def _active_campaign_id():
    _, data = _pred_get("/api/v1/campaigns/active")
    camps = (data or {}).get("campaigns") or []
    if not camps:
        raise RuntimeError("tidak ada campaign aktif")
    return camps[0]["id"]


class handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ---------- helpers ----------

    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # jangan spam log Vercel
        pass

    # ---------- routes ----------

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        address = (params.get("wallet_address") or [""])[0].strip()
        campaign = (params.get("campaign_id") or [""])[0].strip()

        try:
            if not address:
                _, data = _pred_get("/api/v1/campaigns/active")
                camps = (data or {}).get("campaigns") or []
                if not camps:
                    return self._send(502, {"error": "tidak ada campaign aktif di pred.app"})
                c = camps[0]
                return self._send(200, {
                    "id": c["id"],
                    "name": c.get("name", ""),
                    "end_date": c.get("end_date", ""),
                })

            cid = campaign or _active_campaign_id()
            path = "/api/v1/campaigns/%s/reward-eligibility?wallet_address=%s" % (
                urllib.parse.quote(cid, safe=""),
                urllib.parse.quote(address, safe=""),
            )
            _, data = _pred_get(path)
            return self._send(200, data)

        except urllib.error.HTTPError as e:
            return self._send(502, {"error": "pred.app balas HTTP %s" % e.code})
        except urllib.error.URLError as e:
            return self._send(502, {"error": "tidak bisa menjangkau pred.app: %s" % e.reason})
        except Exception as e:  # noqa: BLE001 - laporkan apa adanya
            return self._send(502, {"error": "%s: %s" % (type(e).__name__, e)})
