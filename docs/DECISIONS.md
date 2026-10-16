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
- Status: Implemented (kini berlaku pada `upgrade_score`, pengganti `train_stat`; dicakup `programs/district/tests/integration/upgrade.rs` dan `utility_mint.rs`)
- Pemilik keputusan: Security
- Konteks: `train_stat` membakar token melalui CPI ke `ctx.accounts.utility_mint` tanpa membandingkannya dengan `config.utility_mint`. Error `DistrictError::InvalidUtilityMint` sudah dideklarasikan tetapi tidak pernah dipakai. Pemanggil dapat meneruskan mint apa pun yang ia kendalikan, membakar token tanpa nilai, dan tetap menaikkan skor kanonik.
- Keputusan: Menambahkan tiga pemeriksaan pada `train_stat`: `utility_mint` harus sama dengan `config.utility_mint`, `user_token_account.owner` harus sama dengan `owner` citizen, dan `user_token_account.mint` harus sama dengan `config.utility_mint`.
- Alasan: Spesifikasi mensyaratkan pembakaran 100% token resmi pada setiap pelatihan dan melarang skor kanonik dinaikkan tanpa pembakaran yang sah.
- Dampak: Sudah lolos `cargo check --all-targets` di CI, tetapi belum ada test Anchor dan belum pernah di-build ke BPF. Wajib `anchor build` dan `anchor test` sebelum deploy, ditambah uji regresi yang menolak mint asing.
- Komponen terkait: `programs/district/src/lib.rs`, `programs/district/src/errors.rs`
- Menggantikan: —

## D-0005 — Verifikasi koleksi pada `register_citizen`

- Tanggal: 2026-10-08
- Status: Implemented (integration test lulus dan build SBF lolos per D-0026; review Security tetap wajib)
- Pemilik keputusan: Security
- Konteks: `register_citizen` menerima `asset: AccountInfo` apa pun dan menyimpannya sebagai citizen, sehingga progres bisa ditempelkan ke mint yang bukan bagian dari koleksi resmi. `DistrictError::InvalidCollection` sudah dideklarasikan tetapi tidak pernah dipakai — pola yang sama dengan `InvalidUtilityMint` pada D-0004.
- Keputusan: Verifikasi keanggotaan koleksi dilakukan **di dalam program**, bukan di client. `register_citizen` membaca prefix account Metaplex Core `AssetV1` dan menolak kalau (1) account bukan asset Core yang tidak dikompresi, (2) update authority-nya bukan `Collection`, (3) collection-nya bukan `config.collection_mint`, atau (4) pemilik asset bukan signer. Account `mpl_core_program` wajib diserahkan dan `asset` diberi constraint `owner = mpl_core_program`, jadi byte yang dibaca dijamin ditulis oleh program Metaplex Core yang asli. Cara bacanya dicatat di D-0011.
- Alasan: `packages/metaplex-client` yang diwajibkan `TECH_STACK_ID.md` §11 memang belum ada, tetapi package itu untuk pembacaan off-chain. Pemeriksaan yang melindungi skor kanonik harus terjadi on-chain; menunda sampai adapter tersedia berarti membiarkan celah yang sudah diketahui tetap terbuka.
- Dampak: Instruksi `register_citizen` bertambah satu account wajib (`mpl_core_program`). Program belum pernah di-deploy, jadi tidak ada client lama yang rusak; `@bas/chain-client` mengekspor `MPL_CORE_PROGRAM_ID` dan `CORE_ASSET_LAYOUT` untuk calon integrasi wallet. Celah "jangan buka mint publik sebelum ini beres" sudah tertutup, tetapi tetap wajib diuji terhadap validator sebelum deploy.
- Komponen terkait: `programs/district/src/lib.rs`, `programs/district/src/mpl_core.rs`, `programs/district/src/errors.rs`, `packages/chain-client/src/constants.ts`
- Menggantikan: —

## D-0006 — Instruksi `set_paused` untuk urutan rilis

- Tanggal: 2026-10-08
- Status: Implemented (instruksi ada di program, dicakup `programs/district/tests/integration/admin.rs` dan dipakai `scripts/devnet/setup.mjs`; persetujuan pemilik atas authority belum tercatat di sini). Catatan: field yang menjaganya kini `admin` dengan error `Unauthorized`, bukan `authority` dan `UnauthorizedAuthority`
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

## D-0028 — Kota pixel art detail tinggi dengan suasana hidup

- Tanggal: 2026-10-11
- Status: Approved (pemilik meminta tampilan kota lebih bagus dan hidup, 2026-10-11) — District 01 sudah memakai gaya ini; seluruh peta ikut karena digambar oleh satu generator
- Pemilik keputusan: Pemilik proyek
- Konteks: Tampilan kota mock (kotak berwarna datar) terlihat umum dan terlalu sederhana. Pemilik memilih tetap pixel art tetapi dengan bangunan yang lebih nyata, dan kota yang terasa hidup. Keputusan D-0021 (Phaser 3, 2D isometrik) tidak diubah.
- Keputusan: (1) `scripts/mock-city/generate_city.py` digambar ulang pada ukuran akhir 1280×800 (ubin 48×24, sebelumnya digambar setengah ukuran lalu diperbesar). Dinding digambar sebagai tekstur datar (bata, batu, plester, kayu, genteng, jendela, pintu, lentera) lalu dibentuk ke sisi isometrik dengan transformasi affine. Atap pelana dan piramida, bayangan di tanah dari sisi kiri (cahaya dari kanan), jalan berbatu dengan trotoar, laut, dan busa pantai. Kontrak `cityLayout.json` tetap sama (grid, blocked, spots, props), ditambah `lights`, `smoke`, dan `water` sebagai titik jangkar animasi. (2) `apps/web/src/game/cityAmbience.ts` menambah siklus siang-malam 6 menit, jendela dan lampu yang menyala malam hari, asap cerobong, air mancur, bayangan awan, burung, dan tujuh warga kota yang berjalan. Semuanya murni tampilan: tidak ada state, tidak menyentuh progres, dan warga kota tidak bisa masuk distrik yang terkunci.
- Alasan: Gaya pixel art tetap cocok dengan art NFT dan ringan di HP. Mengubah gambar tanpa mengubah kontrak layout membuat logika jalan, urutan gambar, dan kunci distrik tetap bekerja.
- Dampak: Aset `city-base.png`, `city-props.png`, dan `lock-*.png` dibuat ulang (jalankan ulang generator bila peta diubah). Bangunan, pohon, kios, dan peti baru ikut memblokir sel, jadi `spots` ikut berubah. Tileset final dari artist tetap menggantikan ini sesuai D-0024 butir 4.
- Komponen terkait: `scripts/mock-city/generate_city.py`, `apps/web/src/game/{CityScene,cityAmbience,cityGrid}.ts`, `apps/web/src/game/cityLayout.json`, `apps/web/public/images/city/*`
- Menggantikan: —

## D-0029 — Peta diperluas ke 40×40 dan kamera layar penuh

- Peta tumbuh dari 26×26 menjadi 40×40 sel (kanvas 2000×1240). Kota lama digeser +8 sel ke dalam; waypoint misi di `mockSnapshot.ts` ikut digeser.
- Zona baru: plaza di tengah, distrik arsip/forge/hearth/watch/summit lebih luas, pantai (frontier) dengan mercusuar dan pondok pantai.
- Ditambahkan banyak rumah, pohon, lampu, dan peti; generator memeriksa semua sel misi tetap terjangkau dari plaza.
- Kamera kini mode "cover": peta selalu memenuhi layar, zoom minimum dihitung dari ukuran layar, batas kamera = batas peta, awal di citizen terpilih.
- Aset tetap placeholder (lihat D-0024).

## D-0030 — Sprite jalan 4 arah (placeholder) dan panah arah hadap

- Peta isometrik membuat arah hadap sulit dinilai, sedangkan sprite potret citizen hanya satu gambar menghadap depan.
- `scripts/mock-city/generate_walkers.py` membuat `sprites/walkers.png`: satu baris per citizen, empat arah (bawah, atas, kiri, kanan) × tiga frame (diam, langkah A, langkah B). Warna diambil dari potret tiap citizen; metadata di `walkerSheet.json`.
- Sprite ini placeholder yang digambar lewat kode, sama seperti aset kota (D-0024). Potret asli tetap dipakai di UI. Pengganti dari artis cukup menimpa `walkers.png` dengan tata letak yang sama.
- `CityScene` memilih frame dari arah hadap di layar, baik untuk keyboard maupun rute klik. Panah emas di kaki citizen terpilih menunjukkan arah hadap.

## D-0031 — Rotasi kota 90° (empat sisi pandang)

- Kota digambar dari empat sisi. `scripts/mock-city/generate_city_all.py` menjalankan `generate_city.py` empat kali (`BAS_ROT=0..3`) dan menggabungkan hasilnya ke `cityLayout.json` (`views[0..3]`). Penempatan bangunan dihitung dalam sel logis (sisi 0), lalu diputar ke sel tampilan; skrip memastikan keempat sisi menempatkan bangunan yang sama.
- Aset per sisi: `city-base`, `city-props`, `lock-*` dengan akhiran `-r1..-r3` (sisi 0 tanpa akhiran). Hanya satu sisi yang dimuat di memori; memutar kota menukar tekstur dan memulai ulang scene.
- `cityGrid.ts` menjawab untuk sisi aktif (`setView`). Sel misi tetap bernomor sisi 0; `toView`/`fromView` menerjemahkannya. Posisi citizen dibawa lewat `turnWorld` sehingga mereka tetap berdiri di tanah yang sama.
- Kontrol: tombol putar kiri/kanan di panel zoom, serta `Q` (kiri) dan `E` (kanan).
- Aset tetap placeholder (lihat D-0024).

## D-0032 — Kota dilihat dari depan (tidak miring); D-0030 dan D-0031 dibatalkan

