# Pixel District

## Spesifikasi produk dan teknis v2.0

_Dokumen internal berbahasa Indonesia. Seluruh produk publik, antarmuka, metadata, konten karakter, kode, komentar, event, error, log, test, nama file kode, dan API menggunakan bahasa Inggris._

---

## 0. Status dokumen

Dokumen ini menggantikan brief v1 sebelumnya setelah disetujui pemilik proyek.

Label keputusan:

- **[FINAL]**: wajib diterapkan.
- **[CONFIG]**: perilaku wajib sama, nilainya dibaca dari konfigurasi.
- **[PROPOSED]**: rekomendasi yang perlu disetujui pemilik sebelum release candidate.
- **[DEFERRED]**: jangan dibangun pada versi terkait.

Jika implementasi menemukan hal yang belum dijelaskan, gunakan pilihan paling sederhana yang tidak menambah fitur. Catat keputusan dalam `docs/DECISIONS.md` menggunakan bahasa Indonesia untuk alasan produk dan bahasa Inggris untuk identifier teknis.

---

## 1. Kebijakan bahasa

### 1.1 Dokumen internal

**[FINAL]** Dokumen produk yang dibaca pemilik proyek menggunakan bahasa Indonesia:

```text
docs/id/PRODUCT_SPEC.md
docs/id/TOKEN_UTILITY.md
docs/id/SECURITY.md
docs/id/DEPLOYMENT.md
docs/id/PRIVACY_MODEL.md
DECISIONS.md
```

### 1.2 Produk publik

**[FINAL]** Seluruh elemen berikut menggunakan bahasa Inggris:

- Website dan aplikasi.
- Tombol, menu, notifikasi, error, dan onboarding.
- NFT name, description, attributes, dan external URL.
- Nama peran publik dan dialog karakter.
- Privacy Policy, Terms, Token Utility Disclosure, dan Risk Disclosure.
- Public roadmap dan materi komunitas.

Bahasa Inggris adalah satu-satunya bahasa UI pada v1 dan v1.5. Sistem i18n boleh disiapkan, tetapi terjemahan lain ditunda.

### 1.3 Kode

**[FINAL]** Seluruh bagian teknis berikut menggunakan bahasa Inggris:

- Source code dan comments.
- Variable, function, struct, enum, account, instruction, event, dan error names.
- Test names dan fixtures.
- Commit messages dan pull requests.
- Database tables dan columns.
- Environment variables.
- JSON keys.
- Log messages.

Contoh yang benar:

```rust
pub enum CitizenStat {
    Intelligence,
    Alignment,
    Compute,
}
```

Bukan:

```rust
pub enum SkorWarga {
    Kecerdasan,
    Keselarasan,
    Komputasi,
}
```

---

## 2. Prinsip produk

### 2.1 Ringkasan

**[FINAL]** Pixel District adalah dunia pixel dengan warga digital yang dapat dimiliki. Setiap Core NFT mewakili satu warga dengan seni, peran, identitas, skor, sejarah publik, dan gaya bicara sendiri.

AI adalah lapisan yang menghidupkan warga, bukan pengganti seni atau dunia.

Positioning publik:

> **Own a citizen, not just a chatbot.**

Deskripsi publik:

> **Pixel District is a living pixel world where every citizen remembers their journey, evolves through training, and speaks according to their role and on-chain progression.**

### 2.2 Pembeda utama

1. Pixel art buatan tangan menjadi inti produk.
2. Semua warga tinggal dalam dunia dan lore yang sama.
3. Skor on-chain mengubah dialog dan perilaku yang terlihat.
4. Public character history mengikuti NFT.
5. Private relationship memory tidak ikut saat NFT dipindahkan.
6. AI tidak memegang wallet dan tidak menjalankan trading.
7. Token memiliki fungsi konsumtif yang jelas, bukan janji keuntungan.

### 2.3 Bukan tujuan produk

Pixel District bukan:

- Agent trading.
- AI launchpad.
- Token launchpad.
- Marketplace agent generik.
- Romantic companion.
- Sistem passive income.
- Produk yield, staking APY, atau revenue sharing.

---

