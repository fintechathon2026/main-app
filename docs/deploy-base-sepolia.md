# Deploy PrepaidEscrow ke Base Sepolia, sampai test

Panduan lengkap dari nol: membuat kunci, mengisi ETH testnet, deploy contract, menjalankan spike
(3 hash bukti untuk gate G1), menyambungkan app ke chain, lalu menguji alur prepaid di browser.

Semua perintah dijalankan dari folder `main-app`, kecuali ada tulisan lain. Semua isi `.env.local`
tetap rahasia: **jangan pernah commit `.env.local`, dan jangan kirim private key ke siapa pun
(termasuk ke chat AI).**

---

## 0. Konsep singkat

**Kunci (wallet).** Setiap kunci punya dua bagian:

| Bagian | Contoh bentuk | Sifat | Dipakai untuk |
|---|---|---|---|
| Private key | `0x` + 64 karakter | **rahasia**, seperti password | menandatangani transaksi; hanya di `.env.local` |
| Address | `0x` + 40 karakter | publik, seperti nomor rekening | dikirimi ETH dari faucet; boleh dibagikan |

Address bisa dihitung dari private key. Kebalikannya tidak bisa.

**Enam kunci yang dibutuhkan:**

| Nama | Tugas | Perlu ETH testnet? |
|---|---|---|
| DEPLOYER | memasang contract, mencetak token tCNY | **ya** |
| RELAYER | membayar gas untuk beli, check-in, keluar | **ya, paling banyak** |
| AGENT | Reins sendiri; hanya boleh memanggil `exitWithAttestation` | **ya, sedikit** |
| MERCHANT_SIM | tanda tangan gym (offer dan check-in) | tidak |
| ORACLE | tanda tangan registry (pengumuman resmi) | tidak |
| SPIKE_CONSUMER | konsumen palsu untuk uji spike | tidak |

---

## 1. Siapkan Foundry (sekali saja)

Foundry sudah ter-install di `~/.foundry/bin`. Tambahkan ke PATH supaya bisa memanggil `cast` dan
`forge` langsung:

```bash
echo 'export PATH="$HOME/.foundry/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
cast --version        # harus muncul versi, misalnya "cast Version: 1.8.x"
```

Ambil library contract dan pastikan test lulus:

```bash
git submodule update --init --recursive
cd contracts
forge build
forge test            # harus: 48 tests passed, 0 failed
cd ..
```

---

## 2. Perbaiki `.env.example` (sekali saja, oleh pemilik repo)

Ada satu nilai yang salah di `.env.example` di `main`:

```
MOCKBANK_URL=http://localhost:3000/mockbank     # SALAH
```

Adapter mock bank sudah menambahkan `/mockbank` sendiri, jadi nilai di atas menghasilkan
`/mockbank/mockbank/...` (404, dan setiap pembelian gagal dengan `not_found`). Ubah menjadi:

```
MOCKBANK_URL=http://localhost:3000              # BENAR: base URL app saja, tanpa /mockbank
```

Commit di branch sendiri, misalnya `fix/env-example-mockbank-url`, lalu PR ke `main`. Kalau
`.env.local` kamu disalin dari `.env.example` yang lama, ubah baris yang sama di `.env.local` juga.

---

## 3. Buat 6 kunci

Lewati langkah ini kalau kamu sudah punya 6 private key.

Jalankan 6 kali, satu untuk tiap nama di tabel bagian 0:

```bash
cast wallet new
```

Output tiap kali:

```
Successfully created new keypair.
Address:     0x1234...abcd
Private key: 0xaaaa...ffff
```

Yang disalin ke `.env.local` adalah baris **Private key**.

---

## 4. Tulis kunci ke `.env.local`

Buka `.env.local` di editor dan tambahkan:

```
DEPLOYER_PRIVATE_KEY=0x...
RELAYER_PRIVATE_KEY=0x...
AGENT_PRIVATE_KEY=0x...
MERCHANT_SIM_PRIVATE_KEY=0x...
ORACLE_PRIVATE_KEY=0x...
SPIKE_CONSUMER_PRIVATE_KEY=0x...
TOKEN_MINTER_PRIVATE_KEY=0x...      # isi SAMA dengan DEPLOYER_PRIVATE_KEY
```