- Sudut pandang isometrik (belah ketupat) diganti dengan tampilan oblique dari depan: sel berbentuk persegi 40×40 px, x ke timur dan y ke selatan. Bangunan digambar sebagai dinding depan ditambah atap dari atas, sehingga tombol kiri/kanan/atas/bawah sama dengan arah di peta.
- Peta menjadi 1920×1960 px (40×40 sel). `generate_city.py` memakai proyeksi ini; urutan gambar (painter's order) kini berdasarkan baris tepi depan (`gy + depth`).
- Rotasi 90° (D-0031) dihapus karena tampilan dari depan tidak membutuhkannya: `generate_city_all.py`, aset `-r1..-r3`, tombol putar, dan tombol `Q`/`E`.
- Sprite jalan 4 arah buatan kode (D-0030) dihapus. Citizen kembali memakai potret aslinya (`/sprites/citizens/*.png`), dibalik saat berjalan ke kiri. Panah emas di kaki citizen terpilih tetap menunjukkan arah hadap.
- Aset tetap placeholder (lihat D-0024).

## D-0033 — Citizen menghadap arah jalannya (sprite depan, belakang, samping)

- Potret peta citizen (`<id>.png`) adalah tampilan tiga perempat yang menghadap kanan, sehingga hanya cocok untuk berjalan ke samping. `CityScene` memilih tampilan dari arah jalan di layar lewat `walkLookFor` (`cityFacing.ts`, sama dengan warga latar): ke samping memakai potret (dicerminkan saat ke kiri), ke bawah memakai sprite tampak depan lurus, ke atas memakai sprite tampak belakang. Gerak diagonal dihitung vertikal bila bagian vertikalnya tidak lebih pendek. Citizen yang berdiri diam mempertahankan tampilan terakhirnya; sebelum bergerak ia menghadap ke bawah.
- Sprite depan dan belakang bersifat opsional: field `spriteFront` dan `spriteBack` di `citizens.json` (`/sprites/citizens/<id>-front.png` dan `-back.png`, 128×128). Tanpa field itu, atau bila gambarnya gagal dimuat, potret samping tetap dipakai untuk tampilan tersebut.
- `scripts/import_back_sprites.py <folder>` mengubah gambar tampak belakang berlatar #FF00FF menjadi sprite peta: latar dan tepi magenta dibuang, lalu gambar diletakkan di kanvas seni profil dan dipotong/diskalakan persis seperti sprite depan (batas seni profil, 128 px, kaki di tepi bawah). Nama file memuat id citizen. Skrip juga menambah `spriteBack` ke `citizens.json` atau arsipnya.
- Panah emas kini selalu searah jalan citizen terpilih, memakai `Walker.face` yang sama dengan yang memilih sprite (sebelumnya ada nilai arah terpisah per scene yang ikut berubah saat tombol ditekan pada citizen yang bukan milik pemain). Panah digambar di tanah di luar cincin: di depan citizen ia tampil di atas sprite, di belakang citizen ia tertutup sprite sehingga tidak menempel di badan.

## D-0034 — Warga kota (non-NFT) digambar ulang lebih besar dan menghadap arah jalannya

- Warga latar yang berjalan di kota (bukan citizen) sebelumnya hanya 12×21 px dan satu pose, sehingga terlihat seperti mainan. Kini mereka 24×46 px, setinggi sprite citizen, dan digambar di kode oleh `villagerSprites.ts`: tiga tampilan (depan, belakang, samping ke kanan) × tiga pose (diam dan satu langkah per kaki), dengan garis tepi, bayangan warna, rambut/topi/syal/rompi/celemek, dan gaun atau celana. Sembilan tampilan orang berbeda.
- `CityAmbience` memilih tampilan dari arah jalan lewat `walkLookFor` (`cityFacing.ts`): ke samping memakai tampilan samping (dicerminkan ke kiri), ke bawah tampilan depan, ke atas tampilan belakang. Pose langkah bergantian tiap 7 px jalan (diam, kiri, diam, kanan).
- Warga latar tidak punya cincin emas atau label nama, sehingga terlihat seperti pemain tetapi bukan citizen. Tetap bukan state: tidak menyentuh progres. Aset tetap placeholder yang digambar kode (lihat D-0024).

## D-0035 — Citizen dan warga kota tidak saling tembus

- Semua yang berjalan di kota (10 citizen dan 9 warga latar) mengikuti rutenya tanpa tahu keberadaan yang lain, sehingga bisa saling menembus. `cityCrowd.ts` menambah satu langkah setelah semua bergerak: pasangan yang berdiri lebih dekat dari lebar badan keduanya didorong menjauh lewat `shove`, yaitu offset di atas posisi rute yang memudar sendiri setelah mereka berjauhan. Rute dan sel citizen tidak berubah.
- Dorongan sebagian mengarah ke kanan masing-masing, sehingga dua orang yang berjalan berhadapan berpapasan seperti pejalan kaki dan tidak saling mendorong di satu garis. Jarak vertikal dihitung lebih ringan karena orang di belakang memang tertutup yang di depan lewat urutan gambar.
- Citizen yang sedang dikendalikan pemain (mode kendali) tidak pernah didorong: semua orang lain yang mengalah. Dorongan tidak pernah memindahkan siapa pun ke tanah yang tidak bisa dipijak (`standable` di `cityGrid.ts`) dan dibatasi 26 px.

## D-0036 — Sprite belakang 10 citizen aktif (placeholder buatan kode)

- Tanpa sprite belakang, citizen yang berjalan ke atas tetap menampilkan potret depan yang dicerminkan, sehingga tampak menghadap ke samping. Sprite belakang untuk 10 citizen aktif kini ada di `apps/web/public/sprites/citizens/<id>-back.png` dan terdaftar sebagai `spriteBack` di `citizens.json`.
- `scripts/mock-city/generate_back_sprites.py` membuatnya dari sprite depan: wajah, hidung, dan barang yang dipegang dihapus, siluet ditutup di bekas barang itu, lalu ditambah detail punggung (kelim jaket, tali topi, kelim tudung). Hasilnya deterministik. Ini placeholder buatan kode seperti aset kota lain (D-0024); gambar buatan artis menggantikannya lewat `scripts/import_back_sprites.py` dengan nama file yang sama.
- Hanya 10 citizen aktif yang punya sprite belakang. Citizen arsip tetap memakai sprite depan sampai mereka diaktifkan.

## D-0037 — Sprite tampak depan lurus untuk 10 citizen aktif (placeholder buatan kode)

- Saat berjalan ke bawah, citizen masih memakai potret tiga perempat (hidung ke kanan), sehingga tampak miring padahal panah menunjuk ke bawah. Kini ada sprite tampak depan lurus: `apps/web/public/sprites/citizens/<id>-front.png`, terdaftar sebagai `spriteFront`. Potret tiga perempat tetap dipakai untuk kiri dan kanan.
- `scripts/mock-city/generate_front_sprites.py` menggambarnya dari bentuk: kepala simetris, sepasang mata yang menatap ke depan, hidung dan mulut di tengah, serta pakaian dengan warna potretnya. Barang yang dipegang (minuman, mug, tabung gas, gandum, roti) disalin dari potret agar tetap sama. Hasilnya deterministik; skrip juga menambah `spriteFront` ke `citizens.json`.
- Seperti sprite belakang, ini placeholder buatan kode (lihat D-0024). Sprite buatan seniman cukup menimpa file dengan nama yang sama.

## D-0038 — Tiang lampu menghalangi jalan

- Generator kota menandai bangunan, pohon, dan peti sebagai sel terblokir, tetapi tidak tiang lampu, sehingga citizen dan warga latar berjalan menembus lampu. `lamp()` di `scripts/mock-city/generate_city.py` kini menandai selnya terblokir (21 sel baru di `cityLayout.json`); pencari rute, kendali keyboard, dan dorongan antar-orang (D-0035) membaca daftar yang sama, sehingga semuanya menghindari lampu.
- Satu lampu yang tadinya digambar dua kali di sel yang sama kini hanya satu, jadi `city-props.png` disusun ulang (props 333 → 332, lampu bercahaya 670 → 669). Gambar tanah dan terkunci tidak berubah. Satu sel buntu di (30, 17) kini terpisah dari plaza; tidak ada tujuan citizen di sana.

## D-0039 — Berkas metadata NFT disajikan dari `/templates/7/`

- Program hanya menerima URI aset `<prefix>/templates/7/<serial>-<role>.json` (D-0013, D-0022), tetapi situs tidak menyajikan berkas itu, sehingga URI devnet (`https://bas-district-devnet.vercel.app/templates/7/`) mengarah ke 404 dan dompet tidak bisa menampilkan citizen. Kini ada 20 berkas di `apps/web/public/templates/7/` (`001-artisan.json` sampai `020-navigator.json`) yang dibuat oleh `scripts/gen-metadata.mjs` (`pnpm metadata`). Isinya: nama, deskripsi, gambar, dan atribut dengan label publik Insight/Bond/Craft serta role.
- `scripts/check-metadata.mjs` (bagian dari tes `@bas/web`) menjaga agar nama berkas cocok dengan aturan program (serial tidak kosong, role dikenal, ekstensi `.json`), gambar yang dirujuk ada, dan prefix cocok dengan `scripts/devnet/setup.mjs`.
- `next.config.mjs` memberi `/templates/*` header `Access-Control-Allow-Origin: *` dan cache 5 menit, karena dompet dan marketplace mengambilnya dari origin lain.
- Berkas ini placeholder sampai set mint final ditetapkan (D-0024); mengubah isinya tidak mengubah kontrak, tetapi mengubah nama berkas atau prefix berarti URI aset di chain tidak lagi disetujui.

## D-0040 — Halaman `/citizen/[id]` dibangun statis dan build standalone membawa berkas konten

- Pada build `standalone`, `/citizen/[id]` memberi error 500 ("cannot locate the repository root"): halaman dirender saat diminta, lalu membaca `content/` dan `config/` dari repo dengan mencari `pnpm-workspace.yaml`, sedangkan bundel deploy hanya memuat berkas yang bisa dilacak build. Terbukti dengan memindahkan folder repo setelah build.
- Perbaikan: (1) `generateStaticParams()` membangun satu halaman per citizen dari roster dan `dynamicParams = false` membuat id di luar roster menjadi 404 asli, jadi tidak ada pembacaan berkas saat runtime untuk halaman ini. (2) `outputFileTracingIncludes` menyertakan `pnpm-workspace.yaml`, `content/en/*.json`, dan `config/*.json` ke bundel agar route dinamis lain yang memakai loader server tetap berjalan. (3) `NEXT_OUTPUT=standalone` memilih output standalone tanpa mengubah build biasa.
- Memverifikasi: bundel standalone yang dipindahkan ke lokasi lain melayani semua halaman tanpa error.

## D-0041 — Error `InvalidMetadataUri` untuk URI metadata yang tidak disetujui

- `register_citizen` melaporkan URI di luar template yang disetujui sebagai `InvalidAssetState`, sama dengan akun aset yang rusak, sehingga pengguna dan klien tidak bisa membedakan "URI salah" dari "aset tidak terbaca". Kini ada varian baru `InvalidMetadataUri` (kode 6020) yang hanya dipakai untuk kasus itu.
- Varian baru diletakkan di akhir enum; kode lama tidak berubah. Tes unit `errors::tests` mengunci nomor kode, dan tes integrasi `rejects_an_unapproved_metadata_uri` memeriksa error baru. Tidak ada IDL atau klien yang menyalin daftar error, jadi `packages/chain-client` tidak berubah.
- Hasil audit kontrak lain yang sengaja tidak diubah: proposal admin yang salah dibatalkan dengan `propose_admin` ke alamat lain (tidak perlu instruksi baru); `upgrade_score` sudah memeriksa saldo sebelum membakar dan overflow biaya menjadi `ArithmeticOverflow`; mint utility yang punya freeze authority atau ekstensi Token-2022 yang menghentikan burn tidak diperiksa di chain, jadi pemeriksaan itu menjadi bagian checklist peluncuran mint (D-0024).

## D-0042 — Pemeriksaan benda tembus, notifikasi tahan tombol, dan kelas Tailwind

- `scripts/mock-city/generate_city.py` kini menolak (assert) setiap benda dekor yang berdiri di sel yang bisa dipijak, sehingga benda baru tidak bisa lagi tembus tanpa terlihat. Semua benda yang ada sudah lolos (setelah lampu, D-0038).
- Menahan tombol arah pada citizen yang bukan milik pemain membuka notifikasi "bukan milik Anda" setiap frame. `CityScene` kini membukanya sekali per penekanan tombol (`notOwnedShown`, direset saat semua tombol dilepas).
- `backdrop-blur-xs` dan `drop-shadow-xs` tidak ada di Tailwind 3.4 sehingga tidak berefek; diganti `backdrop-blur-sm` (`PixelModal`) dan `drop-shadow-sm` (`PixelIcon`).

## D-0043 — Jalur progresi Tier 0 → 3 menjadi alur utama UI

- Tanggal: 2026-10-13
- Status: Approved (pemilik meminta alur UI/UX diselesaikan lebih dulu, 2026-10-13); berjalan di web dengan data mock
- Konteks: Mesin progresinya sudah ada (misi memberi credit, credit plus pembakaran token menaikkan skor, skor 3/6/10 membuka distrik), tetapi tidak ada tempat yang menjawab "saya di mana dan harus apa agar naik". Pemilik baru juga tidak punya titik mulai yang jelas.
- Keputusan:
  1. `apps/web/src/lib/data/journey.ts` menghitung rute satu citizen dari snapshot yang sama dengan layar lain, tanpa copy: per stat skor, tier, sisa upgrade ke tier berikutnya, credit yang dimiliki dan kurang, total token sampai tier itu, distrik yang terbuka, dan misi yang memberi credit stat itu beserta alasan bila belum bisa dimulai. Ditambah tangga tier (3, 6, 10) dan satu langkah berikutnya.
  2. Langkah berikutnya dipilih dengan urutan tetap: upgrade yang sudah terbayar dan mencapai tier baru; misi yang sedang berjalan; upgrade lain yang terbayar; saldo token kurang; misi yang menggerakkan stat terdekat ke tier berikutnya (seri: Insight, Bond, Craft); tunggu besok bila batas harian atau cooldown; selesai bila semua stat 10.
  3. Tampilannya: baris "NEXT STEP" dengan satu tombol di panel citizen di kota, di layar Misi, dan di layar Training; panel "YOUR PATH" penuh di profil pemilik dan di layar Misi (tombol "SHOW MY PATH"). Tombol langkah berikutnya memilihkan stat atau misi di layar tujuan lewat `focus` di store, dibaca sekali lalu dihapus.
  4. Setelah training yang melewati tier, dialog "TIER n REACHED" menyebut distrik yang baru terbuka, satu misi di sana, achievement tier pertama, dan bracket Master pada tier 3.
- Alasan: Spesifikasi §3 dan owner value flow menjadikan alur "misi → credit + token → skor → unlock → bracket" sebagai inti produk; tanpa jalur yang terlihat, pemain hanya melihat angka. Menaruh logika di satu modul murni membuat aturannya bisa dites dan tetap benar saat adapter `chain` menggantikan `mock`.
- Dampak: Tidak ada perubahan program, ekonomi, atau batas harian (D-0025). Tes `apps/web/test/journey.test.ts` memeriksa rute, urutan langkah, tangga tier, dan data misi.
- Komponen terkait: `apps/web/src/lib/data/journey.ts`, `apps/web/src/components/journey/JourneyPanel.tsx`, `apps/web/src/stores/useJourney.ts`, `apps/web/src/stores/slices/districtSlice.ts`, `apps/web/src/messages/en.json`

## D-0044 — Misi Summit dan citizen Tier 0 di data mock

- Tanggal: 2026-10-13
- Status: Approved (bagian dari permintaan pemilik pada D-0043)
- Konteks: Summit Hall terbuka pada skor 10 tetapi tidak punya misi, sehingga tier 3 tidak membuka apa pun yang bisa dikerjakan. Data mock juga hanya berisi citizen yang sudah bermain, jadi awal perjalanan tidak bisa dicoba.
- Keputusan: (1) Misi `summitTrial` (The Summit Trial) di distrik Summit: dua langkah jalan, satu jawaban, satu puzzle; credit boleh untuk Insight, Bond, atau Craft dan dipilih saat mulai, seperti misi multi-stat lain (D-0025). Dua sel tujuannya, (9, 0) dan (4, 0), dipilih karena tidak ada benda di sekitarnya, sehingga layout kota tidak berubah (diperiksa dengan membuat ulang kota: JSON dan semua gambar identik). (2) Pip (#012, Pioneer 1/1/1) kini dimiliki wallet mock dan didaftarkan pada hari 12, tanpa credit dan tanpa riwayat selain pendaftaran. Baris Pip di leaderboard Skilled diganti citizen di luar roster karena Pip kini Rookie.
- Alasan: Setiap distrik yang terbuka oleh tier harus punya sesuatu untuk dikerjakan (misi harus mengarah ke progres, bukan keterlibatan tanpa tujuan). Citizen Tier 0 membuat jalur dari awal bisa dicoba dan diuji.
- Dampak: Tes memastikan sel misi tidak terblokir dan terjangkau dari plaza, copy lengkap untuk tiap langkah, setiap stat punya misi awal, dan setiap distrik berbasis tier punya misi.
- Komponen terkait: `apps/web/src/lib/data/mock/mockSnapshot.ts`, `apps/web/src/messages/en.json`, `apps/web/test/journey.test.ts`

## D-0045 — Deploy kontrak ditunda sampai alur UI/UX selesai

- Tanggal: 2026-10-13
- Status: Approved (keputusan pemilik)
- Konteks: Mengubah kontrak yang sudah di-deploy berulang kali mahal bila alur produk masih bergeser.
- Keputusan: Tidak ada deploy program ke devnet sampai alur dari Tier 0 ke Tier 3 dan misi pembukanya selesai di UI. Perubahan program yang sudah masuk di repo (error `InvalidMetadataUri`, D-0041) menunggu deploy yang sama.
- Dampak: Program devnet yang berjalan masih kode lama; selisihnya hanya pesan error. Perubahan alur yang butuh program (misalnya aturan baru untuk credit atau tier) dikumpulkan dulu, lalu dikerjakan sekaligus sebelum deploy.
- Komponen terkait: `programs/district`, `scripts/devnet`

## D-0046 — Layar kota memakai sidebar dan peta berbingkai

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: layout dan struktur boleh diubah total)
- Konteks: Empat kartu melayang di sudut layar (event, misi, daftar citizen, citizen terpilih) menutup sekitar 30% peta dan terlihat berantakan karena ukuran dan posisinya berbeda-beda.
- Keputusan: Dari lebar tablet ke atas layar disusun sebagai top bar, sidebar di kiri, dan peta dalam bingkai sendiri. Peta tidak lagi berada di bawah panel, jadi ukuran kanvas Phaser mengikuti bingkai. Sidebar berisi kartu citizen terpilih (daftar citizen sebagai tab di atasnya) dan kartu misi. Tombol mode dan zoom ada di pojok kanan atas peta, kartu event di pojok kiri atas peta mulai lebar laptop dan membuka isinya sebagai dropdown. Baris "Next step" disembunyikan saat satu-satunya langkah adalah misi yang sudah tampil di sebelahnya. Di ponsel, peta tetap memenuhi layar dengan kartu melayang seperti sebelumnya. Pilihan buka/tutup event disimpan di browser lewat `usePersistedFlag`.
- Dampak: Panel tidak menutupi peta sama sekali di layar tablet ke atas. Tidak ada perubahan data, store, atau kontrak.
- Komponen terkait: `components/city/CityScreen.tsx`, `components/city/CityPanels.tsx`, `components/city/MissionTracker.tsx`, `lib/utils/usePersistedFlag.ts`

## D-0047 — Halaman Missions, Training, dan Profile memakai satu struktur

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: halaman ditata ulang karena kurang rapi)
- Konteks: Ketiga halaman memakai latar peta yang redup, deretan kontrol dengan lebar dan gaya berbeda (pemilih citizen, baris "Next step", filter, pelat info), serta kolom yang tingginya tidak sama.
- Keputusan: Satu kerangka bersama di `ScreenShell`: latar polos, header dan isi memakai lebar yang sama (maksimum 1400 px), dan tab ke lima halaman (City, Missions, Train, Season, Citizen) ada di header mulai lebar laptop. Missions dan Training memakai kolom kiri `CitizenRail` (pemilih citizen, stat, kredit, "Next step") dan isi halaman di kanan; di bawah lebar laptop kolom itu menjadi kartu ringkas di atas isi. Profile memakai kolom kiri yang sama bentuknya untuk identitas citizen, dengan pemilih citizen berupa tautan ke profil masing-masing. Training: pilihan stat, lalu panggung dan struk berdampingan, lalu grafik biaya. Missions: satu bilah alat (filter, hari berikutnya, jalur), baris batas harian dan catatan, lalu daftar misi dan detail. Profile: jalur citizen (atau stat bagi citizen milik orang lain) selebar halaman dalam tiga kolom, lalu distrik dan pencapaian berdampingan, lalu riwayat. Season ikut kerangka yang sama tanpa perubahan isi. Barisan tab citizen, baris stat, dan `StatBar` dipakai bersama oleh kota, rail, dan profil.
- Dampak: Tidak ada perubahan data, store, atau kontrak. Kunci teks profil yang tidak terpakai dihapus dan satu kunci baru ditambahkan (`journey.credits`).
- Komponen terkait: `components/layout/ScreenShell.tsx`, `components/layout/TopBar.tsx`, `components/layout/BottomNav.tsx`, `components/citizen/*`, `components/training/TrainingScreen.tsx`, `components/missions/MissionsScreen.tsx`, `components/journey/JourneyPanel.tsx`

## D-0048 — Training sebagai satu jendela berbingkai, gaya panel dibakukan

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: Training masih kurang rapi; dua gambar contoh struktur diberikan sebagai pola, bukan untuk ditiru persis)
- Konteks: Training memakai kolom kiri `CitizenRail` yang mengulang isi halaman, kolom yang tingginya tidak sama, dan gambar latar 276 x 224 px yang direntangkan sampai buram. Judul panel di tiap halaman juga berbeda-beda.
- Keputusan: Training menjadi satu jendela berbingkai: potret citizen (gambar latar pada ukuran aslinya, karakter dengan bayangan di kaki, pita nama di bawahnya), panel pilihan stat (nama dan kredit, bar, skor besar, biaya) dengan kotak putus-putus untuk efek tier, kotak dialog bertangkai, baris tombol (BURN dan CITY), lalu baris avatar. Di sampingnya ada kolom struk dan grafik biaya. Di bawah lebar laptop kolom itu pindah ke bawah jendela. Dua bagian dibakukan sebagai komponen bersama: `PanelTab` (tab judul gelap di awal setiap panel, dipakai di Training, Missions, Profile, dan Season) dan `Ribbon` (pita nama pada potret, dipakai di Training, kolom Missions, dan Profile). `SwitcherLabel` memakai `PanelTab`. Missions dan Profile tetap memakai kolom kiri karena isi kolom itu tidak diulang di halamannya.
- Dampak: Tidak ada perubahan data, store, atau kontrak. Satu kunci teks baru (`training.pick`).
- Komponen terkait: `components/ui/PanelTab.tsx`, `components/ui/Ribbon.tsx`, `components/citizen/PlayerStrip.tsx`, `components/citizen/CitizenRail.tsx`, `components/training/TrainingScreen.tsx`

## D-0049 — Kolom Missions berbagian berbingkai, area misi satu jendela

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: bagian "Playing as" dan kolom Missions masih bisa lebih rapi, dengan acuan gambar contoh)
- Keputusan: `CitizenRail` dibagi menjadi bagian-bagian berbingkai (`bas-inset`): avatar citizen (empat kotak sama besar mulai lebar laptop), kartu citizen (pita nama, baris keterangan, potret dan tiga baris stat bertumpuk), kredit, dan langkah berikutnya (tab judul, kotak putus-putus, tombol selebar kolom). Di lebar tablet dua bagian pertama berdampingan. Area kanan Missions dibungkus satu jendela: baris filter dan tombol, kotak putus-putus untuk batas harian, jalur citizen, lalu kartu misi dan detail. Kartu misi memakai latar yang lebih terang dari jendela agar terpisah jelas.
- Dampak: Tidak ada perubahan data, store, atau kontrak. Kolom Training dan kota tidak berubah.
- Komponen terkait: `components/citizen/CitizenRail.tsx`, `components/citizen/CitizenSwitcher.tsx`, `components/citizen/CitizenStats.tsx`, `components/journey/JourneyPanel.tsx`, `components/missions/MissionsScreen.tsx`

## D-0050 — Citizen di kota kembali memakai satu potret untuk semua arah

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: bentuk citizen berubah saat berjalan ke atas dan ke bawah; lebih baik terlihat miring daripada berubah bentuk)
- Keputusan: Kota tidak lagi memakai sprite depan dan belakang untuk citizen. Semua arah memakai potret `sprite` yang sama, dicerminkan ke kiri atau kanan sesuai arah gerak; berjalan lurus ke atas atau bawah mempertahankan cermin terakhir. Warga ambient tetap memakai tampilan depan, belakang, dan samping yang digambar lewat kode (`cityFacing.ts`). Panah arah di tanah tetap ada. Kolom `spriteFront` dan `spriteBack` di data konten tidak diubah dan tidak dimuat oleh kota.
- Dampak: Tidak ada perubahan data atau kontrak. Dua aset sprite per citizen tidak lagi dimuat di kota.
- Komponen terkait: `game/CityScene.ts`, `components/city/CityCanvas.tsx`

## D-0051 — Training tanpa credit memberi satu jalan yang jelas, dan kata "credit" hanya berarti kredit stat

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: nilai apakah alur Tier 0 ke 3 membingungkan dan perbaiki)
- Keputusan: Ada dua hal berbeda yang sebelumnya sama-sama disebut credit: sisa jatah misi harian dan kredit stat untuk training. Sekarang jatah harian ditulis sebagai "N dari 3 misi tersisa hari ini" dan kata credit hanya untuk kredit stat. Di Training, citizen tanpa credit pada stat terpilih tidak lagi melihat tombol burn yang tidak bisa dipakai. Dialog berkata credit apa yang dibutuhkan, tombol utama berubah menjadi "EARN A CREDIT IN MISSIONS" yang membuka Missions, dan baris struk menulis "None yet". Teks hadiah misi dan pesan batas harian dibuat lebih jelas.
- Pertanyaan yang tersisa dijawab pemilik dan dicatat di D-0052 sampai D-0054.
- Dampak: Hanya teks dan satu tombol di layar Training. Tidak ada perubahan data, store, atau kontrak.
- Komponen terkait: `components/training/TrainingScreen.tsx`, `messages/en.json`

## D-0052 — Token resmi bernama $BAS, dibeli di Pump.fun

- Tanggal: 2026-10-13
- Status: Approved (jawaban pemilik: token utama diluncurkan di Pump.fun dan seharusnya bernama BAS, bukan DIST)
- Keputusan: Simbol token di aplikasi menjadi `$BAS` (`messages/en.json`, `app.tokenSymbol`). Pemain mendapat $BAS dengan membelinya di Pump.fun lewat wallet sendiri, lalu membakarnya untuk training. Aplikasi tidak menjual token dan tidak pernah meminta transfer manual. Panel "GET $BAS" di Training dan Mint menjelaskan ini; tombol "BUY ON PUMP.FUN" hanya muncul di mainnet dan membuka `https://pump.fun/coin/<utilityTokenMint>`. Di devnet token adalah token uji dan panel hanya menjelaskan hal itu. Pesan "NOT ENOUGH TOKENS" kini menyebut Pump.fun.
- Alasan: SPEC §5 sudah menetapkan satu token resmi lewat Pump.fun; ticker belum ditetapkan di sana dan kini ditetapkan pemilik. Ticker Pump.fun bersifat permanen (SPEC §5.6).
- Dampak: Hanya teks dan satu panel. Perhatian: `config/mainnet.json` masih berisi `utilityTokenMint` yang sama dengan devnet; isi dengan mint asli setelah koin diluncurkan, sebelum mainnet dibuka.
- Komponen terkait: `components/token/GetTokenPanel.tsx`, `messages/en.json`, `config/telemetry.ts`

## D-0053 — Citizen di-mint, bukan dipilih

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: citizen adalah NFT yang di-mint, bukan tinggal pilih)
- Keputusan: Ada layar `/mint`. Pemain membayar harga mint (`mintPriceLamports`) dan mint mengundi satu citizen; role dan skor awalnya ikut NFT (D-0022). Pilihan citizen hanya ada di antara citizen yang sudah dimiliki wallet; tab "+" di deretan avatar dan panel di kota membuka Mint. Wallet tanpa citizen melihat panel "NO CITIZEN YET" di Training, Missions dan kota. Store hanya berisi citizen yang sudah di-mint; `DistrictDataSource.mintCitizen()` menambahkannya. Mock memulai dengan tiga citizen milik wallet dan satu (Pip) yang belum di-mint, sehingga Tier 0 dicoba lewat mint sungguhan. Mock berhenti dengan "The district is full." setelah roster habis. `NEXT_PUBLIC_BAS_MOCK_START=empty` memulai wallet tanpa citizen. Misi milik citizen lain tidak lagi tampil sebagai misi yang sedang dimainkan pemain.
- Alasan: SPEC §6.3 menetapkan Candy Machine mint diikuti `register_citizen` dalam satu transaksi; UI harus mengikuti alur itu dan bukan daftar pilihan.
- Dampak: Snapshot mendapat `wallet.solLamports` dan `mint`; error baru `sold-out` dan `insufficient-sol`. Batas mint per wallet ditetapkan di D-0055. Citizen baru muncul di peta kota saat pemain kembali ke kota. Kontrak tidak berubah.
- Komponen terkait: `components/mint/MintScreen.tsx`, `components/mint/NoCitizenPanel.tsx`, `lib/data/mock/mockDataSource.ts`, `lib/data/mock/mockSnapshot.ts`, `stores/slices/districtSlice.ts`

## D-0054 — Laju kenaikan tier dipertahankan dan ditampilkan

