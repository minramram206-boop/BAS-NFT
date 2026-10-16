# Mission server

Server yang menjaga aturan misi dan ikut menandatangani `claim_training_credit`. Kode ada di `apps/mission-server`. Keputusannya tercatat di D-0059; aturan misinya sendiri di D-0025.

## 1. Pembagian tugas

Program di chain tidak tahu apa itu misi. Ia hanya menerima satu klaim yang ditandatangani `mission_authority` dan menambah satu kredit untuk satu stat. Semua yang membuat klaim itu pantas diberikan dijaga server:

| Dijaga program | Dijaga server |
| --- | --- |
| Kredit per stat, tier, role tetap dari NFT | Urutan dan hasil langkah misi |
| Biaya latih `100 × (skor + 1)` dan pembakaran token | Maksimal 3 misi per citizen per hari season |
| Pemilik NFT harus menandatangani | Satu misi sekali per citizen per hari |
| Receipt klaim tidak bisa dipakai ulang | Satu misi aktif per citizen |
| Klaim kedaluwarsa ditolak | Distrik terbuka menurut tier, jendela event, awal dan akhir season |
| | Poin season (100 per misi, 150 per tugas event) |

Server tidak menyimpan kunci pemain dan tidak memindahkan dana. Kunci `mission_authority` hanya bisa menambah kredit; ia tidak bisa membakar token, mengubah skor, atau mengubah konfigurasi.

## 2. Alur satu misi

1. **Masuk.** Web meminta pesan ke `POST /auth/challenge`, wallet menandatangani pesan itu (`signMessage`, tanpa transaksi), web mengirim tanda tangan ke `POST /auth/verify` dan menerima token berlaku 12 jam. Pesan hanya bisa dipakai sekali dan kedaluwarsa dalam 5 menit.
2. **Mulai.** `POST /citizens/:asset/missions/start` dengan `missionId` dan `stat`. Server membaca pemilik NFT dan skor citizen dari chain, lalu memeriksa semua aturan di bagian 4.
3. **Langkah.** `POST .../step` dengan bukti langkah: `{kind:'goto'}`, `{kind:'talk', answer}` atau `{kind:'puzzle', order}`. Kunci jawaban hanya ada di server.
4. **Klaim.** Setelah langkah terakhir, `POST .../claim` mengembalikan transaksi `claim_training_credit` yang sudah ditandatangani server dan dibayar pemilik. Wallet menambahkan tanda tangan pemilik dan mengirimnya.
5. **Konfirmasi.** `POST .../confirm` memeriksa bahwa receipt klaim sudah ada di chain. Baru saat itu misi dihitung untuk batas harian dan poin season, dan sesi ditutup.

## 3. Endpoint

Semua respons berupa JSON. Kesalahan berbentuk `{ "error": "<kode>", "message": "..." }`. Semua endpoint citizen memakai `Authorization: Bearer <token>`.

| Endpoint | Fungsi |
| --- | --- |
| `GET /health` | Cek hidup |
| `POST /auth/challenge` `{wallet}` | Pesan untuk ditandatangani |
| `POST /auth/verify` `{wallet, nonce, signature}` | Token; tanda tangan dalam base64 |
| `GET /citizens/:asset/missions` | Hari season, misi selesai hari ini, sesi aktif, poin |
| `POST /citizens/:asset/missions/start` `{missionId, stat}` | Mulai misi |
| `POST /citizens/:asset/missions/step` `{missionId, proof}` | Selesaikan langkah berikutnya |
| `POST /citizens/:asset/missions/claim` `{missionId}` | `{status:'sign', transaction, expiresAt}` atau `{status:'confirmed', points}` |
| `POST /citizens/:asset/missions/confirm` `{missionId}` | Hitung klaim yang sudah masuk chain |
| `POST /citizens/:asset/missions/abandon` | Batalkan misi aktif |
| `GET /season` | Info season (`id`, `startsAt`, `days`, `daySeconds`, `endsAt`, `day`, `open`) dan jendela event, tanpa token. Web memakainya untuk menampilkan kartu event |
| `GET /season/standings` | Poin season per citizen, tanpa token |
| `GET /season/prizes[?season=<id>]` | Daftar pemenang yang sudah dipublikasikan (`{prizes: {seasonId, root, rows, ...}}` atau `{prizes: null}`), tanpa token. File-nya ditulis `pnpm devnet:prize finalize` ke `PRIZES_DIR`; server menolak file yang barisnya tidak menghasilkan `root`-nya sendiri, dan web hanya memakai daftar yang root-nya sama dengan akun season di prize vault (D-0101) |
| `POST /mint/prepare` | Transaksi mint penjualan publik (D-0061) untuk wallet pada token: `{transaction, asset, blockhash, lastValidBlockHeight}`. Transaksi base64 sudah ditandatangani semua pihak kecuali wallet pembeli. Hanya aktif bila `MINT_SIGNER_KEYPAIR_FILE` diisi |
| `GET /market/activity` | Penjualan dan tawaran lelang yang dibaca dari log transaksi program market, terbaru dulu, tanpa token: `{sales, bids}` dengan lamport sebagai string desimal (D-0087). Kosong bila `marketProgramId` tidak ada di config jaringan |

