# Pixel District — Catatan Keputusan

Dokumen internal untuk mencatat keputusan implementasi ketika spesifikasi tidak menjelaskan suatu hal secara lengkap.

## Aturan

1. Ketentuan `[FINAL]` dalam `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md` tidak boleh diubah melalui dokumen ini.
2. Gunakan solusi paling sederhana yang tidak menambah fitur.
3. Alasan produk ditulis dalam bahasa Indonesia.
4. Identifier teknis, nama kode, schema, event, error, test, API field, dan path implementasi tetap dalam bahasa Inggris.
5. Setiap entri harus mencantumkan tanggal, status, konteks, keputusan, alasan, dampak, dan dokumen atau komponen terkait.
6. Keputusan yang mengubah ekonomi, token, hadiah, authority, keamanan, atau perilaku produk memerlukan persetujuan pemilik dan pembaruan dokumen sumber terkait; jangan hanya mencatatnya di sini.

## Urutan sumber keputusan

1. Ketentuan `[FINAL]` dalam `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`.
2. Ketentuan eksplisit lain dalam `docs/specs/PIXEL_DISTRICT_SPEC_V2_ID.md`.
3. Aturan kompetisi khusus dalam `docs/id/PRIZE_POOL_MODEL.md`.
4. Keputusan teknologi dalam `docs/id/TECH_STACK_ID.md`.
5. Entri yang telah disetujui dalam dokumen ini.
6. Diagram alur dan desain visual yang nanti diberikan atau disetujui pemilik.
7. Asumsi agent.

## Template

```markdown
## D-XXXX — Judul keputusan

- Tanggal: YYYY-MM-DD
- Status: Proposed | Approved | Superseded
- Pemilik keputusan: Owner | Engineering | Security
- Konteks:
- Keputusan:
- Alasan:
- Dampak:
- Komponen terkait:
- Menggantikan: —
```

## Keputusan

Entri baru hanya ditambahkan ketika ada hal yang benar-benar belum ditentukan,
bukan untuk mengganti persyaratan yang sudah eksplisit.

## D-0001 — Satu sumber data untuk konfigurasi dan konten

- Tanggal: 2026-10-08
- Status: Approved
- Pemilik keputusan: Engineering
- Konteks: `config/devnet.json` dan `config/mainnet.json` berisi nilai yang sama persis dengan konstanta yang diketik ulang di `packages/config/src/index.ts`. `content/en/citizens.json` diimpor langsung oleh store web app melalui path relatif yang keluar dari package (`../../../../content/...`). Dua salinan data yang sama bisa berbeda tanpa terdeteksi.
- Keputusan: File JSON tetap menjadi satu-satunya sumber data sesuai `TECH_STACK_ID.md` §11. `@bas/config` membaca dan memvalidasi `config/*.json` saat module load; `@bas/content/server` membaca dan memvalidasi `content/en/citizens.json` saat request. Tidak ada nilai alamat, supply, atau skor yang diketik ulang di TypeScript.
- Alasan: Menghapus kemungkinan drift antara dokumen konfigurasi dan kode, sekaligus tetap memenuhi struktur repositori yang diwajibkan spesifikasi.
- Dampak: `packages/config` dan `packages/content/server` menjadi module khusus Node, sehingga harus di-compile ke `dist/` dan dikecualikan dari bundle server Next.js melalui `serverExternalPackages`. Build menjadi dua tahap: `pnpm build:packages` lalu `pnpm build:web`.
- Komponen terkait: `packages/config`, `packages/content`, `apps/web/next.config.mjs`, `apps/web/src/app/layout.tsx`, `config/*.json`, `content/en/citizens.json`
- Menggantikan: —

## D-0002 — Batas server/client untuk roster warga