- Tanggal: 2026-10-13
- Status: Approved (pemilik menyerahkan pilihan kepada rekomendasi)
- Keputusan: Satu misi memberi satu credit, tiap misi sekali sehari per citizen, maksimal tiga misi sehari. Laju ini dipertahankan karena menjaga permintaan $BAS tetap stabil dan menahan bot. Agar tidak terasa gelap, panel langkah berikutnya menampilkan "Tier N of 3" dan perkiraan hari ke tier berikutnya ("About 2 days to Tier 1 through Insight"). Perkiraan dihitung dari credit yang masih kurang dan jumlah misi terbuka untuk stat itu, dan tidak tampil bila satu tier sudah bisa dicapai hari ini. Istilah diseragamkan: "score" untuk angka stat, "upgrade" untuk satu langkah training, "tier" untuk tingkatan; "points" hanya untuk poin musim.
- Dampak: `Journey` mendapat `pace`; teks "level" diganti. Tidak ada perubahan kontrak.
- Komponen terkait: `lib/data/journey.ts`, `components/journey/JourneyPanel.tsx`, `messages/en.json`

## D-0055 — Satu citizen per wallet di penjualan publik

- Tanggal: 2026-10-13
- Status: Approved (pemilik meminta rekomendasi; NFT harus tetap langka seperti di dokumen)
- Keputusan: `mintLimitPerWallet` bernilai 1 di `config/devnet.json` dan `config/mainnet.json`, dan menjadi nilai guard Candy Guard `mintLimit` saat Candy Machine dibuat. `@bas/config` memvalidasinya sebagai bilangan bulat 1 sampai 255 dan test memastikan devnet dan mainnet sama-sama 1. Layar Mint menampilkan "Your mints 0 of 1", menolak mint berikutnya dengan "You have reached the citizen limit for this wallet." (teks dari SPEC §9), dan menyembunyikan tab "+" serta tombol mint saat batas tercapai. Batas dicek sebelum sisa supply, seperti guard.
- Alasan: Supply hanya 100 dan Sentinel serta Navigator masing-masing 10 (D-0023). Dengan batas 1, satu wallet tidak bisa mengumpulkan satu role dari penjualan, minimal ada 100 pemegang, dan prize pool yang sudah membatasi satu citizen per wallet per kompetisi tidak memberi keuntungan bagi pemilik banyak wallet. Pemain yang ingin lebih dari satu membelinya di pasar sekunder; harga di sana mencerminkan kelangkaan. Batas per wallet hanya penghalang, bukan jaminan, karena orang bisa membuat banyak wallet. Perlindungan lainnya adalah harga 0,01 SOL, undian acak, `botTax`, `startDate` dan `thirdPartySigner` yang sudah ada di daftar guard. Jatah tim atau teman bisa lewat guard group allowlist dengan batas sendiri tanpa mengganti mekanisme mint (SPEC §6.1).
- Dampak: Field manifest baru `mintLimitPerWallet`; `@bas/config` perlu dibangun ulang (`pnpm build:packages`). Snapshot mint mendapat `limitPerWallet` dan `mintedByWallet`, error baru `mint-limit`. Kontrak tidak berubah karena batas dijaga Candy Guard.
- Komponen terkait: `config/*.json`, `packages/config/src/{types,network}.ts`, `components/mint/MintScreen.tsx`, `lib/data/mock/mockDataSource.ts`

## D-0056 — Panel citizen di kota memakai bagian berbingkai yang sama dengan Missions

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: seragamkan panel citizen di kota)
- Keputusan: Sidebar kota memakai `CitizenRail` dalam mode satu kolom: bagian PLAYING AS dengan tab avatar, kartu citizen dengan banner nama dan baris aktivitas, CREDITS TO SPEND, NEXT STEP, lalu tombol Profile, Missions dan Train. Memilih avatar tetap memusatkan peta. Versi ringkas di HP tidak berubah. Struktur dan datanya sama, hanya bentuknya yang diseragamkan.
- Dampak: Tidak ada perubahan data, store, atau kontrak.
- Komponen terkait: `components/city/CityPanels.tsx`, `components/citizen/CitizenRail.tsx`

## D-0057 — Misi di kota muncul di atas sidebar dan sebagai popup di setiap langkah

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: kartu misi terkubur di bawah sidebar dan tidak ada respon saat citizen sampai di tempat misi)
- Keputusan: Kartu MISSION dipindah ke bagian paling atas sidebar kota, di atas daftar citizen. Langkah aktif juga dibuka sebagai popup di atas kota: saat misi dimulai, saat citizen sampai di titik tujuan (ada label ARRIVED), dan untuk setiap langkah talk atau puzzle. Langkah jalan menampilkan tujuan dengan tombol LET'S GO yang memusatkan peta. Setelah popup ditutup, langkah tetap ada di kartu MISSION dan bisa dibuka lagi lewat ANSWER atau SOLVE. Popup hanya muncul sekali per langkah dan hanya untuk citizen milik pemain.
- Dampak: Store UI mendapat `missionPrompt` (`dismissed`, `arrived`) dengan aksi `dismissMissionPrompt`, `reopenMissionPrompt`, `markMissionArrival`. Tidak ada perubahan data source atau kontrak.
- Komponen terkait: `components/city/MissionPopup.tsx`, `components/city/MissionTracker.tsx`, `components/city/CityScreen.tsx`, `components/city/CityCanvas.tsx`, `components/missions/MissionStepDialog.tsx`, `stores/slices/uiSlice.ts`

## D-0058 — Popup hadiah saat misi selesai

- Tanggal: 2026-10-13
- Status: Approved (permintaan pemilik: selesai misi harus memberi popup sukses yang jelas)
- Keputusan: Saat langkah terakhir selesai, kota dan semua halaman membuka popup hadiah, bukan kotak teks biasa. Isinya tanda centang, nama misi, kredit stat yang didapat, poin musim, jumlah kredit stat itu yang siap dipakai, dan sisa misi hari ini untuk citizen tersebut. Tombol TRAIN NOW membuka halaman Training dengan stat itu sudah terpilih, KEEP PLAYING menutup popup. Popup naik tier tetap memakai dialog lama karena membawa teks tentang distrik yang terbuka.
- Dampak: Store UI mendapat `reward` dan `closeReward`; `advanceMission` mengisi `reward` dengan data dari snapshot terbaru. Teks `completeMessage` diganti kunci `reward*`. Tidak ada perubahan data source atau kontrak.
- Komponen terkait: `components/modal/MissionRewardDialog.tsx`, `stores/slices/districtSlice.ts`, `stores/slices/uiSlice.ts`, `components/layout/ScreenShell.tsx`, `components/city/CityScreen.tsx`

## D-0059 — Mission server sebagai penjaga aturan misi dan penandatangan klaim

- Tanggal: 2026-10-13
- Status: Approved (pemilik menyetujui urutan: mission server dulu, lalu data source chain, mint, deploy devnet)
- Keputusan: `apps/mission-server` (Node, TypeScript, tanpa framework web) menjalankan aturan D-0025 dan menandatangani `claim_training_credit` sebagai `mission_authority`. Program tidak berubah. Server membangun seluruh transaksi klaim, menandatanganinya, dan mengembalikannya ke wallet pemilik untuk ditandatangani lalu dikirim. Kunci jawaban dan urutan puzzle hanya ada di server. Pemilik NFT dibaca dari chain pada setiap permintaan. Misi baru dihitung (batas harian, poin season) setelah receipt klaimnya terlihat di chain. Nonce klaim `season_id × 1000 + hari season` membuat PDA receipt ikut menolak klaim ganda pada hari yang sama. Klaim kedaluwarsa baru diganti setelah jeda 30 detik supaya klaim lama yang terlambat masuk tidak bertemu dengan klaim baru. Langkah jalan hanya dibatasi waktu tempuh minimum karena kota berjalan di browser.
- Alasan: Kredit adalah satu-satunya jalan menaikkan stat (SPEC bagian 12), jadi penjaga kredit harus berada di luar browser. Membangun transaksi di server menghindari pemain mengubah argumen atau akun setelah tanda tangan. Menunggu receipt di chain membuat server dan chain tidak pernah berselisih tentang berapa misi yang sudah selesai.
- Dampak: Paket baru `@bas/mission-server` ikut `pnpm typecheck`, `lint`, dan `test`; dependensi baru `@solana/web3.js` 1.98.4. Katalog misi ada di dua tempat (server dengan jawaban, web tanpa jawaban di mode chain) dan `apps/web/test/missionParity.test.ts` gagal kalau keduanya berbeda. Perbedaan dengan mock: di server tidak ada status "mission-busy" lintas citizen. Detail ada di `docs/MISSION_SERVER.md`.
- Komponen terkait: `apps/mission-server/src/*`, `apps/web/test/missionParity.test.ts`, `docs/MISSION_SERVER.md`, `.env.example`

## D-0060 — `DistrictDataSource` versi chain, wallet Wallet Standard, dan misi lewat mission server

- Tanggal: 2026-10-13
- Status: Approved (pemilik meminta langkah berikutnya: isi `DistrictDataSource` dengan versi chain, baca citizen dan kredit, kirim `upgrade_score`, dan pakai mission server untuk misi)
- Keputusan: (1) `NEXT_PUBLIC_BAS_DATA=chain` mengganti data source mock dengan `lib/data/chain/chainDataSource.ts`; tanpa variabel itu web tetap memakai mock. (2) Citizen dibaca dari chain: asset Core milik wallet di koleksi (`getProgramAccounts`, memcmp pada field koleksi) digabung dengan `CitizenState` lewat alamat asset; nomor urut dibaca dari URI metadata `NNN-role.json` lalu dipetakan ke catatan roster. Asset yang nomornya tidak ada di roster dilewati. (3) Saldo `$BAS` dibaca dari token account pemilik. (4) Semua misi memakai `apps/mission-server`: masuk dengan `signMessage`, langkah dan klaim lewat API-nya. Transaksi `claim_training_credit` datang dari server sudah ditandatangani `mission_authority`, wallet pemain menambah tanda tangan lalu mengirimnya, dan `confirm` baru dihitung setelah receipt terlihat di chain. (5) `upgrade_score` dibangun di web dari `@bas/chain-client/browser` dan ditandatangani wallet. (6) Wallet memakai Wallet Standard lewat `@solana/kit` (`lib/wallet`), dengan dialog pilih wallet; browser tidak pernah mengimpor akar `@bas/chain-client` karena akar itu menarik `node:fs`, jadi ada entry `./browser` (dan `./stats`) beserta tes penjaga. (7) Server mendapat `GET /season` (hari season dan jendela event) tanpa token, dipakai untuk kartu event; misi event yang belum dijadwalkan atau sudah berakhir tidak ditampilkan, yang belum buka tampil dengan hitungan jam. (8) RPC browser bisa diganti lewat `NEXT_PUBLIC_SOLANA_RPC_URL` (hanya https; http hanya untuk localhost di devnet). (9) Prompt yang ditolak di wallet menjawab `declined`; kegagalan setelah transaksi terkirim menjawab `transaction-failed` dan adapter membaca ulang chain, jadi layar tidak menyimpan tebakan.
- Alasan: Pemilik, stat, dan kredit harus datang dari chain, bukan dari memori browser. Memakai server yang sama untuk semua misi menjaga kunci jawaban dan batas harian di luar browser (D-0059). Wallet Standard adalah integrasi yang diwajibkan TECH_STACK dan tidak mengikat web ke satu wallet.
- Dampak: Katalog misi dipindah ke `lib/data/missionCatalog.ts` (tanpa jawaban) dan mock membuat definisinya dari katalog itu; `missionParity.test.ts` membandingkannya dengan server. `WalletView` mendapat `connected`; store mendapat `refresh` untuk sinkron ulang; layout membuat data source chain bila variabel diaktifkan. Tes baru memakai mission server dan RPC palsu sungguhan di dalam proses (`apps/web/test/chain*.test.ts`, `chainWorld.ts`), plus tes decoder akun, instruksi, dan entry browser di `@bas/chain-client`.
- Batas yang diketahui: (a) `mintCitizen` menjawab `unavailable` sampai tahap Candy Machine; tombol mint nonaktif di mode chain. (b) `mintedByWallet` bernilai 0 karena batas satu mint per wallet dijaga Candy Guard. (c) Riwayat hanya memuat klaim dari server (belum ada event latih atau hari daftar). (d) Roster baru berisi 10 catatan (20 art) untuk supply 100. (e) Vault hadiah tampil 0 dan alamat `—` sampai ada vault sungguhan. (f) RPC palsu yang dipakai tes dan verifikasi browser ditulis menurut spesifikasi JSON-RPC, belum diuji ke RPC devnet sungguhan; RPC publik devnet bisa membatasi `getProgramAccounts`, jadi pakai RPC hosted. (g) Pemilik klaim membayar sewa PDA receipt dan fee dalam SOL.
- Komponen terkait: `apps/web/src/lib/data/chain/*`, `apps/web/src/lib/wallet/*`, `apps/web/src/components/modal/WalletDialog.tsx`, `apps/web/src/stores/*`, `packages/chain-client/src/{accounts,browser,instructions}.ts`, `packages/config/src/{env,index}.ts`, `apps/mission-server/src/{http,service}.ts`, `docs/ARCHITECTURE.md` bagian 3a
- Menggantikan: —

## D-0061 — Mint publik lewat Core Candy Machine, atomik dengan `register_citizen`

- Tanggal: 2026-10-14
- Status: Approved (pemilik meminta tahap berikutnya di roadmap: Candy Machine mint dengan `register_citizen`, satu mint per wallet, 0,01 SOL, supply 100)
- Keputusan: (1) Satu transaksi mint berisi tiga instruksi: `setComputeUnitLimit` 400.000, `mintV1` milik Core Candy Guard, lalu `register_citizen`. Karena satu transaksi, citizen tidak pernah ada tanpa `CitizenState` (dan sebaliknya); kalau salah satu gagal, semuanya batal. (2) Guard yang dipasang: `solPayment` (0,01 SOL ke `solTreasury`), `mintLimit` id 0 dengan batas 1 per wallet, dan `thirdPartySigner` dengan kunci `mintSigner` dari manifest. `botTax` dan `startDate` tidak dipasang di devnet. (3) Mission server membangun transaksi mint (`POST /mint/prepare`, butuh token masuk), menandatanganinya sebagai `mintSigner` dan sebagai pemilik keypair asset baru, lalu mengembalikannya dengan satu tanda tangan kosong: wallet pembeli, yang juga fee payer dan pemilik asset. Builder menolak transaksi yang tanda tangan kosongnya bukan tepat satu dan menolak pembeli yang sama dengan salah satu kunci server. (4) Karena `thirdPartySigner`, tidak ada mint yang bisa sampai ke Candy Machine tanpa lewat server; itu dipakai server sebagai gerbang jam buka (`MINT_OPENS_AT`) dan untuk menutup penjualan selama mesin belum terisi penuh. Harga dan batas satu mint per wallet tetap dijaga chain, jadi jawaban salah dari server tidak bisa melewatinya. (5) Supply nyata dibaca dari akun Candy Machine (`itemsAvailable`, `itemsRedeemed`), bukan dari `maxSupply` manifest; `mintedByWallet` dibaca dari akun `MintCounter` milik wallet. (6) Paket baru `@bas/metaplex-client` (hanya Node, memakai Umi dan `mpl-core-candy-machine`) membangun penjualan, mengisi item, dan transaksi mint. Browser tidak mengimpornya: pembacaan akun (`decodeCandyMachine`, `decodeMintCounter`, alamat guard dan counter) ada di `@bas/chain-client/browser`. (7) `scripts/devnet/mint-setup.mjs` memasang plugin Royalties 500 bps pada koleksi (SPEC §6.2), membuat Candy Machine dan guard, lalu mengisi item per 10 baris per transaksi, dan aman dijalankan ulang. `scripts/devnet/mint-simulate.mjs` meminta cluster mensimulasikan satu mint tanpa menandatangani dan mencetak log program, ukuran, dan compute unit. (8) Field manifest baru `mintSigner` (alamat valid, wajib bukan placeholder untuk produksi). Server mengaktifkan penjualan hanya bila `MINT_SIGNER_KEYPAIR_FILE` diisi dan kuncinya sama dengan `mintSigner`.
- Alasan: Satu transaksi menghilangkan keadaan setengah jadi yang butuh pemulihan (citizen ada tapi belum terdaftar). `thirdPartySigner` memberi tempat untuk aturan yang tidak bisa ditulis sebagai guard, tanpa mengubah program. Membaca supply dari mesin mencegah halaman Mint menjanjikan 100 citizen padahal mesin devnet hanya berisi yang artnya ada.
- Dampak: Menyelesaikan batas (a) dan (b) di D-0060: `mintCitizen()` di mode chain sekarang meminta transaksi ke server, memintanya ditandatangani wallet, mengirimnya, lalu membaca ulang chain sampai citizen terlihat; `mintedByWallet` dibaca dari chain. Error `mint-not-open` ditambahkan. Dependensi baru: Umi 1.6.0 dan paket Metaplex terkait di `@bas/metaplex-client`; `@solana/web3.js` ditetapkan 1.99.0 di mission-server, web, dan paket itu karena Umi memintanya. Setelah menarik pembaruan ini jalankan `pnpm install` lagi (postinstall membangun paket baru).
- Batas yang diketahui: (a) Belum pernah dijalankan terhadap program Core Candy Machine, Core Candy Guard, dan `mpl-core` yang sungguhan; tidak ada validator di lingkungan pengembangan dan paket crate yang tersedia untuk pembanding lebih tua dari program yang dideploy. Struktur transaksi, urutan akun guard, dan seed PDA dicocokkan dengan kode sumber crate dan diuji, tetapi uji sebenarnya adalah `pnpm devnet:mint-simulate` dan mint pertama di devnet. (b) Batas 400.000 compute unit adalah perkiraan; `mint-simulate` mencetak angka sebenarnya. (c) Mesin devnet berisi roster 10 citizen (`content/en/citizens.json`), bukan 100, karena art untuk 100 belum ada; Candy Machine tidak bisa mengubah ukurannya, jadi mesin untuk 100 dibuat ulang saat artnya siap. Candy Machine memilih item secara acak. (d) `scripts/devnet/setup.mjs` masih membuat koleksi tanpa Royalties; `mint-setup.mjs` menambahkannya. (e) Server tidak mencatat siapa yang sudah meminta transaksi; permintaan yang tidak ditandatangani wallet tidak berdampak apa pun, karena asset baru hanya ada setelah transaksi masuk.
- Urutan berikutnya: deploy devnet dan uji end to end dari wallet (`pnpm devnet:setup`, `pnpm devnet:mint-setup`, `pnpm devnet:mint-simulate`, lalu mint dari web). "Agents" (citizen yang bisa diajak bicara bebas oleh pemiliknya, SPEC §3.3 dan Phase E) belum dikerjakan: ia butuh infrastruktur backend sendiri (gateway OpenRouter di server, Postgres, Redis dan worker, kuota harian dan pemutus anggaran, memori hubungan privat) dan bukan bagian dari mint. SPEC §3.3 melarang pembukaan mint publik mainnet sebelum chat pemilik itu ada (dengan fallback dialog JSON), jadi tahapnya setelah mint, deploy, dan uji end to end di devnet, dan sebelum peluncuran token Pump.fun serta pembukaan mint mainnet (AGENT_START_HERE bagian 4).
- Komponen terkait: `packages/metaplex-client/*`, `packages/chain-client/src/{accounts,constants,instructions,types}.ts`, `packages/config/src/{types,network,readiness}.ts`, `config/*.json`, `apps/mission-server/src/{mint,http,config,errors,main}.ts`, `apps/web/src/lib/data/chain/*`, `apps/web/src/components/mint/MintScreen.tsx`, `scripts/devnet/mint-{setup,simulate}.mjs`, `docs/ARCHITECTURE.md` bagian 3a
- Menggantikan: batas (a) dan (b) di D-0060

## D-0062 — Layar pertama untuk wallet tanpa citizen

