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
- Konteks: `programId` pada `config/devnet.json` dan `config/mainnet.json` panjangnya 42 karakter, dan beberapa alamat lain memakai karakter non-base58 (`0` dan `O`). Nilai-nilai ini belum bisa menjadi public key Solana yang sah karena program belum pernah di-deploy.
- Keputusan: Validasi dibagi dua tingkat. Saat load, `parseNetworkConfig` memastikan setiap field ada, tidak kosong, dan berbentuk public key yang benar: base58, 43–44 karakter, dan tepat 32 byte setelah di-decode; prefix metadata harus HTTPS dan berakhir pada direktori template yang tepat. Kesiapan rilis diperiksa terpisah oleh `findPlaceholderAddresses`, `findPlaceholderConfiguration`, dan `validateProductionReadiness`: gerbang menolak alamat yang nilainya ada di `REPO_PLACEHOLDER_ADDRESSES` serta host metadata contoh/reserved seperti `*.invalid`, `*.test`, dan `example.com`. `resolveNetwork` tidak pernah jatuh ke mainnet.
- Alasan: Alamat yang bentuknya cacat bukan sekadar placeholder, melainkan bug: `declare_id!` memarse program id saat kompilasi sehingga `cargo check` gagal tanpa pesan yang jelas. Host URI contoh juga harus memblokir rilis: on-chain whitelist yang valid secara sintaksis tetap membuat pendaftaran gagal permanen bila aset produksi tidak pernah bisa memakai host itu.
- Dampak: Skrip deployment dan pemeriksaan rilis wajib memanggil `validateProductionReadiness`. Public key yang sama harus ditulis ke `config/devnet.json`, `config/mainnet.json`, `programs/Anchor.toml`, dan `declare_id!`; `pnpm test` gagal kalau keempatnya berbeda. Mainnet juga harus memakai origin metadata produksi yang benar.
- Komponen terkait: `packages/config/src/network.ts`, `packages/config/test/config.test.ts`, `config/*.json`, `programs/Anchor.toml`
- Menggantikan: —

## D-0004 — Verifikasi mint utility pada `train_stat`

- Tanggal: 2026-10-08
- Status: Proposed
- Pemilik keputusan: Security
- Konteks: `train_stat` membakar token melalui CPI ke `ctx.accounts.utility_mint` tanpa membandingkannya dengan `config.utility_mint`. Error `DistrictError::InvalidUtilityMint` sudah dideklarasikan tetapi tidak pernah dipakai. Pemanggil dapat meneruskan mint apa pun yang ia kendalikan, membakar token tanpa nilai, dan tetap menaikkan skor kanonik.
- Keputusan: Menambahkan tiga pemeriksaan pada `train_stat`: `utility_mint` harus sama dengan `config.utility_mint`, `user_token_account.owner` harus sama dengan `owner` citizen, dan `user_token_account.mint` harus sama dengan `config.utility_mint`.
- Alasan: Spesifikasi mensyaratkan pembakaran 100% token resmi pada setiap pelatihan dan melarang skor kanonik dinaikkan tanpa pembakaran yang sah.
- Dampak: Sudah lolos `cargo check --all-targets` di CI, tetapi belum ada test Anchor dan belum pernah di-build ke BPF. Wajib `anchor build` dan `anchor test` sebelum deploy, ditambah uji regresi yang menolak mint asing.
- Komponen terkait: `programs/district/src/lib.rs`, `programs/district/src/errors.rs`
- Menggantikan: —

## D-0005 — Verifikasi koleksi pada `register_citizen`

