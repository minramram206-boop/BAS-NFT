# Integration tests lintas paket

Direktori ini dipertahankan sesuai `docs/id/TECH_STACK_ID.md` §11 untuk
integration test level aplikasi lintas service dan paket.

Test instruksi Anchor yang benar-benar menjalankan program berada di
`programs/district/tests/integration.rs` dan dijalankan dengan
`cargo test --manifest-path programs/district/Cargo.toml --test integration`.
Itu satu-satunya sumber test instruksi program; jangan menduplikasi test yang
sama di sini. Bila adapter metaplex, API, atau service lain ditambahkan,
letakkan tes integrasinya di direktori root ini.