- Tanggal: 2026-10-14
- Status: Approved (pemilik melihat kota kosong dengan Season board sebagai satu-satunya tombol di header, dan meminta layar pertama disesuaikan agar tidak membingungkan)
- Keputusan: (1) Wallet yang belum memiliki citizen melihat panel "Welcome to the district" di sidebar kota (di ponsel, kartu ringkas di atas peta) berisi empat langkah: hubungkan wallet, mint citizen, ambil misi, latih dengan $BAS. Langkah yang sedang berjalan ditandai, dan tombol utamanya mengikuti: "Connect wallet" bila belum terhubung (mode chain), lalu "Mint a citizen · harga". Bila supply habis atau batas wallet tercapai, tombol diganti catatannya. Panel itu menggantikan kotak kuning kecil yang hanya muncul bila ada citizen yang terpilih; pada mode chain tanpa citizen sidebar sebelumnya kosong. (2) Header kota menampilkan tombol "Mint a citizen" menggantikan "Season board" selama wallet tidak punya citizen, dan Season board kembali setelah punya citizen; untuk pemain baru yang hanya ingin melihat, tautan "See the season board" ada di bagian bawah panel sambutan. (3) Tombol Auto/Control dan petunjuk "Tap the map to walk" disembunyikan sampai ada citizen yang bisa digerakkan.
- Alasan: Pemain baru tidak punya apa pun untuk dikendalikan atau dilatih, jadi satu-satunya hal berguna adalah menghubungkan wallet dan mint. Papan season hanya bermakna setelah ada citizen yang ikut serta.
- Dampak: Komponen baru `components/city/WelcomePanel.tsx` dan kelompok teks `welcome` di `messages/en.json`; `CityPanels`, `CityScreen`, dan `TopBar` berubah. Tidak ada perubahan data atau kontrak. Tampilan diperiksa di browser pada mode mock dengan `NEXT_PUBLIC_BAS_MOCK_START=empty` (desktop dan ponsel); keadaan chain tanpa citizen memakai komponen yang sama tetapi belum dilihat di wallet sungguhan.
- Komponen terkait: `apps/web/src/components/city/{WelcomePanel,CityPanels,CityScreen}.tsx`, `apps/web/src/components/layout/TopBar.tsx`, `apps/web/src/messages/en.json`
- Menggantikan: —

## D-0063 — Layar untuk pengguna baru: satu jalan masuk di semua halaman

- Tanggal: 2026-10-14
- Status: Approved (pemilik meminta semua layar disesuaikan agar relevan dan terlihat profesional bagi pengguna baru)
- Keputusan: (1) Sidebar kota untuk wallet tanpa citizen hanya berisi panel sambutan; daftar "Playing as" dan kartu citizen tidak ditampilkan karena tidak ada yang bisa dimainkan. (2) Misi dan Latihan memakai panel sambutan yang sama (`NoCitizenPanel` kini membungkusnya) menggantikan kartu "No citizen yet" dengan ikon telur; di ponsel Misi memakai kartu ringkas agar papan misi tetap terjangkau. (3) Papan Misi untuk pengguna baru adalah pratinjau: status dihitung seperti untuk citizen Tier 0 (distrik yang butuh tier tampil Locked), tidak ada teks "Owned by another player" atau batas harian, dan panel detail mengganti tombol Start dengan ajakan menghubungkan wallet atau mint. (4) Tab terakhir di navigasi menjadi "Mint" untuk wallet tanpa citizen dan kembali menjadi "Citizen" setelah punya; tombol saldo token disembunyikan pada mode chain sampai wallet terhubung. (5) Halaman Mint pada mode chain tanpa wallet menampilkan "Connect wallet to mint" yang membuka dialog wallet, dan baris saldo diganti "Not connected"; panel utama tidak lagi melebar setinggi kolom kanan. (6) Season pada mode chain dibuka di bracket Open (mode mock tetap Skilled karena hanya itu yang punya data contoh); alamat vault yang belum ada tidak lagi tampil sebagai tombol "View on explorer · —" tetapi sebagai catatan. (7) Profil citizen yang nomornya belum ada menampilkan pesan netral dan tombol kembali, bukan "not in the preview roster". (8) Teks mock mint tidak lagi menyebut `register_citizen`.
- Alasan: Pengguna baru hanya punya satu langkah berguna (hubungkan wallet, lalu mint), dan setiap halaman harus menunjuk ke sana alih-alih memperlihatkan kontrol, angka nol, atau kesalahan yang tidak berlaku baginya.
- Dampak: Hanya tampilan web dan teks; tidak ada perubahan data, kontrak, atau server. Kelompok teks `noCitizen` tinggal `cta`; ditambah `nav.mint`, `missions.needCitizen`, `season.vaultSoon`, `mint.speechConnect/ctaConnect/notConnected`; `profile.missing` diganti. Diperiksa di browser (desktop 1440x900 dan ponsel 390x844) pada dua keadaan chain, wallet belum terhubung dan wallet terhubung tanpa citizen, memakai RPC dan mission server palsu; wallet dengan citizen diperiksa ulang agar tidak berubah.
- Batas yang diketahui: Belum dilihat dengan Phantom sungguhan. Ikon telur pada layar Mint bergantung pada berkas `icon_mint_egg.png` di `public/icons`.
- Komponen terkait: `apps/web/src/components/{city/WelcomePanel,city/CityPanels,mint/NoCitizenPanel,mint/MintScreen,missions/MissionsScreen,training/TrainingScreen,season/SeasonScreen,citizen/ProfileScreen,layout/BottomNav,layout/TopBar}.tsx`, `apps/web/src/messages/en.json`
- Menggantikan: —

## D-0064 — "Let's go" berjalan sendiri ke tujuan misi

- Tanggal: 2026-10-14
- Status: Approved (pemilik mencoba misi pertama di devnet: setelah menekan "Let's go" tidak ada yang terjadi sampai citizen sampai di tujuan)
- Keputusan: (1) Tombol "Let's go" pada langkah misi berjenis jalan, dan tombol di kartu misi yang kini bertuliskan "Walk there" (sebelumnya "Center map"), menyuruh citizen misi berjalan ke titik tujuan langkah itu, lalu kamera mengikuti. Ini berlaku pada mode Auto maupun Control; sebelumnya citizen hanya berjalan bila pemain mengetuk peta di mode Control, padahal tombolnya terbaca seperti perintah jalan. (2) Cara kerjanya: store mendapat penghitung `walkRequest` dan aksi `requestWalk`, sejajar dengan `focusRequest`; `CityCanvas` meneruskannya ke `CityScene.walkToTarget()`, yang memakai rute yang sama dengan ketukan di peta (`routeTo`, hasil pemisahan dari `walkSelectedTo`). Tiba di titik tujuan tetap dideteksi oleh `checkArrival`, jadi urutan lencana "Arrived" dan dialog langkah berikutnya tidak berubah.
- Alasan: Tombol yang berjanji berjalan tetapi hanya menutup dialog membuat pemain mengira misi macet. Ketuk-untuk-jalan tetap ada untuk pemain yang ingin memilih jalurnya sendiri.
- Dampak: Hanya perilaku kota; tidak ada perubahan data, server, atau kontrak. Diperiksa di browser dengan RPC dan mission server palsu: dari "Let's go" citizen berjalan sendiri ke pasar dan dialog langkah 2 muncul dengan lencana "Arrived". Teks `missions.centerMap` diganti `missions.walkThere`.
- Komponen terkait: `apps/web/src/game/{CityScene,createCityGame}.ts`, `apps/web/src/stores/{types,selectors}.ts`, `apps/web/src/stores/slices/citySlice.ts`, `apps/web/src/components/city/{CityCanvas,MissionPopup,MissionTracker}.tsx`, `apps/web/src/messages/en.json`
- Menggantikan: —

## D-0065 — Citizen chat dimulai sebagai paket `@bas/ai`

- Tanggal: 2026-10-14
- Status: Approved (pemilik meminta Phase E, agents, dimulai); butir (3), batas yang diketahui, dan urutan tahap diganti oleh D-0066
- Keputusan: (1) Logika chat ditulis dulu sebagai paket tanpa server, `packages/ai`, dengan antarmuka penyimpanan (`QuotaStore`, `MemoryStore`, `ConversationStore`, `SpendLedger`) dan adapter dalam memori; server, Postgres, Redis, dan worker menyusul di tahap berikutnya (docs/AGENTS.md bagian 4). (2) Gateway model adalah OpenRouter, diakses hanya dari server, tanpa tool dan tanpa akses wallet; model utama dan cadangan dari lingkungan. (3) Balasan model harus lolos skema ketat (balasan ≤400 karakter, emosi dan animasi dari daftar, `memoryCandidate` ≤240 atau null, `safety: ok`). Balasan yang tidak lolos, terlambat, atau menyalin penanda rahasia prompt diganti dialog tertulis tangan; kuota dikembalikan bila tidak ada jawaban yang bisa dipakai. (4) Kuota 20 pesan per aset per hari UTC, anggaran harian sebagai pemutus (model berhenti dipanggil bila habis), pesan pemilik maksimal 300 karakter. (5) Memori publik ikut NFT, memori privat terikat pasangan aset dan pemilik sehingga pemilik baru mulai kosong. (6) Riwayat percakapan dipegang server, bukan klien.
- Alasan: Chat adalah syarat sebelum mint mainnet dibuka (SPEC §3.3). Memisahkan logika dari penyimpanan memungkinkan semua aturan diuji tanpa layanan luar dan memastikan adapter produksi mematuhi kontrak yang sama.
- Dampak: Paket baru, dependensi `zod` untuk paket itu, tambahan `.env.example` (`CHAT_*`), dokumen baru. Belum ada server atau tampilan chat; tidak ada perubahan pada web, mission server, atau program. 35 tes baru.
- Batas yang diketahui: Pemeriksaan anggaran dan pencatatan biaya tidak atomik; permintaan bersamaan dapat melewati batas sebesar beberapa balasan sampai ada adapter Postgres. Dialog tertulis tangan (E1b) belum ada, jadi fallback memakai tabel yang disuplai pemanggil.
- Komponen terkait: `packages/ai/**`, `docs/AGENTS.md`, `.env.example`
- Menggantikan: —

## D-0066 — Chat citizen hanya dari model, tanpa dialog pengganti

- Tanggal: 2026-10-14
- Status: Approved (pemilik menolak dialog tertulis tangan sebagai pengganti dan meminta alur yang sebenarnya)
- Keputusan: (1) Tidak ada dialog tertulis tangan. Bila model utama dan model cadangan (keduanya LLM) tidak memberi jawaban yang sah, hasilnya `unavailable` dengan alasan, kuota dikembalikan, dan pesan pemilik diberikan kembali. Tidak ada spanduk "district dialogue mode". (2) Anggaran harian dipesan atomik sebelum model dipanggil (`SpendLedger.reserve`) lalu disesuaikan ke biaya sebenarnya; kehabisan waktu mempertahankan pesanan, kegagalan lain melepasnya. Ini menutup batas yang dicatat di D-0065. (3) Satu percakapan per aset dan pemilik berjalan sekali waktu lewat `ConversationLock`. (4) Pemilik tetap dibaca dari chain pada setiap permintaan. Citizen dicocokkan ke roster lewat serial pada URI metadata aset, bukan `citizenId` chain yang hanya penghitung registrasi. (5) Auth token dan pembaca chain dipindah ke `packages/server-kit` agar mission server dan chat server memakai kode yang sama; token yang sama (`MISSION_TOKEN_SECRET`) berlaku untuk keduanya. (6) Penyimpanan produksi: Postgres untuk kuota, anggaran, dan memori; Redis untuk percakapan, kunci, dan antrean BullMQ; `apps/worker` merangkum memori privat yang melewati 400 karakter ke ≤300 lewat model. (7) Mainnet menolak mulai tanpa `DATABASE_URL` dan `REDIS_URL`. (8) Panel chat di web hanya muncul untuk citizen milik sendiri pada mode chain; mode mock hanya menampilkan catatan pratinjau.
- Alasan: Dialog pengganti membuat pemilik membaca jawaban yang bukan hasil agen yang dijanjikan, dan menyembunyikan kegagalan model. Mengatakan terus terang bahwa jawaban tidak tersedia, tanpa memotong kuota, lebih jujur dan lebih mudah dipantau. Anggaran yang tidak atomik bisa terlampaui oleh permintaan bersamaan.
- Dampak: Paket baru `server-kit` dan `chat-store`; aplikasi baru `chat-server` dan `worker`; `packages/ai` ditulis ulang (tanpa `fallback.ts`); mission server memakai `server-kit`; web mendapat panel chat dan port `chat` pada sumber data chain; `.env.example` menambah `CHAT_PORT`, `CHAT_SITE_URL`, `DATABASE_URL`, `REDIS_URL`, `NEXT_PUBLIC_CHAT_SERVER_URL`. Diperiksa di browser (desktop 1280 dan ponsel 390) dengan chain lokal, Postgres, Redis, dan model palsu: balasan, hitung kuota, pengembalian kuota pada balasan bocor dan lambat, ditolak, memori, dan hapus memori.
- Tambahan hari yang sama: (9) Klaim misi yang terkonfirmasi di chain menghasilkan satu baris riwayat publik lewat antrean (`onHistory` di `MissionService`, `describeClaim`); isinya hanya misi, distrik, hari, dan musim. (10) Animasi dari balasan dimainkan di potret profil, bukan di sprite kota, karena chat hanya terlihat di profil. (11) Setiap panggilan model dilaporkan ke `onModelCall` dan kegagalannya dicatat server tanpa isi pesan. (12) Alat uji untuk pemilik: `pnpm chat:smoke` dan `pnpm devnet:transfer`.
- Batas yang diketahui: Belum diuji dengan model sungguhan dan belum ada transfer NFT sungguhan di devnet; kedua alat ujinya sudah ada tetapi belum dijalankan terhadap layanan sungguhan (komputer kerja tidak punya akses ke OpenRouter maupun devnet). Baris riwayat publik hilang bila Redis tidak tersedia pada saat klaim dikonfirmasi (tidak diulang). Beberapa kunci API atau daftar model lebih dari dua belum didukung (E6).
- Komponen terkait: `packages/{ai,server-kit,chat-store}/**`, `apps/{chat-server,worker}/**`, `apps/mission-server/src/{auth,chain,http,history,config,main,service}.ts`, `packages/metaplex-client/src/transfer.ts`, `scripts/devnet/transfer-asset.mjs`, `apps/web/src/{lib/data,stores,components/chat}/**`, `docs/AGENTS.md`, `.env.example`
- Menggantikan: D-0065 butir (3) dan batas yang diketahui

## D-0067 — Pembaruan Next.js dan BullMQ; peringatan deprecated yang tersisa

- Tanggal: 2026-10-15
- Status: Approved (pemilik bertanya mengapa paket yang ditandai deprecated masih dipertahankan)
- Keputusan: (1) Next.js dan `eslint-config-next` naik dari 15.1.7 ke 15.1.12, versi terbaru lini 15.1 yang tidak ditandai rentan; 15.1.7 sampai 15.1.10 ditandai punya celah keamanan (CVE-2025-66478 dan pembaruan keamanan 2025-12-11). Tetap di lini 15.1 agar tidak ada perubahan perilaku. (2) BullMQ naik dari 5.34.8 ke 6.3.15, yang memakai `cron-parser` 5 dan tidak lagi membawa `uuid` lama. BullMQ 6 menolak tanda titik dua pada id pekerjaan, jadi id pekerjaan antrean kini memuat hash dari kuncinya (`packages/chat-store/src/queue.ts`); perilaku "satu pekerjaan per pemilik" dan "satu baris per peristiwa" tidak berubah dan tetap diuji. (3) Peringatan yang tersisa sengaja dibiarkan karena bukan paket yang kita pilih dan tidak ada versi yang bisa dipasang tanpa memaksa penimpaan dependensi: `crypto-js` 4.2.0 (dari `merkletreejs`, dibawa `@metaplex-foundation/mpl-core-candy-machine` 0.3.0 yang sudah versi terbaru), `uuid` 8.3.2 (dari `jayson`, dibawa `@solana/web3.js` 1.99.0), dan `eslint` 9 (`eslint-config-next` 15 hanya mendukung sampai 9; hanya alat pengembangan).
- Alasan: Celah keamanan pada kerangka web harus ditutup; pembaruan BullMQ menghilangkan dua paket usang tanpa menimpa apa pun. Menimpa dependensi bagian dalam pustaka Solana dan Metaplex berisiko merusak penandatanganan dan mint tanpa manfaat keamanan yang jelas.
- Dampak: `apps/web/package.json`, `apps/worker/package.json`, `packages/chat-store/{package.json,src/queue.ts}`, `pnpm-lock.yaml` (diperbarui oleh `pnpm install`). Diperiksa: typecheck, lint, seluruh tes (termasuk Postgres dan Redis), build produksi web, dan layar chat di browser.
- Batas yang diketahui: Tiga peringatan di atas masih muncul pada `pnpm install` sampai pemilik pustakanya merilis pembaruan. Lini Next.js masih 15; pindah ke 16 adalah pekerjaan terpisah.
- Komponen terkait: `apps/web/package.json`, `apps/worker/package.json`, `packages/chat-store/**`
- Menggantikan: —

## D-0068 — Anggaran berpikir untuk model reasoning

- Tanggal: 2026-10-15
- Status: Approved (hasil `pnpm chat:smoke` pemilik: 0 dari 4 jawaban valid pada model gratis)
- Keputusan: (1) `OpenRouterClient` menerima `reasoningEffort` dan mengirimnya sebagai `reasoning.effort`; nilainya dibaca dari `CHAT_REASONING_EFFORT` (`none`, `minimal`, `low`, `medium`, `high`). Jika kosong, kolom itu tidak dikirim sama sekali. (2) Jawaban kosong kini menjelaskan dirinya: `finish_reason`, token keluaran yang terpakai, dan token yang habis untuk berpikir. Hasil panggilan membawa `finishReason`, dan skrip smoke menampilkannya. (3) Untuk model gratis yang dipakai saat uji, `.env` memakai `CHAT_MAX_OUTPUT_TOKENS=1500`, `CHAT_REASONING_EFFORT=low`, dan `CHAT_REQUEST_TIMEOUT_MS=30000`.
- Alasan: Model reasoning memakai sebagian `max_tokens` untuk berpikir. Dengan batas 300 token, Nemotron menghabiskan seluruhnya untuk berpikir (jawaban kosong) atau terpotong di tengah JSON. Batas keluaran hanya plafon, jadi menaikkannya tidak menaikkan biaya model non-reasoning. Kolom `reasoning` sengaja tidak dikirim secara bawaan karena sebagian gateway menyalakan mode berpikir (dan biayanya) bila kolom itu ada.
- Dampak: `packages/ai/src/{model,config}.ts`, `apps/chat-server/{src/main.ts,scripts/smoke.mjs}`, `apps/worker/src/main.ts`, `.env.example`. Tes baru: pengiriman kolom `reasoning`, pesan jawaban kosong, dan pembacaan konfigurasi. Skrip smoke diuji terhadap gateway tiruan yang meniru model reasoning.
- Batas yang diketahui: Panggilan ke OpenRouter sungguhan belum bisa diuji dari lingkungan saya. `none` ditolak model yang berpikir secara wajib; pakai `minimal` atau `low` bila itu terjadi. Satu nilai berlaku untuk model utama dan cadangan.
- Komponen terkait: `packages/ai/**`, `apps/chat-server/**`, `apps/worker/**`
- Menggantikan: —

## D-0069 — "Forget" juga menghapus percakapan yang sedang terbuka

- Tanggal: 2026-10-15
- Status: Approved (ditemukan pemilik saat menguji chat: setelah menekan tombol Forget, panel memori kosong tetapi Ivy masih menjawab "Boss")
- Keputusan: `ChatService.forget(asset, owner)` menghapus catatan pribadi dan percakapan terbuka (beberapa giliran terakhir yang ikut dikirim ke model), di bawah kunci yang sama dengan pengiriman pesan. Rute `DELETE /chat/:asset/memory` memakainya. Bila sebuah pesan sedang dijawab, rute menjawab 503 dan pemilik cukup mengulang. `ConversationStore` mendapat `delete`, dengan versi memori dan Redis. Prompt `memoryCandidate` juga menegaskan bahwa sapaan dan obrolan ringan bukan fakta (`persona.ts`).
- Alasan: Hanya menghapus catatan meninggalkan jejak yang sama di percakapan terbuka (hingga 30 menit tanpa pesan), sehingga tombol Forget tampak berhasil tetapi tidak menghapus apa yang diingat model. Memakai kunci yang sama mencegah jawaban yang sedang berjalan menulis ulang catatan setelah dihapus.
- Dampak: `packages/ai/src/{chat,session,persona}.ts`, `packages/chat-store/src/redis.ts`, `apps/chat-server/src/http.ts`; tes baru di `packages/ai`, `packages/chat-store`, dan `apps/chat-server`.
- Batas yang diketahui: Ringkasan yang sedang diproses worker pada saat yang sama bisa menulis ulang catatan lama; `replaceSummary` hanya menulis bila catatan belum berubah, dan setelah Forget catatan sudah tidak ada, jadi tulisan itu ditolak.
- Komponen terkait: `packages/ai/**`, `packages/chat-store/**`, `apps/chat-server/**`
- Menggantikan: —

