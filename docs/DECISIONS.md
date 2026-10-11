# BAS District — Catatan Keputusan

Dokumen internal untuk mencatat keputusan implementasi ketika spesifikasi tidak menjelaskan suatu hal secara lengkap.

## Aturan

1. Ketentuan `[FINAL]` dalam `docs/specs/BAS_DISTRICT_SPEC_V2_ID.md` tidak boleh diubah melalui dokumen ini.
2. Gunakan solusi paling sederhana yang tidak menambah fitur.
3. Alasan produk ditulis dalam bahasa Indonesia.
4. Identifier teknis, nama kode, schema, event, error, test, API field, dan path implementasi tetap dalam bahasa Inggris.
5. Setiap entri harus mencantumkan tanggal, status, konteks, keputusan, alasan, dampak, dan dokumen atau komponen terkait.
6. Keputusan yang mengubah ekonomi, token, hadiah, authority, keamanan, atau perilaku produk memerlukan persetujuan pemilik dan pembaruan dokumen sumber terkait; jangan hanya mencatatnya di sini.

## Urutan sumber keputusan

1. Ketentuan `[FINAL]` dalam `docs/specs/BAS_DISTRICT_SPEC_V2_ID.md`.
2. Ketentuan eksplisit lain dalam `docs/specs/BAS_DISTRICT_SPEC_V2_ID.md`.
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
- Keputusan: Menghapus aset duplikat dan aset yang tidak dirujuk, menyisakan 47 berkas gambar yang benar-benar dipakai. Dokumen digabung ke `docs/` (`AGENT_START_HERE.md`, `DECISIONS.md`, `specs/BAS_DISTRICT_SPEC_V2_ID.md`, `id/`). Aset panggung dipindah ke `apps/web/public/images/district/`. `config/*.json` dan `content/en/` dipertahankan karena diwajibkan `TECH_STACK_ID.md` §11.
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
- Status: Implemented (Rust check, unit tests, dan integration tests lulus; review keamanan tetap wajib sebelum deploy)
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

## D-0015 — Registry tujuh role dan role dipilih saat registrasi

- Tanggal: 2026-10-09
- Status: Superseded sebagian oleh D-0022 (registry tujuh role tetap berlaku; role tidak lagi dipilih saat registrasi)
- Pemilik keputusan: Owner
- Konteks: SPEC §6.3 dan §8 Phase A meminta tujuh role dengan stat awal berbeda, tetapi tidak menamai role maupun nilainya, dan tidak menyebut dari mana role sebuah NFT berasal. `roles.rs` sebelumnya merujuk ke "D-0013" untuk hal ini, padahal D-0013 membahas registry URI.
- Keputusan: `programs/district/src/roles.rs` berisi tujuh role (Pioneer, Steward, Artisan, Sentinel, Scholar, Navigator, Mentor). Setiap role memberi total 3 poin dan tidak ada stat yang mulai di Tier 1. Role dipilih oleh pemegang NFT sebagai argumen `register_citizen`; stat awal selalu dibaca dari registry, tidak pernah dari input pemanggil.
- Alasan: Karena total poin semua role sama, pilihan role hanya mengubah bentuk citizen, bukan kekuatannya. Ini opsi paling sederhana tanpa membaca atribut NFT.
- Dampak: Role tidak dijamin cocok dengan art NFT. Bila pemilik ingin role terikat ke NFT, role perlu diturunkan dari metadata (misalnya nama file URI template) dan ini butuh keputusan baru.
- Komponen terkait: `programs/district/src/roles.rs`, `programs/district/src/instructions/register_citizen.rs`, `content/en/roles.json`, `packages/chain-client/src/constants.ts`
- Menggantikan: —

## D-0016 — Pengerasan keamanan program district