- Tanggal: 2026-10-08
- Status: Implemented (menunggu `anchor build` + `anchor test`, dan review Security)
- Pemilik keputusan: Security
- Konteks: `register_citizen` menerima `asset: AccountInfo` apa pun dan menyimpannya sebagai citizen, sehingga progres bisa ditempelkan ke mint yang bukan bagian dari koleksi resmi. `DistrictError::InvalidCollection` sudah dideklarasikan tetapi tidak pernah dipakai — pola yang sama dengan `InvalidUtilityMint` pada D-0004.
- Keputusan: Verifikasi keanggotaan koleksi dilakukan **di dalam program**, bukan di client. `register_citizen` membaca prefix account Metaplex Core `AssetV1` dan menolak kalau (1) account bukan asset Core yang tidak dikompresi, (2) update authority-nya bukan `Collection`, (3) collection-nya bukan `config.collection_mint`, atau (4) pemilik asset bukan signer. Account `mpl_core_program` wajib diserahkan dan `asset` diberi constraint `owner = mpl_core_program`, jadi byte yang dibaca dijamin ditulis oleh program Metaplex Core yang asli. Cara bacanya dicatat di D-0011.
- Alasan: `packages/metaplex-client` yang diwajibkan `TECH_STACK_ID.md` §11 memang belum ada, tetapi package itu untuk pembacaan off-chain. Pemeriksaan yang melindungi skor kanonik harus terjadi on-chain; menunda sampai adapter tersedia berarti membiarkan celah yang sudah diketahui tetap terbuka.
- Dampak: Instruksi `register_citizen` bertambah satu account wajib (`mpl_core_program`). Program belum pernah di-deploy, jadi tidak ada client lama yang rusak; `@bas/chain-client` mengekspor `MPL_CORE_PROGRAM_ID` dan `CORE_ASSET_LAYOUT` untuk calon integrasi wallet. Celah "jangan buka mint publik sebelum ini beres" sudah tertutup, tetapi tetap wajib diuji terhadap validator sebelum deploy.
- Komponen terkait: `programs/district/src/lib.rs`, `programs/district/src/mpl_core.rs`, `programs/district/src/errors.rs`, `packages/chain-client/src/constants.ts`
- Menggantikan: —

## D-0006 — Instruksi `set_paused` untuk urutan rilis

- Tanggal: 2026-10-08
- Status: Proposed (menunggu persetujuan pemilik karena menyentuh authority)
- Pemilik keputusan: Security
- Konteks: `DistrictConfig.is_paused` sudah dipakai sebagai syarat pada `register_citizen` dan `train_stat`, dan diinisialisasi `false`, tetapi tidak ada instruksi untuk mengubahnya. Urutan rilis mewajibkan mainnet di-deploy dalam keadaan paused dan utility baru dibuka setelah verifikasi binding, treasury, multisig, dan vault.
- Keputusan: Menambahkan instruksi `set_paused(paused: bool)` yang hanya dapat dipanggil oleh `config.authority`, dijaga oleh constraint `has_one = authority` dengan error baru `DistrictError::UnauthorizedAuthority`, dan memancarkan event `DistrictPausedChanged` hanya ketika nilainya benar-benar berubah. Bersamaan dengan itu ditambahkan event `CitizenRegistered` dan `StatTrained`, serta diskriminan eksplisit pada `CitizenStat` supaya encoding on-chain stabil.
- Alasan: Tanpa instruksi ini urutan rilis yang diwajibkan spesifikasi tidak bisa diikuti. Event membuat transisi authority dan hasil pelatihan dapat diaudit dari rantai, bukan dari state browser.
- Dampak: Sudah lolos `cargo check --all-targets` di CI, tetapi belum ada test Anchor dan belum pernah di-build ke BPF. Wajib `anchor build` dan `anchor test` sebelum deploy. Karena menyentuh authority, statusnya tetap Proposed sampai pemilik menyetujui.
- Komponen terkait: `programs/district/src/lib.rs`, `programs/district/src/events.rs`, `programs/district/src/errors.rs`, `programs/district/src/state.rs`
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

## D-0008 — Telemetri shell dibaca dari konfigurasi cluster