## 3. Core loop

Core loop produk menggantikan flywheel token-first sebelumnya:

```text
Discover a citizen
→ explore their role and art
→ mint or view the citizen
→ talk and discover district lore
→ train a stat using the official token
→ unlock a visible personality/dialogue change
→ build public character history
→ return for new district events
```

Token adalah alat untuk melakukan training dan customization. Token bukan alasan utama keberadaan dunia.

### 3.1 Alasan memiliki Citizen NFT

**[FINAL]** Citizen NFT memberi pemilik hak produk yang tidak dimiliki pengunjung biasa. Manfaat utama bukan passive income atau janji harga, melainkan kontrol, progression, relationship memory, dan partisipasi di dunia.

Pemilik mendapat:

1. **Verifiable ownership** — satu Core NFT membuktikan kepemilikan atas citizen, art, role, scores, dan public history tertentu.
2. **Owner-only free-form conversation** — pemilik dapat memakai LLM chat; non-owner hanya memperoleh authored JSON dialogue.
3. **Exclusive training control** — hanya pemilik yang dapat membakar official token untuk meningkatkan Insight, Bond, atau Craft.
4. **Visible evolution** — perubahan score wajib membuka dialogue, tone, lore, expression, animation, atau world interaction yang terlihat; score tidak boleh hanya menjadi angka.
5. **Private relationship memory** — citizen dapat membangun ringkasan hubungan dengan wallet pemilik tanpa memberikan memori pribadi itu kepada pembeli berikutnya.
6. **Persistent public biography** — verified district events, public titles, dan role progression mengikuti NFT ketika dipindahkan.
7. **Owner decisions** — pemilik dapat mengambil keputusan dalam owner-only district interactions; pengunjung hanya dapat melihat hasil publik yang aman.
8. **Customization rights** — setelah fitur tersedia, hanya pemilik dapat melakukan rename, memasang cosmetic frame, emote, idle animation, dan citizen room decoration.
9. **Transferability** — pemilik dapat memindahkan atau menjual citizen beserta scores dan public history, tanpa private relationship memory pemilik lama.

### 3.2 Perbedaan akses

| Capability | Visitor/non-owner | Citizen owner | Token holder without citizen |
| --- | --- | --- | --- |
| View art and public profile | Yes | Yes | Yes |
| Read public lore/history | Yes | Yes | Yes |
| Authored JSON dialogue | Yes | Yes, as fallback | Yes |
| Free-form LLM conversation | No | Yes, within quota | No |
| Private relationship memory | No | Yes | No |
| Train scores | No | Yes, using official token | No |
| Make owner-only world choices | No | Yes | No |
| Rename/customize citizen | No | Yes, when released | No |
| Transfer citizen and public history | No | Yes | No |
| Revenue share or guaranteed return | No | No | No |

Token ownership alone tidak memberikan kontrol atas citizen. NFT adalah identitas dan hak kontrol; token adalah consumable fuel untuk tindakan utility.

### 3.3 Minimum owner utility sebelum mainnet

**[FINAL]** Mainnet NFT mint tidak boleh dibuka hanya dengan utility berupa gambar dan tombol upgrade. Sebelum mainnet public mint, versi produksi minimal harus memiliki:

- Owner-only LLM conversation dengan JSON fallback.
- On-chain score training memakai official token.
- Perubahan dialogue/personality yang terlihat pada tier 3, 6, dan 10.
- Private relationship memory yang terpisah dari public character history.
- Public citizen profile yang menampilkan score dan verified history.
- Minimal satu owner-only district interaction atau event.
- Minimal satu expression, animation, atau dialogue unlock yang terlihat dari training.
- Transfer test yang membuktikan public history ikut NFT dan private memory tidak ikut.

Jika paket minimum ini belum siap, produk tetap berada di devnet dan mainnet mint ditunda.

---

## 4. Paritas devnet dan mainnet

### 4.1 Prinsip utama

**[FINAL]** Devnet dan mainnet menggunakan:

- Satu repository.
- Satu codebase.
- Satu set instruction.
- Satu mekanisme mint.
- Satu mekanisme upgrade.
- Satu struktur account.
- Satu alur UI.
- Satu schema database.
- Satu test suite.
- Satu formula token utility.