- Tanggal: 2026-10-09
- Status: Implemented (29 unit test dan 63 integration test lulus; audit independen tetap wajib)
- Pemilik keputusan: Security
- Konteks: Review kode menemukan beberapa celah. (1) Account `mpl_core_program` diisi bebas oleh pemanggil, sehingga constraint `owner = mpl_core_program` bisa dipenuhi oleh program buatan penyerang yang menulis byte asset palsu; asumsi di D-0005 dan D-0011 bahwa constraint itu membuat byte "bisa dipercaya" ternyata salah. (2) `initialize_config` bisa dipanggil siapa saja yang lebih dulu, sehingga kursi admin bisa diserobot setelah deploy. (3) `claim_training_credit` tidak mengikat `citizen_state` ke `asset` yang dicek kepemilikannya. (4) Unpause dan upgrade tidak mensyaratkan mint yang sudah dikunci, padahal SPEC §5.2 dan §12 memintanya. (5) Receipt klaim dibuat dengan `create_account`, yang gagal bila seseorang lebih dulu mengirim lamport ke alamat PDA yang bisa ditebak. (6) `update_config` menerima biaya training nol dan alamat kosong tanpa event.
- Keputusan: (1) Asset harus dimiliki tepat oleh `MPL_CORE_PROGRAM_ID`; account `mpl_core_program` dihapus dari ketiga instruksi dan pengecekan dipusatkan di `mpl_core::load_collection_member`. (2) `initialize_config` mewajibkan account ProgramData program ini dan signer harus upgrade authority-nya. (3) PDA `citizen_state` di claim dan upgrade diturunkan dari `asset.key()`. (4) District selalu mulai paused; `set_paused(false)` dan `upgrade_score` menolak dengan `UtilityMintNotLocked` sampai mint dikunci. (5) Pembuatan receipt memakai `pda::create_pda_account`, yang tetap berhasil pada alamat yang sudah berisi lamport. (6) `initialize_config` dan `update_config` menolak alamat kosong dan biaya nol (`InvalidConfig`), dan `update_config` mengeluarkan `ConfigUpdated`. Argumen `start_paused` dihapus.
- Alasan: Semua poin di atas adalah syarat eksplisit SPEC §5.2, §5.7 dan §12 atau celah yang memungkinkan citizen palsu, pengambilalihan admin, atau klaim yang diblokir. Menegakkannya di program lebih aman daripada mengandalkan urutan langkah manual.
- Dampak: Daftar account `register_citizen`, `claim_training_credit` dan `upgrade_score` berubah (tanpa `mpl_core_program`), dan `initialize_config` butuh account `program_data`. `initialize_config` harus dijalankan oleh deploy key sebelum upgrade authority dipindah ke multisig. Program immutable tanpa upgrade authority tidak bisa diinisialisasi. Setiap perbaikan punya test serangan yang gagal bila perbaikannya dicabut.
- Komponen terkait: `programs/district/src/instructions/*`, `programs/district/src/mpl_core.rs`, `programs/district/src/pda.rs`, `programs/district/src/errors.rs`, `programs/district/src/events.rs`, `programs/district/tests/integration/*`
- Menggantikan: bagian alasan keamanan di D-0005 dan D-0011 yang bergantung pada account `mpl_core_program`

## D-0017 — Token utility boleh SPL Token atau Token-2022

- Tanggal: 2026-10-09
- Status: Implemented — mirror devnet dibuat Token-2022 dengan 6 decimals karena `create_v2` Pump.fun membuat mint seperti itu (dokumentasi Pump.fun, Oktober 2026); cek sekali program mint asli setelah koin dibuat
- Pemilik keputusan: Engineering
- Konteks: Program sebelumnya hanya menerima SPL Token lama. Pump.fun juga punya jalur pembuatan koin Token-2022, jadi token resmi bisa berada di program mana pun. Bila salah, `upgrade_score` tidak akan pernah bisa dipakai. `set_utility_mint` juga belum memverifikasi token program dan decimals seperti diminta SPEC §5.2 dan §5.6.
- Keputusan: `upgrade_score` memakai `anchor_spl::token_interface` sehingga menerima kedua program, dengan constraint bahwa mint dan token account dimiliki token program yang dikirim. `set_utility_mint(expected_decimals)` menolak account yang bukan milik SPL Token atau Token-2022 (`InvalidTokenProgram`), mint yang belum diinisialisasi, dan mint dengan decimals berbeda (`InvalidUtilityMint`). Event `UtilityMintSet` mencatat token program dan decimals.
- Alasan: Satu jalur kode untuk kedua standar menghindari rilis ulang program bila token resmi ternyata Token-2022, dan pengecekan decimals mencegah harga training meleset 10^n kali.
- Dampak: Mirror token devnet harus dibuat di program dan dengan decimals yang sama dengan token mainnet (SPEC §5.1).
- Komponen terkait: `programs/district/src/utility_token.rs`, `programs/district/src/instructions/set_utility_mint.rs`, `programs/district/src/instructions/upgrade_score.rs`
- Menggantikan: —

## D-0018 — Struktur modular dan perbaikan gerbang rilis

