# Panduan Deploy Pintu Worker Onebox

Urutan lengkap dari registrar sampai dashboard bisa dibuka lewat
https://onebox.ai.id. Bagian yang dikerjakan pemilik: Tahap 1–4.
Bagian Muse: menyalakan dashboard + agen di VM setelah Tahap 4
selesai, lalu verifikasi bersama.

## Tahap 0 — Persiapan di laptop

1. Ekstrak `onebox-worker.zip` (isi: `worker.js` + `wrangler.toml`).
2. Pastikan Node.js terpasang (`node --version`) — sudah ada dari
   proyek dashboard.
3. Siapkan berkas token tunnel yang dikirim Muse (satu baris teks).

## Tahap 1 — Akun Cloudflare + daftarkan domain

1. Buka https://dash.cloudflare.com → Sign Up, daftar dengan email,
   verifikasi lewat email masuk.
2. Di dashboard: **Add a domain** (atau "Connect a domain") →
   ketik `onebox.ai.id` → Continue.
3. Pilih plan **Free** → Continue.
4. Cloudflare memindai DNS lama → Continue lagi.
5. Cloudflare menampilkan **dua nameserver** khusus untuk domainmu
   (bentuknya seperti `nama.ns.cloudflare.com`). Catat persis
   keduanya — pasangan ini berbeda untuk setiap domain.

## Tahap 2 — Ganti nameserver di registrar (IDwebhost)

Catatan: registrar domain ini hampir pasti IDwebhost. Bila panelmu
tampil berbeda, intinya sama: cari pengelolaan domain lalu menu
bernama **Nameserver**.

1. Login ke member area IDwebhost → menu **Domain** → klik
   `onebox.ai.id` → **Kelola Domain**.
2. Buka bagian **Nameserver**.
3. Hapus nameserver lama, isi:
   - Nameserver 1: alamat pertama dari Cloudflare (Tahap 1).
   - Nameserver 2: alamat kedua dari Cloudflare.
   - Nameserver 3/4: kosongkan bila ada.
4. Simpan.
5. Tunggu propagasi: biasanya di bawah 1 jam, bisa sampai 24 jam.
   Cloudflare mengirim email dan status domain di dashboard-nya
   berubah dari "Pending" menjadi **Active**.

Aman: mengganti nameserver tidak mengubah kepemilikan domain, dan
domain ini belum dipakai layanan lain, jadi tidak ada yang terganggu.

## Tahap 3 — Deploy Worker dengan wrangler

1. Buka PowerShell di folder hasil ekstrak Tahap 0.
2. `npx wrangler login` — browser terbuka, klik **Allow**.
3. `npx wrangler deploy` — tunggu sampai selesai; binding Durable
   Object dan migrasinya otomatis dari `wrangler.toml`.
4. Pasang secret token:
   `npx wrangler secret put TUNNEL_TOKEN`
   → tempel nilai dari berkas token → Enter.
   (Teks tidak tampil saat ditempel — itu normal.)

## Tahap 4 — Record DNS + Route di Cloudflare

1. Dashboard Cloudflare → pilih domain `onebox.ai.id` →
   **DNS → Records → Add record**:
   - Type: **A**
   - Name: **@**
   - IPv4 address: **192.0.2.1** (alamat contoh; isinya tidak
     penting karena Worker yang menjawab semua permintaan)
   - Proxy status: **Proxied** (awan oranye menyala)
   - Save.
2. Di halaman domain yang sama → **Workers Routes → Add route**:
   - Route: `onebox.ai.id/*`
   - Worker: `onebox-door`
   - Save.

## Tahap 5 — Kabari Muse

Setelah route tersimpan, kabari Muse. Muse menyalakan dashboard
(8787) + agen tunnel di VM, lalu verifikasi bersama:

1. `https://onebox.ai.id/__health` harus menjawab
   `{"agenTerhubung":true}`.
2. Buka `https://onebox.ai.id` dari ponsel → halaman login dashboard
   → masuk dengan kata sandi + TOTP seperti biasa.

## Kalau ada yang macet

- Domain belum Active setelah berjam-jam: cek lagi nameserver di
  registrar — harus persis dua alamat Cloudflare, tanpa sisa yang lama.
- `wrangler deploy` gagal: kirim pesan kesalahannya ke Muse apa adanya.
- `__health` menjawab `agenTerhubung:false`: agen di VM belum
  dinyalakan — itu giliran Muse, bukan kesalahan deploy-mu.
