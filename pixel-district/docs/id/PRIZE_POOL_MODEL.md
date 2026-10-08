# Pixel District — Model Prize Pool dan Kompetisi

_Status: PROPOSED. Dokumen internal berbahasa Indonesia. Public rules, UI, code, database, event names, dan contract identifiers wajib berbahasa Inggris._

## 0. Koreksi istilah Pump.fun

Biaya perdagangan Pump.fun bukan `1.2% buy tax + 1.2% sell tax` yang seluruhnya diterima proyek.

Berdasarkan dokumentasi resmi Pump.fun yang diperiksa pada Oktober 2026:

- Pada bonding curve, total platform fee saat ini 1.25% dari trade.
- Creator fee yang diterima creator saat ini 0.30% dari trade.
- Sisanya adalah protocol fee.
- Setelah token berpindah ke canonical PumpSwap pool, creator fee berubah menurut market-cap tier dan saat ini dapat berkisar dari 0.95% sampai 0.05%.
- Jadwal fee dapat berubah karena ditentukan platform Pump.fun, bukan kontrak Pixel District.

Karena itu, seluruh dokumen publik harus memakai istilah **creator fees actually received**, bukan “1.2% project tax”.

Sumber resmi:

- https://pump.fun/docs/fees
- https://pump.fun/docs/create-coin

## 1. Tujuan prize pool

Prize pool bertujuan memberi sasaran kompetitif setelah citizen berkembang, bukan memberikan passive income kepada holder.

Prinsip:

1. Tidak ada hadiah hanya karena memegang NFT.
2. Tidak ada persentase pendapatan yang dijanjikan kepada holder.
3. Hadiah hanya untuk partisipasi aktif dalam kompetisi berbasis kemampuan dengan aturan yang diterbitkan.
4. Prize pool hanya berasal dari dana yang benar-benar sudah diterima dan dialokasikan.
5. Tidak ada jaminan ukuran prize pool di masa depan.
6. Rarity tidak otomatis melipatgandakan hadiah uang.
7. Level membuka bracket dengan tantangan lebih sulit; level tidak otomatis memenangkan hadiah.

## 2. Model yang dilarang

Jangan memakai model berikut:

```text
Hold NFT → automatically receive creator fees
Rare NFT → automatically receives a larger fee share
Higher level → guaranteed periodic payout
Buy more tokens → guaranteed higher monetary return
Random NFT holder → wins trading-fee lottery
```

Model tersebut mengubah produk menjadi passive reward, mendorong pay-to-win, menarik bot dan farming, serta mengurangi fokus pada gameplay.

## 3. Model yang direkomendasikan

```text
Own a citizen
→ complete authored activities
→ earn non-tradable Training Credits
→ burn official tokens to increase a stat
→ unlock a competition bracket
→ actively compete in a skill-based seasonal event
→ receive a prize only if the published scoring rules are met
```

Permanent citizen progression menentukan bracket yang dapat dimasuki. Seasonal performance menentukan pemenang.

## 4. Sumber dana

Creator fees dari Pump.fun/PumpSwap masuk ke project fee recipient sesuai mekanisme platform. Setelah fee benar-benar dapat diklaim, project treasury melakukan alokasi tercatat.

Pembagian awal yang direkomendasikan:

| Allocation | Share of net creator fees actually received | Purpose |
| --- | ---: | --- |
| Seasonal prize pool | 50% | Fund published competitions |
| Product and AI operations | 30% | RPC, database, LLM, storage, monitoring |
| Security and reserve | 20% | Audit, incident reserve, monitoring, and operational support |

`Net creator fees actually received` berarti creator fees yang sudah masuk/claimable setelah biaya network dan biaya claim yang nyata. Nilai ini bukan proyeksi trading volume.

Persentase ini harus disimpan dalam treasury policy, bukan di citizen upgrade contract. Perubahan persentase membutuhkan:

- Multisig approval.
- Public announcement.
- Minimum seven-day notice.
- Updated public treasury page.

## 5. Prize vault