Kode kesalahan: `unauthorized`, `bad-request`, `not-owner`, `citizen-not-found`, `unknown-mission`, `invalid-stat`, `season-closed`, `mission-closed`, `district-locked`, `citizen-busy`, `mission-cooldown`, `daily-limit`, `no-session`, `wrong-session`, `steps-left`, `wrong-step`, `wrong-answer`, `wrong-order`, `too-fast`, `claim-pending`, `claim-missing`, `mint-not-open`, `mint-limit`, `sold-out`, `rate-limited`, `unavailable`. Nama-nama yang sudah ada di web (`mission-cooldown`, `daily-limit`, `citizen-busy`, `district-locked`, `mission-closed`) memakai arti yang sama.

## 4. Aturan

- **Hari season** dihitung dari `SEASON_STARTS_AT` dalam blok 24 jam, mulai dari 1. Di luar `1..SEASON_DAYS` tidak ada misi yang bisa dimulai atau diklaim.
- **Batas harian:** satu misi sekali per citizen per hari, tiga misi per citizen per hari. Hanya klaim yang sudah terkonfirmasi di chain yang dihitung.
- **Satu misi aktif** per citizen. Server berbeda dari mock web di satu hal: mock menganggap sebuah misi "sibuk" kalau citizen mana pun sedang memainkannya. Di server tiap citizen punya sesi sendiri, jadi dua pemain bisa memainkan misi yang sama bersamaan. Adapter chain di web mengikuti aturan server.
- **Distrik** terbuka kalau salah satu stat distrik itu mencapai skor buka (3, 6 atau 10), dibaca dari `CitizenState` di chain.
- **Event:** misi event hanya bisa dimulai di dalam jendela waktunya, yang diisi lewat `MISSION_EVENTS_FILE`. Tanpa jendela, misi event tertutup.
- **Langkah jalan** tidak bisa diawasi server karena kota berjalan di browser. Server hanya menolak laporan yang datang lebih cepat dari waktu tempuh minimum (250 ms per sel, sekitar 44% dari kecepatan jalan asli, minimum 1 detik per langkah). Ini menahan skrip malas, bukan pemain yang sengaja curang; kejujurannya dibatasi oleh batas harian dan biaya token untuk melatih.
- **Langkah talk dan puzzle** diperiksa terhadap kunci jawaban. Jawaban salah boleh diulang, urutan puzzle yang salah diulang dari awal, sama seperti di web.

## 5. Klaim

- `nonce = season_id × 1000 + hari season`. Receipt di chain berada di PDA `["claim", asset, mission_id, nonce]`, jadi program sendiri menolak klaim kedua untuk misi yang sama pada hari yang sama, walau server salah.
- `expires_at` = 120 detik setelah klaim dibuat. Meminta klaim lagi sebelum itu mengembalikan argumen yang sama dengan blockhash baru.
- Klaim yang sudah lewat masa berlakunya baru diganti setelah jeda 30 detik (selisih jam server dan validator). Di jeda itu server menjawab `claim-pending`. Tanpa jeda, klaim lama yang masih bisa masuk chain bisa bertemu dengan klaim baru dan memberi dua kredit.
- Sebelum menerbitkan atau mengganti klaim, server selalu memeriksa apakah receipt-nya sudah ada. Kalau sudah, misi dihitung selesai.
- `mission_id` tiap misi (`chainId` di katalog) tidak boleh diubah atau dipakai ulang.

## 6. Keamanan