Tidak boleh ada business logic seperti:

```typescript
if (cluster === "devnet") {
  // different product behavior
}
```

Cluster hanya boleh mengubah konfigurasi dan alamat.

### 4.2 Perbedaan yang tidak dapat dihindari

Devnet dan mainnet adalah dua cluster terpisah. Karena itu, alamat berikut pasti berbeda:

- Program ID.
- Core Collection address.
- Core Candy Machine address.
- Candy Guard address.
- SOL treasury wallet.
- Official token mint address.
- RPC endpoint.
- Explorer URL.

Perbedaan alamat bukan perbedaan produk.

### 4.3 Configuration manifests

```text
config/devnet.json
config/mainnet.json
```

Keduanya harus memakai schema yang sama:

```json
{
  "cluster": "devnet",
  "districtProgramId": "...",
  "coreCollection": "...",
  "candyMachine": "...",
  "candyGuard": "...",
  "utilityTokenMint": "...",
  "solTreasury": "...",
  "royaltyRecipient": "...",
  "missionAuthority": "...",
  "maxScore": 10,
  "baseTrainingCostAtoms": "100000000",
  "burnBps": 10000,
  "dailyMessageLimit": 20
}
```

Setelah parameter release candidate ditetapkan, nilai perilaku seperti `maxScore`, formula biaya, pembagian burn, dan limit chat harus sama di devnet dan mainnet. Hanya alamat dan endpoint yang berbeda.

### 4.4 Release parity gate

Mainnet hanya boleh memakai commit yang:

1. Sudah diberi Git tag release candidate.
2. Sudah lulus seluruh test di local validator.
3. Sudah lulus seluruh test di devnet.
4. Tidak memiliki perubahan source code setelah audit/review terakhir.
5. Menggunakan build checksum yang dicatat di deployment manifest.

---

## 5. Official token

### 5.1 Satu token resmi

**[FINAL]** Pixel District hanya memiliki satu official utility token. Token mainnet diluncurkan melalui Pump.fun. Tidak boleh dibuat token upgrade kedua.

Mainnet:

```text
utilityTokenMint = official Pump.fun token mint
```

Devnet:

```text
utilityTokenMint = devnet mirror token mint
```

Devnet mirror wajib meniru token mainnet dalam hal:

- Decimals.
- Total supply model.
- Mint authority state.
- Freeze authority state.
- Transfer behavior.

Devnet token tidak memiliki nilai ekonomi dan hanya dibagikan melalui test faucet atau script.

### 5.2 Binding token ke program

**[FINAL]** Mainnet config boleh dimulai dengan `utilityTokenMint = None` dan program dalam keadaan paused.

Setelah token resmi dibuat:

1. Admin menetapkan mint token resmi satu kali.
2. Program memverifikasi mint account dan token program.
3. Admin menjalankan `lock_utility_mint`.
4. Setelah dikunci, mint token tidak dapat diganti.
5. Program baru boleh di-unpause setelah binding selesai.

Ini mencegah proyek mengganti token utility setelah pengguna masuk.

### 5.3 Utility yang aktif ketika platform diluncurkan

#### A. Citizen training

**[FINAL]** Peningkatan satu stat sebanyak satu level membutuhkan dua input:

```text
official token + stat-specific Training Credit
```

Official token adalah consumable economic input. Training Credit adalah bukti aktivitas yang diperoleh citizen dari authored mission atau verified district event. Training Credit:

- Tidak dapat dibeli.
- Tidak dapat dipindahkan ke citizen lain.
- Melekat pada canonical CitizenState.
- Memiliki jenis `Insight`, `Bond`, atau `Craft`.
- Dikonsumsi ketika stat terkait dinaikkan.

Formula token:

```text
training_cost = base_training_cost × (current_score + 1)
```

Dengan konfigurasi awal 100 token:

```text
1 → 2 = 200 tokens + 1 matching Training Credit
9 → 10 = 1,000 tokens + 1 matching Training Credit
```

Semua nilai kontrak memakai token atoms, bukan floating point.

