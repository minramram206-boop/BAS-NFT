# Citizen agents (chat dengan citizen)

Chat pemilik dengan citizen miliknya: karakter AI yang menjawab pendek, tetap di dalam dunia BAS, dan tidak punya akses ke apa pun selain teks. Spesifikasinya ada di SPEC §3.3, §10, §11 dan Phase E. Keputusan tercatat di D-0065 dan D-0066.

Semua balasan berasal dari model. Tidak ada dialog tertulis tangan sebagai pengganti: bila model tidak bisa menjawab, layar mengatakan itu apa adanya, kuota dikembalikan, dan pesan pemilik diberikan kembali agar bisa dikirim ulang.

## 1. Batas yang tidak boleh bergeser

- Hanya pemilik NFT yang bisa chat. Pemilik dibaca dari chain pada setiap permintaan, bukan dari isi token.
- Model tidak punya tool, wallet, kunci, atau akses jaringan. Ia hanya menerima teks dan mengembalikan satu objek JSON.
- Balasan divalidasi ketat sebelum sampai ke layar. Balasan yang tidak lolos tidak ditampilkan dan tidak dihitung ke kuota.
- Kunci OpenRouter hanya hidup di server dan worker. Kunci tidak pernah masuk ke pesan galat, log, atau web.
- Anggaran harian adalah pemutus keras dan dipesan secara atomik sebelum model dipanggil.
- Mint mainnet tidak boleh dibuka sebelum chat pemilik berjalan (SPEC §3.3).

## 2. Susunan

```
apps/web ──(bearer token)──> apps/chat-server ──> OpenRouter
                                │    │
                                │    └── Postgres: kuota, anggaran, memori privat, riwayat publik
                                └─────── Redis: percakapan, kunci per aset, antrean BullMQ
                                                    │
                                              apps/worker ──> OpenRouter (merangkum memori)
```

| Paket / aplikasi | Tugas |
| --- | --- |
| `packages/ai` | Seluruh logika chat tanpa I/O: skema balasan, prompt, kuota, anggaran, kunci, memori, sesi, konsolidasi, klien OpenRouter |
| `packages/server-kit` | Token bearer (HMAC), pembaca chain (pemilik aset, status citizen, serial dari metadata URI), pembatas laju, pembaca body JSON, CORS. Dipakai bersama mission server dan chat server |
| `packages/chat-store` | Adapter Postgres (`PgQuotaStore`, `PgSpendLedger`, `PgMemoryStore`), Redis (`RedisConversationStore`, `RedisLock`), antrean `bas-chat-upkeep`, migrasi |
| `apps/chat-server` | HTTP: `GET /health`, `GET /chat/:asset/status`, `POST /chat/:asset/messages`, `GET` dan `DELETE /chat/:asset/memory` |
| `apps/mission-server` | Setelah klaim misi terkonfirmasi di chain, menaruh satu pekerjaan `public-line` ke antrean (bila `REDIS_URL` diisi). Barisnya hanya memuat misi, distrik, hari, dan musim; tidak ada stat, pemilik, atau ucapan pemilik. Gagal masuk antrean tidak menggagalkan klaim |
| `apps/worker` | Menjalankan pekerjaan antrean: `consolidate` (memori privat melewati 400 karakter ditulis ulang ke ≤300) dan `public-line` (baris riwayat publik) |
| `apps/web` | Panel chat di profil citizen milik sendiri, hanya pada mode chain. Potret citizen memainkan sekali animasi dari balasan (`blink`, `look_left`, `look_right`, `happy`, `worried`, `thinking`) lalu kembali melompat. Animasi ada di potret profil karena di sanalah chat dibaca; kota tidak tampil saat mengobrol |

### Isi `@bas/ai`