Aturan format (kalau dilanggar, perintah `cast` akan gagal dengan
`Error accessing local wallet`):

- Nama variabel harus **persis** seperti di atas.
- Tidak ada spasi di sekitar `=`: `AGENT_PRIVATE_KEY=0xabc...`, bukan `AGENT_PRIVATE_KEY = 0xabc...`.
- Tanpa tanda kutip, dan tanpa komentar `# ...` di baris kunci.
- Nilai diawali `0x` lalu tepat 64 karakter hex. Kalau kuncimu tidak diawali `0x`, tambahkan.
- Yang ditulis adalah **private key**, bukan address. Address hanya 40 karakter setelah `0x`.

Kalau file pernah disimpan dari Windows, hapus karakter akhir baris yang tersembunyi:

```bash
sed -i 's/\r$//' .env.local
```

### 4a. Cek kunci terbaca (tidak menampilkan isi kunci)

Setiap kali membuka terminal baru, `.env.local` harus dimuat dulu:

```bash
set -a; . ./.env.local; set +a
```

Lalu cek:

```bash
for k in DEPLOYER RELAYER AGENT MERCHANT_SIM ORACLE SPIKE_CONSUMER TOKEN_MINTER; do
  v="${k}_PRIVATE_KEY"; x="${!v}"
  if [ -z "$x" ]; then echo "$k: KOSONG (nama variabel salah atau .env.local belum dimuat)";
  elif [[ "$x" =~ ^0x[0-9a-fA-F]{64}$ ]]; then echo "$k: OK";
  else echo "$k: format salah (panjang ${#x}, seharusnya 66)"; fi
done
```

Semua harus `OK` sebelum lanjut.

---

## 5. Hitung address dan simpan dua di antaranya

```bash
set -a; . ./.env.local; set +a
for k in DEPLOYER RELAYER AGENT MERCHANT_SIM ORACLE SPIKE_CONSUMER; do
  v="${k}_PRIVATE_KEY"
  echo "$k = $(cast wallet address --private-key ${!v})"
done
```

Catat hasilnya. Lalu tambahkan dua baris ini ke `.env.local` (isinya **address**, bukan private
key):

```
AGENT_ADDRESS=<address AGENT dari output di atas>
ORACLE_ADDRESS=<address ORACLE dari output di atas>
```

`AGENT_ADDRESS` harus sama persis dengan address dari `AGENT_PRIVATE_KEY`. Kalau berbeda, aksi
prepaid pertama di mode chain sengaja gagal ("AGENT_ADDRESS does not match AGENT_PRIVATE_KEY").

---

## 6. Isi ETH testnet dari faucet

ETH testnet gratis dan tidak bernilai, tetapi tetap dibutuhkan untuk membayar gas.

### 6a. Faucet Coinbase (CDP)

1. Buka `https://portal.cdp.coinbase.com` dan login.
2. Di menu kiri pilih **Faucets**, atau langsung buka `https://portal.cdp.coinbase.com/products/faucet`.
   Kalau diminta membuat **project**, buat saja dengan nama bebas (misalnya `reins`).
3. **Network:** pilih **Base Sepolia** (bukan Ethereum Sepolia).
4. **Token:** pilih **ETH**.
5. **Address:** tempel address **DEPLOYER** dari langkah 5, lalu klik **Claim**.
6. Ulangi untuk **RELAYER** dan **AGENT**.

Jumlah per klaim bisa kecil. Klik **Claim** beberapa kali untuk DEPLOYER kalau perlu.

### 6b. Faucet lain kalau kurang

- Alchemy: `https://www.alchemy.com/faucets/base-sepolia` (kadang mensyaratkan saldo kecil di
  Ethereum mainnet).
- Atau isi DEPLOYER sampai cukup, lalu bagikan dari terminal:

  ```bash
  set -a; . ./.env.local; set +a
  RELAYER=$(cast wallet address --private-key $RELAYER_PRIVATE_KEY)
  AGENT=$(cast wallet address --private-key $AGENT_PRIVATE_KEY)
  cast send $RELAYER --value 0.0005ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url https://sepolia.base.org
  cast send $AGENT   --value 0.0002ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url https://sepolia.base.org
  ```