- Tanggal: 2026-10-08
- Status: Approved
- Pemilik keputusan: Engineering
- Konteks: Header dan status bar menulis `SOLANA MAINNET`, `PROGRAM: Bas1...7SoL`, latensi `24ms`, dan `SYNCHRONIZED` sebagai teks tetap. Nilai-nilai itu tidak berasal dari konfigurasi mana pun: aplikasi berjalan di devnet, program id yang sebenarnya adalah placeholder repo, dan tidak ada pengukuran latensi.
- Keputusan: Menambahkan `apps/web/src/config/telemetry.ts` (server-only) yang membangun `DistrictTelemetry` dari `@bas/config`, meneruskannya melalui `DistrictTelemetryProvider` di `app/layout.tsx`, dan membuat seluruh label cluster, program id pendek, serta `maxSupply` dirender dari sana. Klaim yang tidak diukur (`24ms`, `SYNCHRONIZED`) dihapus.
- Alasan: Spesifikasi melarang state browser diperlakukan sebagai kebenaran dan meminta paritas perilaku antar cluster. UI yang mengklaim mainnet sementara konfigurasi menunjuk devnet adalah bentuk lain dari masalah yang sama.
- Dampak: `UI.networkBadge` dan `PROGRAM_LABEL` dihapus; `BROADCAST` berubah dari objek string menjadi fungsi yang menerima nilai telemetri. Mengganti cluster kini otomatis mengganti seluruh label di shell.
- Komponen terkait: `apps/web/src/config/telemetry.ts`, `apps/web/src/config/constants.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/hud/*`, `apps/web/src/components/layout/DistrictStatusBar.tsx`
- Menggantikan: —

## D-0009 — Penjaga aset dan CI

- Tanggal: 2026-10-08
- Status: Approved
- Pemilik keputusan: Engineering
- Konteks: Perapian menemukan 74 berkas biner yang tidak dirujuk kode, dua pohon dokumen identik, dan tiga salinan sprite yang sama. Tidak ada pemeriksaan apa pun yang mencegah hal itu terulang. Repositori juga belum memiliki CI, padahal `TECH_STACK_ID.md` §12 Stage 1 mensyaratkannya.
- Keputusan: Menambahkan `scripts/check-assets.mjs` yang gagal ketika ada berkas di `apps/web/public` yang tidak dirujuk oleh sumber atau konten, dan ketika ada dua berkas publik yang identik byte-per-byte. Skrip ini menjadi `pnpm test` milik `@bas/web`. Menambahkan `.github/workflows/verify.yml` dengan job TypeScript (typecheck, unit test, lint, asset guard) dan job `cargo check` untuk program Anchor.
- Alasan: Aturan yang hanya tertulis di dokumentasi sudah terbukti tidak cukup; pemeriksaan yang berjalan otomatis membuat duplikasi gagal di CI, bukan ditemukan manual berbulan-bulan kemudian.
- Dampak: Awalnya `next build` sengaja tidak dijalankan di CI karena font `next/font` mengunduh dari Google. Keterbatasan itu kemudian diselesaikan oleh D-0014 dengan font self-hosted dan build produksi di CI. Job Rust hanya menjalankan tes host, bukan `anchor build`, karena BPF toolchain tidak tersedia di runner.
- Komponen terkait: `scripts/check-assets.mjs`, `.github/workflows/verify.yml`, `apps/web/package.json`, `package.json`
- Menggantikan: —

## D-0010 — Program id placeholder harus berbentuk public key yang sah

- Tanggal: 2026-10-08
- Status: Approved
- Pemilik keputusan: Engineering
- Konteks: CI pertama yang benar-benar mengompilasi program (`cargo check`) gagal. Penyebabnya bukan kode baru, melainkan `declare_id!("BASDistr1ct111...")`: string itu hanya 42 karakter dan men-decode ke 31 byte, sedangkan `Pubkey::from_str` mewajibkan 32 byte. Program ini tidak pernah bisa di-build sejak awal. Dua alamat lain juga memakai karakter non-base58 (`0` dan `O`).
- Keputusan: Program id diganti dengan public half dari keypair ed25519 yang dibuat baru dan tidak pernah di-deploy (`scripts/gen-program-id.mjs`), keypair-nya ditulis ke `programs/district/keypair.json` dan di-gitignore. Nilai yang sama dipasang di `declare_id!`, `[programs.devnet]`, `[programs.mainnet]`, dan kedua `config/*.json`. Placeholder mint diturunkan secara deterministik dari `sha256("bas:placeholder:utility-token-mint")`. Ditambah test yang membandingkan keempat salinan program id dan test yang menolak alamat 31 byte serta alamat non-base58.
- Alasan: Placeholder harus cukup sah untuk dikompilasi dan diuji, tetapi tetap jelas bukan alamat asli. Menolak placeholder berdasarkan nilai (`REPO_PLACEHOLDER_ADDRESSES`) membuat gerbang rilis tetap berfungsi walaupun bentuknya kini valid.
- Dampak: Keypair di `programs/district/keypair.json` adalah rahasia dan tidak boleh masuk Git; `.gitignore` sudah menutup `keypair.json`, `*-keypair.json`, dan `programs/*/keypair.json`. Sebelum deploy, owner wajib membuat keypair sendiri dan menjalankan `anchor keys sync`. CI job `programs` kini menjadi penjaga nyata untuk perubahan Rust.
- Komponen terkait: `scripts/gen-program-id.mjs`, `programs/district/src/lib.rs`, `programs/Anchor.toml`, `config/*.json`, `packages/config/src/network.ts`, `.gitignore`
- Menggantikan: —