- Tanggal: 2026-10-09
- Status: Implemented
- Pemilik keputusan: Engineering
- Konteks: `lib.rs` berisi semua instruksi dan account (849 baris), `tests/integration.rs` 2.560 baris, `packages/config/src/network.ts` mencampur parsing, validasi public key dan gerbang rilis, dan store web mencampur roster, training dan UI. Selain itu `REPO_PLACEHOLDER_ADDRESSES` berisi string yang tidak sama dengan isi `config/*.json`, sehingga `validateProductionReadiness` tidak menandai koleksi devnet serta koleksi dan treasury mainnet.
- Keputusan: Program dipecah menjadi `instructions/` (satu file per instruksi), `state/`, `constants.rs`, `progression.rs`, `pda.rs` dan `utility_token.rs`; test integrasi menjadi `tests/integration/` dengan `harness/` dan satu file per area. `@bas/config` dipecah menjadi `network.ts`, `pubkey.ts`, `readiness.ts` dan `template-uri.ts`. Store web dipecah menjadi `stores/slices/` dengan API publik yang sama. String placeholder diperbaiki dan sebuah test memastikan setiap alamat kritis di kedua manifest ditandai. Workflow sementara `.github/workflows/diagnose.yml` dihapus, dan CI menambahkan `cargo fmt --check`.
- Alasan: File kecil dengan satu tanggung jawab lebih mudah direview dan diaudit; bug placeholder membuat gerbang rilis bisa lolos dengan alamat palsu.
- Dampak: Tidak ada perubahan perilaku web; urutan interaksi yang sama menghasilkan output yang identik sebelum dan sesudah refactor. Path file yang dirujuk entri lama (misalnya `src/lib.rs`, `src/state.rs`, `tests/integration.rs`) kini berada di lokasi baru di atas.
- Komponen terkait: `programs/district/src/**`, `programs/district/tests/integration/**`, `packages/config/src/*`, `apps/web/src/stores/**`, `.github/workflows/verify.yml`
- Menggantikan: —

## D-0019 — Prize pool dibiayai fee sharing Pump.fun ke vault program

- Tanggal: 2026-10-09
- Status: Approved (pemilik, 2026-10-09) — program `prize_vault` belum dibuat
- Pemilik keputusan: Pemilik proyek
- Konteks: Pemilik ingin prize pool dibiayai dari "tax" dan dana itu tidak bisa ditarik tim. Pump.fun tidak punya pajak beli/jual untuk creator; yang ada creator fee (0.30% di bonding curve; di PumpSwap 0.30% pada tier pertama, lalu 0.95% turun bertingkat sampai 0.05%). Angka "tax 2%" di GMGN pada token pembanding ternyata fee pool Meteora DLMM untuk penyedia likuiditas, bukan pajak token. Dokumentasi resmi Pump.fun menunjukkan fee sharing bisa membagi creator fee ke maksimal 10 alamat, daftar penerimanya hanya bisa diatur sekali (`update_fee_shares_v2`, lalu `admin_revoked = true`), dan distribusinya (`sweep_creator_fee`, `transfer_creator_fees_to_pump_v2`, `distribute_creator_fees_v2`) permissionless, dengan SOL dikirim langsung ke tiap alamat.
- Keputusan: Prize pool hanya dibiayai creator fee lewat fee sharing Pump.fun dengan pembagian 5000 / 3000 / 2000 bps ke `PrizePoolVault` (PDA program `prize_vault`), `OperationsTreasury` (multisig) dan `SecurityReserve` (multisig). Pembagian dikunci sekali saat launch. Program `prize_vault` hanya punya `initialize`, `fund_season`, `finalize_winners`, `claim` dan `rollover`, tanpa `withdraw`. Bot proyek menjalankan distribusi fee secara rutin. Tidak memakai pajak transfer Token-2022 dan tidak membuat pool likuiditas sendiri.
- Alasan: Satu-satunya jalur yang tidak butuh kunci pribadi tim untuk memindahkan dana ke vault, bisa dicek publik di akun `sharing_config`, dan tidak butuh modal likuiditas.
- Dampak: Hadiah dibayar dalam SOL. Persentase tidak bisa diubah setelah dikunci, jadi aturan lama "perubahan persentase lewat multisig dan pengumuman tujuh hari" di PRIZE_POOL_MODEL §4 dihapus. Alamat vault, kedua multisig dan program ID `prize_vault` harus final sebelum launch. Pump.fun tetap bisa memasang admin baru lewat `admin_cto_sharing_config` (community takeover), dan ini harus diungkapkan. Pengiriman SOL ke PDA program harus lulus test fork mainnet sebelum launch. "Multisig prize vault" di SPEC §5.8 kini berarti vault milik program, dengan multisig sebagai authority finalisasi.
- Komponen terkait: `docs/id/PRIZE_POOL_MODEL.md` §0, §4, §5, §14, §15; `programs/prize_vault` (belum ada)
- Menggantikan: alokasi manual oleh treasury di PRIZE_POOL_MODEL §4 versi sebelumnya