Jika token memiliki 6 decimals:

```text
baseTrainingCostAtoms = 100_000_000
```

Sistem ini mencegah pengguna memaksimalkan citizen hanya dengan membeli token. Citizen tingkat tinggi mewakili token yang telah dikonsumsi sekaligus aktivitas yang benar-benar diselesaikan.

#### B. Token processing

**[FINAL]** Seluruh token yang dibayarkan untuk citizen training dibakar:

- 100% dibakar.
- 0% dikirim ke project atau ecosystem treasury.
- Program tidak memiliki jalur untuk mengambil token training.

Operasional proyek dibiayai dari sumber yang diungkapkan secara terpisah, seperti SOL mint, Core royalties, dan creator fees yang benar-benar diterima sesuai kebijakan platform saat itu. Pembakaran adalah mekanisme konsumsi utility dan tidak boleh dipromosikan sebagai jaminan kenaikan harga.

### 5.4 Utility lanjutan

Utility berikut boleh ditambahkan setelah training terbukti digunakan:

| Utility | Status | Prinsip |
| --- | --- | --- |
| Rename citizen | DEFERRED | Token dibakar; cooldown dan content filter |
| Cosmetic frames | DEFERRED | Tidak menambah kekuatan |
| Emotes and idle animations | DEFERRED | Permanent unlock per citizen |
| Seasonal crafting | DEFERRED | Menghasilkan item kosmetik atau lore item |
| District event entry | DEFERRED | Tidak boleh menghapus akses dasar |
| Additional AI messages | DEFERRED | Tidak boleh melewati hard safety/session cap |
| Governance | DEFERRED | Tidak dijanjikan pada launch |

### 5.5 Utility yang dilarang

Official token tidak digunakan untuk:

- Menjanjikan yield.
- Revenue share kepada holder.
- Passive income.
- Hadiah hanya karena menyimpan token.
- Membayar pengguna agar melakukan chat palsu.
- Agent trading.
- Auto-buy, auto-sell, atau autonomous wallet actions.
- Janji buyback untuk menaikkan harga.
- Klaim bahwa burn pasti menaikkan harga.

### 5.6 Pump.fun launch policy

Sebelum token dibuat, finalkan:

- Official name.
- Ticker.
- Square image.
- English description.
- Website URL.
- X/community URL.
- Creator/fee recipient wallet.

Name, ticker, dan image harus dianggap permanen. Token Pump.fun langsung dapat diperdagangkan melalui bonding curve dan dapat berpindah ke PumpSwap setelah memenuhi ketentuan platform. Platform juga dapat memberikan creator fees sesuai kebijakan Pump.fun yang berlaku; fee tersebut tidak dijanjikan kepada pengguna dan tidak menjadi dasar proyeksi keuntungan.

Setelah token dibuat:

- Publikasikan mint address dari akun resmi.
- Simpan mint address di mainnet config.
- Verifikasi token program dan decimals langsung dari chain.
- Jalankan `lock_utility_mint`.
- Jangan pernah meminta pengguna mengirim token ke wallet manual untuk training.

### 5.7 Urutan peluncuran token dan produk

**[FINAL]** Jangan meluncurkan token jauh sebelum utility siap.

Urutan yang benar:

1. Devnet product dan token mirror selesai.
2. Contract dan UI lulus test.
3. Mainnet program, collection, Candy Machine, dan backend siap tetapi paused.
4. Official token diluncurkan melalui Pump.fun.
5. Mainnet program di-bind ke official token mint dan dikunci.
6. Upgrade utility di-unpause.
7. NFT mint dibuka.
8. Pengguna yang memiliki NFT langsung dapat memakai token untuk training.

Dengan urutan ini, token memiliki utility nyata ketika ekosistem NFT dibuka.

### 5.8 Seasonal competition prize pools

**[PROPOSED]** Sebagian creator fees yang benar-benar sudah diterima dari Pump.fun/PumpSwap dapat dialokasikan ke funded seasonal prize pool.

Prize pool tidak dibagikan otomatis kepada holder. Permanent citizen level hanya membuka competition bracket; seasonal skill/performance menentukan pemenang.

