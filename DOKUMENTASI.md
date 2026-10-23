# Dokumentasi Pintu Worker Onebox

Dokumen ini mencatat pintu akses publik **sementara** untuk Dashboard
Onebox: cara kerjanya, di mana setiap bagian tinggal, cara
mengoperasikannya, dan cara mematikannya kelak. Ditulis saat pintu ini
terbukti live, 23 Oktober 2026.

## 1. Status dan ringkasan

- **Live sejak:** 23 Oktober 2026 (±19:47 WIB).
- **Alamat publik:** https://onebox.ai.id — melayani Dashboard Onebox
  yang berjalan di VM Muse, port lokal 8787.
- **Alamat cadangan bawaan:** https://onebox-door.hathappend.workers.dev
  — Worker yang sama, berguna untuk diagnosis (lihat bagian 8).
- **Sifat:** pintu SEMENTARA. Pintu final tetap Bentuk A + frp lewat
  VPS Oracle (task T8 di proyek dashboard), yang masih menunggu
  instance tersedia. Pintu ini pensiun begitu pintu final berdiri.
- **Kenapa jalur ini ada:** VM tidak punya IP publik dan seluruh lalu
  lintas keluarnya wajib lewat proxy; Cloudflare Tunnel terbukti tidak
  bisa dari VM ini (T1). Worker + tunnel WebSocket buatan sendiri bisa,
  karena sambungannya dibuka dari dalam VM ke luar.
- **Aturan perubahan (mengikat, keputusan pemilik 23 Okt 2026):**
  pintu ini diperlakukan sebagai **production**. Semua perubahan
  dikerjakan dan diuji **lokal dulu** (edit di proyek ini, uji dengan
  hub tiruan, commit lokal). Menerapkan perubahan ke Worker yang live
  — `wrangler deploy`, mengganti secret, mengubah route/DNS — hanya
  dilakukan atas instruksi eksplisit pemilik, tidak pernah sebagai
  bagian diam-diam dari pekerjaan lokal.

## 2. Arsitektur

```
Browser / ponsel
   │  https://onebox.ai.id
   ▼
Cloudflare (DNS proxied + Workers Route onebox.ai.id/*)
   │  permintaan diserahkan ke Worker
   ▼
Worker "onebox-door" ──► Durable Object "TunnelHub" (id "utama")
   │  meneruskan lewat WebSocket yang selalu terbuka
   ▼
Agen tunnel di VM (systemd: onebox-agent)
   │  http://127.0.0.1:8787
   ▼
Dashboard Onebox (systemd: onebox-dashboard)
```

Tiga komponen buatan sendiri, dua sisi:

| Komponen | Lokasi berkas | Berjalan di |
|---|---|---|
| Worker + Durable Object | `worker/worker.js`, `worker/wrangler.toml` | Cloudflare (akun pemilik) |
| Agen tunnel | `agent/agent.js`, `agent/config.json` | VM Muse (systemd) |
| Dashboard | proyek `onebox-dashboard` (di luar repo ini) | VM Muse (systemd), port 8787 |

Protokol tunnel (ringkas): semua pesan JSON di atas satu WebSocket.
Browser meminta → Worker membungkus sebagai pesan `req` (id, method,
path, header, body base64) → agen memanggil dashboard lokal → jawaban
dikembalikan sebagai `res` (status + header) lalu `chunk` (potongan
base64 64 KB) dan `end`. Batas waktu per permintaan 30 detik. Agen
menyambung ulang otomatis dengan backoff 1→30 detik dan mengirim ping
aplikasi tiap 30 detik.

## 3. Aset dan akun

- **Akun Cloudflare:** milik pemilik (Gmail `hathappend@…`), plan Free.
  Worker bernama `onebox-door`; subdomain workers.dev
  `hathappend.workers.dev`.
- **Durable Object:** kelas `TunnelHub`, binding `HUB`, migrasi v1
  (`new_sqlite_classes`). Satu instans bernama `utama` memegang
  sambungan agen yang aktif; sambungan agen baru menggantikan yang lama.
