#!/usr/bin/env python3
"""
PRED Gift Box ($100K Surprise Box) — bulk wallet eligibility checker.

Queries the public endpoint used by the "Surprise Box -> Check Now" form:
    GET https://www.pred.app/api/v1/campaigns/{campaign_id}/reward-eligibility?wallet_address=0x...

No login / no auth token required. Read-only.

Usage:
    python3 pred_giftbox_check.py addresses.txt
    python3 pred_giftbox_check.py addresses.csv --column address
    python3 pred_giftbox_check.py --addresses 0xaaa...,0xbbb...
    python3 pred_giftbox_check.py addresses.txt --out results.csv --workers 8

Output: CSV with one row per address + a printed summary.
"""

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API_BASE = "https://www.pred.app"
ACTIVE_CAMPAIGNS = "/api/v1/campaigns/active"
ELIGIBILITY = "/api/v1/campaigns/{cid}/reward-eligibility?wallet_address={addr}"

EVM_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
HEADERS = {
    "Accept": "application/json",
    "Origin": API_BASE,
    "Referer": API_BASE + "/",
    "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
}


def http_get(path, timeout=25, retries=3):
    """GET with retry/backoff. Returns (status, parsed_json_or_text)."""
    url = API_BASE + path
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", "replace")
                try:
                    return resp.status, json.loads(raw)
                except json.JSONDecodeError:
                    return resp.status, raw
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            last = f"HTTP {e.code}: {body}"
            if e.code == 429 or 500 <= e.code < 600:
                time.sleep(1.5 * (attempt + 1))
                continue
            return e.code, last
        except Exception as e:  # noqa: BLE001 - network layer, report as-is
            last = f"{type(e).__name__}: {e}"
            time.sleep(1.0 * (attempt + 1))
    return 0, last or "unknown error"


def resolve_campaign_id(explicit=None):
    if explicit:
        return explicit
    status, data = http_get(ACTIVE_CAMPAIGNS)
    if status != 200 or not isinstance(data, dict):
        raise SystemExit(f"Gagal ambil campaign aktif ({status}): {data}")
    camps = data.get("campaigns") or []
    if not camps:
        raise SystemExit("Tidak ada campaign aktif.")
    return camps[0]["id"]


def load_addresses(path=None, column=None, inline=None):
    raw = []
    if inline:
        raw.extend(inline.split(","))
    if path:
        if not os.path.exists(path):
            raise SystemExit(f"File tidak ditemukan: {path}")
        if path.lower().endswith(".csv"):
            with open(path, newline="", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                if column and reader.fieldnames and column in reader.fieldnames:
                    raw.extend(r[column] for r in reader)
                elif reader.fieldnames:
                    # auto-pick the first column that looks like an address column
                    guess = next(
                        (c for c in reader.fieldnames if "addr" in c.lower() or "wallet" in c.lower()),
                        reader.fieldnames[0],
                    )
                    raw.extend(r[guess] for r in reader)
                else:
                    f.seek(0)
                    raw.extend(line.strip() for line in f)
        else:
            with open(path, encoding="utf-8-sig") as f:
                raw.extend(line.strip() for line in f)

    seen, valid, invalid = set(), [], []
    for item in raw:
        a = (item or "").strip()
        if not a or a.startswith("#"):
            continue
        if EVM_RE.match(a):
            k = a.lower()
            if k not in seen:
                seen.add(k)
                valid.append(a)
        else:
            invalid.append(a)
    return valid, invalid


def check_one(cid, address):
    path = ELIGIBILITY.format(cid=cid, addr=urllib.parse.quote(address))
    status, data = http_get(path)
    row = {"address": address}
    if status == 200 and isinstance(data, dict):
        row["eligible"] = data.get("eligible")
        row["tier"] = data.get("tier")
        row["reward_value"] = data.get("reward_value")
        row["reward_type"] = data.get("reward_type")
        row["status"] = "ok"
        row["note"] = ""
    else:
        row.update(eligible="", tier="", reward_value="", reward_type="", status=f"error:{status}", note=str(data))
    return row


def main():
    ap = argparse.ArgumentParser(description="PRED Surprise Box bulk wallet checker")
    ap.add_argument("input", nargs="?", help="File .txt / .csv berisi alamat EVM")
    ap.add_argument("--addresses", help="Daftar alamat dipisah koma")
    ap.add_argument("--column", help="Nama kolom alamat kalau input CSV")
    ap.add_argument("--campaign-id", help="Override campaign id (default: campaign aktif)")
    ap.add_argument("--out", default=None, help="Path CSV output")
    ap.add_argument("--workers", type=int, default=6, help="Jumlah request paralel (default 6)")
    args = ap.parse_args()

    addresses, invalid = load_addresses(args.input, args.column, args.addresses)
    if not addresses:
        raise SystemExit("Tidak ada alamat EVM valid yang ditemukan.")

    cid = resolve_campaign_id(args.campaign_id)
    print(f"Campaign id : {cid}")
    print(f"Alamat valid: {len(addresses)}" + (f"  | dilewati (format salah): {len(invalid)}" if invalid else ""))

    rows, done = [], 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(check_one, cid, a): a for a in addresses}
        for fut in as_completed(futures):
            rows.append(fut.result())
            done += 1
            if done % 25 == 0 or done == len(addresses):
                print(f"  {done}/{len(addresses)} ...", flush=True)

    order = {a.lower(): i for i, a in enumerate(addresses)}
    rows.sort(key=lambda r: order.get(r["address"].lower(), 0))

    out = args.out or os.path.join("files", f"pred_giftbox_results_{int(time.time())}.csv")
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    fields = ["address", "eligible", "tier", "reward_value", "reward_type", "status", "note"]
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    ok = [r for r in rows if r["status"] == "ok"]
    elig = [r for r in ok if r["eligible"] is True]
    errs = [r for r in rows if r["status"] != "ok"]
    tiers = {}
    total = 0.0
    for r in elig:
        tiers[r["tier"] or "unknown"] = tiers.get(r["tier"] or "unknown", 0) + 1
        try:
            total += float(r["reward_value"])
        except (TypeError, ValueError):
            pass

    print("\n===== RINGKASAN =====")
    print(f"Total dicek      : {len(rows)}")
    print(f"Eligible         : {len(elig)}")
    print(f"Tidak eligible   : {len(ok) - len(elig)}")
    print(f"Error/gagal      : {len(errs)}")
    print(f"Total reward USD : ${total:,.2f}")
    for t, n in sorted(tiers.items()):
        print(f"  {t}: {n}")
    if invalid:
        print(f"Dilewati (bukan EVM): {len(invalid)} -> {invalid[:5]}{' ...' if len(invalid) > 5 else ''}")
    print(f"Durasi           : {time.time() - t0:.1f}s")
    print(f"Output CSV       : {out}")

    print(json.dumps({"type": "generated_file", "path": os.path.abspath(out), "name": os.path.basename(out)}))


if __name__ == "__main__":
    main()