## D-0020 — UI/UX dikerjakan dulu dengan data mock

- Tanggal: 2026-10-09
- Status: Approved (pemilik, 2026-10-09)
- Pemilik keputusan: Pemilik proyek
- Konteks: Program `district` sudah lulus test, tetapi alur di layar (kota, NFT berjalan, misi, training, season) belum bisa dicoba. Mendesain contract lanjutan sebelum alurnya terasa berisiko menghasilkan instruksi yang tidak dipakai.
- Keputusan: UI/UX dikerjakan lebih dulu dengan data mock, lalu disambungkan ke chain. Semua akses data web lewat satu interface adapter dengan dua implementasi, `mock` dan `chain`. Data mock memakai bentuk yang sama dengan account on-chain (`CitizenState`, `Config`, receipt) dan aturan yang sama (stat maksimal 10, tier 3/6/10, biaya training dari `progression`), sehingga UI tidak menjanjikan hal yang tidak bisa dilakukan program.
- Alasan: Iterasi UI murah, contract mahal diubah setelah audit. Mock yang mengikuti bentuk account membuat penggantian ke chain hanya mengganti adapter.
- Dampak: Urutan kerja di dokumen status berubah: UI/UX + mock sebelum deploy devnet dan integrasi wallet. Perubahan aturan yang ditemukan saat mencoba UI dicatat sebagai keputusan baru sebelum program diubah.
- Komponen terkait: `apps/web/src/stores/**`, `packages/chain-client`
- Menggantikan: urutan kerja sebelumnya di dokumen status (validator → devnet → mint → wallet → UI)

## D-0021 — Kota 2D isometrik dengan Phaser 3, citizen memakai art NFT

- Tanggal: 2026-10-09
- Status: Approved (pemilik, 2026-10-09) — scene Phaser dan semua layar sudah jalan di web dengan data mock (9 Okt 2026); kanvas desain awal dihapus karena website sekarang jadi acuannya
- Pemilik keputusan: Pemilik proyek
- Konteks: Pemilik membandingkan kota 3D (Three.js lewat React Three Fiber) dengan 2D. Art citizen berupa potret statis 1000×1000 tanpa sprite jalan, dan background courtyard yang sudah ada berbentuk isometrik. Kota 3D butuh versi voxel per citizen dan kira-kira 1,5–2 kali waktu pengerjaan.
- Keputusan: Kota dibuat 2D isometrik dengan Phaser 3. Citizen di kota memakai art NFT asli yang diperkecil dan bergerak dengan animasi lompat (hop dan squash), tanpa sprite jalan baru. Layar didesain dulu sebelum coding: peta kota, profil citizen, papan misi, training, season dan prize vault, serta versi HP. Distrik yang terkunci di peta mengikuti tier citizen yang sedang dipilih.
- Alasan: Paling cepat dibuat, langsung cocok dengan art NFT dan aset yang ada, dan ringan di HP.
- Dampak: Pertanyaan "Phaser 3" di dokumen status terjawab. Tileset kota final masih butuh art; desain sekarang memakai peta mock yang digambar dari kode. Sprite jalan bisa ditambahkan nanti tanpa mengubah alur.
- Komponen terkait: `apps/web/src/game/*` (scene Phaser), `apps/web/src/components/**` (layar), `scripts/mock-city/generate_city.py` (peta mock), `apps/web/public/sprites/citizens/*`
- Menggantikan: —

## D-0022 — Role citizen dibaca dari nama file metadata