- **Secret `TUNNEL_TOKEN`:** terpasang sebagai Secret pada Worker via
  `wrangler secret put`. Nilainya sama dengan `token` di
  `agent/config.json` pada VM (dibuat acak lokal saat pembangunan;
  berkas itu tidak masuk git dan tidak pernah melewati chat — salinan
  yang sempat dikirim sebagai berkas ke pemilik sudah terpakai dan
  boleh dihapus pemilik).
- **Domain:** `onebox.ai.id`, registrar IDwebhost; nameserver sudah
  diganti ke nameserver Cloudflare dan berstatus Active.

## 4. Konfigurasi Cloudflare yang benar

Dua pengaturan di zona `onebox.ai.id`, keduanya wajib persis:

1. **DNS record** — Type `A`, Name `@`, IPv4 `192.0.2.1`,
   Proxy status **Proxied** (awan oranye), TTL Auto.
   `192.0.2.1` adalah alamat contoh resmi yang tidak menunjuk server
   mana pun; record ini hanya formalitas agar route bisa menempel di
   domain utama. Tidak ada lalu lintas yang benar-benar pergi ke sana
   selama route aktif.
2. **Workers Route** — pola `onebox.ai.id/*`, Worker `onebox-door`.

   ⚠ Pelajaran 23 Okt 2026: pola `*.onebox.ai.id/*` (dengan `*.` di
   depan) adalah wildcard *subdomain* — cocok untuk `www.` dan
   subdomain lain, tetapi **tidak** mencakup domain polosnya. Gejalanya
   membingungkan: record benar, Worker sehat, tetapi domain utama
   menjawab error 522 karena permintaan lolos ke alamat contoh di atas.
   Pola untuk domain utama tidak boleh memakai `*.`.

## 5. Layanan di VM (systemd)

Keduanya layanan sistem, `enabled`, `Restart=always`:

| Layanan | Isi | Berkas unit (sumber) |
|---|---|---|
| `onebox-dashboard` | Node server dashboard, `PORT=8787`, direktori kerja `projects/onebox-dashboard/server` | `~/workspace/ops/systemd/onebox-dashboard.service` |
| `onebox-agent` | Agen tunnel repo ini | `~/workspace/ops/systemd/onebox-agent.service` |

- Env agen: `/home/hatch/.config/onebox/agent.env` (izin 600, di luar
  git) berisi `TUNNEL_URL` dan variabel proxy egress yang dibutuhkan
  agen untuk menembus proxy keluar VM. Saat ini
  `TUNNEL_URL=wss://onebox-door.hathappend.workers.dev/__tunnel` —
  sengaja lewat alamat workers.dev supaya hidup-matinya tunnel tidak
  tergantung DNS domain; di dalam Worker, sambungannya sama saja.
- **Struktur bengkel → production (sejak 23 Okt 2026, keputusan
  pemilik):** layanan agen berjalan dari folder production
  `~/workspace/production/onebox-worker-door/agent` — BUKAN dari repo
  bengkel — supaya suntingan lokal tidak pernah ikut terbawa saat
  layanan restart. Deploy adalah langkah sadar:
  `bash ~/workspace/ops/deploy-onebox-agent.sh` menyalin `agent/` dari
  bengkel (versi sebelumnya disimpan sebagai `agent.prev` untuk
  rollback), mencatat commit terpasang di
  `~/workspace/production/onebox-worker-door/VERSION`, lalu me-restart
  layanan. Rollback: salin `agent.prev` kembali ke `agent`, restart.
  Berkas `config.json` production ikut tersalin dari bengkel pada
  setiap deploy — bengkel adalah sumber kebenaran tunggal.
- Pemasangan ulang (idempoten):
  `bash ~/workspace/ops/install-onebox-services.sh`
  (pemasang juga mengisi folder production dari bengkel bila folder
  itu hilang, mis. restore sebagian pasca-ganti VM)
