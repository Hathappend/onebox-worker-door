# Pintu Worker Onebox (pintu sementara)

Pintu publik sementara untuk dashboard Onebox selama instance Oracle
untuk jalur frp belum tersedia. Dashboard tetap berjalan di VM pemilik;
yang dipinjam dari Cloudflare hanya "pintu depannya".

## Cara kerja

1. Pengunjung membuka https://onebox.ai.id — diterima Cloudflare Worker.
2. Worker meneruskan permintaan ke Durable Object `TunnelHub`.
3. Di dalam TunnelHub ada satu sambungan WebSocket yang dipegang agen
   kecil di VM (`agent/agent.js`). Sambungan ini dibuka dari arah VM
   (keluar, wss/443, lewat proxy egress) — tidak ada port masuk yang
   dibuka di VM.
4. Agen meneruskan permintaan ke dashboard lokal (127.0.0.1:8787) dan
   mengirim jawabannya kembali menuruni sambungan yang sama.

Protokol antara Worker dan agen: pesan JSON di atas WebSocket —
`req` (method, url, headers, body base64) dari hub ke agen, lalu
`res`/`chunk`/`end` (status, headers, potongan badan base64) kembali.
Agen menolak melayani bila token pada header Authorization tidak cocok
dengan Secret `TUNNEL_TOKEN` di Worker.

## Isi folder

- `agent/` — agen di VM (Node, dependensi `ws` + `https-proxy-agent`).
  Konfigurasi di `agent/config.json` (tidak masuk git): `tunnelUrl`,
  `token`, `localOrigin`. Variabel lingkungan `TUNNEL_URL`,
  `TUNNEL_TOKEN`, `LOCAL_ORIGIN` menimpa berkas itu.
- `worker/` — `worker.js` (Worker + Durable Object) dan `wrangler.toml`.
- `test/mock-hub.js` — hub tiruan untuk uji lokal tanpa Cloudflare.
- `deploy/onebox-agent.service` — unit systemd untuk agen.

## Uji lokal (sudah lolos 2026-10-23)

Dashboard uji di :8799, hub tiruan di :8899, agen mengarah ke hub
tiruan. Hasil: halaman dan aset biner identik byte-per-byte dengan
akses langsung; alur login kata sandi → TOTP → sesi terautentikasi
berjalan penuh lewat tunnel, termasuk cookie.

## Batasan yang diketahui

- TLS berhenti di Cloudflare: tepi Cloudflare secara teknis dapat
  melihat isi trafik, termasuk cookie sesi. Karena itu pintu ini
  bersifat sementara; jalur frp di VPS sendiri tetap tujuan akhir.
- Durable Object paket gratis punya jatah permintaan harian; cukup
  untuk dashboard pribadi, bukan untuk trafik publik besar.
- Bila Durable Object diistirahatkan platform di tengah permintaan,
  satu muatan halaman bisa gagal dan cukup dimuat ulang.

## Deploy

Lihat panduan langkah demi langkah yang dikirim bersama proyek ini
(akun Cloudflare, pemasangan domain, `wrangler deploy`, secret,
route). Setelah deploy selesai dan agen + dashboard dinyalakan di VM,
cek `https://onebox.ai.id/__health` — harus menjawab
`{"agenTerhubung":true}`.