- Tanggal: 2026-10-09
- Status: Implemented (pemilik menyetujui 2026-10-09; 31 unit test dan 63 integration test lulus)
- Pemilik keputusan: Pemilik proyek
- Konteks: D-0015 membiarkan pemegang memilih role sebagai argumen `register_citizen`, sehingga role tidak dijamin cocok dengan art. Art setiap citizen sudah menunjukkan role-nya, `content/en/citizens.json` sudah memetakan role per karakter, dan lapisan kelangkaan "sebaran role" di desain hanya berlaku bila role tetap sejak mint. Membaca plugin atribut Metaplex Core di program terlalu rumit dibanding nama file yang sudah diperiksa D-0013.
- Keputusan: File metadata dinamai `<serial>-<role>.json` di bawah prefix template yang disetujui, misalnya `018-navigator.json`. `register_citizen` tidak lagi punya argumen; program mengambil nama file dari URI asset lewat `ApprovedTemplate::approved_file_name`, lalu `roles::role_from_metadata_file` membaca code name huruf kecil setelah `-` terakhir. Serial di depannya tidak boleh kosong. Nama file tanpa role yang dikenal ditolak dengan `InvalidRole`. Role tetap ditulis sebagai atribut di JSON metadata agar tampil di marketplace, tetapi program tidak membacanya.
- Alasan: Role melekat pada NFT sejak mint, cocok dengan art, bisa dilihat pembeli sebelum membeli, dan sebaran role bisa dikendalikan. Caranya memakai pemeriksaan URI yang sudah ada, tanpa parser atribut baru.
- Dampak: Penamaan file metadata wajib benar sebelum mint karena role tidak bisa diubah setelahnya; daftar file harus dicek sebelum Candy Machine diisi. `@bas/chain-client` mengekspor `roleFromMetadataFile` dan `metadataFileName` dengan aturan yang sama, dan test paritas membandingkannya dengan `roles.rs`. Fixture test kini memakai `013-pioneer.json`.
- Komponen terkait: `programs/district/src/roles.rs`, `programs/district/src/state/approved_template.rs`, `programs/district/src/instructions/register_citizen.rs`, `programs/district/src/lib.rs`, `programs/district/tests/integration/{harness,register.rs,pause.rs}`, `packages/chain-client/src/{stats,types}.ts`, `README.md`
- Menggantikan: pemilihan role sebagai argumen `register_citizen` di D-0015

## D-0023 — Sebaran role saat mint, clan sebagai fitur tahap berikutnya

- Tanggal: 2026-10-09
- Status: Approved (pemilik, 2026-10-09) — sebaran role sudah ada di content dan test; clan belum dibuat
- Pemilik keputusan: Pemilik proyek
- Konteks: Role kini melekat di NFT sejak mint (D-0022), sehingga jumlah warga per role ditetapkan saat mint dan menjadi lapisan kelangkaan. Pemilik juga menanyakan apakah konsep ini seperti clan.
- Keputusan: (1) Supply 100 dibagi: Artisan 20, Steward 18, Pioneer 16, Scholar 14, Mentor 12, Sentinel 10, Navigator 10, disimpan sebagai `mintSupply` di `content/en/roles.json`. Sebelum mint, angka ini dicocokkan dengan art yang ada; kalau art per role berbeda, angka disesuaikan ke art lewat keputusan baru. (2) Clan adalah tim lintas role, bukan role. Clan dikerjakan setelah kota, misi, training dan season berjalan. Versi pertama: 5–7 citizen dari wallet berbeda dengan minimal 3 role berbeda, poin clan dari event distrik dan leaderboard clan per season, hadiah berupa title, banner dan kosmetik tanpa uang, dan data disimpan di server tanpa program on-chain baru. Clan hanya ikut prize pool SOL lewat keputusan baru.
- Alasan: Role memberi identitas dan kelangkaan, jadi harus selesai sebelum mint. Clan memberi komunitas dan baru berguna setelah ada cukup pemain dan event. Event seperti Blackout Night butuh tiga stat, sehingga clan berisi satu role saja tidak bisa menyelesaikannya.
- Dampak: Test `@bas/content` memastikan total `mintSupply` sama dengan `maxSupply` devnet dan mainnet, dan Sentinel serta Navigator paling langka; mengubah `maxSupply` berarti mengubah sebaran ini juga. File metadata harus mengikuti sebaran ini (`<serial>-<role>.json`). Prize pool tetap per citizen: satu wallet, satu citizen per kompetisi.
- Komponen terkait: `content/en/roles.json`, `packages/content/src/{types,validate}.ts`, `packages/content/test/citizens.test.ts`, doc desain dan doc status
- Menggantikan: —

## D-0024 — Parameter peluncuran: harga mint, biaya training, art, tileset, multisig, host metadata