Rarity tidak menjadi automatic monetary multiplier. Rarity boleh membuka art, narrative route, animation, atau cosmetic prestige, tetapi tidak menjamin pembayaran.

Model lengkap, treasury allocation, brackets, anti-cheat, payout, dan public disclosure berada di:

```text
docs/id/PRIZE_POOL_MODEL.md
```

Real-money competitions dilarang sebelum public English Competition Rules, multisig prize vault, anti-cheat, payout testing, dan satu full zero-value test season selesai.

---

## 6. NFT mint architecture

### 6.1 Satu mekanisme untuk dua network

**[FINAL]** Devnet dan mainnet sama-sama menggunakan Metaplex Core Candy Machine. Rencana lama yang memakai custom mint di devnet dan Candy Machine di mainnet dibatalkan.

Candy Guard minimum:

- `solPayment`.
- `mintLimit`.
- `startDate` saat public release.
- `thirdPartySigner` untuk transaksi yang dibangun backend.
- `botTax` saat mainnet public mint setelah diuji.

Allowlist dapat ditambahkan sebagai guard group tanpa mengganti mekanisme mint.

### 6.2 Core Collection

Core Collection memakai:

- Royalties plugin: 500 basis points.
- Creator recipient: configured royalty wallet.
- Program allowlist/denylist ruleset setelah compatibility test.
- Update authority: project multisig pada mainnet.

### 6.3 Citizen registration

Mint dan registration harus menggunakan satu alur transaksi yang dibangun aplikasi:

```text
Core Candy Machine mint
→ District program register_citizen
```

`register_citizen` wajib:

1. Memverifikasi Core Asset baru.
2. Memverifikasi asset termasuk collection resmi.
3. Memverifikasi metadata URI atau template identifier yang disetujui.
4. Membaca citizen template dari registry/constant.
5. Membuat canonical citizen state.
6. Menetapkan initial stats berdasarkan role.
7. Mengeluarkan `CitizenRegistered` event.

Jika registration gagal, seluruh transaction harus gagal agar tidak ada NFT resmi tanpa state.

### 6.4 Canonical citizen state

**[FINAL]** Hanya boleh ada satu sumber kebenaran untuk skor.

Urutan pilihan teknis:

1. Core AppData dengan PDA program sebagai data authority.
2. Jika Phase B membuktikan AppData tidak cocok dengan batasan kontrak, gunakan `CitizenState` PDA dengan seed:

```text
["citizen", asset]
```

Attributes plugin boleh digunakan sebagai display mirror untuk marketplace, tetapi tidak menjadi sumber validasi program.

Canonical data:

```rust
pub struct CitizenState {
    pub version: u8,
    pub bump: u8,
    pub citizen_id: u32,
    pub asset: Pubkey,
    pub role: u8,
    pub intelligence: u8,
    pub alignment: u8,
    pub compute: u8,
    pub insight_training_credits: u16,
    pub bond_training_credits: u16,
    pub craft_training_credits: u16,
}
```

---

## 7. Roles and stats

Internal code names tetap:

- `intelligence`
- `alignment`
- `compute`

Public English labels:

| Internal | Public label | Meaning |
| --- | --- | --- |
| intelligence | Insight | Lore depth and reasoning |
| alignment | Bond | Trust, warmth, and cooperation |
| compute | Craft | Role-specific capability and efficiency |

Public UI tidak menggunakan istilah Indonesia dan tidak menampilkan karakter sebagai server atau robot.

Tiers:

- Tier 1: score 3+
- Tier 2: score 6+
- Tier 3: score 10

Maximum score: 10.

---

## 8. Product phases

### Phase A — UI and content prototype

- English UI.
- One district screen.
- Ten mock citizens.
- Seven role registry.
- JSON dialogue.
- Fake score upgrade for UI testing.

### Phase B — final architecture spike

- Core Collection.
- Core Candy Machine.
- Devnet mirror token.
- Mint + register in intended transaction flow.
- AppData versus CitizenState decision.
- One atomic score upgrade.

Keputusan Phase B dicatat dan tidak diganti ketika menuju mainnet.

