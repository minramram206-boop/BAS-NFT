# Deploy BAS District ke Devnet

Panduan ini dijalankan sekali oleh pemilik proyek dari laptop sendiri. Program sudah di-build (`target/deploy/district.so`) dan sudah diuji lengkap di validator lokal pada 9 Oktober 2026, jadi tidak perlu memasang Rust atau Anchor.

Langkah 1 sampai 4 dijalankan di **WSL (Ubuntu)**, langkah 5 di **PowerShell Windows** biasa.

## Yang dibutuhkan

- WSL Ubuntu (sudah ada).
- Sekitar **5 SOL devnet**: 3,27 SOL untuk rent program, sisanya untuk biaya transaksi. SOL devnet gratis dan tidak punya nilai.
- Node.js dan pnpm di Windows (sudah dipakai untuk `pnpm dev`).

## 1. Pasang Solana CLI 1.18.26 di WSL

Buka Ubuntu (WSL), lalu jalankan:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)"
```

Tutup lalu buka lagi terminal Ubuntu, kemudian cek:

```bash
solana --version
# solana-cli 1.18.26
```

Kalau perintah `solana` belum dikenal, tambahkan baris ini ke `~/.bashrc`, lalu buka terminal baru:

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

## 2. Masuk ke folder proyek

Folder Windows bisa dibuka dari WSL lewat `/mnt/c/...`:

```bash
cd /mnt/c/Users/shole/OneDrive/Desktop/BAS-NFT
```

## 3. Buat wallet deployer devnet dan isi SOL devnet

Pakai wallet baru khusus devnet, jangan wallet utama Anda:

```bash
mkdir -p .keys
solana-keygen new -o .keys/devnet-deployer.json
solana-keygen pubkey .keys/devnet-deployer.json
```

- Saat `solana-keygen new`, Anda boleh mengosongkan passphrase (tekan Enter).
- **Catat seed phrase** yang muncul.
- Folder `.keys/` tidak ikut ke git.

Isi SOL devnet ke alamat yang dicetak perintah terakhir:

- Buka https://faucet.solana.com, pilih **Devnet**, tempel alamatnya, lalu minta 5 SOL. Faucet ini membatasi jumlah per hari. Kalau sudah kena batas, coba lagi besok.
- Atau dari terminal: `solana airdrop 2 $(solana-keygen pubkey .keys/devnet-deployer.json) --url devnet`. Cara ini sering kena batas.

Cek saldo:

```bash
solana balance $(solana-keygen pubkey .keys/devnet-deployer.json) --url devnet
```

## 4. Deploy program

```bash
bash scripts/devnet/deploy.sh
```

Script ini mengecek dulu bahwa keypair program (`programs/district/keypair.json`) cocok dengan program id di kode, lalu men-deploy `target/deploy/district.so`. Wallet deployer otomatis menjadi upgrade authority.

Hasil yang benar berakhir dengan:

```
Program Id: 82zccW1Z97ic24aCrt2c3U6qDUZMfbHufZMCjv2dm1Ym
Owner: BPFLoaderUpgradeab1e11111111111111111111111
Authority: <alamat deployer Anda>
```

Kalau deploy terputus di tengah jalan karena jaringan, jalankan ulang perintah yang sama.

## 5. Setup on-chain (PowerShell Windows)

Buka PowerShell di folder proyek:

```powershell
cd C:\Users\shole\OneDrive\Desktop\BAS-NFT
pnpm devnet:setup
```

Script ini mengerjakan semua langkah berikut sekaligus, dan menulis alamat-alamat barunya ke `config/devnet.json`:

1. Membuat kunci **mission authority** (disimpan di `.keys/devnet-mission-authority.json`). Treasury SOL devnet memakai wallet deployer.
2. Membuat **token tiruan** devnet: Token-2022 dengan 6 desimal, dan mengirim 1.000.000 token ke wallet deployer untuk mencoba training.
3. Membuat **koleksi Metaplex Core** "BAS District Devnet".
4. Menjalankan `initialize_config`, mengikat dan mengunci mint token, lalu membuka pause, sehingga district siap dipakai.

Kalau ada langkah yang gagal, perbaiki penyebabnya lalu jalankan `pnpm devnet:setup` lagi. Langkah yang sudah selesai akan dilewati.

## Setelah selesai

- Kirim isi `config/devnet.json` ke Claude, atau cukup bilang "setup devnet selesai". File ini hanya berisi alamat publik, tidak ada kunci rahasia.
- Jangan kirim isi folder `.keys/` ke siapa pun.
- Yang masih placeholder sampai langkah mint NFT: `candyMachine`, `candyGuard` dan `royaltyRecipient`.
- Metadata NFT devnet akan disajikan dari `https://bas-district-devnet.vercel.app/templates/7/`. Prefix ini dikunci di program saat `initialize_config`, jadi web app devnet nanti harus di-deploy dengan nama proyek Vercel itu. Kalau nama itu ternyata tidak bisa dipakai, program devnet cukup di-deploy ulang dengan program id baru, karena di devnet biayanya hanya SOL gratis.