| Berkas | Tugas |
| --- | --- |
| `reply.ts` | Skema balasan (Zod, strict) dan `parseReply`. Menolak non-JSON, kunci tambahan, animasi di luar daftar, balasan lebih dari 400 karakter; `safety: blocked` menjadi `declined`; salinan penanda rahasia prompt menjadi `invalid` |
| `persona.ts` | `buildSystemPrompt` dan `buildMessages`. Suara citizen berubah di tier 3, 6, dan 10 dari stat tertinggi; pesan pemilik dipotong 300 karakter dan selalu jadi giliran `user` terakhir; enam giliran riwayat |
| `quota.ts` | 20 pesan per aset per hari UTC (`dailyMessageLimit` di `config/*.json`). `consume` sebelum model, `refund` bila tidak ada jawaban yang bisa dipakai |
| `budget.ts` | `SpendLedger.reserve(day, estimasi, batas)` atomik lalu `adjust(day, selisih)` ke biaya sebenarnya. Habis berarti model tidak dipanggil lagi hari itu. Kehabisan waktu mempertahankan pesanan (biaya mungkin sudah terjadi di gateway); kegagalan lain melepasnya |
| `lock.ts` | `ConversationLock` per aset dan pemilik: dua pesan bersamaan dari pemilik yang sama tidak berjalan paralel (hasil `busy`) |
| `memory.ts` | Memori publik per aset (ikut NFT, 20 baris, idempoten per `eventKey`) dan memori privat per pasangan (aset, pemilik) sehingga pemilik baru mulai kosong. Tidak ada transkrip mentah. `replaceSummary` optimistis pada `updatedAt` |
| `consolidate.ts` | `createConsolidator`: meminta model menulis ulang ringkasan ke ≤300 karakter; `skipped`, `updated`, `conflict`, `budget`, atau `failed` |
| `session.ts` | Sesi habis setelah 30 menit diam; pengingat istirahat setelah 60 menit |
| `model.ts` | `OpenRouterClient`: mode JSON, tanpa `tools`/`tool_choice`, batas waktu dengan `AbortController`, biaya dari `usage.cost` atau dari harga per juta token |
| `config.ts` | `loadChatConfig(env)`. Bila `CHAT_ENABLED=true`, kunci, model utama, anggaran harian, dan kedua harga token wajib ada |
| `chat.ts` | `createChatService(deps).respond(...)` dan `.status(...)` |

Urutan `respond`: validasi pesan → chat mati? → kunci percakapan → kuota → memori dan percakapan → untuk model utama lalu model cadangan: pesan anggaran → panggil → sesuaikan biaya → `parseReply` → simpan giliran dan memori → kembalikan kuota bila tidak ada jawaban yang bisa dipakai.

Hasil: `reply`, `declined`, `unavailable` (alasan `disabled`, `budget`, `quota`, `timeout`, `invalid`, `error`, `busy`), atau `rejected` (`empty`, `too-long`). Pada `unavailable` selain `quota`, kuota dikembalikan dan pesan diberikan kembali ke pemilik. Model cadangan tetap sebuah LLM; ia hanya dicoba bila model utama gagal.

Setiap panggilan model dilaporkan ke `onModelCall` (model, hasil, kode status atau alasan penolakan skema, lama, biaya), tanpa pesan pemilik dan tanpa teks balasan. `apps/chat-server` mencatat yang gagal ke konsol (`[chat-server] model ... error (http 402) after 312 ms`), sehingga penyebab "tidak tersedia" terlihat di log server.

Nama model tidak ditulis di kode; semuanya dari `CHAT_MODEL_PRIMARY` dan `CHAT_MODEL_FALLBACK`.

### Mencocokkan citizen

`citizenId` di chain adalah penghitung registrasi, bukan nomor roster. Entri roster dicari dari serial pada URI metadata aset (`<serial>-<role>.json`, D-0022) lewat `decodeCoreAsset` dan `serialFromMetadataUri`; role diambil dari indeks role di chain. Aset yang URI-nya tidak terbaca ditolak dengan `citizen-not-found`.

## 3. Penyimpanan