### Phase C — v1 devnet release candidate

- Ten citizens.
- Same Candy Machine flow intended for mainnet.
- Token training.
- English JSON dialogue affected by stats.
- Transfer test.
- Royalties compatibility test.

### Phase D — engagement proof

- One district event.
- Three short authored interactions.
- At least one visible outcome based on a stat tier.
- No LLM required.

### Phase E — v1.5 conversational citizens

- Owner-only free-form LLM chat.
- OpenRouter gateway.
- Structured JSON output.
- Public and private memory separation.
- Daily quota and budget kill-switch.
- JSON fallback.

### Phase F — mainnet

Mainnet uses the same release candidate architecture. Mainnet changes configuration addresses and production infrastructure, not product logic.

---

## 9. English user interface copy

Default UI strings:

| Situation | English text |
| --- | --- |
| Opening | Welcome to Pixel District. What would you like to do? |
| Wallet required | Connect your wallet to continue. |
| Mint starting | Registering a new citizen... |
| Mint success | Citizen #{id} is now registered in the district. |
| Mint sold out | The district is full. |
| Mint limit | You have reached the citizen limit for this wallet. |
| Select training | What would you like to train today? |
| Training cost | Cost: {amount} {symbol}. Continue? |
| Training success | Training complete. {stat} is now {value}. |
| Maximum stat | This stat has reached its maximum level. |
| Not owner | Only the current owner can train this citizen. |
| Failed transaction | The transaction failed. Please try again. |
| AI disclosure | This citizen is an AI character, not a real person. |
| JSON fallback | The citizen is using district dialogue mode. |
| Session reminder | You have been chatting for 60 minutes. Consider taking a break. |

English copy must be stored in:

```text
app/messages/en.json
```

Do not hardcode user-facing copy across React components.

---

## 10. LLM architecture

### 10.1 Gateway

Default gateway: OpenRouter.

Environment configuration:

```text
OPENROUTER_API_KEY=
CHAT_MODEL_PRIMARY=
CHAT_MODEL_FALLBACK=
CHAT_MAX_OUTPUT_TOKENS=
CHAT_REQUEST_TIMEOUT_MS=
CHAT_DAILY_BUDGET_USD=
CHAT_ENABLED=
```

Model names are never hardcoded in components or smart contracts.

### 10.2 Authentication

Wallet authentication uses:

1. One-time nonce.
2. Domain-bound sign-in message.
3. Wallet signature verification.
4. Expiration timestamp.
5. Single-use nonce invalidation.
6. Secure, HTTP-only session cookie.

A reusable static signature is forbidden.

### 10.3 Ownership verification

Before every free-form session and at reasonable intervals during a session, the server verifies:

- Asset belongs to official collection.
- Session wallet is the current asset owner.
- Canonical citizen state exists.
- Chat quota is available.
- Daily budget kill-switch is not active.

### 10.4 Structured output

The LLM returns:

```json
{
  "reply": "The district was quieter than usual last night.",
  "emotion": "curious",
  "animation": "look_left",
  "memoryCandidate": null,
  "safety": "ok"
}
```

Server validates output against a strict schema.

Allowlisted animations:

```text
idle
blink
look_left
look_right
happy
worried
thinking
```

Invalid output triggers JSON dialogue fallback.

### 10.5 Agent restrictions

The LLM:

- Has no private key.
- Cannot sign transactions.
- Cannot transfer assets.
- Cannot trade tokens.
- Cannot modify a score.
- Cannot set a training cost.
- Cannot call arbitrary tools.
- Cannot read environment secrets.
- Cannot override server validation.

Tool calling is disabled in v1.5.

---

## 11. Memory and privacy

### 11.1 Public character history

Keyed by asset:

```text
public_character_memory:{asset}
```

May include:

- Verified mission completion.
- District events.
- Public title.
- Role progression.
- Public choices.

It follows the NFT.

### 11.2 Private relationship memory

Keyed by asset and owner:

```text
private_relationship_memory:{asset}:{owner_wallet}
```

May include:

- Preferred nickname.
- Conversation preferences.
- Minimal relationship summary.

It never becomes visible to a new owner.