- Pemulihan pasca-ganti VM: `~/workspace/ops/recover.sh` bagian 5
  memanggil pemasang itu, jadi kedua layanan ikut dipulihkan otomatis
  oleh sistem pemulihan yang sudah ada (dengan laporan ke pemilik).
- Perintah harian:
  - Status: `systemctl status onebox-dashboard onebox-agent`
  - Log: `journalctl -u onebox-agent -n 50` (atau `-f` untuk mengikuti)
  - Restart: `systemctl restart onebox-agent` (tunnel pulih sendiri
    dalam hitungan detik; terbukti pada uji restart paksa 23 Okt).

## 6. Endpoint pemeriksaan

Worker menyediakan satu endpoint khusus, tidak diteruskan ke dashboard:

- `GET /__health` → `{"agenTerhubung":true}` bila agen tersambung,
  `{"agenTerhubung":false}` bila tidak. Bila agen tidak tersambung,
  semua permintaan lain dijawab 502 dengan pesan berbahasa Indonesia.

Cek cepat dari mana saja:

```
curl https://onebox.ai.id/__health
curl https://onebox-door.hathappend.workers.dev/__health
curl -o /dev/null -w "%{http_code}" https://onebox.ai.id/
```

Hasil sehat: health `true` di kedua alamat dan halaman utama 200.

## 7. Keamanan dan batasan yang disepakati

Pintu ini diterima pemilik pada 23 Okt 2026 **dengan tiga ongkos yang
sudah dijelaskan terbuka**, dan batasan berikut mengikat selama pintu
ini hidup:

- TLS berakhir di tepi Cloudflare; isi lalu lintas (termasuk cookie
  sesi) secara teknis terbaca di sana. Inilah alasan utama pintu ini
  sementara dan frp tetap menjadi tujuan akhir.
- Pola mirip-proxy ini berada di wilayah abu-abu Ketentuan Layanan
  Cloudflare §2.2.1(j). Risiko yang diterima: Cloudflare dapat
  menghentikan Worker; tidak ada data yang hilang bila itu terjadi
  (semua data tetap di VM).
- Hanya SATU layanan yang terekspos (dashboard), sama seperti syarat
  pintu final. Tidak ada proxy generik, tidak ada port lain.
- Penegak akses tetap login + 2FA milik dashboard. Pintu tidak memberi
  akses apa pun kepada orang yang tidak bisa login.
- Token tunnel adalah satu-satunya kunci antara agen dan Worker:
  agen tanpa token yang cocok ditolak (401) dan tidak bisa menumpang.
- Catatan free plan: Durable Object bisa diusir dari memori saat
  menganggur; permintaan pertama sesudahnya bisa gagal sesaat —
  cukup muat ulang halaman.

## 8. Troubleshooting

| Gejala | Penyebab paling mungkin | Pemeriksaan / obat |
|---|---|---|
| Domain 522, workers.dev sehat | Route tidak kena (salah pola, mis. `*.` di depan) atau record tidak proxied | Cek pola route persis `onebox.ai.id/*`; cek awan oranye |
| Semua alamat 502 pesan Indonesia | Agen tidak tersambung | `systemctl status onebox-agent`; `journalctl -u onebox-agent -n 50` |
| `__health` menjawab `false` | Sama seperti di atas | Sama seperti di atas |
| Domain tidak ter-resolve sama sekali | Nameserver belum Active / propagasi | Panel Cloudflare: status domain; panel registrar: nameserver |
| Halaman sesekali gagal lalu normal setelah muat ulang | Durable Object terusir saat menganggur (free plan) | Normal untuk pintu sementara; muat ulang |
| `wrangler deploy` error "static files" | Perintah dijalankan di folder yang tidak berisi `wrangler.toml` | `cd` ke folder berisi `worker.js` + `wrangler.toml`, ulangi |
| Setelah VM diganti pintu mati | Layanan belum terp
...[truncated 3083 chars]asang ulang | Jalankan `recover.sh` / pemasang layanan; cek `systemctl status` |
| Tunnel tersambung tapi halaman kosong/error | Dashboard lokal bermasalah | Cek `http://127.0.0.1:8787/api/health` dari VM |

