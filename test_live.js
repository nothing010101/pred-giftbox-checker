/**
 * Tes integrasi nyata: halaman asli (index.html) + function Vercel asli (api/pred.py)
 * lewat dev_server.py, memanggil API pred.app yang sesungguhnya.
 *
 *   python3 dev_server.py 8765 &
 *   node test_live.js
 */
const fs = require("fs");
const { JSDOM } = require("jsdom");

const PORT = process.env.PORT || 8765;
const BASE = `http://127.0.0.1:${PORT}`;

const HTML = fs.readFileSync("/home/user/pred-giftbox-checker/index.html", "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
async function waitFor(fn, label, timeout = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return true; await sleep(50); }
  throw new Error("TIMEOUT: " + label);
}

const ADDRS = [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "0x000000000000000000000000000000000000dEaD",
  "0x4200000000000000000000000000000000000006",
];

(async () => {
  console.log("\n=== A. Proxy Vercel langsung (tanpa browser) ===");
  const r1 = await fetch(`${BASE}/api/pred`);
  const camp = await r1.json();
  check("GET /api/pred -> campaign id", r1.status === 200 && !!camp.id, camp);
  check("campaign punya nama", typeof camp.name === "string" && camp.name.length > 0, camp.name);

  const r2 = await fetch(`${BASE}/api/pred?campaign_id=${encodeURIComponent(camp.id)}&wallet_address=${ADDRS[0]}`);
  const elig = await r2.json();
  check("GET /api/pred?wallet_address -> hasil", r2.status === 200 && typeof elig.eligible === "boolean", elig);
  check("respons punya tier & reward_value", "tier" in elig && "reward_value" in elig, elig);
  check("header CORS ada", r2.headers.get("access-control-allow-origin") === "*");

  console.log("\n=== B. Halaman asli lewat proxy ===");
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously",
    url: BASE + "/",
    pretendToBeVisual: true,
    beforeParse(window) {
      // teruskan fetch ke server lokal yang sama (mengikuti perilaku browser)
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? new URL(input, BASE).href : input;
        return fetch(url, init);
      };
      window.navigator.clipboard = { writeText: async (t) => { window.__copied = t; } };
      window.URL.createObjectURL = () => "blob:stub";
      window.URL.revokeObjectURL = () => {};
      window.confirm = () => true;
      window.__blobs = [];
      const OrigBlob = window.Blob;
      window.Blob = function (parts, opts) {
        const b = new OrigBlob(parts, opts);
        window.__blobs.push(parts.join(""));
        return b;
      };
      window.HTMLAnchorElement.prototype.click = function () { window.__downloaded = this.download; };
    },
  });
  const w = dom.window, d = w.document;
  await sleep(200);

  check("mode terdeteksi proxy", /proxy Vercel/.test(d.getElementById("modeTag").textContent), d.getElementById("modeTag").textContent);

  d.getElementById("input").value = ADDRS.join("\n");
  d.getElementById("btnStart").click();
  await waitFor(
    () => d.getElementById("btnStart").textContent.trim() === "Cek Semua" && d.getElementById("cDone").textContent === "3",
    "selesai 3 alamat"
  );
  await sleep(200);

  const marks = [...d.querySelectorAll("#list .item .mark")].map((m) => m.textContent);
  const rows = d.querySelectorAll("#list .item");
  check("3 baris hasil", rows.length === 3, rows.length);
  check("tidak ada error (tidak ada ⚠️)", !marks.includes("⚠️"), marks);
  check("ada minimal 1 ✅", marks.includes("✅"), marks);
  check("ringkasan terisi", d.getElementById("sTotal").textContent === "3", d.getElementById("sTotal").textContent);
  check("total reward bukan $0", d.getElementById("sUsd").textContent !== "$0", d.getElementById("sUsd").textContent);

  const raw = JSON.parse(w.localStorage.getItem("pred_giftbox_v1") || "{}");
  check("3 hasil tersimpan", Object.keys(raw.results || {}).length === 3, Object.keys(raw.results || {}).length);

  console.log("\n=== C. Fallback ke koneksi langsung (proxy sengaja dimatikan) ===");
  const dom2 = new JSDOM(HTML, {
    runScripts: "dangerously",
    url: BASE + "/",
    pretendToBeVisual: true,
    beforeParse(window) {
      const direct = [];
      window.__direct = direct;
      window.fetch = (input, init) => {
        const u = typeof input === "string" ? input : input.url;
        // semua request ke /api/pred dibuat gagal seperti "Failed to fetch"
        if (u.startsWith("/api/pred")) return Promise.reject(new TypeError("Failed to fetch"));
        direct.push(u);
        return fetch(new URL(u, BASE).href, init);
      };
      window.navigator.clipboard = { writeText: async () => {} };
      window.URL.createObjectURL = () => "blob:stub";
      window.URL.revokeObjectURL = () => {};
    },
  });
  const w2 = dom2.window, d2 = w2.document;
  await sleep(200);
  d2.getElementById("input").value = ADDRS[0];
  d2.getElementById("btnStart").click();
  await waitFor(() => d2.getElementById("btnStart").textContent.trim() === "Cek Semua" && d2.getElementById("cDone").textContent === "1", "fallback selesai");
  await sleep(150);

  check("fallback memakai URL pred.app langsung", w2.__direct.some((u) => u.startsWith("https://www.pred.app/api/v1/campaigns/")), w2.__direct);
  check("tag mode berubah ke langsung", /langsung ke pred\.app/.test(d2.getElementById("modeTag").textContent), d2.getElementById("modeTag").textContent);
  check("hasil tetap didapat", d2.querySelectorAll("#list .item .mark").length === 1);

  console.log("\n========================================");
  console.log("  PASS: " + pass + "   FAIL: " + fail);
  console.log("========================================\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\nTEST ERROR:", e.message); process.exit(2); });