- Tanggal: 2026-10-09
- Status: Approved (pemilik meminta rekomendasi diterapkan, 2026-10-09) — harga mint sudah ada di config dan test; butir lain adalah langkah persiapan sebelum mint
- Pemilik keputusan: Pemilik proyek
- Konteks: Lima pertanyaan terbuka di dokumen status perlu jawaban sebelum mint, dan pemilik menetapkan bahwa mint tidak gratis tetapi berbiaya 0,01 SOL.
- Keputusan:
  1. Harga mint 0,01 SOL. `mintPriceLamports` bernilai `"10000000"` di `config/devnet.json` dan `config/mainnet.json`; guard `solPayment` di Candy Guard menariknya ke `solTreasury`. Dengan 100 citizen, total pendapatan mint 1 SOL, jadi harga ini terutama menyaring spam dan bot, bukan sumber dana utama.
  2. Biaya dasar training tetap 100 token per level (`baseTrainingCostAtoms` `100000000` pada 6 decimals). Menaikkan satu stat dari 0 ke 10 butuh 5.500 token. Harga token baru diketahui setelah launch, jadi nilai ini boleh diubah lewat `update_config` oleh multisig, dengan pengumuman lebih dulu dan event `ConfigUpdated`.
  3. Sebaran role dan art: 20 art yang sudah ada (Artisan 5, Steward 4, Sentinel 4, Scholar 2, Mentor 2, Navigator 2, Pioneer 1) masih di bawah kuota D-0023. Sisa 80 art digambar mengikuti sisa kuota: Artisan 15, Pioneer 15, Steward 14, Scholar 12, Mentor 10, Navigator 8, Sentinel 6. Test `@bas/content` gagal bila art suatu role melebihi kuotanya.
  4. Tileset kota final: tileset isometrik original dengan ubin 64×32 piksel, digambar artist dalam gaya pixel yang sama dengan art NFT, dengan palet berbeda per distrik. Sampai tileset jadi, kota memakai peta mock yang digambar dari kode. Aset pihak ketiga hanya boleh dipakai dengan lisensi komersial yang dicatat di `apps/web/public/licenses`.
  5. Multisig: Squads v4, 2-of-3. Satu multisig memegang admin program, upgrade authority (dengan time lock 48 jam), update authority Core Collection, dan authority finalisasi pemenang; `OperationsTreasury` dan `SecurityReserve` memakai vault terpisah di dalam multisig yang sama. Tiga signer di perangkat berbeda, minimal satu hardware wallet, dan tidak ada kunci yang dipegang AI atau server. Disiapkan dan diuji di devnet dulu.
  6. Host metadata: devnet memakai hosting web app sendiri (gratis), misalnya `https://<app>/templates/7/`. Untuk mainnet, ditinjau ulang sebelum launch; kandidat utamanya Arweave lewat Turbo (ar.io/ArDrive), diunggah sebagai satu folder dengan path manifest berisi `templates/7/`, sehingga `approvedTemplateUriPrefix` menjadi `https://arweave.net/<manifest-id>/templates/7/`. Data di Arweave permanen dan tidak bisa diubah, cocok dengan role yang dikunci di nama file (D-0022). Upload dilakukan sekali setelah ke-100 file metadata dan gambar dicek. Bukan lewat Irys: endpoint Irys yang menyimpan ke Arweave dihentikan 1 November 2026 dan upload barunya pindah ke jaringan Irys sendiri. Metaplex Umi punya `@metaplex-foundation/umi-uploader-arweave-via-turbo`. Biaya dibayar sekali di muka dengan Turbo Credits (kartu, SOL atau USDC); perkiraan Oktober 2026 untuk 100 gambar sekitar 44 MB adalah beberapa dolar, dan file JSON di bawah 105 KiB gratis.
- Alasan: Harga mint kecil tetap menyaring bot tanpa menghalangi pemain. Biaya training dipertahankan karena sudah dipakai di test dan desain, dan tetap bisa disesuaikan setelah harga token terlihat. Tileset original menjaga gaya yang sama dengan art NFT. Multisig 2-of-3 menghindari satu kunci yang bisa menarik atau mengganti program. Arweave membuat metadata dan role tidak bisa diganti diam-diam.
- Dampak: `@bas/config` memvalidasi `mintPriceLamports` sebagai string desimal positif dan test memastikan devnet dan mainnet sama-sama 0,01 SOL. Prefix `metadata.example.invalid` tetap ditolak gerbang rilis sampai diganti alamat Arweave. Alamat multisig dan vault harus final sebelum fee sharing Pump.fun dikunci (D-0019).
- Komponen terkait: `config/devnet.json`, `config/mainnet.json`, `packages/config/src/{types,network}.ts`, `packages/config/test/config.test.ts`, `packages/content/test/citizens.test.ts`, doc status
- Menggantikan: —