## D-0011 — Membaca prefix account Metaplex Core tanpa dependensi `mpl-core`

- Tanggal: 2026-10-08
- Status: Approved
- Pemilik keputusan: Security
- Konteks: Verifikasi keanggotaan koleksi (D-0005) perlu membaca account Metaplex Core. Cara lazim adalah menarik crate `mpl-core`, tetapi crate itu tidak bisa di-vendor maupun dikompilasi di lingkungan pengerjaan, dan menambah dependensi yang tidak bisa diuji justru memperbesar risiko.
- Keputusan: `programs/district/src/mpl_core.rs` membaca langsung prefix berukuran tetap dari account `AssetV1`: `key` (1 byte, harus `Key::AssetV1 == 1`), `owner` (32 byte di offset 1), tag `UpdateAuthority` (1 byte di offset 33, harus `Collection == 2`), dan pubkey koleksi (32 byte di offset 34). Field variabel `name`, `uri`, `seq` dan seluruh data plugin tidak dibaca sama sekali, sehingga panjangnya tidak bisa menggeser hasil. Account yang terlalu pendek atau diskriminatornya salah ditolak (fail closed). Parser ini punya 8 unit test Rust terhadap byte sintetis yang dijalankan CI lewat `cargo test --lib`, dan satu test di `@bas/chain-client` yang membandingkan alamat program serta setiap offset dengan berkas Rust-nya.
- Alasan: Seluruh nilai yang dibutuhkan berada di prefix tetap, jadi parser-nya kecil, bisa diuji di host tanpa validator maupun BPF toolchain, dan tidak menambah dependensi yang tidak bisa diverifikasi. Layout-nya diambil dari `programs/mpl-core/src/state/asset.rs` dan `state/update_authority.rs` di github.com/metaplex-foundation/mpl-core, bukan dari ingatan; alamat program diambil dari `MPL_CORE_PROGRAM_ID` di `clients/js/src/generated/programs/mplCore.ts` repo yang sama.
- Dampak: Asset terkompresi (`Key::HashedAssetV1`) ditolak karena tidak menyimpan owner dan collection yang bisa dibaca di account-nya; mendukungnya butuh Merkle tree dan harus diputuskan terpisah. Kalau Metaplex mengubah layout `AssetV1`, parser wajib diperbarui — test offset akan gagal lebih dulu di CI. Pemeriksaan ini tetap tidak boleh menjadi satu-satunya lapisan: constraint `owner = mpl_core_program` yang membuat byte-nya bisa dipercaya.
- Komponen terkait: `programs/district/src/mpl_core.rs`, `programs/district/src/lib.rs`, `packages/chain-client/src/constants.ts`, `.github/workflows/verify.yml`
- Menggantikan: —

## D-0012 — Test instruksi dengan `solana-program-test`, bukan validator atau BPF