### 6c. Cek saldo

```bash
set -a; . ./.env.local; set +a
for k in DEPLOYER RELAYER AGENT; do
  v="${k}_PRIVATE_KEY"; a=$(cast wallet address --private-key ${!v})
  echo "$k $a: $(cast balance $a --rpc-url https://sepolia.base.org --ether) ETH"
done
```

Ketiganya harus di atas `0`. Base Sepolia sangat murah. Kalau langkah 8 nanti gagal dengan
`insufficient funds`, tambah saldo lalu ulangi langkah itu.

---

## 7. Buat RPC URL sendiri

RPC adalah pintu ke blockchain. RPC publik `https://sepolia.base.org` cepat kena batas, jadi pakai
yang pribadi untuk server dan forge:

1. Daftar di `https://dashboard.alchemy.com`, lalu **Create new app**: chain **Base**, network
   **Base Sepolia**.
2. Salin URL HTTPS-nya (bentuk `https://base-sepolia.g.alchemy.com/v2/xxxx`).
3. Tambahkan ke `.env.local`:

   ```
   BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/xxxx
   ```

URL ini mengandung key Alchemy. Jangan taruh di variabel yang diawali `NEXT_PUBLIC_` (variabel itu
terkirim ke browser).

---

## 8. Deploy contract

```bash
set -a; . ./.env.local; set +a
cd contracts
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
cd ..
```

Kalau berhasil, akhir output berisi:

```
TOKEN_ADDRESS=0x...
ESCROW_ADDRESS=0x...
CHAIN_START_BLOCK=12345678
written: .../contracts/deployments/84532.json
```

Salin tiga baris pertama itu ke `.env.local`.

| Error | Artinya | Perbaikan |
|---|---|---|
| `insufficient funds` | DEPLOYER tidak punya ETH | ulangi langkah 6 |
| `environment variable "..." not found` | `.env.local` belum dimuat | `set -a; . ./.env.local; set +a` |
| `Error accessing local wallet` | kunci kosong atau format salah | ulangi langkah 4a |

---

## 9. Spike: tiga transaksi bukti (gate G1)

Spike menjalankan purchase (3 sesi × ¥100), check-in sesi 1, lalu exit dengan pengumuman resmi,
masing-masing dari kunci yang memang dipakai di produksi.

```bash
set -a; . ./.env.local; set +a
cd contracts
forge script script/Spike.s.sol --rpc-url base_sepolia --broadcast
cd ..
```

Baris yang dicari di output:

```
plan 1: purchased, session 1 redeemed, exited with attestation
```

Error `ORACLE_PRIVATE_KEY is not the escrow's oracle` berarti `ORACLE_ADDRESS` saat deploy
(langkah 8) tidak cocok dengan `ORACLE_PRIVATE_KEY`. Cek langkah 5, perbaiki, lalu deploy ulang.

### 9a. Ambil hash transaksinya

```bash
grep -o '"hash": "0x[0-9a-f]*"' contracts/broadcast/Spike.s.sol/84532/run-latest.json
```

Hash pertama bisa berupa `mint` (mengisi token ke konsumen). **Tiga hash terakhir** adalah
purchase, redeem, dan exit. Buka masing-masing di:

```
https://sepolia.basescan.org/tx/<hash>
```

Statusnya harus **Success**.

### 9b. Catat bukti

Buat `docs/evidence/spike.md`:

```markdown
# Base Sepolia spike (gate G1)

Escrow: https://sepolia.basescan.org/address/<ESCROW_ADDRESS>
Token (tCNY, test token, no value): https://sepolia.basescan.org/address/<TOKEN_ADDRESS>

| Step | Sent by | Transaction |
|---|---|---|
| Purchase (3 × ¥100) | relayer | https://sepolia.basescan.org/tx/<hash 1> |
| Redeem session 1 | relayer | https://sepolia.basescan.org/tx/<hash 2> |
| Attested exit | agent | https://sepolia.basescan.org/tx/<hash 3> |
```

---

## 10. Sambungkan app ke chain

Tambahkan atau ubah baris ini di `.env.local`:

```
REINS_ESCROW=chain
CHAIN_ID=84532
NEXT_PUBLIC_RPC_URL=https://sepolia.base.org      # RPC publik untuk browser (tanpa key)
SIM_BASE_URL=http://localhost:3000
SIM_API_KEY=<string acak bebas, minimal 16 karakter>
CRON_SECRET=<string acak bebas, minimal 16 karakter>
REINS_ADMIN_USER_IDS=11111111-1111-4111-8111-111111111111
MOCKBANK_URL=http://localhost:3000                # tanpa /mockbank (lihat langkah 2)
```

Baris dari langkah sebelumnya tetap ada: `ESCROW_ADDRESS`, `TOKEN_ADDRESS`, `CHAIN_START_BLOCK`,
`AGENT_ADDRESS`, `ORACLE_ADDRESS`, `BASE_SEPOLIA_RPC_URL`, dan semua `*_PRIVATE_KEY`.

String acak bisa dibuat dengan:

```bash
openssl rand -hex 24
```

### 10a. Ringkasan `.env.local` mode chain

```
# Database dan login (dari: pnpm exec supabase status)
DATABASE_URL=postgres://reins_server:reins-server-local@127.0.0.1:54322/postgres
DATABASE_URL_DIRECT=postgres://postgres:postgres@127.0.0.1:54322/postgres
MOCKBANK_DATABASE_URL=postgres://reins_mockbank:reins-mockbank-local@127.0.0.1:54322/postgres
TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY dari supabase status; JANGAN secret key>

# Mock bank, cron, admin
MOCKBANK_URL=http://localhost:3000
MOCKBANK_API_KEY=<string acak>
CRON_SECRET=<string acak>
REINS_ADMIN_USER_IDS=11111111-1111-4111-8111-111111111111

# Model AI
REINS_MODELS=recorded            # live + ANTHROPIC_API_KEY untuk teks baru

# Chain
REINS_ESCROW=chain
CHAIN_ID=84532
BASE_SEPOLIA_RPC_URL=<URL Alchemy>
NEXT_PUBLIC_RPC_URL=https://sepolia.base.org
ESCROW_ADDRESS=<langkah 8>
TOKEN_ADDRESS=<langkah 8>
CHAIN_START_BLOCK=<langkah 8>
AGENT_ADDRESS=<langkah 5>
ORACLE_ADDRESS=<langkah 5>

# Kunci (rahasia)
RELAYER_PRIVATE_KEY=0x...
AGENT_PRIVATE_KEY=0x...
DEPLOYER_PRIVATE_KEY=0x...
TOKEN_MINTER_PRIVATE_KEY=0x...   # sama dengan DEPLOYER
MERCHANT_SIM_PRIVATE_KEY=0x...
ORACLE_PRIVATE_KEY=0x...
SPIKE_CONSUMER_PRIVATE_KEY=0x...

# Simulator
SIM_BASE_URL=http://localhost:3000
SIM_API_KEY=<string acak>
```

Biarkan kosong: `REINS_FIXTURES`, `REINS_EVAL_DISABLE_GATE`, `REINS_DEMO_AUTH`.

---

## 11. Taruh paket FitBox Lin di chain

Script ini:
- mint tCNY ke "HP Lin",
- membeli 60 sesi FitBox lewat relayer,
- melakukan 12 check-in,
- mengarahkan wallet Lin dan alamat FitBox di database ke kunci asli,
- menghapus plan mock,
- menjalankan chain-sync sekali.

1. Jalankan database lokal (sekali per sesi kerja):

   ```bash
   pnpm exec supabase start
   pnpm exec supabase db reset        # kembali ke data demo Lin yang bersih
   ```

2. Buat satu kunci lagi untuk "HP Lin": `cast wallet new`. Kunci ini **tidak** disimpan di
   `.env.local`, cukup dipakai di perintah berikut:

   ```bash
   set -a; . ./.env.local; set +a
   DEMO_CONSUMER_PRIVATE_KEY=0x<kunci baru> node --no-warnings --experimental-transform-types scripts/chain-demo-setup.ts
   ```

3. Output berisi sekitar 14 baris hash (`mint`, `purchaseWithPermit`, `redeem #1` sampai `#12`)
   dan diakhiri:

   ```
   Lin's plan N is on chain with 12 sessions used and 48 in escrow.
   ```

