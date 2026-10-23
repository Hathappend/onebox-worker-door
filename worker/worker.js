// Pintu Cloudflare Worker untuk Onebox (pintu sementara).
//
// Cara kerja: pengunjung domain diterima Worker ini, lalu diteruskan
// ke Durable Object TunnelHub. Di dalam TunnelHub ada satu sambungan
// WebSocket yang dipegang agen di VM pemilik dashboard. Permintaan
// HTTP pengunjung dikirim menuruni sambungan itu, dikerjakan dashboard
// lokal, dan jawabannya mengalir kembali sebagai Response.
//
// Rahasia yang dibutuhkan: variabel TUNNEL_TOKEN (Secret) — nilainya
// harus sama persis dengan token di config agen di VM.

function b64Encode(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const per = 32768;
  for (let i = 0; i < bytes.length; i += per) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + per));
  }
  return btoa(bin);
}

function b64Decode(teks) {
  const bin = atob(teks);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const BATAS_WAKTU_MS = 30000;

export class TunnelHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.menunggu = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Ujung sambungan agen.
    if (url.pathname === "/__tunnel") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Ujung ini khusus WebSocket.", { status: 426 });
      }
      if (request.headers.get("Authorization") !== `Bearer ${this.env.TUNNEL_TOKEN}`) {
        return new Response("Token tunnel tidak cocok.", { status: 401 });
      }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const soket = this.state.getWebSockets();
    const terhubung = soket.length > 0;

    // Pemeriksaan kesehatan sederhana untuk pemilik.
    if (url.pathname === "/__health") {
      return Response.json({ agenTerhubung: terhubung });
    }

    if (!terhubung) {
      return new Response(
        "Dashboard sedang tidak terhubung. Agen tunnel di sisi pemilik belum menyambung — coba lagi beberapa saat lagi.",
        { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    // Siapkan muatan permintaan untuk agen.
    const headers = [];
    request.headers.forEach((nilai, nama) => headers.push([nama, nilai]));
    let bodyB64 = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > 0) bodyB64 = b64Encode(buf);
    }

    const id = crypto.randomUUID();
    const janji = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.menunggu.delete(id)) {
          reject(new Error("batas waktu tunnel habis"));
        }
      }, BATAS_WAKTU_MS);
      this.menunggu.set(id, { resolve, reject, timer, chunks: [], status: 200, headers: [] });
    });

    soket[0].send(
      JSON.stringify({
        t: "req",
        id,
        method: request.method,
        url: url.pathname + url.search,
        headers,
        bodyB64,
      })
    );

    try {
      const hasil = await janji;
      let total = 0;
      for (const c of hasil.chunks) total += c.length;
      const badan = new Uint8Array(total);
      let posisi = 0;
      for (const c of hasil.chunks) {
        badan.set(c, posisi);
        posisi += c.length;
      }
      const respHeaders = new Headers();
      for (const [nama, nilai] of hasil.headers) {
        const kecil = nama.toLowerCase();
        if (kecil === "transfer-encoding" || kecil === "connection" || kecil === "keep-alive") {
          continue;
        }
        respHeaders.append(nama, nilai);
      }
      return new Response(badan, { status: hasil.status, headers: respHeaders });
    } catch (err) {
      return new Response(`Tunnel gagal meneruskan permintaan: ${err.message}`, {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  }

  async webSocketMessage(ws, message) {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.t === "ping") {
      ws.send(JSON.stringify({ t: "pong" }));
      return;
    }
    const entri = this.menunggu.get(msg.id);
    if (!entri) return;
    if (msg.t === "res") {
      entri.status = msg.status;
      entri.headers = msg.headers || [];
    } else if (msg.t === "chunk") {
      entri.chunks.push(b64Decode(msg.dataB64));
    } else if (msg.t === "end") {
      clearTimeout(entri.timer);
      this.menunggu.delete(msg.id);
      entri.resolve(entri);
    } else if (msg.t === "err") {
      clearTimeout(entri.timer);
      this.menunggu.delete(msg.id);
      entri.reject(new Error(msg.message || "agen melaporkan kesalahan"));
    }
  }

  async webSocketClose() {
    for (const [, entri] of this.menunggu) {
      clearTimeout(entri.timer);
      entri.reject(new Error("agen tunnel terputus di tengah permintaan"));
    }
    this.menunggu.clear();
  }

  async webSocketError() {
    return this.webSocketClose();
  }
}

export default {
  async fetch(request, env) {
    const stub = env.HUB.get(env.HUB.idFromName("onebox"));
    return stub.fetch(request);
  },
};