## D-0070 — Balasan mengikuti bahasa pemilik; reaksi potret tetap terlihat saat gerak dimatikan

- Tanggal: 2026-10-15
- Status: Approved (permintaan pemilik setelah uji chat: potret Ivy diam dan balasan selalu berbahasa Inggris)
- Keputusan: (1) Aturan prompt "answer in English" diganti: warga menjawab dalam bahasa yang terakhir dipakai pemilik (Indonesia, Inggris, Mandarin, Inggris Singapura, dan lainnya), memakai Inggris bila tidak jelas, dan tetap menyebut nama sendiri serta istilah BAS apa adanya. Kunci JSON, nilai `emotion` dan `animation` tetap bahasa Inggris. `memoryCandidate` ditulis dalam bahasa Inggris, tetapi nama panggilan dipertahankan persis seperti yang ditulis pemilik. (2) Bila sistem operasi meminta gerak dikurangi (`prefers-reduced-motion`), lompatan idle tetap mati, tetapi reaksi balasan memakai cahaya lembut di sekeliling potret (`react-glow`), tanpa gerakan.
- Alasan: Pemilik yang menulis dalam bahasa lain mendapat jawaban yang tidak ia pakai. Pada komputer pemilik, Windows memberi sinyal reduced motion, sehingga CSS lama mematikan seluruh animasi dan balasan tidak tampak di potret; hal ini dipastikan dengan uji di browser yang meniru preferensi tersebut (kelas reaksi terpasang tetapi `animation-name` bernilai none).
- Dampak: `packages/ai/src/persona.ts` dan tesnya, `apps/web/src/app/globals.css`, `apps/chat-server/scripts/smoke.mjs` (pertanyaan pertama kini berbahasa Indonesia).
- Batas yang diketahui: Kepatuhan model pada aturan bahasa bergantung pada modelnya dan hanya bisa dipastikan dengan panggilan sungguhan (`pnpm chat:smoke`). Catatan memori yang ditampilkan di panel tetap berbahasa Inggris. Teks antarmuka web masih Inggris saja; menerjemahkannya adalah pekerjaan terpisah.
- Komponen terkait: `packages/ai/**`, `apps/web/src/app/globals.css`
- Menggantikan: —

## D-0071 — Penanda suasana hati di potret, tidak bergantung pada animasi

- Tanggal: 2026-10-15
- Status: Approved (pemilik: pengguna tidak mungkin diminta mengubah pengaturan Windows, ponsel atau PC agar karakter terlihat berekspresi)
- Keputusan: Setiap balasan citizen memunculkan label suasana hati singkat (Curious, Happy, Worried, Thinking; `neutral` tanpa label) di sudut potret selama 3,5 detik. Label ini tidak memakai gerak sehingga terlihat di semua perangkat, termasuk yang menyalakan `prefers-reduced-motion`. Reaksi gerak tetap ada untuk yang mengizinkannya, dan D-0070 tetap berlaku: tanpa gerak, potret diberi cahaya lembut. Preferensi gerak pengguna sengaja tidak ditimpa. Reaksi di store kini membawa `emotion` di samping `animation`.
- Alasan: Sinyal `prefers-reduced-motion` datang dari sistem operasi dan sebagian pengguna tidak menyadari mereka menyalakannya (mode hemat daya dan sesi desktop jarak jauh pada Windows juga bisa mematikan animasi). Menimpa pilihan itu merugikan pengguna yang memang terganggu oleh gerakan; label teks menjamin semua orang melihat reaksinya.
- Dampak: `apps/web/src/stores/{types.ts,slices/chatSlice.ts}`, `apps/web/src/components/{chat/useCitizenChat.ts,citizen/ProfileScreen.tsx}`, `apps/web/src/messages/en.json` (`chat.moods`), `apps/web/test/chatSlice.test.ts`.
- Batas yang diketahui: Label berbahasa Inggris seperti seluruh antarmuka web; terjemahan antarmuka adalah pekerjaan terpisah.
- Komponen terkait: `apps/web/**`
- Menggantikan: —

## D-0072 — Kota tidak lagi rusak saat areanya berukuran nol

- Tanggal: 2026-10-15
- Status: Approved (pemilik melaporkan galat "Framebuffer status: Incomplete Attachment" dari Phaser)
- Keputusan: `createCityGame` mengabaikan perubahan ukuran induk yang nol (`ignoreEmptyParent`): selama induk tersembunyi atau jendela diperkecil sampai tidak berukuran, kanvas mempertahankan ukuran terakhirnya, dan ukuran awal paling kecil 1×1. Mode `Scale.RESIZE` tetap dipakai untuk ukuran yang nyata.
- Alasan: Phaser mengikuti ukuran induknya. Ukuran 0×0 membuat WebGL gagal membuat framebuffer, dan kanvas tetap 0×0 setelah induk tampil lagi, sehingga kota rusak sampai halaman dimuat ulang. Galat ini direproduksi di browser (induk disembunyikan, galat sama muncul, kanvas jadi 0×0) dan hilang setelah perbaikan; perubahan ukuran jendela yang normal (1280×900, 800×600, 390×800) tetap diikuti kanvas.
- Dampak: `apps/web/src/game/createCityGame.ts`.
- Batas yang diketahui: Perbaikan ini menimpa `getParentBounds` milik Phaser 3.90; bila Phaser dinaikkan, periksa kembali bahwa metode itu masih ada. Penyebab pasti pada komputer pemilik (jendela diperkecil, tab tersembunyi, atau PC tidur) tidak terlihat dari galatnya; semuanya berujung pada ukuran nol yang kini ditangani. Kehilangan konteks WebGL (misalnya setelah tidur panjang) belum diuji.
- Komponen terkait: `apps/web/src/game/**`
- Menggantikan: —

## D-0073 — Disconnect mengembalikan ke halaman awal dan membersihkan chat di layar

- Tanggal: 2026-10-15
- Status: Approved (pemilik: setelah disconnect, aplikasi harus kembali ke halaman utama dengan panduan menyambung wallet, seperti kunjungan pertama)
- Keputusan: Saat wallet terputus (tombol Disconnect di aplikasi, atau akun dicabut dari dalam wallet), `WalletProvider` mengarahkan ke `/` dengan `router.replace`, yaitu halaman "Welcome to the District" yang juga dibuka kunjungan pertama. Perpindahan tidak dilakukan untuk pemulihan wallet saat halaman dimuat. Setiap kali alamat wallet berubah (disconnect atau akun lain), `resetChat` menghapus semua baris percakapan dan reaksi di layar. Pemutusan itu sendiri tidak berubah: pengendali wallet melepas sesi, menghapus nama wallet dari localStorage, mencabut token misi, dan memanggil `disconnect` milik wallet, sehingga muat ulang tidak menyambung lagi.
- Alasan: Sebelumnya pemutusan berhasil tetapi pemain tetap di halaman profil warga yang sudah bukan miliknya, dan riwayat chat wallet lama tetap ada di memori halaman sehingga bisa terbaca wallet berikutnya yang memakai browser yang sama. Diperiksa di browser: sebelum perbaikan URL tetap `/citizen/1`; sesudahnya `/` dengan panduan menyambung wallet, dan tetap begitu setelah muat ulang.
- Dampak: `apps/web/src/lib/wallet/context.tsx`, `apps/web/src/stores/{types.ts,slices/chatSlice.ts}`, `apps/web/test/chatSlice.test.ts`.
- Batas yang diketahui: Wallet yang tidak mengirim peristiwa saat akunnya dicabut dari dalam ekstensi tidak bisa terdeteksi oleh aplikasi sampai halaman dimuat ulang atau permintaan berikutnya gagal; itu batas dari wallet-standard. Log chat pemain yang sama tidak disimpan antar muat ulang (memang hanya di memori halaman).
- Komponen terkait: `apps/web/**`
- Menggantikan: —

## D-0074 — Postgres dan Redis lokal lewat Docker Compose

- Tanggal: 2026-10-15
- Status: Approved (pemilik memakai Docker; langkah berikutnya setelah uji chat lolos)
- Keputusan: `docker-compose.yml` di akar repositori menjalankan Postgres 16 dan Redis 7 untuk pengembangan lokal, terikat ke `127.0.0.1` dengan volume tetap (data bertahan setelah dimatikan) dan pemeriksaan kesehatan. `pnpm services:up` menyalakan keduanya dan menunggu sehat; `pnpm services:down` mematikan tanpa menghapus data. Kredensial (`bas`/`bas`) hanya untuk mesin ini dan cocok dengan `DATABASE_URL` dan `REDIS_URL` di `.env.example`. Redis memakai `--appendonly yes` agar antrean tidak hilang saat kontainer dimulai ulang.
- Alasan: Memori, kuota, dan riwayat publik hanya teruji penuh dengan penyimpanan sungguhan; tanpa itu semuanya hilang saat chat-server dimatikan dan worker tidak punya antrean untuk dikerjakan. Compose membuat penyiapan satu perintah dan dapat diulang, tanpa memasang Postgres dan Redis langsung di Windows.
- Dampak: `docker-compose.yml`, `package.json` (skrip `services:up` dan `services:down`), `.env.example`.
- Batas yang diketahui: Berkas ini divalidasi sintaksnya (`docker compose config`) tetapi belum dijalankan oleh saya karena lingkungan saya tidak menjalankan kontainer; Postgres dan Redis yang sama diuji lewat instalasi lokal di lingkungan saya (tes `chat-store`, `worker`, dan `chat-server`). Port 5432 dan 6379 harus bebas di komputer pemilik.
- Komponen terkait: `docker-compose.yml`, `package.json`, `.env.example`
- Menggantikan: —

## D-0075 — Pemeriksaan sebelum menjalankan Postgres dan Redis nyata

- Tanggal: 2026-10-15
- Status: Approved (pemilik meminta pemeriksaan menyeluruh sebelum menjalankan, agar tidak bolak-balik memperbaiki)
- Keputusan: (1) Perintah Redis di chat server dan mission server dibatasi waktu (5 dan 3 detik), dan penambahan pekerjaan ke antrean dibatasi 3 detik, karena BullMQ menunggu koneksi tanpa batas. (2) Kegagalan menjadwalkan perapian ringkasan tidak lagi menggagalkan balasan warga; balasan sudah dibayar. (3) Chat server dan worker memeriksa Postgres dan Redis saat mulai dan keluar dengan satu pesan yang menyebut alamatnya (tanpa kata sandi) dan `pnpm services:up`; mission server memberi peringatan lalu jalan tanpa antrean riwayat. (4) Kolam Postgres punya penangan galat supaya koneksi menganggur yang putus karena database dimulai ulang tidak menghentikan proses. (5) Tes baru: sesudah chat server dimulai ulang, nama panggilan, percakapan terbuka, dan kuota tetap ada, dan Forget menghapus keduanya. (6) `.gitignore` di komputer pemilik kehilangan blok `.env`; dikembalikan, sehingga `.env` (berisi kunci OpenRouter) tidak ikut `git add .`.
- Alasan: Sebelumnya Redis yang mati membuat konfirmasi misi menggantung tanpa batas dan balasan chat gagal; Postgres yang tidak menyala memberi galat mentah `ECONNREFUSED` tanpa petunjuk. Semua ini ditemukan dengan menjalankan proses sungguhan (worker, chat server) terhadap Postgres 16 dan Redis dengan kredensial yang sama dengan Compose, termasuk mematikan Redis di tengah jalan.
- Dampak: `packages/chat-store/src/{redis,queue,postgres,reach,index}.ts`, `apps/chat-server/src/{main,runtime}.ts`, `apps/worker/src/main.ts`, `apps/mission-server/src/{main,upkeep,index}.ts`, `packages/ai/src/chat.ts`, tes terkait, `.gitignore`, `docs/AGENTS.md`.
- Batas yang diketahui: Redis yang mati saat balasan sudah dibayar tetap membuat balasan itu gagal (percakapan tidak bisa disimpan); itu kegagalan penyimpanan inti, bukan pekerjaan latar. Mission server tidak menyambung ulang antrean riwayat sampai dimulai ulang. Compose belum dijalankan oleh saya (lihat D-0074).
- Komponen terkait: `packages/chat-store`, `apps/chat-server`, `apps/worker`, `apps/mission-server`, `packages/ai`
- Menggantikan: —

## D-0076 — Satu perintah untuk seluruh lingkungan pengembangan

- Tanggal: 2026-10-15
- Status: Approved (pemilik meminta satu perintah setelah penyimpanan Postgres dan Redis terbukti jalan di komputernya)
- Keputusan: `pnpm dev:all` menjalankan `pnpm services:up`, `pnpm build:packages`, lalu mission server, chat server, worker, dan web lewat `concurrently` (devDependency akar, ^9.1.2) dengan nama dan warna per layanan. `--kill-others` mematikan semua bila salah satu berhenti. Menjalankan tiap layanan di jendela sendiri tetap didukung dan tetap cara yang disarankan untuk mencari galat.
- Alasan: Sebelumnya empat jendela harus dinyalakan satu per satu. Pemilik sudah membuktikan bahwa memori, kuota, percakapan, dan riwayat publik bertahan setelah restart, jadi risiko menyembunyikan galat di balik satu terminal sudah lebih kecil daripada manfaatnya.
- Dampak: `package.json` (skrip `dev:all`, devDependency `concurrently`), `pnpm-lock.yaml`, `docs/AGENTS.md`.
- Batas yang diketahui: Diuji di Linux dengan chat server dan worker sungguhan (semua menyala, salah satu berhenti mematikan yang lain, tidak ada proses tersisa). Perilaku `Ctrl+C` di PowerShell Windows belum saya uji; `concurrently` mematikan pohon proses di Windows, tetapi bila ada proses yang tertinggal, jendela terminal boleh ditutup. Jalur Docker untuk keempat aplikasi tidak dibuat (lihat percakapan: ditunda sampai persiapan deploy).
- Komponen terkait: `package.json`, `pnpm-lock.yaml`
- Menggantikan: —

## D-0077 — Memori Ivy tidak lagi menumpuk pengulangan, dan nama panggilan benar-benar tersimpan

- Tanggal: 2026-10-15
- Status: Approved (ditemukan dari tangkapan layar panel memori milik pemilik setelah Postgres aktif)
- Keputusan: (1) Prompt kini mengajarkan format nama panggilan yang tepat ("Likes to be called <nickname>") dan melarang mengulang fakta yang sudah ada di catatan. (2) `mergeCandidate` mengenali "likes/prefers/wants to be called X" dan "Nickname: X" sebagai nama panggilan, bukan hanya awalan persis "likes to be called". (3) Fakta yang sudah ada di ringkasan (dibandingkan tanpa huruf besar dan tanda baca) atau nama panggilan yang sama tidak mengubah memori sama sekali.
- Alasan: Panel menampilkan "The owner prefers to be called bos. bos owner prefers to be called bos bos prefers to be called bos ..." dan tidak ada baris "Calls you bos." Model menulis kandidat dengan kata-katanya sendiri, pengurai hanya mengenali satu awalan sehingga nama panggilan tidak pernah tersimpan, dan setiap pengulangan ditambahkan ke ringkasan sampai batas 600 karakter memotongnya menjadi serpihan.
- Dampak: `packages/ai/src/{memory,persona}.ts`, `packages/ai/test/{memory,chat,persona}.test.ts`.
- Batas yang diketahui: Catatan yang sudah rusak di database pemilik tidak dibersihkan otomatis; tombol "Forget what I told Ivy" menghapusnya. Efek perubahan prompt pada model gratis sungguhan belum bisa saya uji dari lingkungan saya (tidak menjangkau OpenRouter); pengurai dan penolak duplikat diuji otomatis tanpa bergantung pada model.
- Komponen terkait: `packages/ai`
- Menggantikan: —

## D-0078 — Panel memori ikut diperbarui saat warga membalas

- Tanggal: 2026-10-15
- Status: Approved (ditemukan dari tangkapan layar pemilik: panel menampilkan "Nothing about you yet" padahal warga sudah memanggilnya "bos")
- Keputusan: Bila panel memori sedang terbuka, `useCitizenChat` mengambil ulang memori setelah setiap balasan yang berhasil. Panel yang ditutup tetap tertutup; kegagalan mengambil ulang tidak mengganggu balasan dan panel mempertahankan isi terakhir.
- Alasan: Panel hanya mengambil data saat dibuka atau saat Forget, sehingga isinya basi begitu percakapan berlanjut. Server menyimpan catatan baru sebelum membalas, jadi pengambilan ulang tepat setelah balasan selalu mendapat data terbaru.
- Dampak: `apps/web/src/components/chat/useCitizenChat.ts`.
- Batas yang diketahui: Satu permintaan tambahan per balasan selama panel terbuka. Baris riwayat publik yang ditulis worker beberapa detik setelah misi baru muncul saat panel dibuka ulang, bukan otomatis.
- Komponen terkait: `apps/web/**`
- Menggantikan: —

## D-0079 — Alat baca untuk menemukan alamat aset citizen

- Tanggal: 2026-10-15
- Status: Approved (langkah berikutnya setelah lingkungan lokal terbukti: uji transfer NFT di devnet butuh alamat aset, yang tidak tampil di aplikasi)
- Keputusan: `pnpm devnet:citizens <alamat wallet>` (`scripts/devnet/list-citizens.mjs`) menanyakan ke RPC semua aset Core milik wallet itu di koleksi BAS dan mencetak nama, alamat aset, dan uri metadata. Skrip hanya membaca: tanpa kunci, tanpa tanda tangan. Offset byte sama dengan `CORE_ASSET_LAYOUT` di `@bas/chain-client` (pemilik di 1, koleksi di 34, nama di 66).
- Alasan: `devnet:transfer` meminta alamat aset, sementara aplikasi hanya menampilkan nomor citizen. Mencari alamatnya di wallet atau explorer lewat tebakan membuka peluang salah aset.
- Dampak: `scripts/devnet/list-citizens.mjs`, `package.json`, `docs/AGENTS.md`.
- Batas yang diketahui: Diuji terhadap RPC tiruan dengan tata letak akun yang sama (pemilik, koleksi, nama, uri; wallet dengan dua citizen, wallet kosong, input salah). Belum dijalankan terhadap devnet sungguhan karena jaringan saya tidak menjangkaunya. Endpoint devnet publik membatasi `getProgramAccounts`; skrip mencoba ulang bila dibatasi lajunya.
- Komponen terkait: `scripts/devnet`
- Menggantikan: —

## D-0080 — Mengubah kunci wallet uji devnet menjadi berkas kunci untuk uji transfer