- Pemilik NFT dibaca dari asset Core di chain pada setiap permintaan, bukan dari token. NFT yang dijual langsung pindah kendali, dan sesi pemilik lama berhenti bekerja.
- Token masuk adalah HMAC-SHA256 atas wallet dan waktu habis. `MISSION_TOKEN_SECRET` harus acak dan minimal 32 byte.
- Server menolak start kalau kunci di `MISSION_AUTHORITY_KEYPAIR_FILE` tidak sama dengan `missionAuthority` di manifest cluster. Hal yang sama berlaku untuk `MINT_SIGNER_KEYPAIR_FILE` dan `mintSigner`.
- Kunci mint signer adalah `thirdPartySigner` Candy Guard. Ia hanya menandatangani transaksi yang dibangun server sendiri (tiga instruksi, satu pembeli, satu asset baru), tidak memegang dana, dan tidak bisa memindahkan atau mengubah citizen. Bila bocor, penyerang bisa menyusun mint yang tetap harus membayar 0,01 SOL dan tetap kena batas satu per wallet dari chain, tetapi bisa melewati jam buka; ganti kuncinya dengan `set_guards` pada Candy Guard.
- Kunci `mission_authority` ada di file di luar repository (`.keys/devnet-mission-authority.json` dari `pnpm devnet:setup`), dan tidak pernah masuk log atau respons. Untuk mainnet, simpan di secret manager.
- Batas ukuran body 4 KB, batas 120 permintaan per menit per alamat, CORS hanya untuk `ALLOWED_ORIGINS`.
- Error dari chain atau disk dijawab `unavailable` tanpa rincian.

## 7. Menjalankan

Untuk memakai server dari web, jalankan juga web dengan `NEXT_PUBLIC_BAS_DATA=chain` dan `NEXT_PUBLIC_MISSION_SERVER_URL` (default `http://localhost:8787`); `ALLOWED_ORIGINS` di server harus memuat alamat web itu. Lihat bagian "Mode chain" di `docs/ARCHITECTURE.md`.

```powershell
cd C:\Users\shole\OneDrive\Desktop\BAS-NFT
pnpm install
$env:BAS_NETWORK = "devnet"
$env:MISSION_AUTHORITY_KEYPAIR_FILE = ".keys\devnet-mission-authority.json"
$env:MISSION_TOKEN_SECRET = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
$env:SEASON_STARTS_AT = "1791000000"   # unix detik awal season
pnpm --filter @bas/mission-server start
```

Untuk membuka penjualan publik tambahkan kunci mint signer (dibuat `pnpm devnet:mint-setup`) dan, bila perlu, jam buka:

```powershell
$env:MINT_SIGNER_KEYPAIR_FILE = ".keys\devnet-mint-signer.json"
$env:MINT_OPENS_AT = "1791000000"   # opsional, unix detik; sebelum itu /mint/prepare menjawab mint-not-open
```

Tanpa `MINT_SIGNER_KEYPAIR_FILE`, `/mint/prepare` menjawab `unavailable`. Server juga menolak memberi transaksi bila Candy Machine belum terisi penuh, sudah habis, atau wallet sudah mint satu kali. Urutan penyiapan di devnet: `pnpm devnet:setup`, `pnpm devnet:mint-setup`, `pnpm devnet:mint-simulate`, lalu jalankan server. Satu transaksi mint meminta 400.000 compute unit (`MINT_COMPUTE_UNIT_LIMIT`); `mint-simulate` mencetak pemakaian sebenarnya, sesuaikan bila mendekati batas.

Pengaturan lengkap ada di `.env.example`. Path relatif untuk file kunci dan event dibaca dari root repository, jadi server bisa dijalankan dari folder mana pun. Data sesi dan klaim disimpan di `MISSION_STORE_FILE` (default `./data/missions.json`). File itu dibuat lewat file sementara lalu di-rename, tetapi hanya aman untuk satu proses server; untuk lebih dari satu instance, ganti `FileStore` dengan database lewat antarmuka `MissionStore`.

## 8. Yang belum ada

- Adapter chain di web sudah ada (D-0060): `NEXT_PUBLIC_BAS_DATA=chain` membuat web memakai server ini untuk semua misi. Katalog di web tidak memuat kunci jawaban; kunci itu hanya ada di `apps/mission-server/src/catalog.ts`.
- Mint (D-0061) belum dijalankan terhadap program Core Candy Machine dan Core Candy Guard yang sungguhan; tes memakai transaksi yang dibangun offline dan dicocokkan dengan kode sumber guard. Jalankan `pnpm devnet:mint-simulate` sebelum mint pertama.
- Server belum bisa diuji terhadap devnet karena program belum dideploy. Pembacaan akun (`RpcChainReader`) diuji lewat byte yang disusun sesuai layout program, dan tes mencocokkan layout itu dengan sumber Rust.
- Poin season hanya ada di server. Pemenang disusun dari poin itu oleh `pnpm devnet:prize finalize` dan diumumkan sebagai Merkle root di prize vault (D-0101, `docs/PRIZE_VAULT.md`).
- `SEASON_DAY_SECONDS` (khusus devnet) memendekkan satu hari season, supaya satu season penuh, pemenangnya, dan klaimnya bisa dicoba dalam satu sesi. Server menolak nilai selain 86400 di luar devnet.
- Database sungguhan, cadangan data, dan pemantauan.