Plan ini dimiliki kunci "HP Lin" tadi, bukan kunci yang dibuat browser. Artinya tombol **Check in**
dan **Leave** di app tidak bisa dipakai untuk plan ini (browser tidak memegang kuncinya). Untuk plan
ini, pakai alur "exit karena pengumuman" di langkah 13. Untuk menguji tombol, beli paket baru dari
app (langkah 12).

---

## 12. Test di browser

### 12a. Jalankan app

```bash
set -a; . ./.env.local; set +a
pnpm dev
```

Buka `http://localhost:3000`, login sebagai `lin@demo.reins.local` dengan password `reins-demo`.

### 12b. Cek layar dasar

| Layar | Yang harus terlihat |
|---|---|
| Prepaid | paket FitBox ¥4.800 dengan link `tx 0x…` ke Basescan dan label "Test token, no value" |
| Activity | daftar keputusan; klik satu item, lalu "Rule check" muncul |
| Evidence | "Tamper check: passed" |

### 12c. Beli paket baru dari browser

1. Di **Prepaid**, buka offer **FitBox Futian**, lalu klik **Buy with money held safely** dan
   **Sign and buy**.
2. Pembelian pertama **akan gagal** karena kunci browser belum punya tCNY. Pesannya dimulai dengan
   "It did not go through …". Itu wajar: saat itu address browser sudah terdaftar.
3. Ambil address browser dan isi tCNY:

   ```bash
   set -a; . ./.env.local; set +a
   ADDR=$(psql "$DATABASE_URL_DIRECT" -Atc "select address from public.wallets where user_id='11111111-1111-4111-8111-111111111111'")
   echo $ADDR
   cast send $TOKEN_ADDRESS "mint(address,uint256)" $ADDR 600000 --private-key $TOKEN_MINTER_PRIVATE_KEY --rpc-url $BASE_SEPOLIA_RPC_URL
   ```

   `600000` fen = ¥6.000, cukup untuk 60 × ¥100.
4. Klik **Buy** lagi. Hasilnya harus "Bought. The money is held safely …" dengan link `tx 0x…`. Buka
   link itu dan pastikan statusnya **Success** di Basescan.
5. Plan baru belum muncul di daftar sampai chain-sync jalan. Jalankan:

   ```bash
   curl -X POST http://localhost:3000/api/cron/chain-sync -H "authorization: Bearer $CRON_SECRET"
   ```

   Refresh **Prepaid**. Paket ¥6.000 yang baru muncul.

### 12d. Check-in

1. Buka paket ¥6.000, lalu klik **Check in at the gym**.
2. Hasilnya harus "Session 1 used. One session price went to the gym." dengan link tx.
3. Jalankan chain-sync lagi (perintah `curl` di atas) supaya hitungan sesi ter-update dari chain.

Alternatif untuk demo: halaman tablet gym ada di `http://localhost:3000/sim/tablet`. Isi nomor plan
(lihat "Plan #" di detail paket). Halaman itu hanya menunjukkan bahwa gym ikut menandatangani. Tombol
**Check in** di app tetap yang mengirim transaksinya.

### 12e. Keluar sukarela (dengan fee)

1. Di paket yang sama, klik **Leave this package**, lalu **Sign and leave**.
2. Hasilnya: kartu "¥5.310 is back in your wallet" (59 sesi × ¥100 dikurangi fee 10%).
3. Pastikan transaksinya **Success** di Basescan.

---

## 13. Test exit karena pengumuman resmi (adegan demo utama)

Ini alur "gym bangkrut, Reins menarik uang Lin kembali". Pakai paket FitBox ¥4.800 dari langkah 11.

1. Publish pengumuman resmi dari registry simulator:

   ```bash
   set -a; . ./.env.local; set +a
   curl -X POST http://localhost:3000/sim/registry/publish \
     -H "authorization: Bearer $SIM_API_KEY" -H 'content-type: application/json' \
     -d '{"merchant":"FITBOX_FUTIAN","kind":"court_enforcement"}'
   ```

   Balasan berisi `"attestation"` dengan `signature`.
