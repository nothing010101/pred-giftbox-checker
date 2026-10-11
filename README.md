# pred-giftbox-checker

Bulk checker for the **PRED ($100K Gift Box / Surprise Box)** wallet reward eligibility — the "Check Now" form on pred.app, but for hundreds of addresses at once.

Read-only. No login, no API key, no wallet connection required.

## What it checks

The banner's `Check Now` button calls a **public, unauthenticated** endpoint:

```
GET https://www.pred.app/api/v1/campaigns/{campaign_id}/reward-eligibility?wallet_address=0x...
```

Response:

```json
{ "eligible": true, "tier": "Tier 1", "reward_value": "200", "reward_type": "USD" }
```

The campaign id is resolved automatically from `GET /api/v1/campaigns/active`
(currently `1b48ffb5-cc02-4663-95aa-de7c863ecd92` — "Double Your 1st Win").

> Note: `mainnet.pred.app` (the base URL hardcoded in the web bundle) does not resolve
> publicly. The API is reachable through the `www.pred.app/api/...` reverse proxy, which is
> what this script uses.

## Usage

```bash
# Plain list, one address per line
python3 pred_giftbox_check.py addresses.txt

# CSV input (auto-detects the address column, or name it explicitly)
python3 pred_giftbox_check.py wallets.csv --column address

# Inline
python3 pred_giftbox_check.py --addresses 0xaaa...,0xbbb...

# Tuning
python3 pred_giftbox_check.py addresses.txt --out results.csv --workers 8
```

Output is a CSV (`address, eligible, tier, reward_value, reward_type, status, note`) written to
`files/pred_giftbox_results_<timestamp>.csv` by default, plus a summary on stdout: eligible count,
tier breakdown, total reward value, error count.

## Behaviour

- Validates EVM format (`^0x[a-fA-F0-9]{40}$`) and skips invalid lines (reported at the end).
- De-duplicates case-insensitively, preserving input order in the output.
- Concurrent requests (default 6 workers) with retry + backoff on `429`/`5xx`.
- ~18 requests/sec observed: 60 addresses in ~3.4s, so 500 addresses in roughly 30s.

## Sample output

| address | eligible | tier | reward_value |
|---|---|---|---|
| `0xd8dA…6045` | True | Tier 3 | 50 |
| `0x0000…dEaD` | True | Tier 1 | 200 |
| `0x4200…0006` | True | Tier 1 | 200 |
| *60 random addresses* | False | – | – |

Eligibility is based on on-chain wallet history — addresses with no history come back
`eligible: false`, so the result is meaningful rather than random.

## Scope / responsible use

This tool only **reads** eligibility. It does not register, authenticate, or claim anything.

Mass-claiming rewards across hundreds of wallets is where the account risk sits — PRED's terms
are one account per person, and reward farming across wallets can get every address involved
blacklisted, including ones holding real balances. Check freely; claim carefully.

## Requirements

Python 3.8+. Standard library only — no dependencies.