| Data | Tempat | Catatan |
| --- | --- | --- |
| Kuota | Postgres `chat_quota` | Per aset per hari UTC |
| Anggaran | Postgres `chat_spend` | `reserve` satu pernyataan atomik |
| Memori privat | Postgres `chat_private_memory` | Kunci (aset, pemilik) |
| Riwayat publik | Postgres `chat_public_memory` | Per aset, idempoten per `eventKey` |
| Percakapan | Redis, TTL 30 menit | Dipegang server; klien tidak bisa menyisipkan giliran |
| Kunci percakapan | Redis `SET NX PX` + pelepasan Lua | Per aset dan pemilik |
| Antrean | Redis, BullMQ `bas-chat-upkeep` | `jobId` untuk dedupe |

Migrasi berjalan saat server dan worker mulai (`chat_migrations`, dengan advisory lock). Tanpa `DATABASE_URL`/`REDIS_URL`, chat server memakai penyimpanan dalam memori untuk pengembangan lokal; di mainnet kedua variabel wajib dan server menolak mulai tanpa keduanya.

## 4. Menjalankan lokal

```powershell
# Postgres dan Redis (Docker Compose, lihat docker-compose.yml)
pnpm services:up

# .env di root repo:
#   MISSION_TOKEN_SECRET=...        (sama dengan mission server)
#   CHAT_ENABLED=true
#   OPENROUTER_API_KEY=...          (kunci devnet saja)
#   CHAT_MODEL_PRIMARY=... CHAT_MODEL_FALLBACK=...
#   CHAT_DAILY_BUDGET_USD=... CHAT_PRICE_INPUT_PER_MILLION_USD=... CHAT_PRICE_OUTPUT_PER_MILLION_USD=...
#   DATABASE_URL=postgres://bas:bas@127.0.0.1:5432/bas
#   REDIS_URL=redis://127.0.0.1:6379
#   NEXT_PUBLIC_CHAT_SERVER_URL=http://127.0.0.1:8788

pnpm --filter @bas/chat-server start
pnpm --filter @bas/worker start
```

Empat proses di atas (mission server, chat server, worker, web) bisa dijalankan sekaligus dengan satu perintah: `pnpm dev:all`. Perintah ini menyalakan Postgres dan Redis, membangun paket, lalu menjalankan keempatnya di satu terminal dengan log berwarna per layanan. `Ctrl+C` mematikan semuanya, dan bila salah satu berhenti karena galat, yang lain ikut dimatikan. Untuk mencari galat satu layanan, jalankan layanan itu sendirian di jendela terpisah seperti di atas.

`REDIS_URL` juga dibaca mission server: bila diisi, misi yang terkonfirmasi diantrekan sebagai baris riwayat publik untuk dikerjakan worker. Bila Redis tidak menjawab saat mission server mulai, server tetap jalan dan baris riwayat tidak diantrekan sampai server dimulai ulang. Chat server dan worker menolak mulai bila Postgres atau Redis yang dikonfigurasi tidak terjangkau, dengan pesan yang menyebut alamatnya.

Tes yang memakai Postgres dan Redis nyata dilewati bila `BAS_TEST_DATABASE_URL` dan `BAS_TEST_REDIS_URL` tidak diisi. Tes Postgres menghapus tabel chat di database itu, jadi jangan arahkan ke database `bas` yang berisi data sungguhan; buat database terpisah (misalnya `bas_test`).

## 5. Menguji dengan model dan chain sungguhan

Dua alat ini dijalankan dari komputer pemilik karena butuh kunci dan jaringan.

**Model sungguhan.** `pnpm chat:smoke` (atau `pnpm chat:smoke -- --primary` untuk model utama saja) mengirim empat pertanyaan ke OpenRouter dengan kunci dan model dari `.env`: sapaan, permintaan diingat, upaya membocorkan instruksi, dan permintaan mengirim SOL. Tiap jawaban diperiksa dengan skema ketat yang sama seperti server dan dicetak beserta emosi, animasi, memori, lama, dan biaya. Kode keluar 0 bila model utama menjawab keempatnya dengan format yang benar. Galat 401, 402, 404, 429, atau jaringan dijelaskan dengan petunjuk. Tidak ada database, chain, atau wallet yang dipakai.