- Tanggal: 2026-10-15
- Status: Approved (dibutuhkan pemilik: wallet hanya menawarkan Burn untuk Ivy #019 yang belum terverifikasi, tanpa Send)
- Keputusan: `pnpm devnet:import-key <alamat wallet> [--name wallet-a]` (`scripts/devnet/import-key.mjs`) meminta kunci rahasia dengan masukan tersembunyi, menerima base58 64 atau 32 byte atau array JSON, memeriksa bahwa kunci itu menurunkan alamat yang disebut dan bahwa separuh kedua cocok, lalu menulis `.keys/<nama>.json` (mode 0600, tidak menimpa, folder sudah di `.gitignore`). Kunci tidak pernah dicetak dan pesan galat tidak mengulang masukan.
- Alasan: `devnet:transfer` menandatangani dengan berkas kunci format `solana-keygen`, sedangkan wallet mengekspor base58. Mengubahnya dengan alat yang memeriksa kecocokan alamat mencegah salah kunci dan tidak membuat pemilik menempelkan kunci ke chat atau mengedit berkas dengan tangan.
- Dampak: `scripts/devnet/import-key.mjs`, `package.json`, `docs/AGENTS.md`.
- Batas yang diketahui: Hanya untuk wallet yang berisi aset uji devnet; berkasnya harus dihapus setelah uji. Diuji di Linux dengan masukan terpipa dan terminal sungguhan (backspace, tidak ada gema); perilaku tempel di PowerShell Windows belum saya uji.
- Komponen terkait: `scripts/devnet`
- Menggantikan: —

## D-0081 — Skrip devnet tidak lagi mencetak kunci API RPC

- Tanggal: 2026-10-15
- Status: Approved (ditemukan saat pemilik menempelkan keluaran `devnet:citizens` yang memuat alamat RPC lengkap beserta `api-key`)
- Keputusan: Lima skrip devnet (`setup`, `mint-setup`, `mint-simulate`, `transfer-asset`, `list-citizens`) mencetak alamat RPC lewat `describeRpc` di `solana.mjs`, yang hanya menampilkan host. Kunci di query string, di path, atau di bagian pengguna tidak ikut tercetak.
- Alasan: Penyedia RPC berbayar menaruh kunci akun di alamatnya. Keluaran skrip sering disalin ke chat, issue, atau tangkapan layar; mencetak kunci itu sama saja dengan membocorkannya.
- Dampak: `scripts/devnet/{solana,setup,mint-setup,mint-simulate,transfer-asset,list-citizens}.mjs`.
- Batas yang diketahui: Kunci yang sudah pernah tercetak dan disalin tetap terbuka; pemilik perlu memutarnya di dasbor penyedia. Kunci RPC di variabel `NEXT_PUBLIC_*` memang terlihat di bundel browser; pembatasan domain di dasbor penyedia adalah perlindungan yang tersisa untuk itu.
- Komponen terkait: `scripts/devnet`
- Menggantikan: —

## D-0082 — Marketplace citizen sendiri: harga tetap dulu, tanpa menahan dana

- Tanggal: 2026-10-15
- Status: Approved (permintaan pemilik; hanya rancangan, belum ada kode)
- Keputusan: BAS membangun marketplace untuk koleksi citizen sendiri, bertahap (`docs/MARKET.md`). F1 adalah harga tetap lewat program Anchor baru `market`. NFT tetap di wallet penjual; penjual memberi plugin `TransferDelegate` Core ke PDA `market-authority`, dan `buy` memindahkan aset ke pembeli, membayar penjual, royalti dan fee dalam satu transaksi. Program tidak pernah menahan SOL atau NFT. F2 (offer) dan F3 (lelang) menyusul, karena keduanya menahan dana orang lain. Semua fase hanya di devnet sampai ada audit eksternal.
- Alasan: Uji transfer menunjukkan wallet tidak menawarkan Send untuk koleksi yang belum terverifikasi, jadi pemain tidak punya cara memindahkan citizen, padahal D-0055 mengandalkan pasar sekunder. Royalti 5% memakai `ruleSet: None`, sehingga marketplace lain boleh mengabaikannya; marketplace sendiri selalu membayarnya. Tanpa penahanan dana, kesalahan di program tidak bisa menghilangkan SOL atau NFT milik pengguna.
- Dampak: Program baru `programs/market` (anggota workspace Cargo), paket klien, halaman `/market`, dan aksi List for sale di profil citizen. `district` tidak berubah. Pembelian tidak memberi poin, kredit, atau token (SPEC 2.3).
- Batas yang diketahui: CPI `TransferV1` Core ditulis tangan seperti pembaca aset `district`; diskriminator, urutan akun, dan reset delegate saat transfer harus dibuktikan dengan test terhadap `mpl_core.so` asli, yang hanya bisa dijalankan di WSL pemilik. Royalti di luar marketplace ini tetap sukarela. SPEC 2.3 melarang "marketplace agent generik"; market ini hanya untuk koleksi BAS, jadi dicatat sebagai perluasan terbatas.
- Komponen terkait: `docs/MARKET.md`, `programs/market` (belum ada)
- Menggantikan: —

## D-0083 — Halaman Market dibangun lebih dulu di atas data contoh; program menyusul

- Tanggal: 2026-10-15
- Status: Approved (pemilik meminta UI/UX lebih dulu dan program on-chain ditunda)
- Keputusan: Halaman `/market`, dialog beli dan jual, serta tombol jual dan beli di profil citizen dibangun lebih dulu di atas data mock. Snapshot distrik mendapat `market` (`open`, royalti, batas harga, daftar listing), antarmuka data mendapat `listCitizen`, `changeListingPrice`, `cancelListing` dan `buyCitizen`, dan sumber mock mendapat `simulateSale` untuk memperlihatkan apa yang tersisa setelah penjualan. Sumber chain melaporkan market tertutup (`open: false`) dan menolak semua aksinya dengan `market-closed`; di jaringan sungguhan halaman berkata market belum dibuka dan tombol jual disembunyikan. Aturan harga (0,01 sampai 1.000 SOL, royalti 5% dibulatkan ke bawah, SOL dibaca tanpa floating point) berada di `lib/data/market.ts` dan akan dipakai klien program nanti.
- Alasan: UI bisa dinilai dan diuji tanpa toolchain Solana, dan bentuk data serta teks yang menjelaskan apa yang berpindah (skor, kredit, riwayat publik ikut; memori chat pribadi tidak) diputuskan sebelum program ditulis.
- Dampak: `lib/data/{types,market}.ts`, `lib/data/mock/*`, `lib/data/chain/chainDataSource.ts`, store dan selector, `components/market/*`, `app/market/page.tsx`, tab MARKET di header dan bar bawah (enam tab; di lebar laptop hanya tab aktif yang menampilkan namanya), `messages/en.json`, riwayat publik mendapat entri `sale`. Tes baru: `test/market.test.ts` (25) dan satu tes di `chainDataSource.test.ts`.
- Batas yang diketahui: Semua listing, harga, dan penjualan di halaman ini adalah data contoh; tidak ada transaksi sungguhan. Pemindahan NFT dan pembayaran royalti baru ada setelah program F1. Entri riwayat `sale` belum dibaca dari chain. Tampilan belum dicoba dengan dompet sungguhan, karena market belum terbuka di jaringan mana pun.
- Komponen terkait: `apps/web/src/components/market`, `apps/web/src/lib/data/market.ts`, `docs/MARKET.md`
- Menggantikan: — (melengkapi D-0082)

## D-0084 — Program market F1 ditulis dan diuji dengan kode Core sungguhan

- Tanggal: 2026-10-15
- Status: Approved (pemilik meminta kode program setelah UI market selesai)
- Keputusan: `programs/market` (id devnet `EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP`) berisi `initialize_config`, `update_config`, `set_paused`, `propose_admin`, `accept_admin`, `create_listing`, `update_price`, `cancel_listing`, `close_stale_listing` dan `buy`, sesuai `docs/MARKET.md`. Tiga hal ditambahkan dari rancangan D-0082: (1) program membaca registry plugin aset sendiri, sehingga `create_listing` dan `update_price` menolak aset yang delegate-nya bukan market, dan `close_stale_listing` juga menutup listing yang delegate-nya dicabut atau asetnya dibakar; (2) penerima royalti dan fee harus sudah memegang SOL minimum rent saat config ditulis, karena 5% dari harga minimum 0,01 SOL lebih kecil dari rent akun kosong; (3) `buy` memeriksa ulang bahwa pembeli memang pemilik aset setelah CPI Core. Tes integrasi berada di `programs/market/integration`, workspace Cargo terpisah dengan lockfile sendiri, dan menjalankan program Core: dari `tests/fixtures/mpl_core.so` bila berkas itu ada (hasil dump devnet), selain itu dari kode sumber Core rilis 0.9.8. Batas harga di `lib/data/market.ts` web kini dicek terhadap `constants.rs` oleh tes.
- Alasan: Risiko terbesar D-0082 adalah CPI `TransferV1` yang ditulis tangan dan perilaku reset delegate. Toolchain SBF dan RPC devnet tidak terjangkau dari lingkungan kerja ini, tetapi kode sumber Core terjangkau, jadi program dijalankan bersama Core yang sesungguhnya alih-alih byte aset tiruan. Klien Rust resmi Core dipakai di tes sebagai pembanding independen untuk encoding instruksi dan pembacaan aset.
- Dampak: `programs/market/**` (baru), `Cargo.toml` (anggota workspace dan `exclude`), `Cargo.lock` (hanya entri `market`), `programs/Anchor.toml`, `package.json` (`market:test`, `market:test-core`, `market:build`, `market:test-sbf`, `devnet:deploy-market`), `scripts/devnet/deploy.sh` (variabel `PROGRAM`), `.gitignore`, `docs/MARKET.md`, `apps/web/src/lib/data/market.ts` (komentar), `apps/web/test/market.test.ts`. Tes: 15 unit, 45 integrasi; tes `district` tidak berubah dan tetap lulus.
- Batas yang diketahui: Pemilik menjalankan ke-45 tes dengan `mpl_core.so` hasil dump devnet tanggal 2026-10-15 dan semuanya lulus, jadi market cocok dengan Core yang ter-deploy hari itu; bila Metaplex memperbarui Core, dump dan tes perlu diulang. Program market sendiri belum dibangun untuk SBF (rustc 1.75) dan belum di-deploy; keduanya dijalankan di WSL pemilik. Event `emit!` belum teruji. Klien TypeScript, skrip setup config, dan sumber data chain untuk halaman `/market` belum ada, jadi web masih menampilkan market tertutup di jaringan sungguhan.
- Komponen terkait: `programs/market`, `docs/MARKET.md`
- Menggantikan: — (melaksanakan langkah 2 dan sebagian langkah 3 D-0082)

## D-0085 — Program market ter-deploy di devnet

- Tanggal: 2026-10-15
- Status: Approved (dijalankan pemilik di WSL)
- Keputusan: `market.so` hasil `cargo build-sbf` (409.416 byte, sha256 `d387d379081c5b45c41e40d3a26502daa90cb4f08198637339f7945db1505649`) lulus ke-45 tes integrasi sebagai binary SBF bersama `mpl_core.so` hasil dump devnet, lalu di-deploy ke `EVjdJiuyVfKUoQFirJDbCauvkHcVKZ38y9i2XAP1ypyP` di slot 511238547 (signature `575TGvmrrCAGnwfdSjEB8XBKTKcydwS5dgwqFC5KN9CiaM8572zVpT7F2s2K5tzRWM6p7ULQhcToik6YWbne35Wk`). Upgrade authority adalah deployer `9DfhjiWco7mDjyiwwSZo9UtyAYqYhjxSw3GyfTmCGEuK`; ProgramData `HBShUkRUMjENj91LthPbWYju6rV5CTZgYmszw8ZZ4w1j`.
- Alasan: Langkah 3 D-0082 selesai; build tidak memberi peringatan stack frame, dan `buy` lengkap dengan transfer Core memakai paling banyak sekitar 36.000 compute unit.
- Dampak: `docs/MARKET.md`. Tidak ada perubahan kode.
- Batas yang diketahui: Config belum di-initialize, jadi market belum bisa dipakai; hanya upgrade authority yang bisa memanggil `initialize_config`, sehingga tidak ada pihak lain yang bisa mendahuluinya. Event `emit!` belum teruji. Web masih menampilkan market tertutup sampai klien, skrip setup config, dan sumber data chain selesai (langkah 4).
- Komponen terkait: `programs/market`, `scripts/devnet/deploy.sh`
- Menggantikan: — (melengkapi D-0084)

## D-0086 — Klien market, skrip setup devnet, dan halaman `/market` di chain

- Tanggal: 2026-10-15
- Status: Approved (pemilik meminta langkah 4 dipasang)
- Keputusan: (1) `@bas/chain-client` mendapat `market.ts` (alamat PDA, decoder `MarketConfig` dan `Listing`, pembaca plugin TransferDelegate dan FreezeDelegate aset Core, instruksi market, instruksi plugin Core yang ditulis tangan, serta `listForSaleInstructions` dan `cancelSaleInstructions` yang menyusun satu aksi menjadi satu transaksi) dan `marketAdmin.ts` (`initialize_config`, `set_paused`, pembaca otoritas upgrade, pembaca plugin Royalties koleksi). (2) `config/*.json` mendapat field opsional `marketProgramId`; hanya devnet yang memilikinya, dan tes config gagal bila mainnet memilikinya sebelum audit. (3) `scripts/devnet/market-setup.mjs` (`pnpm devnet:market-setup`) memeriksa deploy dan otoritas upgrade, memeriksa royalti koleksi 500 bps penuh ke `royaltyRecipient`, memeriksa saldo penerima, menjalankan `initialize_config` (royalti 500, fee 0), lalu membuka pause; aman dijalankan ulang, `--pause` menutup kembali. (4) Sumber data chain membaca config dan listing, menampilkan listing hanya bila pemilik aset masih penjual, delegate masih market, dan aset tidak dibekukan, serta menjalankan jual, ubah harga, batal, dan beli dengan satu tanda tangan per aksi. Harga yang dilihat pembeli dikirim sebagai `max_price`; galat program dibaca dari log preflight dan dipetakan ke galat layar, termasuk galat baru `price-changed`. (5) Teks `insufficient-sol`, `market-closed`, dan `closedText` dibuat umum, karena dipakai juga untuk pembelian dan saat market di-pause.
- Alasan: Program sudah ter-deploy (D-0085), tetapi tanpa klien dan config yang diisi, market tidak bisa dipakai. Penyusunan instruksi ditaruh di `chain-client` agar web, skrip setup, dan tes memakai kode yang sama. Instruksi Core ditulis tangan karena web tidak memuat Umi; ketepatannya dibuktikan dengan perbandingan byte terhadap klien resmi Core.
- Dampak: `packages/chain-client/src/{market,marketAdmin,browser,index}.ts`, `packages/chain-client/test/market.test.ts`, `packages/config/src/{types,network}.ts`, `packages/config/test/config.test.ts`, `config/devnet.json`, `packages/metaplex-client/test/{market-core,market.e2e}.test.ts`, `packages/metaplex-client/package.json` dan `pnpm-lock.yaml` (`litesvm` 1.5.0 sebagai devDependency), `scripts/devnet/market-setup.mjs`, `package.json`, `apps/web/src/lib/data/chain/{types,reads,transactions,chainDataSource}.ts`, `apps/web/src/lib/data/types.ts`, `apps/web/src/config/telemetry.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/stores/{types,slices/districtSlice}.ts`, `apps/web/src/messages/en.json`, `apps/web/test/{chainWorld,chainDataSource.test,chainReads.test,chainTransactions.test}.ts`, `docs/MARKET.md`, `docs/AGENTS.md`. Tes: 437 lulus di seluruh paket.
- Bukti: `market.e2e.test.ts` menjalankan listing, ubah harga, beli (saldo tepat: 0,65 SOL memberi 0,0325 ke royalti), jual ulang, batal, listing basi, dan citizen beku terhadap `market.so` hasil build pemilik (sha256 `d387d379…`) dan `mpl_core.so` hasil dump, di LiteSVM. Skrip setup dijalankan apa adanya terhadap RPC tiruan berbasis LiteSVM: inisialisasi, buka, dijalankan ulang, pause, serta menolak penerima tanpa saldo dan royalti 400 bps. Halaman `/market` dalam mode chain diuji di Chromium headless terhadap RPC yang sama, dengan wallet Wallet Standard uji: membaca dua listing sah dan menyembunyikan satu listing basi, lalu beli, jual, dan batal masing-masing dengan satu tanda tangan dan mendarat di program.
- Batas yang diketahui: Pemilik menjalankan `pnpm devnet:market-setup` di devnet pada 2026-10-15: semua pemeriksaan lulus, config `Da5LKDu5FB77SUJ1YJPUoWQcAFYxZU9AJoFteaCG6nX5` di-initialize (signature `5sYbb5KM…`) dan market dibuka (`3CtW3iWY…`). Hari yang sama pemilik menjual Ivy (#019) seharga 0,10 SOL dari wallet `5WjX…Wo4y` ke `CJkc…t2AK` lewat `/market`; di chain penjual menerima 0,095 SOL ditambah sewa listing, penerima royalti 0,005 SOL, listing tertutup, dan delegate kembali ke pemilik baru. LiteSVM tidak punya build Windows, jadi tes e2e dilewati di PowerShell. Riwayat publik belum mendapat baris `sale` dari penjualan di chain, dan penjual tidak mendapat pemberitahuan saat citizennya terjual. Listing citizen yang dibekukan disembunyikan; menjual citizen beku tidak dicegah di layar.
- Komponen terkait: `packages/chain-client`, `scripts/devnet`, `apps/web/src/lib/data/chain`, `docs/MARKET.md`
- Menggantikan: — (melaksanakan langkah 4 D-0082)

## D-0087 — Lelang citizen (F3), baris penjualan di riwayat publik, dan pemberitahuan penjual

- Tanggal: 2026-10-15
- Status: Approved (pemilik meminta lelang, baris "terjual" di riwayat publik, dan pemberitahuan untuk penjual; keempat pilihan rancangan lelang dipilih pemilik)
- Keputusan: (1) Program `market` mendapat `create_auction`, `place_bid`, `cancel_auction` dan `settle_auction` dengan akun `Auction` (`["auction", asset]`, 142 byte). Pilihan pemilik: NFT tetap di wallet penjual dan dibekukan lewat plugin FreezeDelegate Core yang dipegang PDA `market-authority`; penjual memilih 24, 48 atau 72 jam; tawaran di 10 menit terakhir memundurkan akhir menjadi 10 menit sesudah tawaran itu; penjual hanya boleh membatalkan sebelum ada tawaran. Tawaran berikutnya minimal 5% di atas tawaran tertinggi (dibulatkan ke atas, minimal 1 lamport). Akun lelang hanya memegang tawaran tertinggi; tawaran sebelumnya dikembalikan penuh di instruksi yang sama. Siapa pun boleh menyelesaikan lelang setelah berakhir; citizen pindah ke penawar tertinggi lewat transfer Core dan uangnya dibagi seperti `buy`. Satu citizen hanya bisa dijual dengan harga tetap atau dilelang, tidak keduanya: `create_auction` menolak bila ada listing, `create_listing` dan `buy` menolak aset beku. (2) Sumber chain di web menunjuk ulang delegate dengan aturan Core: plugin yang didelegasikan ke alamat lain dicabut dulu sebelum di-approve ke market (galat Core `CannotRedelegate`), untuk listing maupun lelang. (3) Mission server membaca transaksi program market (`getSignaturesForAddress` lalu `getTransaction`, tiap 15 detik), mendekode event Anchor dari log, melayani `GET /market/activity`, dan menulis satu baris riwayat publik per penjualan ("Bought in the market for 0.10 SOL on day 5 of season 1, and moved to a new owner." atau "Won at auction …") tanpa menyebut wallet. (4) Web menampilkan penjualan di riwayat setiap citizen, memberi tahu wallet yang terhubung sekali saja tentang citizen yang terjual, lelang yang dimenangkan, dan tawaran yang dikalahkan (id yang sudah tampil disimpan per wallet di browser, maksimal 200), dan mendapat tab AUCTIONS, kartu dan dialog lelang, mode FIXED PRICE/AUCTION di dialog jual, serta status lelang di profil dan daftar citizen sendiri. Mode mock mendapat lelang contoh dan tombol pratinjau (pemain lain menawar, lompat ke akhir). (5) Aturan program yang dipakai layar (batas harga, durasi lelang, perpanjangan, tawaran berikutnya) dan format SOL hanya ditulis di `@bas/chain-client`, yang mengujinya terhadap `programs/market`; `lib/data/market.ts` web dan mission server mengambilnya dari sana, tidak lagi menyalinnya. Ini menggantikan bagian D-0083 yang menaruh batas harga di `lib/data/market.ts`.
- Alasan: Harga tetap tidak memberi cara bagi beberapa pembeli untuk saling menawar. Membekukan aset di wallet penjual mengikuti cara F1 (tanpa menahan NFT), dan dengan satu tawaran yang dipegang akun lelang, kesalahan paling buruk hanya menyangkut satu tawaran. Perpanjangan 10 menit mencegah tawaran detik terakhir. Penyelesaian oleh siapa pun berarti tidak perlu worker yang memegang kunci.
- Dampak: `programs/market/src/{constants,errors,events,core_asset,sale,pda,lib}.rs`, `programs/market/src/state/auction.rs`, `programs/market/src/instructions/{create_auction,place_bid,cancel_auction,settle_auction,create_listing,buy,mod}.rs`, `programs/market/integration/src/lib.rs`, `programs/market/integration/tests/{auction,listing}.rs`, `scripts/devnet/deploy.sh` (memperbesar akun program bila binary bertambah besar), `packages/chain-client/src/market.ts`, `packages/chain-client/test/market.test.ts`, `packages/metaplex-client/test/{market-core,market.e2e}.test.ts`, `apps/mission-server/src/{market,http,main,index}.ts`, `apps/mission-server/test/market.test.ts`, `apps/web/src/lib/data/{types,market}.ts`, `apps/web/src/lib/data/mock/{mockSnapshot,mockDataSource}.ts`, `apps/web/src/lib/data/chain/{types,reads,transactions,missionApi,chainDataSource}.ts`, `apps/web/src/stores/{types,selectors}.ts`, `apps/web/src/stores/slices/districtSlice.ts`, `apps/web/src/lib/utils/useNow.ts`, `apps/web/src/components/market/{AuctionCard,AuctionDialog,MarketNotices,MarketScreen,SellDialog}.tsx`, `apps/web/src/components/citizen/ProfileScreen.tsx`, `apps/web/src/components/layout/ScreenShell.tsx`, `apps/web/src/components/city/CityScreen.tsx`, `apps/web/src/messages/en.json`, `apps/web/test/{chainWorld,chainDataSource.test,chainReads.test,market.test}.ts`, `docs/MARKET.md`, `docs/MISSION_SERVER.md`. Data contoh: Baker Mabel (#013) pindah dari listing ke lelang, Captain Gale (#018) dilelang tanpa tawaran.
- Bukti: 57 tes integrasi market dengan program Core (11 di antaranya lelang) lulus dengan Core dari kode sumber, dengan `mpl_core.so` hasil dump devnet, dan sebagai binary SBF yang dibangun di lingkungan kerja ini (507.904 byte, sha256 `c2a814b1…`). `market.e2e.test.ts` menjalankan lelang dari awal sampai selesai dan sampai dibatalkan lewat `@bas/chain-client` di LiteSVM, dan memeriksa event `Sold`. Pemilik menjalankan ke-57 tes itu di WSL dengan binary SBF hasil build-nya sendiri dan `mpl_core.so` hasil dump devnet; semuanya lulus (compute unit terbesar: `settle_auction` sekitar 48.300, `create_auction` sekitar 46.500). Tes seluruh paket (`pnpm test`): 478 lulus. Pembaca aktivitas mission server dijalankan terhadap RPC devnet sungguhan dan menemukan penjualan Ivy (#019) dari D-0086 (signature `2Rjkx6n6…`, 0,10 SOL, penjual menerima 0,095 SOL), jadi event `Sold` program yang sudah ter-deploy terbaca dengan decoder baru; baris riwayatnya muncul setelah mission server dinyalakan ulang, bahkan sebelum upgrade. Halaman `/market` mode mock dicoba di Chromium: menawar, dikalahkan (pemberitahuan muncul dan SOL kembali), lompat ke akhir, menyelesaikan, dan memulai lelang sendiri.
- Batas yang diketahui: Program di devnet belum di-upgrade; sampai itu terjadi, lelang tidak tampil dan semua aksi lelang ditolak program lama. Upgrade perlu sekitar 0,50 SOL permanen untuk memperbesar akun program dan sekitar 2,58 SOL sementara untuk buffer, sementara deployer memegang 0,53 SOL (langkahnya di `docs/MARKET.md`). Core mengizinkan pemilik mencabut TransferDelegate walau aset beku: lelang lalu tidak bisa diserahkan, tawaran ditolak, dan lelang bisa diselesaikan seketika dengan tawaran tertinggi dikembalikan penuh. Tidak ada dana yang hilang, tetapi penjual bisa menghentikan lelangnya sendiri dengan cara ini; jaminan penjual belum dibuat. Mission server menyimpan aktivitas market di memori (500 penjualan dan 500 tawaran terbaru) dan membacanya ulang dari chain setiap kali dinyalakan. Pemberitahuan diingat per browser, jadi wallet yang sama di browser lain melihatnya sekali lagi.
- Komponen terkait: `programs/market`, `packages/chain-client`, `apps/mission-server`, `apps/web/src/components/market`, `docs/MARKET.md`
- Menggantikan: — (melaksanakan F3 dari D-0082 dan menutup dua batas D-0086)

## D-0088 — Riwayat tawaran di market, kartu yang lebih pendek, dan satu bingkai untuk pesan market

- Tanggal: 2026-10-16
- Status: Approved (pemilik meminta riwayat tawaran di ruang kosong sebelah kanan kartu lelang, kartu yang tidak terlalu tinggi, dan modal pemberitahuan yang seragam)
- Pemilik keputusan: Owner
- Konteks: Upgrade program market di devnet (D-0087) dijalankan pemilik pada 2026-10-16; data program di chain sama byte demi byte dengan build pemilik (sha256 `225148b5…`). Lelang pertama dari web (Ivy #019, mulai 0,10 SOL, 24 jam) mendapat tawaran 0,10 SOL dari `5WjX…Wo4y` lalu 0,105 SOL dari `CJLT…ZaY1`; tawaran pertama kembali penuh di `place_bid` yang kedua. Halaman lelang tidak menunjukkan siapa saja yang sudah menawar, ruang di kanan kartu kosong, kartu memakan banyak ruang vertikal, dan pemberitahuan "While you were away" memakai tombol oranye selebar dialog, berbeda dari pesan "Bid placed".
- Keputusan: (1) Setiap `MarketAuction` membawa `bids` (penawar disingkat, jumlah, waktu, milik wallet sendiri atau bukan), terbaru dulu, dari `GET /market/activity` dan hanya yang sesudah `started_at` lelang itu. Tawaran yang sudah ada di akun lelang tetapi belum terbaca server (server membaca tiap 15 detik) ditaruh di atas dari `highest_bidder`, tanpa waktu ("just now"). (2) Tab AUCTIONS mendapat panel BID HISTORY di samping kartu pada layar 1280 px ke atas dan di bawah kartu pada layar lebih sempit: semua tawaran lelang yang tampil (mengikuti filter role), 20 terbaru, dengan citizen, penawar ("You" bila wallet sendiri), waktu, jumlah, dan label LEADING atau OUTBID; satu baris membuka lelangnya. Dialog lelang mendapat daftar tawaran lelang itu. Mode mock mendapat tawaran contoh. (3) Kartu lelang dan kartu jual dipendekkan tanpa mengubah desain: gambar 2:1, tile stat satu baris, keterangan kecil digabung menjadi satu baris, jarak dan tombol sedikit lebih rapat (tinggi kartu sekitar 390 px, sebelumnya sekitar 500 px). (4) `PixelMessageFrame` dipakai bersama oleh modal global dan pemberitahuan market, sehingga "While you were away" sama dengan "Bid placed". (5) `programs/market/Cargo.toml` menamai cfg yang diperiksa macro Anchor 0.30 (`anchor-debug`, `custom-heap`, `custom-panic`, `target_os = "solana"`), sehingga rustc 1.80 ke atas tidak lagi mencetak satu peringatan per instruksi; binary SBF tidak berubah.
- Alasan: Penawar perlu melihat siapa yang menawar dan kapan sebelum menawar lagi, dan datanya sudah ada di indeks mission server, jadi tidak perlu perubahan program. Mengisi tawaran teratas dari akun lelang membuat riwayat langsung benar setelah tawaran sendiri. Kartu yang lebih pendek membuat kartu dan riwayat seimbang dalam satu layar.
- Dampak: `apps/web/src/lib/data/{types,market}.ts`, `apps/web/src/lib/data/chain/chainDataSource.ts`, `apps/web/src/lib/data/mock/{mockSnapshot,mockDataSource}.ts`, `apps/web/src/components/market/{BidHistory,MarketScreen,AuctionDialog,AuctionCard,ListingCard,CitizenLine,MarketNotices}.tsx`, `apps/web/src/components/modal/PixelModal.tsx`, `apps/web/src/messages/en.json`, `apps/web/test/{market,chainDataSource}.test.ts`, `programs/market/Cargo.toml`, `docs/MARKET.md`.
- Bukti: Tes web 176 lulus saat itu, termasuk tawaran yang belum terbaca server dan tawaran dari lelang sebelumnya yang tidak ikut. Tampilan dicoba di Chromium pada lebar 390, 1024, 1280 dan 1440 px. Di devnet, saldo diperiksa langsung: akun lelang `DEvi…AzyK` memegang 0,105 SOL ditambah sewa, `5WjX…Wo4y` kembali ke saldo semula dikurangi biaya jaringan 0,000025 SOL.
- Batas yang diketahui: Baris "SOL after bidding" belum mengurangi biaya jaringan (sekitar 0,000025 SOL). Riwayat bergantung pada indeks mission server, yang hanya menyimpan 500 tawaran terbaru di memori.
- Komponen terkait: `apps/web/src/components/market`, `apps/mission-server` (`/market/activity`), `docs/MARKET.md`
- Menggantikan: — (menutup batas D-0087 "program di devnet belum di-upgrade")

## D-0089 — Jam lelang cepat khusus devnet

- Tanggal: 2026-10-16
- Status: Approved (pemilik: uji lelang di devnet dengan waktu nyata terlalu lama untuk ditunggu)
- Pemilik keputusan: Owner
- Konteks: Lelang terpendek 24 jam (D-0087), jadi menyelesaikan lelang di devnet berarti menunggu sehari untuk setiap percobaan. Lelang Ivy yang dimulai 2026-10-16 02:58 WIB baru berakhir 2026-10-17 02:58 WIB. Tes integrasi sudah memajukan jam, tetapi uji dari web dengan wallet sungguhan tidak bisa.
- Keputusan: (1) Program market mendapat fitur Cargo `devnet-clock`. Dengan fitur itu satu jam lelang berlangsung 10 detik (24, 48, 72 jam menjadi 4, 8, 12 menit) dan jendela tawaran akhir menjadi 60 detik; tanpa fitur itu jamnya tetap 3.600 dan 600 detik. Instruksi, akun, dan pilihan 24/48/72 sama untuk kedua build. Nilainya ditulis di `constants.rs` (`AUCTION_HOUR_SECONDS`, `AUCTION_EXTENSION_SECONDS`) dan di `AUCTION_CLOCKS` milik `@bas/chain-client`, yang tesnya membaca `constants.rs`. (2) `config/devnet.json` menulis `"auctionClock": "devnet-fast"` selama devnet menjalankan build cepat. `@bas/config` menolak field itu di mainnet, tanpa `marketProgramId`, atau dengan nilai lain. Web mengambil panjang lelang, jendela tawaran akhir, dan catatan "Test clock" dari situ; sisa waktu tetap dari `ends_at` di chain. (3) Build cepat menulis "BAS devnet auction clock" ke log setiap `create_auction`; `scripts/devnet/deploy.sh` mencari teks itu di binary, menolak binary cepat bila genesis hash RPC bukan devnet, dan menolak binary yang jamnya tidak sama dengan manifest. (4) Tes integrasi mengambil jam dari crate program, sehingga ke-57 tes berjalan di kedua build; `pnpm market:build-devnet` dan `pnpm market:test-sbf-devnet` ditambahkan.
- Alasan: Aturan lelang (langkah 5%, perpanjangan, penyelesaian oleh siapa pun, pengembalian tawaran) tetap persis sama, hanya jamnya dipercepat, jadi uji di devnet tetap menguji kode yang sama. Fitur saat build lebih aman daripada nilai di akun config: binary mainnet sama sekali tidak bisa menjalankan jam cepat, dan admin tidak mendapat tuas untuk memendekkan lelang.
- Dampak: `programs/market/{Cargo.toml,src/constants.rs,src/sale.rs,src/instructions/create_auction.rs}`, `programs/market/integration/{Cargo.toml,tests/auction.rs}`, `packages/config/src/{types,network}.ts`, `packages/config/test/config.test.ts`, `config/devnet.json`, `packages/chain-client/src/market.ts`, `packages/chain-client/test/market.test.ts`, `apps/web/src/{config/telemetry.ts,app/layout.tsx,stores/types.ts,stores/slices/districtSlice.ts}`, `apps/web/src/lib/data/{types,market}.ts`, `apps/web/src/lib/data/chain/chainDataSource.ts`, `apps/web/src/lib/data/mock/{mockSnapshot,mockDataSource}.ts`, `apps/web/src/components/market/{SellDialog,AuctionDialog,AuctionCard}.tsx`, `apps/web/src/messages/en.json`, `apps/web/test/{chainWorld,chainDataSource.test,market.test}.ts`, `scripts/devnet/deploy.sh`, `package.json`, `docs/MARKET.md`.
- Bukti: Tes unit program lulus dengan dan tanpa fitur. Ke-57 tes integrasi dengan Core lulus secara native dan sebagai binary SBF, untuk build biasa maupun build cepat. Build cepat 508.032 byte (sha256 `c9bc6468…`) dan memuat teks penanda; build biasa tidak memuatnya dan hanya berbeda 1 byte dari build lelang sebelumnya di lingkungan build yang sama (sha256 `c2a814b1…`; yang berbeda adalah nomor baris galat Anchor). Penjaga di `deploy.sh` dicoba untuk kelima kombinasi jaringan, manifest dan binary dengan perintah `solana` tiruan. Tes seluruh paket: 484 lulus, termasuk lelang 24 jam yang selesai dalam empat menit di sumber chain.
- Batas yang diketahui: Lelang yang dimulai sebelum upgrade tetap memakai `ends_at`-nya sendiri, jadi lelang Ivy tetap berakhir 2026-10-17 02:58 WIB. Teks cara kerja ("An auction runs for one to three days") tetap menyebut jam nyata; di devnet catatan "Test clock" muncul di dialog jual dan dialog lelang. Sebelum mainnet, build biasa wajib dipakai dan `auctionClock` tidak boleh ada di manifest mainnet (dijaga `@bas/config` dan `deploy.sh`).
- Komponen terkait: `programs/market`, `packages/config`, `packages/chain-client`, `apps/web/src/components/market`, `scripts/devnet/deploy.sh`, `docs/MARKET.md`
- Menggantikan: — (melengkapi D-0087)

## D-0090 — Lelang yang berakhir diselesaikan pemenang (CLAIM) atau penjual (COLLECT)

- Tanggal: 2026-10-16
- Status: Approved (pemilik: lelang berakhir otomatis, pemenang mendapat tombol klaim, bukan FINISH)
- Pemilik keputusan: Owner
- Konteks: Program tidak bisa berjalan sendiri; lelang berhenti menerima tawaran pada `ends_at`, tetapi citizen baru pindah dan penjual baru dibayar saat seseorang mengirim `settle_auction`. Tombol FINISH AUCTION yang sama untuk semua orang membuat pemilik bertanya mengapa lelang harus diselesaikan dengan tangan. Pilihan lain yang dibahas: keeper di mission server, menumpang di transaksi market lain, transaksi penyelesaian yang ditandatangani di depan dengan durable nonce, dan jaringan otomatisasi seperti Tuk Tuk. Pemilik memilih tombol menurut peran, tanpa server dan tanpa perubahan program.
- Keputusan: (1) `auctionStage` di `apps/web/src/lib/data/market.ts` menentukan bagian wallet dalam satu lelang: `live`, `claim` (pemenang), `collect` (penjual dengan pemenang), `take-back` (penjual tanpa tawaran), `refund` (penawar tertinggi lelang yang dihentikan penjual), `close` (penjual yang menghentikan lelangnya) dan `waiting` (orang lain). (2) Kartu lelang, dialog lelang dan profil citizen memakai tombol yang sama untuk tiap tahap: CLAIM CITIZEN, COLLECT PAYMENT, TAKE BACK, TAKE BID BACK, END AUCTION, atau DETAILS bagi orang lain; badge pemenang menjadi YOU WON dan label tawaran tertinggi di riwayat menjadi WON. Dialog menjelaskan apa yang terjadi untuk peran itu (misalnya jumlah yang diterima penjual setelah royalti). Orang lain tidak mendapat tombol penyelesaian sama sekali, termasuk penawar yang kalah (koreksi pemilik setelah uji devnet); program tetap menerima `settle_auction` dari siapa pun, tetapi layar menyerahkannya kepada pemenang dan penjual. (3) `auctionNotices` membuat pemberitahuan AUCTION ENDED untuk pemenang ("Claim it in the market") dan penjual ("Collect your payment in the market") begitu lelang berakhir, juga saat halaman sedang terbuka; di luar halaman market ada tombol OPEN MARKET. `PixelMessageFrame` mendapat tombol tambahan opsional untuk itu. (4) Pesan setelah penjual menyelesaikan lelang menjadi PAYMENT COLLECTED dengan jumlah yang diterima.
- Alasan: Penyerahan tetap satu transaksi `settle_auction` yang boleh dikirim siapa saja (D-0087), jadi tidak perlu perubahan program, deploy, server, atau kunci baru. Tombol diberikan kepada pihak yang diuntungkan, sehingga yang biasanya kembali lebih dulu yang menyelesaikannya, dan pihak lain tidak perlu melakukan apa-apa. Selama belum diselesaikan, tawaran tetap aman di akun lelang dan citizen tetap di wallet penjual.
- Dampak: `apps/web/src/lib/data/{market,types}.ts`, `apps/web/src/components/market/{AuctionCard,AuctionDialog,BidHistory,MarketNotices}.tsx`, `apps/web/src/components/modal/PixelModal.tsx`, `apps/web/src/components/citizen/ProfileScreen.tsx`, `apps/web/src/stores/slices/districtSlice.ts`, `apps/web/src/messages/en.json`, `apps/web/test/market.test.ts`, `docs/MARKET.md`.
- Bukti: Tes web 179 lulus, termasuk tabel tahap untuk setiap peran dan pemberitahuan yang hanya muncul untuk pemenang dan penjual. Di mode mock (Chromium): pemenang mendapat AUCTION ENDED, YOU WON, CLAIM CITIZEN dan AUCTION WON; penjual mendapat AUCTION ENDED, COLLECT PAYMENT dan PAYMENT COLLECTED dengan 0,475 SOL dari 0,50 SOL; dari halaman Training, OPEN MARKET membawa ke `/market`. Di devnet, lelang jam cepat Baker Mabel (D-0089) berjalan 240 detik dengan tiga tawaran dan satu perpanjangan.
- Batas yang diketahui: Penyerahan baru terjadi saat pemenang, penjual, atau orang lain mengirim transaksinya; tanpa itu lelang menunggu dengan aman. Pemberitahuan diingat per browser.
- Komponen terkait: `apps/web/src/components/market`, `apps/web/src/lib/data/market.ts`, `docs/MARKET.md`
- Menggantikan: — (mengganti tombol FINISH AUCTION untuk semua orang dari D-0087 dengan tombol menurut peran)

## D-0091 — Tab FINISHED: hasil lelang dan penjualan harga tetap yang sudah selesai

- Tanggal: 2026-10-16
- Status: Approved (pemilik menanyakan di mana riwayat lelang yang sudah selesai, lalu meminta nama FINISHED dan pemisahan yang jelas antara hasil lelang dan penjualan tanpa lelang)
- Pemilik keputusan: Owner
- Konteks: Setelah lelang selesai, kartunya hilang dari tab AUCTIONS dan riwayat tawarannya ikut hilang. Penjualan hanya terlihat sebagai satu baris di riwayat publik profil citizen dan sebagai pemberitahuan sekali lihat untuk penjual dan pemenang. Indeks mission server (`/market/activity`) sudah menyimpan setiap penjualan dan setiap tawaran.
- Keputusan: (1) `MarketSnapshot.sales` berisi penjualan yang selesai, terbaru dulu: citizen, jenis (harga tetap atau lelang), harga, penjual, pembeli (ditandai bila itu wallet sendiri), waktu, dan untuk lelang, tawarannya. (2) Di sumber chain, tawaran sebuah lelang yang selesai disusun ulang dengan mengikuti `previousBidder` setiap tawaran, mundur dari tawaran pemenang sampai tawaran pertama (yang tidak mengalahkan siapa pun). Dengan begitu tawaran dari lelang sebelumnya untuk citizen yang sama tidak pernah ikut. (3) Market mendapat tab ketiga FINISHED · N dengan dua bagian yang tidak pernah dicampur: AUCTION RESULTS (bawaan) dan FIXED-PRICE SALES, masing-masing terbaru dulu dan mengikuti filter role. Setiap kartu disusun seperti rincian di dialog market: citizen dan waktu di atas, lalu baris Winner (atau Buyer), Seller, Bids dan Final price (atau Price), dan untuk lelang tombol SHOW N BIDS selebar kartu yang membuka tawarannya (label WON dan OUTBID). "You" berarti wallet sendiri. Versi sebelumnya menulis semuanya dalam dua baris teks kecil; pemilik menilainya kurang rapi. Citizen yang kini dilelang atau dijual lagi diberi tanda "At auction again" atau "For sale again", supaya hasil lama tidak dikira yang sedang berjalan. Versi pertama tab ini bernama SOLD dan mencampur keduanya; pemilik melihat penjualan harga tetap Ivy terbaca seperti lelang Ivy yang sedang berjalan. (4) Mode mock mencatat setiap pembelian, penjualan pratinjau, dan lelang yang selesai, dan dimulai dengan dua penjualan contoh (Ivy di lelang, Milo dengan harga tetap, masing-masing oleh wallet yang kini menjualnya lagi).
- Alasan: Riwayat harga dan siapa yang menawar adalah informasi yang dicari pembeli sebelum menawar atau membeli, dan datanya sudah ada, jadi tidak perlu perubahan program atau server. Menyusun ulang dari `previousBidder` lebih tepat daripada memotong menurut waktu, karena lelang yang dihentikan atau dibatalkan tidak tercatat sebagai penjualan.
- Dampak: `apps/web/src/lib/data/{types,market}.ts`, `apps/web/src/lib/data/chain/chainDataSource.ts`, `apps/web/src/lib/data/mock/{mockSnapshot,mockDataSource}.ts`, `apps/web/src/components/market/{FinishedSales,MarketScreen}.tsx`, `apps/web/src/messages/en.json`, `apps/web/test/{chainDataSource,market}.test.ts`, `docs/MARKET.md`.
- Bukti: Tes web 181 lulus, termasuk lelang di sumber chain dengan tiga tawaran dari dua wallet ditambah satu tawaran dari lelang sebelumnya: daftar tawarannya tepat tiga, terbaru dulu, tanpa tawaran lama, dan penjual serta pembeli masing-masing melihat dirinya sebagai "you". Tampilan dicoba di Chromium pada lebar 1440 dan 390 px, termasuk lelang yang baru dimenangkan langsung muncul di AUCTION RESULTS dan kedua bagian dengan tanda "For sale again".
- Batas yang diketahui: Daftar ini memuat apa yang disimpan mission server (500 penjualan dan 500 tawaran terbaru, dibaca ulang dari chain setiap kali server dinyalakan). Lelang tanpa penyerahan (dihentikan penjual) tidak muncul karena bukan penjualan.
- Komponen terkait: `apps/web/src/components/market`, `apps/mission-server` (`/market/activity`), `docs/MARKET.md`
- Menggantikan: —

## D-0092 — Market memegang citizen selama lelang

- Tanggal: 2026-10-16
- Status: Approved (pemilik meminta agar penjual tidak bisa menghentikan lelang yang sudah ada tawarannya, tetapi tetap bisa menghentikannya bila belum ada tawaran, lalu memilih "Dipegang market sejak lelang dimulai")
- Pemilik keputusan: Owner
- Konteks: Sejak D-0087 citizen yang dilelang tetap di wallet penjual, dibekukan oleh market dengan FreezeDelegate, dan market memindahkannya sebagai TransferDelegate. Core tetap mengizinkan pemilik mencabut TransferDelegate walaupun aset dibekukan. Penjual bisa memakai itu untuk menghentikan lelang yang sudah ada tawarannya: `place_bid` menolak dengan `AuctionUndeliverable` dan `settle_auction` mengembalikan tawaran tertinggi. Uang penawar tetap aman, tetapi tidak ada yang mencegah penjual melakukannya.
- Keputusan: (1) `create_auction` memindahkan citizen ke PDA `market-authority` dengan `TransferV1` yang ditandatangani penjual, lalu memeriksa PDA benar-benar pemiliknya. Plugin TransferDelegate dan FreezeDelegate tidak dipakai lagi untuk lelang, dan klien hanya mengirim `create_auction` (ditambah `close_stale_listing` bila perlu). (2) `cancel_auction`, hanya sebelum tawaran pertama, mengembalikan citizen ke penjual. (3) `settle_auction` memberikan citizen ke pemenang, atau mengembalikannya ke penjual bila tidak ada tawaran. (4) Setelah ada tawaran, penjual tidak memiliki apa pun yang bisa dicabut, dan `cancel_auction` menolak dengan `AuctionHasBids`, jadi lelang selalu berjalan sampai selesai. (5) Lelang yang dibuat sebelum perubahan ini (citizen beku di wallet penjual) tetap bisa ditawar, dibatalkan dan diselesaikan dengan jalur lama: `Auction::can_deliver` menerima kedua jenis. Lelang Ivy di devnet termasuk jenis lama. (6) Kode error `FreezeMissing` tetap ada di enum supaya nomor error sesudahnya tidak bergeser. (7) Di web, selama market memegang citizen, citizen itu tidak termasuk citizen milik wallet (tidak bisa dilatih, diajak chat, atau dipakai misi, karena program district memeriksa pemilik aset). Peran penjual dibaca dari akun lelang (`MarketAuction.sellerIsMe`), bukan dari kepemilikan. YOUR CITIZENS di market tetap menampilkannya dengan lelangnya, profilnya menulis "Your auction · held by the market until it ends", dan teks lelang menjelaskan bahwa market memegangnya.
- Alasan: Membekukan di wallet tidak bisa dibuat aman karena Core sengaja membiarkan pemilik mencabut TransferDelegate. Jaminan atau denda penjual hanya membuat penghentian mahal, tidak mencegahnya. Memegang aset adalah satu-satunya cara agar aturan "sesudah ada tawaran tidak bisa dihentikan" benar-benar ditegakkan oleh program. Biayanya: citizen tidak bisa dipakai bermain selama lelang, dan bisa diambil kembali dengan membatalkan sebelum ada tawaran.
- Dampak: `programs/market/src/{core_asset,lib,constants,errors,events}.rs`, `programs/market/src/state/auction.rs`, `programs/market/src/instructions/{create_auction,cancel_auction,settle_auction,create_listing}.rs`, `programs/market/integration/{src/lib.rs,tests/auction.rs}`, `packages/chain-client/{src/market.ts,test/market.test.ts}`, `packages/metaplex-client/test/market.e2e.test.ts`, `apps/web/src/lib/data/{types,market}.ts`, `apps/web/src/lib/data/chain/{chainDataSource,transactions,types}.ts`, `apps/web/src/lib/data/mock/{mockSnapshot,mockDataSource}.ts`, `apps/web/src/components/market/{AuctionCard,AuctionDialog,MarketNotices,MarketScreen,SellDialog}.tsx`, `apps/web/src/components/citizen/ProfileScreen.tsx`, `apps/web/src/stores/slices/districtSlice.ts`, `apps/web/src/messages/en.json`, `apps/web/test/{chainWorld.ts,chainDataSource.test.ts,market.test.ts}`, `docs/MARKET.md`.
- Bukti: 61 tes integrasi lulus (15 untuk lelang, 3 di antaranya membangun lelang jenis lama) secara native dan dengan biner SBF, masing-masing pada jam asli dan `devnet-clock`. Tes unit program 22 lulus pada kedua build. `@bas/chain-client` 71 lulus, `@bas/metaplex-client` 34 lulus termasuk lelang di LiteSVM dengan biner baru (pembatalan penjual ditolak setelah ada tawaran). Tes web 183 lulus. Di SBF, `create_auction` memakai paling banyak sekitar 41.700 compute unit.
- Batas yang diketahui: Biner `devnet-clock` berukuran 514.784 byte dan muat di akun program yang ada (518.144 byte), jadi tidak perlu `extend`. Di-deploy ke devnet pada 2026-10-16 sekitar pukul 09.00 WIB (slot 511552165) setelah 61 tes integrasi lulus dengan biner SBF di WSL pemilik; pada hari yang sama model baru dicoba penuh di devnet dengan Baker Mabel: lelang yang dibatalkan sebelum ada tawaran langsung mengembalikan citizen ke `CJkc…t2AK`; lelang berikutnya mendapat tawaran 0,023 SOL dari `CJLT…ZaY1` dan 0,04 SOL dari `9fd6…WBD8`, citizen dipegang `86Czje…AYhR`, simulasi pembatalan penjual ditolak dengan `AuctionHasBids`, lalu pemenang menekan CLAIM pukul 09.48.30 WIB: penjual menerima 0,038 SOL ditambah sewa, royalti 0,002 SOL, citizen pindah ke pemenang dan akun lelang tertutup.
- Komponen terkait: `programs/market`, `packages/chain-client`, `apps/web/src/components/market`, `docs/MARKET.md`
- Menggantikan: bagian "dibekukan di wallet penjual" dari D-0087

## D-0093 — Riwayat market disimpan di Postgres

- Tanggal: 2026-10-16
- Status: Approved (pemilik meminta riwayat market disimpan ke Postgres supaya tab FINISHED dan riwayat tawaran tetap lengkap berapa pun jumlahnya)
- Pemilik keputusan: Owner
- Konteks: `MarketIndexer` di mission server membaca transaksi program market setiap 15 detik dan menyimpan penjualan serta tawaran di memori, paling banyak 500 masing-masing. Setiap kali server dinyalakan, seluruh riwayat dibaca ulang dari chain, dan baris riwayat publik setiap penjualan diantrekan lagi (aman karena idempoten, tetapi sia-sia).
- Keputusan: (1) Migrasi `0002-market` di `@bas/chat-store` (daftar migrasi yang sama dengan chat, satu database) membuat `market_sales`, `market_bids` dan `market_cursor`. Setiap baris menyimpan program market, jadi program baru memulai riwayatnya sendiri. Lamport disimpan sebagai `numeric` dan dibaca kembali sebagai string desimal yang sama. (2) `PgMarketStore` di mission server menulis penjualan dan tawaran satu transaksi chain beserta cursor dalam satu transaksi database, dengan `ON CONFLICT DO NOTHING`, jadi menulis ulang tidak menggandakan apa pun. (3) `MarketIndexer` menerima `store`: saat sinkron pertama ia memuat seluruh isi store dan cursor, lalu hanya membaca transaksi sesudah cursor. Rekaman ditulis ke store sebelum masuk ke `/market/activity` dan sebelum `onSale`, jadi bila penulisan gagal, transaksi itu dibaca ulang pada sinkron berikutnya dan tidak ada yang tampil tanpa tersimpan. Dengan store tidak ada batas jumlah; `onSale` hanya terpanggil untuk penjualan yang belum pernah dibaca, termasuk oleh proses sebelumnya. (4) Mission server memakai `DATABASE_URL`. Bila tidak diisi atau Postgres tidak menjawab saat mulai, server tetap jalan dengan memori seperti sebelumnya (500 terbaru) dan menuliskan alasannya ke log; misi dan market tidak bergantung padanya. (5) Format `/market/activity` tidak berubah, jadi web tidak perlu diubah.
- Alasan: Riwayat sudah ada di chain, tetapi membacanya ulang setiap kali mulai lambat dan dibatasi 500. Postgres sudah dipakai chat server dan worker dan dijalankan oleh `pnpm dev:all`, jadi tidak ada layanan baru. Menulis rekaman dan cursor dalam satu transaksi database membuat server bisa berhenti kapan saja tanpa kehilangan atau menggandakan rekaman.
- Dampak: `packages/chat-store/{src/schema.ts,test/postgres.test.ts,package.json}`, `apps/mission-server/src/{market,market-store,config,main,index}.ts`, `apps/mission-server/test/market.test.ts`, `.env.example`, `docs/{MARKET,AGENTS}.md`.
- Bukti: Tes mission server 80 lulus, termasuk dengan Postgres 16 sungguhan (`BAS_TEST_DATABASE_URL`): tiga tawaran dan satu penjualan dengan lamport 18446744073709551615 kembali persis, terbaru dulu; menulis transaksi yang sama dua kali tidak menggandakan; program lain mendapat riwayat kosong. Dengan store di memori: proses kedua hanya mengambil satu transaksi baru dan tidak melaporkan ulang penjualan proses pertama; penulisan yang gagal tidak menampilkan apa pun lalu berhasil pada sinkron berikutnya; tanpa store batasnya tetap 500. Postgres yang tidak terjangkau tidak menghentikan server dan kata sandinya tidak muncul di log. Tes `@bas/chat-store` 13 lulus dengan Postgres.
- Di mesin pemilik (2026-10-16): mula-mula seluruh riwayat dibaca sekali (worker melewati tiga baris riwayat publik yang sudah ada); setelah `pnpm dev:all` dinyalakan ulang tidak ada yang dibaca ulang, dan tab FINISHED tetap memuat keempat penjualan, termasuk lelang Baker Mabel yang baru selesai.
- Batas yang diketahui: `/market/activity` masih mengirim seluruh riwayat pada setiap polling. Untuk 100 citizen ini kecil; pasar yang ramai nanti perlu paging.
- Komponen terkait: `apps/mission-server`, `packages/chat-store`, `docs/MARKET.md`
- Menggantikan: batas 500 penjualan dan tawaran yang dicatat di D-0091

## D-0094 — Mainnet tidak boleh memakai nilai tes devnet

- Tanggal: 2026-10-16
- Status: Approved (pemilik menegaskan bahwa semua yang dipakai sekarang hanya untuk tes, dan mainnet nanti memakai semuanya baru: alamat program, wallet, dan lainnya; lalu meminta pengecekannya dibuat sekarang)
- Pemilik keputusan: Owner
- Konteks: Commit `d6b9b9d` ikut mendorong `_to_delete/bas-src.tgz` ke GitHub, dan di dalamnya ada `programs/district/keypair.json`, keypair alamat program district devnet (`82zc…m1Ym`). Program itu sudah ter-deploy di devnet, jadi devnet tidak terpengaruh, tetapi `config/mainnet.json` memakai alamat yang sama. Gerbang peluncuran (`validateProductionReadiness`) hanya menolak alamat placeholder dan satu alamat devnet yang ditulis tangan, dan belum dipanggil dari mana pun selain tes.
- Keputusan: (1) `findDevnetReuse` menolak, di cluster selain devnet, setiap alamat (semua field alamat, termasuk `marketProgramId`) yang ada di `config/devnet.json` dalam field mana pun, karena satu wallet devnet mengisi beberapa peran. Endpoint RPC dan host metadata devnet juga ditolak. (2) `findPlaceholderConfiguration` dan `validateProductionReadiness` dari `@bas/config` membandingkan dengan manifest devnet secara bawaan; satu field hanya dilaporkan sekali. (3) Mission server dan chat server menolak mulai, dan `next.config.mjs` menolak build atau dev web, bila jaringannya bukan devnet dan gerbangnya belum lulus. (4) `pnpm mainnet:check` mencetak daftar yang masih kurang dan keluar dengan kode 1 selama daftar itu tidak kosong.
- Alasan: Pengecekan berdasarkan isi manifest devnet ikut berubah sendiri setiap kali devnet diganti, jadi tidak ada daftar tulis tangan yang bisa ketinggalan. Memasang gerbang di tempat yang benar-benar menjalankan mainnet membuat nilai tes tidak bisa ikut terbawa tanpa sengaja.
- Dampak: `packages/config/src/{readiness,index}.ts`, `packages/config/test/config.test.ts`, `apps/mission-server/src/config.ts`, `apps/chat-server/src/config.ts`, `apps/chat-server/test/config.test.ts`, `apps/web/next.config.mjs`, `scripts/check-mainnet.mjs`, `package.json`, `README.md`, `docs/ARCHITECTURE.md`.
- Bukti: Tes `@bas/config` 21 lulus: mainnet dengan semua alamat baru lulus; wallet deployer devnet sebagai `missionAuthority`, `marketProgramId` devnet, RPC devnet dan host metadata devnet masing-masing ditolak dengan alasannya; alamat program district hanya dilaporkan sekali; devnet tidak dibandingkan dengan dirinya sendiri. Chat server menolak mainnet dengan manifest saat ini. `NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta next build` berhenti dengan daftar masalah, sedangkan web devnet tetap jalan. `pnpm mainnet:check` menampilkan 10 hal yang belum siap. Semua `pnpm test` lulus.
- Batas yang diketahui: `declare_id!` program district dan `Anchor.toml` masih memakai alamat devnet. Saat mainnet disiapkan, program district perlu keypair baru, dan tes yang memastikan alamat itu sama di semua tempat perlu disesuaikan untuk dua cluster.
- Komponen terkait: `packages/config`, `apps/mission-server`, `apps/chat-server`, `apps/web`
- Menggantikan: —

## D-0095 — Alamat market harus ada di jaringan agar Solflare mau menandatangani lelang

- Tanggal: 2026-10-16
- Status: Approved (pemilik mencoba saran ini di devnet dan lelang langsung berhasil)
- Pemilik keputusan: Owner
- Konteks: Setelah upgrade D-0092, memulai lelang dari web selalu ditolak Solflare dengan "Network mismatch: your current network is set to devnet, but this transaction is for mainnet", walaupun web mengirim `chain: solana:devnet` lewat Wallet Standard. Listing harga tetap dari wallet yang sama tetap lolos. Simulasi `create_auction` yang sama di devnet berhasil (33.683 compute unit). Satu-satunya hal yang khas di transaksi lelang: citizen dikirim dari wallet penandatangan ke PDA `market-authority` (`86Czje…AYhR`), dan PDA itu belum pernah menerima lamport, jadi belum ada sebagai akun di devnet. Setelah pemilik mengirim 0,001 SOL ke alamat itu, lelang Baker Mabel (mulai 0,03 SOL, 4 menit) langsung bisa ditandatangani dan dibuka.
- Keputusan: `scripts/devnet/market-setup.mjs` mendapat satu langkah: bila PDA `market-authority` memegang kurang dari minimum sewa untuk akun kosong, deployer mengirim selisihnya (sekitar 0,00089 SOL) dengan transfer sistem biasa. Langkah ini dilewati bila saldonya sudah cukup. Program tidak berubah; ia tidak pernah menulis ke akun itu, hanya menandatangani atas namanya. Setup mainnet nanti harus melakukan hal yang sama.
- Alasan: Solflare tampaknya menilai jaringan dari keadaan akun yang disentuh transaksi, bukan dari `chain` yang dikirim aplikasi, dan menganggap alamat tujuan yang tidak dikenal sebagai tanda jaringan lain. Cara Solflare mendeteksi jaringan tidak didokumentasikan, jadi ini disimpulkan dari percobaan: alamat tanpa akun ditolak, alamat yang sudah ada diterima. Mengisi alamat itu sekali murah dan tidak mengubah apa pun di program atau web.
- Dampak: `scripts/devnet/market-setup.mjs`, `docs/MARKET.md`.
- Bukti: Pemilik mengirim 0,001 SOL ke `86CzjeSfC3P7Wa8Dk3D1rKG11f9PLTWB1ThQtpBxAYhR` di devnet (saldo terbaca 1.000.000 lamport), lalu lelang yang sebelumnya dua kali ditolak Solflare langsung terbuka. Data instruksi transfer di skrip sama byte demi byte dengan `SystemProgram.transfer` dari `@solana/web3.js`.
- Batas yang diketahui: Wallet lain (Phantom, Backpack) belum dicoba dengan alamat kosong; dengan alamat yang sudah terisi, perilaku mereka tidak relevan lagi.
- Komponen terkait: `scripts/devnet/market-setup.mjs`, `docs/MARKET.md`
- Menggantikan: —