### 11.3 Transfer behavior

When ownership changes:

- Scores remain with the NFT.
- Public history remains with the NFT.
- Previous private memory becomes inaccessible to the new owner.
- New owner starts with a new private relationship record.
- Previous owner can request deletion.

Raw transcripts are not stored by default.

### 11.4 Chat limits

- 20 free-form messages per citizen per UTC day.
- Primary quota key: asset.
- Abuse controls: asset + wallet + IP.
- Transfer does not reset the asset quota.
- Maximum user message: 300 characters.
- Maximum reply: approximately 400 characters.
- 60-minute session reminder cannot be bypassed with tokens.

---

## 12. Program instructions

```text
initialize_config
set_utility_mint
lock_utility_mint
update_config
set_paused
register_citizen
claim_training_credit
upgrade_score
propose_admin
accept_admin
```

### `initialize_config`

- Callable only by the approved bootstrap/deploy authority.
- Stores admin, SOL treasury, collection, mission authority, economic parameters, and paused state.
- Starts paused on mainnet.

### `set_utility_mint`

- Admin only.
- Only while not locked.
- Verifies mint and token program.

### `lock_utility_mint`

- Admin only.
- Irreversible.

### `register_citizen`

- Verifies official Core Collection.
- Verifies approved metadata/template.
- Initializes canonical score state.
- Cannot run twice for the same asset.

### `claim_training_credit`

- Requires current citizen owner signature.
- Requires authorized mission authority approval/signature.
- Claim is bound to asset, stat type, mission ID, season ID, owner, nonce, and expiry.
- Creates a claim receipt PDA so the same mission claim cannot be replayed.
- Adds one stat-specific Training Credit to canonical CitizenState.
- Does not mint or distribute official tokens.

### `upgrade_score`

Verifies:

- Program is not paused.
- Asset belongs to official collection.
- Signer is current owner.
- Utility token mint exactly matches locked config.
- Stat index is valid.
- Current score is below maximum.
- Matching Training Credit balance is at least one.
- User token balance is sufficient.

Then atomically:

1. Calculates cost with checked arithmetic.
2. Burns the full training cost.
3. Consumes one matching Training Credit.
4. Increments score by one.
5. Updates display mirror if enabled.
6. Emits event.

---

## 13. Events and errors

Events:

```text
ConfigInitialized
UtilityMintSet
UtilityMintLocked
CitizenRegistered
TrainingCreditClaimed
ScoreUpgraded
AdminProposed
AdminAccepted
PauseStateChanged
```

Errors:

```text
Unauthorized
ProgramPaused
AlreadyInitialized
UtilityMintNotSet
UtilityMintLocked
InvalidUtilityMint
InvalidTokenProgram
InvalidCollection
InvalidAssetState
CitizenAlreadyRegistered
NotOwner
InvalidStat
MaxScore
InsufficientTrainingCredits
InvalidMissionClaim
MissionClaimExpired
MissionClaimAlreadyUsed
InsufficientTokenBalance
ArithmeticOverflow
```

User-facing translations remain English and live in `app/messages/en.json`.

---

## 14. Repository structure

```text
programs/district/           Anchor program; English only
app/                         Next.js application; English only
app/messages/en.json         public UI copy
scripts/                     deployment and setup scripts; English only
content/en/roles.json        public role content
content/en/citizens.json     public citizen content
content/en/dialog/*.json     authored dialogue
config/devnet.json           devnet addresses/config
config/mainnet.json          mainnet addresses/config
docs/id/                     Indonesian internal documents
tests/                       English test names and fixtures
DECISIONS.md                 decision log
```

---

## 15. Acceptance tests

### 15.1 Network parity

1. The same test suite passes against devnet and mainnet-config dry run.
2. No business logic branches on cluster name.
3. Devnet mirror token has the intended decimals and authority state.
4. Config schema is identical across networks.

### 15.2 Mint

1. Mint uses Core Candy Machine on devnet.
2. Mint and citizen registration complete in the intended transaction flow.
3. Registration failure prevents an official unregistered citizen from being produced through the application flow.
4. Mint limit is enforced.
5. SOL payment reaches the configured treasury.
6. Asset belongs to the official collection.
7. Royalties plugin reports 500 basis points.