**Transfer NFT sungguhan.** Alamat aset sebuah citizen tidak tampil di aplikasi; `pnpm devnet:citizens <alamat wallet>` mencantumkan citizen milik wallet itu beserta alamat asetnya (hanya membaca, tanpa kunci). Wallet browser tidak menawarkan Send untuk NFT dari koleksi yang belum terverifikasi (hanya Burn), jadi pemindahan dilakukan lewat skrip; `pnpm devnet:import-key <alamat wallet>` mengubah kunci rahasia wallet uji devnet (ditempel tersembunyi di terminal, tidak pernah dicetak) menjadi berkas kunci di `.keys/`, setelah memeriksa bahwa kunci itu milik alamat yang disebut. `pnpm devnet:transfer <asset> <pemilik baru> --keypair <berkas kunci pemilik sekarang>` mensimulasikan transfer Core di cluster tanpa menandatangani apa pun. Dengan `--send`, pemilik sekarang menandatangani dan transfer terjadi. Sesudahnya, wallet lama harus ditolak chat server pada permintaan berikutnya (`not-owner`), wallet baru diterima, kuota tidak terisi ulang, dan memori pribadi wallet lama tidak terlihat wallet baru (diuji otomatis dengan chain tiruan di `apps/chat-server/test/http.test.ts`). Pembangun instruksinya (`buildTransferAsset` di `@bas/metaplex-client`) diuji tanpa jaringan; skripnya sendiri belum pernah dijalankan di cluster. Setelah `pnpm devnet:market-setup` dijalankan (D-0086), citizen juga bisa berpindah lewat jual beli di `/market`; aturan pergantian pemilik di chat server sama untuk keduanya.

## 6. Tahapan

| Tahap | Isi | Status |
| --- | --- | --- |
| E1 | `@bas/ai`: skema, prompt, kuota, anggaran atomik, kunci, memori, sesi, konsolidasi, klien OpenRouter, konfigurasi | Selesai |
| E2 | `packages/server-kit` dan `apps/chat-server` | Selesai |
| E3 | `packages/chat-store` (Postgres, Redis, antrean) dan `apps/worker` | Selesai |
| E4 | Panel chat di web: hanya pemilik, keterangan AI, sisa kuota, pengingat istirahat, memori yang bisa dilihat dan dihapus | Selesai |
| E5 | Tes penerimaan SPEC §15.5: alat sudah ada (`chat:smoke`, `devnet:transfer`), tes otomatis untuk pergantian pemilik sudah lulus; menjalankannya terhadap OpenRouter dan devnet sungguhan | Menunggu dijalankan pemilik |
| E6 | Operasi. Selesai: pekerjaan `public-line` dari klaim misi terkonfirmasi, log penyebab kegagalan model. Belum: pemantauan anggaran, versi prompt, beberapa kunci API atau daftar model lebih dari dua | Sebagian |

## 7. Tes

`pnpm test` dari root menjalankan semuanya. Cakupan chat: `@bas/ai` 47 tes (skema, prompt, kuota dan reset UTC, anggaran atomik, kunci, batas waktu, injeksi prompt, memori setelah transfer, klien OpenRouter dengan server palsu, konsolidasi, konfigurasi), `@bas/server-kit` 7, `@bas/chat-store` 14 (butuh Postgres dan Redis), `@bas/chat-server` 20, `@bas/worker` 4, `@bas/mission-server` 69 (termasuk riwayat publik), `@bas/metaplex-client` 19 (termasuk instruksi transfer), ditambah 8 tes integrasi web dan 2 tes slice chat.

Belum terverifikasi: panggilan ke model sungguhan (jalankan `pnpm chat:smoke`), konsolidasi memori pada volume besar, dan transfer NFT sungguhan di devnet (jalankan `pnpm devnet:transfer`).