- Tanggal: 2026-10-08
- Status: Approved
- Pemilik keputusan: Engineering
- Konteks: Store web app membaca file konten langsung sehingga loader Node ikut ter-bundle ke browser. Percobaan pertama memperbaiki hal ini dengan mengisi store global saat render, tetapi `useSyncExternalStore` tidak melihat perubahan yang dilakukan selama render, sehingga tampilan District 01 kosong pada HTML hasil server rendering.
- Keputusan: Route menjadi Server Component. Roster divalidasi di server oleh `@bas/content/server`, diteruskan sebagai props ke `BasStoreProvider` di `app/layout.tsx`, dan store dibuat satu kali per sesi melalui `createBasStore({ citizens })` sebelum render anak pertama.
- Alasan: Menjamin HTML pra-render dan markup setelah hidrasi identik, menjaga progres sesi tetap hidup saat berpindah antara `/` dan `/training`, dan mengeluarkan `node:fs` dari bundle browser.
- Dampak: Store tidak lagi berupa singleton global; komponen membaca state melalui selector di `apps/web/src/stores/selectors.ts`. Mode tampilan ganda (`viewMode` di store dan route `/training`) disatukan menjadi route saja.
- Komponen terkait: `apps/web/src/app/layout.tsx`, `apps/web/src/stores/basStore.ts`, `apps/web/src/stores/BasStoreProvider.tsx`, `packages/content/src/citizens.server.ts`
- Menggantikan: —

## D-0003 — Alamat placeholder dan gerbang kesiapan rilis

- Tanggal: 2026-10-08
- Status: Approved
- Pemilik keputusan: Engineering
- Konteks: `programId` pada `config/devnet.json` dan `config/mainnet.json` panjangnya 42 karakter, dan beberapa alamat lain 43 karakter dengan karakter non-base58. Nilai-nilai ini belum bisa menjadi public key Solana yang sah karena program belum pernah di-deploy.
- Keputusan: Validasi dibagi dua tingkat. Saat load, `parseNetworkConfig` memastikan setiap field ada, tidak kosong, dan berbentuk benar. Kesiapan rilis diperiksa terpisah oleh `findPlaceholderAddresses` dan `validateProductionReadiness`, yang menolak alamat yang bukan base58 43–44 karakter. `resolveNetwork` tidak pernah jatuh ke mainnet.
- Alasan: Aplikasi tetap bisa dibangun dan dijalankan sebelum deployment, sementara rilis tidak bisa lolos tanpa alamat asli. Pemeriksaan yang terlalu ketat saat load akan membuat repositori tidak bisa dibangun sama sekali.
- Dampak: Skrip deployment dan pemeriksaan rilis wajib memanggil `validateProductionReadiness`. Setelah keypair program dibuat, public key yang sama harus ditulis ke `config/devnet.json`, `config/mainnet.json`, dan `programs/Anchor.toml`.
- Komponen terkait: `packages/config/src/network.ts`, `packages/config/test/config.test.ts`, `config/*.json`, `programs/Anchor.toml`
- Menggantikan: —

## D-0004 — Verifikasi mint utility pada `train_stat`

- Tanggal: 2026-10-08
- Status: Proposed
- Pemilik keputusan: Security
- Konteks: `train_stat` membakar token melalui CPI ke `ctx.accounts.utility_mint` tanpa membandingkannya dengan `config.utility_mint`. Error `DistrictError::InvalidUtilityMint` sudah dideklarasikan tetapi tidak pernah dipakai. Pemanggil dapat meneruskan mint apa pun yang ia kendalikan, membakar token tanpa nilai, dan tetap menaikkan skor kanonik.
- Keputusan: Menambahkan tiga pemeriksaan pada `train_stat`: `utility_mint` harus sama dengan `config.utility_mint`, `user_token_account.owner` harus sama dengan `owner` citizen, dan `user_token_account.mint` harus sama dengan `config.utility_mint`.
- Alasan: Spesifikasi mensyaratkan pembakaran 100% token resmi pada setiap pelatihan dan melarang skor kanonik dinaikkan tanpa pembakaran yang sah.
- Dampak: Perubahan ini belum dikompilasi maupun diuji karena lingkungan saat ini tidak memiliki toolchain Rust/Anchor. Wajib dijalankan `pnpm program:check` dan `pnpm program:test` sebelum deploy, ditambah uji regresi yang menolak mint asing.
- Komponen terkait: `programs/district/src/lib.rs`, `programs/district/src/errors.rs`
- Menggantikan: —

## D-0005 — Verifikasi koleksi pada `register_citizen` belum diimplementasikan