- Tanggal: 2026-10-08
- Status: Approved
- Pemilik keputusan: Engineering
- Konteks: Pemeriksaan keamanan `register_citizen` (D-0005, D-0011) dan gerbang burn `train_stat` hanya diuji lewat `cargo check` plus 8 unit test untuk parser byte-nya. Tidak ada satu pun test yang menjalankan satu instruksi utuh, jadi constraint account, derivasi PDA, CPI ke SPL Token, dan urutan penjaga di dalam handler semuanya tidak terverifikasi. Jalur lazim `anchor test` memerlukan Anchor CLI, `cargo build-sbf`, Solana CLI, validator yang hidup, dan IDL; tidak satu pun tersedia di runner CI maupun di lingkungan pengerjaan.
- Keputusan: Menambahkan `programs/district/tests/integration.rs` — 18 test di atas `solana-program-test` 1.18.26, dijalankan dengan `cargo test` biasa. Prosesornya adalah `entry` yang dihasilkan macro `#[program]` Anchor, dibungkus shim `transmute` karena `AccountInfo<'a>` invarian terhadap `'a` sehingga `entry` tidak bisa di-coerce langsung ke `ProcessInstruction`. Instruksi dibangun dari `district::accounts::X {}.to_account_metas(None)` dan `district::instruction::X { .. }.data()`, jadi diskriminator dan urutan account datang dari kode yang dihasilkan macro, bukan ditulis tangan. Fixture account memakai `AccountSharedData::from(solana_sdk::account::Account { .. })` karena `set_data` bersifat privat; account SPL Token di-pack langsung tanpa diskriminator Anchor. Semua assertion membaca state yang sudah ter-commit — PDA config, PDA citizen, saldo token, dan supply mint — bukan event.
- Alasan: Ini satu-satunya jalur yang menjalankan logika program yang sebenarnya tanpa validator maupun BPF build, sehingga bisa masuk CI sebagai penjaga regresi. Menulis IDL tangan untuk mocha TypeScript berarti menduplikasi sumber kebenaran dan bisa menyimpang diam-diam.
- Dampak: Yang **tidak** bisa diuji di sini dan tetap harus lewat `anchor test` terhadap validator sebelum deploy: payload `emit!`, batas compute unit yang sesungguhnya, dan perilaku spesifik BPF. Event tidak terlihat karena `solana_runtime` membangun log collector dengan `LogCollectorFilter::ExcludeReturnData`, dan program berjalan sebagai native builtin — bukan lewat BPF VM — sehingga `sol_log_data` yang dipakai Anchor untuk event tersaring sebelum mencapai `simulation_details.logs`. Karena itu dua test dinamai ulang agar jujur terhadap apa yang diperiksa, dan burn diverifikasi dari turunnya supply mint, yang lebih kuat daripada event. Empat dependensi baru semuanya `[dev-dependencies]` (`solana-program-test`, `solana-sdk`, `spl-token`, `tokio`), jadi tidak satu pun masuk ke binary BPF.
- Catatan yang ditemukan lewat test ini dan wajib diketahui pengubah berikutnya: `Transaction::new_signed_with_payer` **tidak** menandatangani untuk payer, jadi payer harus ikut daftar keypair; `init` Anchor menarik lamport dari payer yang **dideklarasikan** (`authority` di `InitializeDistrict`, `owner` di `RegisterCitizen`), bukan dari fee payer, sehingga keypair itu butuh airdrop sendiri; instruksi identik yang diulang perlu `warp_to_slot` + blockhash baru atau bank menolaknya sebagai `AlreadyProcessed` sebelum program dipanggil; constraint `owner =` melaporkan `ConstraintOwner` (2004), bukan `AccountOwnedByWrongProgram` (3007); dan pendaftaran ganda ditolak oleh system program (`SystemError::AccountAlreadyInUse`, muncul sebagai `Custom(0)`) lewat CPI `init`, sebelum handler berjalan. `RUSTFLAGS: -A unexpected_cfgs` dan `RUST_LOG: error` dipasang di CI karena warning macro anchor dan log DEBUG runtime menenggelamkan ringkasan test.
- Komponen terkait: `programs/district/tests/integration.rs`, `programs/district/Cargo.toml`, `Cargo.toml`, `programs/Anchor.toml`, `package.json`, `.github/workflows/verify.yml`
- Menggantikan: —