Gunakan wallet/PDA atau multisig account khusus:

```text
PrizePoolVault
```

Prize vault dipisahkan dari:

```text
OperationsTreasury
SecurityReserve
RoyaltyTreasury
```

Dashboard publik menampilkan:

- Total creator fees actually received.
- Total allocated to prize pool.
- Current funded season pool.
- Previous payouts and transaction signatures.
- Unallocated balance.

Prize pool dianggap tersedia hanya setelah dana masuk ke `PrizePoolVault`.

## 6. Competition brackets

Proposed permanent brackets:

| Bracket | Citizen requirement | Purpose |
| --- | --- | --- |
| Rookie | Highest stat 1–3 | New citizen onboarding |
| Skilled | Highest stat 4–6 | Intermediate challenges |
| Elite | Highest stat 7–9 | Advanced role challenges |
| Master | At least one stat 10 plus required achievement | Highest-difficulty events |

Bracket requirement harus mempertimbangkan stat dan achievement, bukan token spending saja.

Contoh syarat Master:

```text
At least one stat at 10
+ three verified seasonal achievements
+ one role mastery title
```

## 7. Pembagian funded seasonal pool

Setelah funded season pool diumumkan, pembagian awal yang direkomendasikan:

| Pool | Share |
| --- | ---: |
| Open competition | 30% |
| Rookie bracket | 10% |
| Skilled bracket | 15% |
| Elite bracket | 20% |
| Master bracket | 25% |

Total: 100%.

Pool Master lebih besar karena tantangan dan syaratnya lebih berat, bukan karena holder otomatis berhak menerima pendapatan.

Pembagian dapat dievaluasi per season berdasarkan jumlah peserta, tetapi tidak boleh diubah setelah sebuah season dimulai.

### 7.1 Jumlah pemenang

Default yang direkomendasikan adalah maksimal **35 cash-prize winners per season**:

| Competition pool | Maximum cash winners |
| --- | ---: |
| Open | 10 |
| Rookie | 10 |
| Skilled | 7 |
| Elite | 5 |
| Master | 3 |
| **Maximum total** | **35** |

Jumlah aktual tidak selalu mencapai maksimum. Formula per bracket:

```text
actual_winners = min(
  bracket_winner_cap,
  floor(valid_entries × 20%),
  floor(bracket_pool ÷ configured_minimum_prize)
)
```

Aturan tambahan:

- `valid_entries` dihitung setelah duplicate, fraud, dan disqualification checks.
- Jika hasil formula nol atau valid entries kurang dari lima, bracket tidak membayar pada season tersebut dan alokasinya rollover ke season berikutnya.
- Satu wallet memilih maksimal satu citizen untuk satu competition.
- Jumlah funded pool, formula, bracket cap, dan minimum prize diumumkan sebelum competition dimulai.
- Pemenang prize uang dibedakan dari achievement recipients. Lebih banyak peserta dapat memperoleh non-cash title atau cosmetic tanpa menjadi cash winner.

Default payout di dalam setiap bracket:

| Actual winners | Payout split of that bracket pool |
| ---: | --- |
| 1 | 100% |
| 2 | 65% / 35% |
| 3 | 50% / 30% / 20% |
| 4 or more | 40% / 25% / 15% / remaining 20% shared equally among the rest |

## 8. Rarity policy

Rarity boleh memberikan:

- Visual distinction.
- Unique animation.
- Role-specific narrative route.
- Cosmetic prestige.
- Special public profile treatment.

Rarity tidak boleh secara otomatis memberikan:

- Prize multiplier.
- Guaranteed payout.
- Creator fee share.
- Higher odds dalam random draw berbayar.

Alasan: rarity ditentukan pada mint dan bukan hasil kemampuan pengguna. Menghubungkan rarity langsung ke hadiah uang akan membuat sistem semakin pay-to-win dan merusak fairness kompetisi.

## 9. Competition scoring

Competition score harus berasal dari aksi yang dapat diverifikasi, misalnya:

- Deterministic puzzle result.
- Mission completion time dengan anti-cheat.
- Correct lore investigation answer.
- Role-specific resource efficiency.
- Community-reviewed creative submission dengan rubric.
- Combination of verified objectives.

Jangan menggunakan LLM sebagai satu-satunya juri. LLM boleh membantu moderation atau classification, tetapi payout harus berdasarkan aturan deterministik atau review dengan rubric dan audit trail.

## 10. Seasonal state

Pisahkan permanent progression dan seasonal competition state.

Permanent state mengikuti NFT:

```text
scores
public achievements
role mastery
permanent cosmetics
public history
```

Seasonal state di-reset setiap season:

```text
season points
competition attempts
leaderboard score
season rank
```

Pemisahan ini mencegah citizen lama memenangkan semua kompetisi selamanya.

## 11. Eligibility

Syarat umum yang direkomendasikan:

- Current citizen owner at entry and payout snapshot.
- Wallet authentication.
- Official collection verification.
- Citizen registered in canonical state.
- No active ban or unresolved fraud flag.
- One selected citizen per wallet per competition, subject to anti-Sybil review.
- Must satisfy the published competition eligibility rules.

Jika kepemilikan NFT berpindah selama event, rules harus menentukan apakah entry dibatalkan, tetap pada wallet awal, atau berpindah bersama NFT. Default yang direkomendasikan: ownership snapshot saat entry dan saat payout harus cocok.

## 12. Anti-abuse

Wajib tersedia sebelum prize bernilai nyata:

- Rate limits.
- Replay protection.
- Signed mission claims.
- Duplicate wallet and behavior checks.
- Server-authoritative scoring.
- Manual review for top winners.
- Public disqualification rules.
- Appeal window.
- Audit log.
- Maximum entries per wallet.

Jangan memberi token untuk setiap pesan chat karena mudah difarming.

## 13. Payout

Prize dibayar dari funded pool dalam SOL atau USDC yang benar-benar tersedia. Jangan mint official token baru untuk hadiah.

Payout transaction harus:

- Disetujui multisig atau prize distribution program.
- Merujuk season dan competition ID.
- Dipublikasikan di dashboard.
- Memiliki winner list dan scoring evidence yang aman untuk dipublikasikan.

Contoh event:

```text
SeasonFunded
CompetitionOpened
EntrySubmitted
EntryDisqualified
WinnersFinalized
PrizeClaimed
SeasonClosed
```

## 14. Public English disclosure

Contoh teks publik:

> Seasonal prize pools are funded only from creator fees actually received and allocated by the project treasury. Prize amounts are not guaranteed and may vary. Holding a Citizen NFT does not automatically earn rewards. Prizes require active participation in published skill-based competitions and are subject to eligibility and anti-fraud review.

Hindari teks:

```text
Hold our NFT and earn trading fees.
Rare NFTs generate passive income.
Higher-level citizens guarantee bigger returns.
Buy the token now to qualify for future profits.
```

## 15. Launch gate

Real-money prize pools tidak boleh diluncurkan sebelum:

1. Public Competition Rules tersedia dalam bahasa Inggris.
2. Eligibility dan scoring rules dipublikasikan sebelum season dimulai.
3. Prize vault dan dashboard diuji.
4. Multisig aktif.
5. Anti-cheat dan manual winner review aktif.
6. At least one full zero-value test season selesai di devnet.
7. Payout simulation dan dispute flow lulus test.
8. Seluruh funded pool sudah tersedia di PrizePoolVault sebelum diumumkan.

## 16. Hubungan dengan nilai Citizen NFT

Prize pool hanya satu komponen. Citizen NFT yang menarik bagi pembeli membawa kombinasi:

```text
handcrafted art
+ role utility
+ scores
+ consumed official tokens
+ non-tradable effort converted into progression
+ scarce achievements
+ permanent unlocks
+ public history
+ access to harder skill-based brackets
```

Tidak ada jaminan bahwa kombinasi tersebut menciptakan harga pasar atau pembeli. Project tidak boleh menjanjikan profit atau floor price.