- Tanggal: 2026-10-08
- Status: Proposed
- Pemilik keputusan: Security
- Konteks: `register_citizen` menerima `asset: AccountInfo` apa pun dan menyimpannya sebagai citizen, sehingga progres bisa ditempelkan ke mint yang bukan bagian dari koleksi resmi. `DistrictError::InvalidCollection` sudah dideklarasikan tetapi tidak pernah dipakai. Verifikasi keanggotaan koleksi Metaplex Core memerlukan adapter `packages/metaplex-client` yang diwajibkan `TECH_STACK_ID.md` §11 dan belum ada.
- Keputusan: Tidak menambahkan pemeriksaan setengah jadi. Verifikasi koleksi ditunda sampai `packages/metaplex-client` tersedia, dan dicatat di sini sebagai pekerjaan wajib sebelum mint dibuka.
- Alasan: Aturan kerja melarang menambahkan fitur atau menebak antarmuka ketika dependensi yang diwajibkan spesifikasi belum dibangun; pemeriksaan yang salah justru memberi rasa aman yang palsu.
- Dampak: `register_citizen` tidak boleh dipanggil di jaringan publik sebelum verifikasi koleksi diimplementasikan dan diuji.
- Komponen terkait: `programs/district/src/lib.rs`, `packages/metaplex-client` (belum ada), `docs/ARCHITECTURE.md`
- Menggantikan: —

## D-0006 — Instruksi pause/unpause belum ada

- Tanggal: 2026-10-08
- Status: Proposed
- Pemilik keputusan: Engineering
- Konteks: `DistrictConfig.is_paused` sudah dipakai sebagai syarat pada `register_citizen` dan `train_stat`, dan diinisialisasi `false`. Tidak ada instruksi untuk mengubahnya, padahal urutan rilis mewajibkan mainnet di-deploy dalam keadaan paused dan utility baru dibuka setelah verifikasi binding, treasury, multisig, dan vault.
- Keputusan: Mencatat kebutuhan instruksi `set_paused` yang hanya dapat dipanggil `config.authority`, tanpa mengimplementasikannya sekarang karena perubahan authority dan keamanan program memerlukan persetujuan pemilik.
- Alasan: Menambahkan instruksi baru pada program yang belum dikompilasi dan belum diaudit berisiko mengunci kesalahan desain; spesifikasi juga meminta keputusan yang mengubah authority mendapat persetujuan pemilik.
- Dampak: Deployment mainnet tidak dapat mengikuti urutan rilis yang diwajibkan sampai instruksi ini ada.
- Komponen terkait: `programs/district/src/lib.rs`, `programs/district/src/state.rs`, `docs/AGENT_START_HERE.md`
- Menggantikan: —

## D-0007 — Perapian struktur repositori dan aset

- Tanggal: 2026-10-08
- Status: Approved
- Pemilik keputusan: Owner
- Konteks: Root repositori berisi 74 gambar hasil eksperimen (crop, preview, percobaan courtyard dan header, `1.png`–`20.png`, foto Telegram) yang tidak dirujuk kode mana pun. `avatars/` identik byte-per-byte dengan `apps/web/public/avatars/`, `1.png`–`20.png` identik dengan `apps/web/public/characters/`, dan seluruh pohon `pixel-district/` identik dengan dokumen di root. `apps/web/public/icons/` memuat 23 ikon sementara hanya 6 yang dirender UI, dan `header_live_compiled.png` identik dengan `header_live_virtual.png`.
- Keputusan: Menghapus aset duplikat dan aset yang tidak dirujuk, menyisakan 47 berkas gambar yang benar-benar dipakai. Dokumen digabung ke `docs/` (`AGENT_START_HERE.md`, `DECISIONS.md`, `specs/PIXEL_DISTRICT_SPEC_V2_ID.md`, `id/`). Aset panggung dipindah ke `apps/web/public/images/district/`. `config/*.json` dan `content/en/` dipertahankan karena diwajibkan `TECH_STACK_ID.md` §11.
- Alasan: Struktur yang diminta pemilik (modular dan rapi) dan penghapusan duplikasi yang membuat tidak jelas salinan mana yang kanonik.
- Dampak: Semua berkas yang dihapus tetap dapat dipulihkan dari riwayat Git pada commit `37b3d6a`. Berkas `.tsbuildinfo` dan `dist/` kini diabaikan, dan `apps/web/public` hanya memuat aset yang ikut ter-deploy.
- Komponen terkait: seluruh root repositori, `docs/`, `apps/web/public/`, `.gitignore`
- Menggantikan: —