## D-0025 — Cara misi dimainkan, batas harian, pilihan stat, dan poin season

- Tanggal: 2026-10-09
- Status: Approved (pemilik meminta rekomendasi diterapkan, 2026-10-09) — sudah jalan di web dengan data mock; mission server dan program belum
- Pemilik keputusan: Pemilik proyek
- Konteks: Training butuh credit dari misi, tetapi langkah misi di preview masih berupa tombol. Pemilik meminta empat hal terbuka diputuskan sesuai rekomendasi: bentuk tiap langkah, batas misi, misi dengan dua pilihan stat, dan poin season.
- Keputusan:
  1. Tiap langkah misi memakai satu dari tiga jenis: `goto` (jalankan citizen di mode CONTROL ke penanda di peta; langkah selesai saat citizen tiba), `talk` (pilih satu dari tiga jawaban; jawaban salah boleh diulang) dan `puzzle` (susun bagian dalam urutan yang benar; salah urutan mengulang dari awal). Langkah, lokasi tujuan dan teksnya ditulis di definisi misi, bukan di kode layar.
  2. Batas: satu misi hanya bisa diselesaikan sekali per citizen per hari season, maksimal 3 credit misi per citizen per hari, dan satu citizen hanya mengerjakan satu misi pada satu waktu. Event distrik mengikuti jadwal event-nya sendiri.
  3. Misi dengan dua pilihan stat (Night patrol, Expedition to the ruins): pemain memilih stat credit saat menekan START, dan pilihan itu tidak bisa diganti sampai misi selesai atau dibatalkan.
  4. Poin season: 100 poin per misi selesai dan 150 poin per tugas event. Training tidak memberi poin, sehingga peringkat datang dari aktivitas, bukan dari banyaknya token yang dibakar.
- Alasan: Tanpa batas harian, credit bisa di-farm dan kenaikan stat hanya soal token. Tiga jenis langkah cukup untuk misi pertama dan semuanya bisa diperiksa mission server. Memilih stat di awal membuat klaim yang ditandatangani server terikat ke satu stat sejak misi dimulai.
- Dampak: Mission server (Stage 5) harus memeriksa urutan langkah, batas harian dan stat pilihan sebelum ikut menandatangani `claim_training_credit`. Program tidak berubah: batas harian dijaga server, dan program tetap menolak klaim yang dipakai ulang. Di web, adapter mock menjalankan aturan yang sama dan punya tombol "next day" khusus mock untuk menguji batas harian.
- Komponen terkait: `apps/web/src/lib/data/{types,missions}.ts`, `apps/web/src/lib/data/mock/*`, `apps/web/src/components/missions/*`, `apps/web/src/game/CityScene.ts`, `apps/web/src/messages/en.json`
- Menggantikan: —

## D-0026 — Build SBF dengan toolchain Solana 1.18.26, tanpa `anchor build`

- Tanggal: 2026-10-09
- Status: Approved (pemilik meminta langkah validator dikerjakan, 2026-10-09) — build dan test SBF lolos, belum di-deploy ke devnet
- Pemilik keputusan: Pemilik proyek
- Konteks: Program baru diuji di host. Saat build SBF pertama, `Cargo.lock` berisi versi dependency yang butuh Rust lebih baru dari rustc 1.75 milik platform-tools v1.41, dan formatnya versi 4 yang tidak dibaca cargo 1.75. `anchor build` 0.30.1 juga menulis ulang `declare_id!` dari keypair acak di `target/deploy`, dan build IDL-nya mencoba mengunduh toolchain lain.
- Keputusan: (1) `rust-version = "1.75.0"` di workspace, sehingga cargo memilih versi dependency yang masih bisa di-build platform-tools dan `Cargo.lock` tetap format 3. `blake3` dikunci ke 1.5.5 karena tidak mencantumkan versi Rust minimum. (2) Build memakai `pnpm program:build` (`cargo build-sbf`) dan test pada binary SBF memakai `pnpm program:test-sbf` (`cargo test-sbf`). Anchor CLI 0.30.1 hanya dipakai untuk deploy. (3) `programs/Anchor.toml` mendaftarkan program di `[workspace] members = ["district"]`, karena file itu ada di `programs/`, bukan di root.
- Alasan: Program harus di-build dengan compiler yang sama dengan yang dipakai saat deploy. Program id tidak boleh berubah diam-diam saat build, karena dicek oleh test paritas.
- Dampak: Hasil 9 Oktober 2026: `district.so` 469.304 byte; 31 unit test dan 63 test instruksi lolos pada binary SBF; compute unit terbesar 29.589 (`initialize_config`, batas 200.000); `initialize_config` berhasil di `solana-test-validator` dengan 29.129 CU. Deploy program butuh sekitar 3,27 SOL untuk rent, jadi wallet devnet perlu minimal sekitar 4 SOL devnet ditambah biaya transaksi. Test paritas program id tetap jalan.
- Komponen terkait: `Cargo.toml`, `Cargo.lock`, `programs/district/Cargo.toml`, `programs/Anchor.toml`, `package.json`, `README.md`
- Menggantikan: —

