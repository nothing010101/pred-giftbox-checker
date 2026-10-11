const fs = require("fs");
const { JSDOM } = require("jsdom");

const HTML = fs.readFileSync("/home/user/pred-giftbox-checker/index.html", "utf8");

const calls = [];

// dua alamat pertama & ketiga dianggap punya hadiah -> ekspektasi 2 eligible, 3 kosong
const ELIGIBLE = new Set();
const ok = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

function makeDom() {
  return new JSDOM(HTML, {
    runScripts: "dangerously",
    url: "https://tool.example.com/",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.isSecureContext = true;
      window.fetch = async (url) => {
        const u = String(url);
        calls.push(u);
        const abs = new URL(u, "https://tool.example.com/");
        if (!abs.searchParams.get("wallet_address")) {
          return ok({
            id: "CID-TEST",
            name: "Double Your 1st Win",
            campaigns: [{ id: "CID-TEST", name: "Double Your 1st Win" }],
          });
        }
        const addr = abs.searchParams.get("wallet_address");
        const eligible = ELIGIBLE.has(String(addr).toLowerCase());
        return ok({
          eligible,
          tier: eligible ? "Tier 1" : null,
          reward_value: eligible ? "200" : "0",
          reward_type: "USD",
        });
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
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(40);
  }
  throw new Error("TIMEOUT menunggu: " + label);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}

const ADDRS = [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // ends with 'd' -> eligible
  "0x1111111111111111111111111111111111111111", // not eligible
  "0x000000000000000000000000000000000000dEaD", // eligible
  "0x4200000000000000000000000000000000000006", // not
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // not
];

ELIGIBLE.add(ADDRS[0].toLowerCase());
ELIGIBLE.add(ADDRS[2].toLowerCase());

(async () => {
  console.log("\n=== 1. Boot & restore ===");
  const dom = makeDom();
  const w = dom.window, d = w.document;
  await sleep(120);
  check("textarea ada", !!d.getElementById("input"));
  check("tombol Cek Semua ada", !!d.getElementById("btnStart"));
  check("summary tersembunyi saat kosong", d.getElementById("summaryCard").hidden);

  console.log("\n=== 2. Jalankan pengecekan ===");
  d.getElementById("input").value = ADDRS.join("\n");
  d.getElementById("btnStart").click();
  await waitFor(() => d.getElementById("btnStart").textContent.trim() === "Cek Semua" && d.getElementById("cDone").textContent === "5", "selesai 5 alamat");
  await sleep(120);

  const eligCalls = () => calls.filter((c) => c.includes("wallet_address="));
  check("semua 5 alamat direquest", eligCalls().length === 5, eligCalls().length);
  check("pakai campaign id dari /campaigns/active", calls.some((c) => c.includes("CID-TEST")), calls.slice(0, 2));
  check("dipanggil lewat proxy same-origin", calls.every((c) => c.startsWith("/api/pred")), calls[0]);
  check("campaign_id diteruskan ke proxy", calls.some((c) => c.includes("campaign_id=CID-TEST")));

  const rows = d.querySelectorAll("#list .item");
  check("5 baris hasil tampil", rows.length === 5, rows.length);

  const marks = [...d.querySelectorAll("#list .item .mark")].map((m) => m.textContent);
  check("centang ✅ untuk yang ada hadiah", marks.filter((m) => m === "✅").length === 2, marks);
  check("silang ❌ untuk yang kosong", marks.filter((m) => m === "❌").length === 3, marks);

  check("baris eligible dapat class .ok", d.querySelectorAll("#list .item.ok").length === 2);
  check("ringkasan: dicek=5", d.getElementById("sTotal").textContent === "5", d.getElementById("sTotal").textContent);
  check("ringkasan: ada hadiah=2", d.getElementById("sHit").textContent === "2", d.getElementById("sHit").textContent);
  check("ringkasan: kosong=3", d.getElementById("sMiss").textContent === "3", d.getElementById("sMiss").textContent);
  check("ringkasan: total reward $400", d.getElementById("sUsd").textContent === "$400", d.getElementById("sUsd").textContent);
  check("chip Tier 1 tampil", /Tier 1/.test(d.getElementById("chips").textContent), d.getElementById("chips").textContent);

  console.log("\n=== 3. Tombol salin alamat ===");
  const copyBtn = d.querySelector("#list .item button.sm");
  copyBtn.click();
  await sleep(80);
  check("menyalin alamat yang benar", w.__copied === ADDRS[0], w.__copied);
  check("toast muncul", d.getElementById("toast").classList.contains("show"));

  console.log("\n=== 4. localStorage ===");
  const raw = w.localStorage.getItem("pred_giftbox_v1");
  check("tersimpan di localStorage", !!raw);
  const parsed = JSON.parse(raw || "{}");
  check("5 hasil tersimpan", Object.keys(parsed.results || {}).length === 5, Object.keys(parsed.results || {}).length);
  check("urutan alamat tersimpan", Array.isArray(parsed.order) && parsed.order.length === 5);
  check("campaign id tersimpan", parsed.campaignId === "CID-TEST", parsed.campaignId);
  check("input teks tersimpan", (parsed.input || "").includes(ADDRS[0]));

  console.log("\n=== 5. Filter ===");
  d.querySelector('#filters button[data-f="hit"]').click();
  await sleep(60);
  check("filter 'ada hadiah' -> 2 baris", d.querySelectorAll("#list .item").length === 2, d.querySelectorAll("#list .item").length);
  d.querySelector('#filters button[data-f="miss"]').click();
  await sleep(60);
  check("filter 'kosong' -> 3 baris", d.querySelectorAll("#list .item").length === 3, d.querySelectorAll("#list .item").length);
  d.querySelector('#filters button[data-f="all"]').click();
  await sleep(60);
  check("filter 'semua' -> 5 baris", d.querySelectorAll("#list .item").length === 5, d.querySelectorAll("#list .item").length);

  console.log("\n=== 6. Export CSV ===");
  d.getElementById("btnCsv").click();
  await sleep(80);
  const csv = (w.__blobs || []).join("");
  check("CSV dibuat", csv.length > 0);
  check("CSV punya header", csv.includes("address,eligible,tier,reward_value,reward_type,status,note"));
  check("CSV punya 5 baris data + header", csv.trim().split("\n").length === 6, csv.trim().split("\n").length);
  check("nama file CSV benar", /^pred_giftbox_\d{8}_\d{4}\.csv$/.test(w.__downloaded || ""), w.__downloaded);

  console.log("\n=== 7. Resume setelah refresh (skip yang sudah dicek) ===");
  const dom2 = makeDom();
  const w2 = dom2.window, d2 = w2.document;
  // pindahkan localStorage dari dom1 ke dom2
  w2.localStorage.setItem("pred_giftbox_v1", raw);
  dom2.window.location.reload && null;
  // boot ulang manual: buat dom baru lalu isi storage sebelum script jalan tidak mungkin,
  // jadi kita verifikasi lewat dom baru + reload
  const dom3 = makeDom();
  dom3.window.localStorage.setItem("pred_giftbox_v1", raw);
  await sleep(50);

  const dom4 = new JSDOM(HTML, {
    runScripts: "dangerously",
    url: "https://tool.example.com/",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.isSecureContext = true;
      window.localStorage.setItem("pred_giftbox_v1", raw);
      window.fetch = async (url) => {
        calls.push(String(url));
        const abs = new URL(String(url), "https://tool.example.com/");
        if (!abs.searchParams.get("wallet_address")) {
          return ok({ id: "CID-TEST", campaigns: [{ id: "CID-TEST" }] });
        }
        const addr = abs.searchParams.get("wallet_address");
        const eligible = ELIGIBLE.has(String(addr).toLowerCase());
        return ok({ eligible, tier: eligible ? "Tier 1" : null, reward_value: eligible ? "200" : "0", reward_type: "USD" });
      };
      window.navigator.clipboard = { writeText: async () => {} };
      window.URL.createObjectURL = () => "blob:stub";
      window.URL.revokeObjectURL = () => {};
    },
  });
  await sleep(150);
  const d4 = dom4.window.document;
  check("hasil dipulihkan setelah refresh", d4.querySelectorAll("#list .item").length === 5, d4.querySelectorAll("#list .item").length);
  check("ringkasan dipulihkan", d4.getElementById("sHit").textContent === "2", d4.getElementById("sHit").textContent);

  const before = calls.filter((c) => c.includes("wallet_address=")).length;
  d4.getElementById("btnStart").click();
  await sleep(900);
  const after = calls.filter((c) => c.includes("wallet_address=")).length;
  check("skip yang sudah dicek -> tidak ada request baru", after === before, { before, after });
  check("pesan 'sudah pernah dicek'", d4.getElementById("toast").textContent.includes("sudah pernah dicek"), d4.getElementById("toast").textContent);

  console.log("\n=== 8. Parse upload CSV ===");
  const dom5 = makeDom();
  const w5 = dom5.window, d5 = w5.document;
  await sleep(120);
  const csvText = "wallet_address,note\n" + ADDRS[0] + ",a\n" + ADDRS[1] + ",b\n";
  const fileInput = d5.getElementById("file");
  const file = new w5.File([csvText], "wallets.csv", { type: "text/csv" });
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  fileInput.dispatchEvent(new w5.Event("change"));
  await waitFor(() => d5.getElementById("input").value.length > 0, "CSV dimuat");
  const loaded = d5.getElementById("input").value.split("\n").filter(Boolean);
  check("kolom wallet_address terdeteksi", loaded.length === 2, loaded);
  check("header tidak ikut", loaded[0] === ADDRS[0], loaded[0]);

  console.log("\n=== 9. Alamat tidak valid dilewati ===");
  const dom6 = makeDom();
  const d6 = dom6.window.document;
  await sleep(120);
  d6.getElementById("input").value = [ADDRS[0], "0xdeadbeef", "bukan-alamat", ADDRS[0]].join("\n");
  d6.getElementById("btnStart").click();
  await waitFor(() => d6.getElementById("cDone").textContent === "1", "hanya 1 valid");
  check("duplikat & invalid dilewati -> 1 dicek", d6.getElementById("cDone").textContent === "1", d6.getElementById("cDone").textContent);
  check("peringatan baris dilewati", d6.getElementById("toast").textContent.includes("dilewati"), d6.getElementById("toast").textContent);

  console.log("\n========================================");
  console.log("  PASS: " + pass + "   FAIL: " + fail);
  console.log("========================================\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("\nTEST ERROR:", e.message); process.exit(2); });