2. Jalankan job risk (belum ada tombolnya di UI, jadi lewat terminal):

   ```bash
   curl -X POST http://localhost:3000/api/cron/risk -H "authorization: Bearer $CRON_SECRET"
   ```

   Kalau balasannya tidak menyebut plan Lin, tambahkan
   `REINS_RISK_USER_IDS=11111111-1111-4111-8111-111111111111` ke `.env.local`, restart `pnpm dev`,
   lalu ulangi.
3. Hasil yang diharapkan:
   - Activity: "Exited plan with FitBox Futian, refund sent to you" dengan link tx.
   - Prepaid: kartu "¥4.800 is back in your wallet", alasan "Official notice about the gym".
   - Basescan: transaksi `exitWithAttestation` dikirim oleh address **AGENT**, status **Success**.
4. Uji serangan: publish pengumuman palsu, lalu jalankan risk lagi. **Tidak boleh** ada exit:

   ```bash
   curl -X POST http://localhost:3000/sim/registry/publish \
     -H "authorization: Bearer $SIM_API_KEY" -H 'content-type: application/json' \
     -d '{"merchant":"FITBOX_FUTIAN","kind":"court_enforcement","variant":"forged"}'
   ```

   Lakukan ini di plan yang masih aktif (misalnya sebelum langkah 13.1, atau setelah
   `supabase db reset` + langkah 11). Varian lain yang bisa dicoba: `stale`, `other_merchant`.

---

## 14. Test otomatis

Pastikan semuanya hijau sebelum PR:

```bash
pnpm lint
pnpm typecheck
set -a; . ./.env.local; set +a
pnpm test                          # semua suite; yang butuh DB jalan karena DATABASE_URL di-set
cd contracts && forge test && cd ..
```

Hasil di branch `main` saat panduan ini ditulis: `pnpm test` 967 passed, `forge test` 48 passed.

Suite yang paling relevan untuk escrow:

```bash
pnpm vitest run tests/chain                          # anvil lokal + contract (18 test)
pnpm vitest run tests/foundations/user-prepaid.test.ts
pnpm vitest run tests/foundations/voluntary-exit.test.ts
```

`tests/chain` menjalankan anvil sendiri dan tidak menyentuh Base Sepolia, jadi gratis dan bisa
diulang.

---

## 15. Commit hasil deploy

Di branch baru, bukan `main`:

```bash
git switch -c chore/r3-03-base-sepolia-deploy origin/main
git add contracts/deployments/84532.json docs/evidence/spike.md
git commit -m "chore(contracts): record base sepolia deployment and spike hashes"
git push -u origin chore/r3-03-base-sepolia-deploy
```

Alamat contract dan hash transaksi memang publik, jadi aman di-commit. `.env.local` dan semua
private key tidak.

Setelah itu update `task.md`: centang **R3-01**, **R3-03**, gate **G1**, dan **R3-11** kalau
langkah 12–13 berhasil.

---

## 16. Masalah umum

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `Error accessing local wallet` | variabel kunci kosong atau format salah | langkah 4a |
| `insufficient funds` | kunci pengirim tidak punya ETH | langkah 6 |
| Beli gagal: `escrow_not_configured` | `REINS_ESCROW=chain` tapi `ESCROW_ADDRESS` atau RPC kosong | isi langkah 8 dan 7, restart `pnpm dev` |
| Beli gagal: `not_found` | `MOCKBANK_URL` berakhiran `/mockbank` | langkah 2 |
| "The gym has no signed offer" | `MERCHANT_SIM_PRIVATE_KEY` kosong | langkah 4 |
| "The gym tablet did not sign" | plan bukan milik merchant di kunci sim, atau plan tidak aktif | pakai plan dari langkah 11 atau 12c |
| Plan baru tidak muncul | chain-sync belum jalan | `curl` chain-sync di langkah 12c |
| Layar menampilkan "Sample data" | belum login, atau Supabase belum jalan | `pnpm exec supabase start`, lalu login |
| Aksi prepaid gagal: "AGENT_ADDRESS does not match" | `AGENT_ADDRESS` tidak cocok dengan `AGENT_PRIVATE_KEY` | langkah 5, restart `pnpm dev` |
| Ingin kembali ke mode tanpa chain | — | `REINS_ESCROW=mock`, restart `pnpm dev` |