### 15.3 Training

1. Authorized mission claim adds the correct stat-specific Training Credit.
2. Reused mission claim receives `MissionClaimAlreadyUsed`.
3. Expired or incorrectly signed claim is rejected.
4. Upgrade without a matching Training Credit receives `InsufficientTrainingCredits`.
5. Owner with token and matching Training Credit can upgrade one stat by one level.
6. Non-owner receives `NotOwner`.
7. Asset from another collection receives `InvalidCollection`.
8. Wrong token mint receives `InvalidUtilityMint`.
9. Cost calculation uses token atoms and checked arithmetic.
10. The full training cost is burned.
11. Exactly one matching Training Credit is consumed.
12. Credit consumption, score update, and token burn are atomic.
13. Maximum score cannot be exceeded.
14. Transferred NFT can only be trained by the new owner.

### 15.4 Token binding

1. Utility mint can be set before lock.
2. Utility mint cannot be changed after lock.
3. Upgrade is disabled while the program is paused.
4. Upgrade is disabled before utility mint is configured.

### 15.5 Chat

1. Non-owner receives authored JSON dialogue only.
2. Owner receives role-consistent LLM dialogue.
3. LLM output must pass schema validation.
4. Timeout and invalid output trigger JSON fallback.
5. Daily limit is enforced in UTC.
6. Token spending cannot bypass the safety session cap.
7. Prompt injection does not reveal system instructions or enable tools.
8. Public and private memories remain separated after transfer.

---

## 16. Public disclosures

The English website must state clearly:

- The token is used for platform utility.
- Token ownership does not provide revenue share.
- NFT ownership does not provide revenue share.
- Holding an NFT does not automatically earn prize-pool payments.
- Seasonal prizes require active participation under published competition rules and are not guaranteed.
- No price appreciation is promised.
- Training consumes tokens.
- AI responses may be inaccurate.
- Characters are not real people.
- The AI cannot execute trades or wallet actions.
- Digital assets and tokens involve risk.
- Users must confirm every blockchain transaction in their wallet.

Security, treasury, payout, and operational reviews are required before the public mainnet launch.

---

## 17. Final decisions replacing the old document

| Old decision | Replacement |
| --- | --- |
| Indonesian public UI | English public UI |
| Custom mint on devnet, Candy Machine later | Core Candy Machine on both networks |
| Separate devnet upgrade token plan | Devnet mirror of the one official Pump.fun token |
| Token mint authority script as mainnet plan | Mainnet token comes from Pump.fun; program binds its mint once |
| Memory keyed only by asset | Public memory by asset; private memory by asset + owner |
| Generic LLM API | OpenRouter gateway through server-side adapter |
| Free-form text response | Strict JSON response validated by server |
| Token-first flywheel | Character/world-first core loop |
| 80% burn / 20% token treasury | 100% of every training payment is burned |
| Royalty described as always optional | Core Royalties plugin plus marketplace compatibility tests |
| Devnet/mainnet feature differences | Same architecture and instructions; addresses/config differ |

---

## 18. Sources to verify during implementation

- Metaplex Core overview: https://developers.metaplex.com/smart-contracts/core
- Metaplex Core Royalties plugin: https://developers.metaplex.com/smart-contracts/core/plugins/royalties
- Metaplex Core Candy Machine: https://developers.metaplex.com/smart-contracts/core-candy-machine
- Core Candy Machine guards: https://developers.metaplex.com/smart-contracts/core-candy-machine/guards
- Metaplex AppData example: https://developers.metaplex.com/core/guides/onchain-ticketing-with-appdata
- Metaplex loyalty/AppData pattern: https://developers.metaplex.com/core/guides/loyalty-card-concept-guide
- Pump.fun create coin documentation: https://pump.fun/docs/create-coin
- Pump.fun current fees: https://pump.fun/docs/fees
- OpenRouter documentation: https://openrouter.ai/docs

External platform behavior and fees can change. Pin SDK versions for each release candidate and record the verified documentation date in `docs/id/DEPLOYMENT.md`.
