// Hub tiruan untuk pengujian lokal pintu Worker.
//
// Meniru peran Cloudflare Worker + TunnelHub di mesin ini saja, dengan
// protokol pesan yang sama persis, supaya rantai agen <-> hub <->
// dashboard bisa dibuktikan ujung-ke-ujung sebelum Cloudflare terlibat.
//
// Jalan:  NODE_PATH=../agent/node_modules node mock-hub.js
// Port:   8899 (HTTP pengunjung + WebSocket agen di /__tunnel)

const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = 8899;
const TOKEN = process.env.TUNNEL_TOKEN || "";
const menunggu = new Map();
let soketAgen = null;

const server = http.createServer(async (req, res) => {
  if (req.url === "/__health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ agenTerhubung: !!soketAgen }));
    return;
  }
  if (!soketAgen) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("agen belum terhubung");
    return;
  }
  const headers = [];
  const mentah = req.rawHeaders;
  for (let i = 0; i < mentah.length; i += 2) headers.push([mentah[i], mentah[i + 1]]);
  const potongan = [];
  req.on("data", (c) => potongan.push(c));
  req.on("end", () => {
    const badan = Buffer.concat(potongan);
    const id = `uji-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      if (menunggu.delete(id)) {
        res.writeHead(504, { "content-type": "text/plain" });
        res.end("batas waktu hub tiruan");
      }
    }, 30000);
    menunggu.set(id, { res, timer, chunks: [], status: 200, headers: [] });
    soketAgen.send(
      JSON.stringify({
        t: "req",
        id,
        method: req.method,
        url: req.url,
        headers,
        bodyB64: badan.length ? badan.toString("base64") : null,
      })
    );
  });
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/__tunnel") {
    socket.destroy();
    return;
  }
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    soketAgen = ws;
    console.log("agen terhubung ke hub tiruan");
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.t === "ping") {
        ws.send(JSON.stringify({ t: "pong" }));
        return;
      }
      const entri = menunggu.get(msg.id);
      if (!entri) return;
      if (msg.t === "res") {
        entri.status = msg.status;
        entri.headers = msg.headers || [];
      } else if (msg.t === "chunk") {
        entri.chunks.push(Buffer.from(msg.dataB64, "base64"));
      } else if (msg.t === "end") {
        clearTimeout(entri.timer);
        menunggu.delete(msg.id);
        const headersObj = {};
        for (const [nama, nilai] of entri.headers) {
          const kecil = nama.toLowerCase();
          if (kecil === "transfer-encoding" || kecil === "connection" || kecil === "keep-alive") continue;
          if (kecil === "set-cookie") {
            headersObj["set-cookie"] = (headersObj["set-cookie"] || []).concat(nilai);
          } else {
            headersObj[nama] = nilai;
          }
        }
        entri.res.writeHead(entri.status, headersObj);
        entri.res.end(Buffer.concat(entri.chunks));
      } else if (msg.t === "err") {
        clearTimeout(entri.timer);
        menunggu.delete(msg.id);
        entri.res.writeHead(502, { "content-type": "text/plain" });
        entri.res.end("kesalahan agen: " + msg.message);
      }
    });
    ws.on("close", () => {
      soketAgen = null;
      console.log("agen terputus dari hub tiruan");
    });
  });
});

server.listen(PORT, () => console.log(`hub tiruan mendengarkan di :${PORT}`));