## D-0027 — Program id devnet, script deploy, dan prefix metadata devnet

- Tanggal: 2026-10-09
- Status: Approved (pemilik meminta semua disesuaikan, 2026-10-09) — script sudah diuji lengkap di validator lokal; deploy devnet menunggu pemilik menjalankannya
- Pemilik keputusan: Pemilik proyek
- Konteks: Jaringan devnet tidak bisa dihubungi dari ruang kerja Claude, jadi deploy harus dijalankan dari laptop pemilik. Program id lama (`D8HG…`) hanya placeholder dan keypair-nya tidak ada.
- Keputusan:
  1. Program id devnet adalah `82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym`, dengan keypair di `programs/district/keypair.json` (di-gitignore). Keypair ini hanya dipakai saat deploy pertama; setelah itu yang berkuasa adalah upgrade authority, yaitu wallet deployer milik pemilik. Mainnet membuat keypair sendiri sebelum build mainnet, dan gerbang rilis mainnet menolak id devnet (`DEVNET_ONLY_ADDRESSES`).
  2. Deploy lewat `scripts/devnet/deploy.sh` (WSL), setup lewat `pnpm devnet:setup` (`scripts/devnet/setup.mjs`, hanya modul bawaan Node). Setup membuat mission authority, token tiruan Token-2022 dengan 6 desimal dan 1.000.000 token uji, koleksi Metaplex Core, lalu menjalankan `initialize_config`, `set_utility_mint`, `lock_utility_mint` dan unpause. Script bisa diulang dan langkah yang sudah selesai dilewati.
  3. Treasury SOL devnet memakai wallet deployer. Prefix metadata devnet adalah `https://bas-district-devnet.vercel.app/templates/7/`. Prefix ini tidak bisa diubah setelah `initialize_config`, jadi web app devnet di-deploy dengan nama proyek Vercel itu.
  4. Prefix metadata devnet dan mainnet boleh berbeda: devnet memakai web app devnet, mainnet memakai host permanen (D-0024 butir 6).
- Alasan: Kunci deployer tetap di tangan pemilik. Script tanpa dependency tidak perlu `pnpm install` baru dan tidak menambah library Solana kedua ke repositori. Urutan setup mengikuti D-0016: mulai dalam keadaan pause, mint diikat dan dikunci, baru unpause.
- Dampak: Rehearsal lengkap di `solana-test-validator`, dengan program Metaplex Core asli dimuat, berhasil pada 9 Oktober 2026. Hasilnya: deploy, token, koleksi, config, mint terkunci dan district live; menjalankan ulang tidak mengubah apa-apa. Test `@bas/config` dan `@bas/chain-client` tetap lolos sebelum dan sesudah `config/devnet.json` diisi alamat asli. Mint NFT (Candy Machine, Candy Guard, royalti) adalah langkah berikutnya.
- Komponen terkait: `scripts/devnet/{deploy.sh,solana.mjs,setup.mjs}`, `docs/id/DEVNET_DEPLOY_ID.md`, `programs/district/src/lib.rs`, `programs/Anchor.toml`, `config/*.json`, `packages/config/src/readiness.ts`, `packages/config/test/config.test.ts`, `packages/chain-client/test/chain-client.test.ts`, `.gitignore`, `package.json`
- Menggantikan: placeholder program id `D8HG…` dari D-0010 (untuk devnet)