## 9. Mengganti token tunnel

Token adalah rahasia bersama agen ↔ Worker. Ganti bila dicurigai bocor:

1. Buat nilai acak baru di VM (mis. `openssl rand -hex 32`) — jangan
   lewat chat.
2. Tulis nilai baru ke `token` di `agent/config.json` **di bengkel**
   (sumber kebenaran), jangan langsung di folder production.
3. `npx wrangler secret put TUNNEL_TOKEN` dari laptop, tempel nilai
   yang sama. Sejak langkah ini agen lama ditolak Worker — tunnel
   berhenti sebentar, itu wajar.
4. `bash ~/workspace/ops/deploy-onebox-agent.sh` (menyalin config baru
   ke production + restart layanan), lalu cek `__health` harus kembali
   `true`.

## 10. Memensiunkan pintu ini

Dilakukan hanya setelah pintu final (frp + VPS, T8) terbukti melayani
`onebox.ai.id`:

1. Alihkan route/domain ke pintu final lebih dulu (jangan matikan
   pintu lama sebelum penggantinya terbukti — hindari jeda tanpa
   pintu).
2. `systemctl disable --now onebox-agent` di VM.
3. Hapus Workers Route `onebox.ai.id/*` dan, bila mau bersih total,
   hapus Worker `onebox-door` dari panel Cloudflare
   (Workers & Pages → onebox-door → Settings → Delete).
4. Repo ini tetap disimpan sebagai arsip + bahan evaluasi; jangan
   hapus `agent/config.json` sampai Worker benar-benar terhapus.

## 11. Riwayat singkat

- **23 Okt 2026 sore** — dibangun dan diuji ujung-ke-ujung secara lokal
  dengan hub tiruan (login + TOTP lolos, aset identik byte).
- **23 Okt ±19:05** — pemilik men-deploy Worker sendiri via wrangler
  dari laptopnya; secret terpasang.
- **±19:24** — agen + dashboard dinyalakan; satu runtime restart
  membunuh kedua proses (dipulihkan dengan menyalakan ulang; agen
  sempat tertahan kartu izin satu putaran).
- **±19:35** — keduanya dijadikan layanan systemd persisten atas
  persetujuan pemilik; uji restart paksa lulus.
- **±19:40** — domain utama 522: pola route pertama pemilik adalah
  wildcard subdomain `*.onebox.ai.id/*` yang tidak mencakup apex;
  terdiagnosis dari tangkapan layarnya.
- **±19:47** — pola dikoreksi menjadi `onebox.ai.id/*`; domain resmi
  live dan terverifikasi penuh.
- **±21:46** — struktur bengkel → production diterapkan: layanan agen
  kini berjalan dari `~/workspace/production/onebox-worker-door/`
  (VERSION mencatat commit `dd42969`), bengkel kembali murni tempat
  kerja.

## 12. Yang belum selesai

1. **Setup awal dashboard — SELESAI** (23 Okt 2026, oleh pemilik lewat
   browser): database asli sudah melewati tahap setup;
   `/api/auth/state` kini menjawab `login`, artinya kata sandi + TOTP
   sudah terdaftar dan yang menghadap publik sekarang adalah halaman
   login biasa.
2. **Pintu final (T8)** — frp + VPS Oracle; skrip retry pembuatan
   instance berjalan di laptop pemilik. Begitu instance ada, ikuti
   bagian 10 untuk pensiunnya pintu ini.
3. **Cermin GitHub untuk repo ini** — belum dibuat. Perannya hanya
   arsip cadangan di luar VM (bukan jalur deploy); pembuatannya
   menunggu instruksi pemilik.
