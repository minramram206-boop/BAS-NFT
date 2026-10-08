# Browser end-to-end tests

Direktori ini dipertahankan sesuai `docs/id/TECH_STACK_ID.md` §11 untuk alur
browser-level, termasuk smoke test Playwright menjelang rilis.

Saat ini belum ada runner Playwright maupun test browser otomatis. Jangan
menyebutnya sudah tercakup oleh `pnpm test`: CI menjalankan pemeriksaan
TypeScript, konfigurasi/konten, copy publik, lisensi font, aset, dan build
produksi; smoke test browser masih menjadi pekerjaan sebelum rilis publik.
