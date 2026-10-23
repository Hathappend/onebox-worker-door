// Agen tunnel pintu Worker Onebox.
//
// Program kecil ini tinggal di VM yang sama dengan dashboard. Ia
// membuka satu sambungan WebSocket keluar (wss, lewat proxy egress
// bila ada) ke Cloudflare Worker di domain publik, lalu meneruskan
// setiap permintaan HTTP yang datang lewat sambungan itu ke dashboard
// lokal dan mengirim jawabannya kembali. Tidak ada port masuk yang
// dibuka: semua arah hubungan dimulai dari sini.

const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const { HttpsProxyAgent } = require("https-proxy-agent");

const berkas = path.join(__dirname, "config.json");
const config = fs.existsSync(berkas)
  ? JSON.parse(fs.readFileSync(berkas, "utf8"))
  : {};

// Variabel lingkungan menang atas berkas config (dipakai unit layanan
// dan pengujian lokal).
const TUNNEL_URL =
  process.env.TUNNEL_URL || config.tunnelUrl || "wss://onebox.ai.id/__tunnel";
const TOKEN = process.env.TUNNEL_TOKEN || config.token || "";
const LOCAL_ORIGIN =
  process.env.LOCAL_ORIGIN || config.localOrigin || "http://127.0.0.1:8787";

if (!TOKEN) {
  console.error("Token tunnel kosong. Isi TUNNEL_TOKEN atau config.json.");
  process.exit(1);
}

const BATAS_WAKTU_MS = 30000;
const CHUNK = 64 * 1024;

let ws = null;
let jedaSambung = 1000;
let pengaturPing = null;

function kirim(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function tanganiPesan(mentah) {
  let msg;
  try {
    msg = JSON.parse(mentah.toString());
  } catch {
    return;
  }
  if (msg.t === "pong") return;
  if (msg.t !== "req") return;
  teruskan(msg);
}

// Meneruskan satu permintaan ke dashboard lokal dan mengalirkan
// jawabannya kembali sebagai pesan res/chunk/end berkode base64.
function teruskan(msg) {
  const tujuan = new URL(msg.url, LOCAL_ORIGIN);
  const headers = {};
  for (const [nama, nilai] of msg.headers || []) {
    const kecil = nama.toLowerCase();
    if (kecil === "connection" || kecil === "keep-alive") continue;
    headers[nama] = nilai;
  }
  headers.host = tujuan.host;

  const req = http.request(
    tujuan,
    { method: msg.method, headers },
    (res) => {
      const pairs = [];
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        pairs.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
      }
      kirim({ t: "res", id: msg.id, status: res.statusCode, headers: pairs });
      let sisa = null;
      res.on("data", (potong) => {
        sisa = sisa ? Buffer.concat([sisa, potong]) : potong;
        while (sisa.length >= CHUNK) {
          kirim({
            t: "chunk",
            id: msg.id,
            dataB64: sisa.subarray(0, CHUNK).toString("base64"),
          });
          sisa = sisa.subarray(CHUNK);
        }
      });
      res.on("end", () => {
        if (sisa && sisa.length) {
          kirim({ t: "chunk", id: msg.id, dataB64: sisa.toString("base64") });
        }
        kirim({ t: "end", id: msg.id });
      });
    }
  );
  req.setTimeout(BATAS_WAKTU_MS, () =>
    req.destroy(new Error("dashboard lokal tidak menjawab tepat waktu"))
  );
  req.on("error", (err) =>
    kirim({ t: "err", id: msg.id, message: String(err.message || err) })
  );
  if (msg.bodyB64) req.write(Buffer.from(msg.bodyB64, "base64"));
  req.end();
}

function sambung() {
  const opsi = {
    headers: { Authorization: `Bearer ${TOKEN}` },
    handshakeTimeout: 15000,
  };
  // Semua lalu lintas keluar dari VM ini wajib lewat proxy egress.
  // Sambungan lokal (pengujian) tidak memakai proxy.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const lokal = /^wss?:\/\/(127\.0\.0\.1|localhost)/.test(TUNNEL_URL);
  if (proxy && !lokal) opsi.agent = new HttpsProxyAgent(proxy);

  ws = new WebSocket(TUNNEL_URL, opsi);

  ws.on("open", () => {
    jedaSambung = 1000;
    console.log(`[${new Date().toISOString()}] Tunnel terhubung ke ${TUNNEL_URL}`);
    clearInterval(pengaturPing);
    pengaturPing = setInterval(() => kirim({ t: "ping" }), 30000);
  });
  ws.on("message", tanganiPesan);
  ws.on("error", (err) => {
    console.error(`[${new Date().toISOString()}] Kesalahan tunnel: ${err.message}`);
  });
  ws.on("close", () => {
    clearInterval(pengaturPing);
    console.log(
      `[${new Date().toISOString()}] Tunnel putus. Menyambung ulang dalam ${jedaSambung / 1000} detik.`
    );
    setTimeout(sambung, jedaSambung);
    jedaSambung = Math.min(jedaSambung * 2, 30000);
  });
}

sambung();