## D-0013 — Registry URI template Metaplex Core yang disetujui

- Tanggal: 2026-10-09
- Status: Implemented (menunggu validasi Rust dan review keamanan)
- Pemilik keputusan: Security
- Konteks: SPEC v2 §6.3 mensyaratkan template citizen yang disetujui, tetapi PDA kosong yang diturunkan dari `approved_template_id` tidak membuktikan bahwa URI metadata asset benar-benar berasal dari template itu. Asset dapat berasal dari koleksi yang benar tetapi memakai JSON arbitrer.
- Keputusan: `initialize_config` membuat akun program-owned `ApprovedTemplate` pada PDA `approved_template` + little-endian template ID, menyimpan versi, bump, ID, dan prefix URI HTTPS yang berakhir `/templates/{id}/`. Prefix ini immutable karena tidak ada instruksi update; `update_config` tidak lagi menerima perubahan template ID. `register_citizen` membaca field URI Borsh `AssetV1` dan menerima hanya satu nama file ASCII aman yang berakhiran `.json` di bawah prefix tersimpan. Slash tambahan, backslash, query, fragment, whitespace, path traversal, URI tidak valid, dan asset yang memakai template ID lain ditolak. `config/*.json` memasok prefix yang sama untuk TypeScript; gerbang produksi menolak host reserved placeholder.
- Alasan: Validasi harus dilakukan on-chain dari URI yang ditulis Metaplex Core, bukan hanya dari parameter client atau alamat PDA yang bisa diturunkan siapa pun. Prefix exact dan immutable membuat keputusan template dapat diaudit dan menghindari kelemahan pemeriksaan substring.
- Dampak: Instruksi `initialize_config` menerima prefix dan akun registry tambahan; `register_citizen` menerima akun registry typed; integrasi client/manifes mengikuti perubahan tersebut. Manifest repository memakai `metadata.example.invalid` hanya sebagai fixture, bukan endpoint deploy. Sebelum deploy wajib menggantinya dengan host metadata produksi dan menjalankan gerbang kesiapan. Fixture/unit/integration tests harus membuktikan penerimaan URI yang disetujui dan penolakan URI tak disetujui.
- Komponen terkait: `programs/district/src/state.rs`, `programs/district/src/mpl_core.rs`, `programs/district/src/lib.rs`, `programs/district/tests/integration.rs`, `packages/config`, `packages/chain-client`
- Menggantikan: —

## D-0014 — Font pixel self-hosted dan build produksi CI

- Tanggal: 2026-10-09
- Status: Implemented (install, font-license check, lint, typecheck, tests, dan production build lulus)
- Pemilik keputusan: Engineering
- Konteks: `next/font/google` mengambil Silkscreen dan Pixelify Sans dari host Google saat `next build`, sedangkan host tersebut tidak tersedia di runner ini. Workflow meniadakan build produksi dan dokumentasi menyebut opsi mock `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, tetapi berkas mock yang dirujuk tidak ada dan variabel itu tidak ditangani oleh versi Next yang terpasang.
- Keputusan: Mengganti unduhan build-time dengan paket pinned `@fontsource/silkscreen` dan `@fontsource/pixelify-sans` versi 5.3.0. UI memuat font Latin yang dibutuhkan secara lokal; `pnpm build` kembali menjadi langkah CI.
- Alasan: Hasil produksi harus bisa dikompilasi secara deterministik setelah `pnpm install`, tanpa bergantung pada host eksternal yang tidak masuk allowlist jaringan runner.
- Dampak: Font masuk dalam dependency dan bundle first-party. Teks lisensi OFL beserta copyright notice kedua font disediakan di `apps/web/public/licenses/`, sehingga tetap tersedia pada deploy. Build mengecek bahwa stylesheet dan font files lokal benar-benar terpakai.
- Komponen terkait: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/package.json`, `pnpm-lock.yaml`, `scripts/check-font-licenses.mjs`, `.github/workflows/verify.yml`, `docs/ARCHITECTURE.md`
- Menggantikan: Pengecualian build produksi di D-0009.
