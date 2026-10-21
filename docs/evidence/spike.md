# Base Sepolia spike (gate G1)

Run of `contracts/script/Spike.s.sol` on Base Sepolia (chain id 84532), October 20, 2026. Each step
is sent by the key that does it in production: the relayer for purchase and check-in, the agent key
for the attested exit. tCNY is a test token with no value. The contract is not audited.

## Deployment

From `contracts/deployments/84532.json` (deploy block 48356082):

| Contract | Address |
|---|---|
| PrepaidEscrow | [0xcf9e41a7891339D5229B2e3744d80Fe63B7337d0](https://sepolia.basescan.org/address/0xcf9e41a7891339D5229B2e3744d80Fe63B7337d0) |
| TestCNY (tCNY, no value) | [0x7218ACcba071865e31eA60CA740Dd8d0568587F1](https://sepolia.basescan.org/address/0x7218ACcba071865e31eA60CA740Dd8d0568587F1) |
| Oracle (registry signer) | [0x280F4572D9f816d6019834B9c94cA826318aBB6A](https://sepolia.basescan.org/address/0x280F4572D9f816d6019834B9c94cA826318aBB6A) |

## Transactions

All four confirmed with status `success`. The function was checked from each transaction's 4-byte
selector.

| # | Step | Function | Sent by | Block | Transaction |
|---|---|---|---|---|---|
| 0 | Fund the test consumer | `mint` (on tCNY) | token minter `0x2D73…83f7` | 48356155 | [0xc9c8…af6b](https://sepolia.basescan.org/tx/0xc9c8956426e3ff1b1078ae7bd479b290bdf134b7cf9a38a05c3eb562eed4af6b) |
| 1 | **Purchase** (3 sessions × ¥100, fee 10%) | `purchaseWithPermit` | relayer `0x7b18…4777` | 48356155 | [0x2e89…7ea8](https://sepolia.basescan.org/tx/0x2e89b2629350c7d2c29f81021a83c2467ac9c236d56fef80a5ccee602e647ea8) |
| 2 | **Redeem** session 1 (consumer + merchant signatures) | `redeem` | relayer `0x7b18…4777` | 48356156 | [0x27c4…35ea](https://sepolia.basescan.org/tx/0x27c4962d00ee9fcca43b9354b290e7459b4bedca6da9ebf83540637ec6c835ea) |
| 3 | **Attested exit** (oracle-signed closure notice) | `exitWithAttestation` | agent `0xfCE7…7A26` | 48356157 | [0x7d14…d987](https://sepolia.basescan.org/tx/0x7d1431cb0268003514abbe37e511c5dc01ca8197597c21fcebe72056a602d987) |

## Resulting plan state

Read from the escrow after the run (`getPlan(1)`, `remaining(1)`):

- Plan 1: consumer `0xcDbE…1134`, merchant `0x644D…147e`, agent `0xfCE7…7A26` (the key that sent the exit).
- 3 units at 10,000 fen, 1 redeemed, cancel fee 10%, status `exited_attested`.
- `remaining(1) = 0`: the 2 unused sessions (¥200) went back to the consumer; the merchant was paid
  only for the one session that both parties signed.
- The escrow's oracle is `0x280F…BB6A`, the same as in the deployment file.

Gate G1 passes: three confirmed Base Sepolia hashes for purchase, redeem and attested exit.

---

# End to end: Lin's FitBox plan through the app (M2)

Plan 2 on the same escrow: 60 sessions × ¥100, fee 10%, agent = Reins' agent key. Bought and
checked in by `scripts/chain-demo-setup.ts`, indexed into the app by `cron/chain-sync`, then exited
by the agent after the registry simulator published a court-enforcement notice. The exit went
through the full app path: risk job → agent plan → Policy Gate `allow`
(`global.kill_switch`, `mandate.valid`, `schema.prepaid_exit`, `prepaid.exit_plan`,
`prepaid.auto_exit_on`) → executor → chain adapter (agent key, `exitWithAttestation` only).

| Step | Function | Sent by | Transaction |
|---|---|---|---|
| Purchase (60 × ¥100) | `purchaseWithPermit` | relayer | [0xcd52…ad9e](https://sepolia.basescan.org/tx/0xcd52cd94f5028eef2aff5322d03bc955ca56069e75db32b1cc2e5cf2ed52ad9e) |
| Redeem session 1 | `redeem` | relayer | [0xf4c8…45cd](https://sepolia.basescan.org/tx/0xf4c881f55b8f12bdbd3c989b018f978615288ee769610d88ecac2d6876dc45cd) |
| Redeem session 2 | `redeem` | relayer | [0xa055…534f](https://sepolia.basescan.org/tx/0xa055ab1d63654bc8330b91e6332e51c448b78391134ebefb2327cc1ee93a534f) |
| Redeem session 3 | `redeem` | relayer | [0x80da…9054](https://sepolia.basescan.org/tx/0x80da89bc25516e9e6621b02c2147b18f1e51516f4a29274e330aa30cca449054) |
| Redeem session 4 | `redeem` | relayer | [0x1b92…f314](https://sepolia.basescan.org/tx/0x1b924c43e9026357d1236b680d9ef9418e73a1e21d366d1338dcd8d4a582f314) |
| Redeem session 5 | `redeem` | relayer | [0xf675…20f2](https://sepolia.basescan.org/tx/0xf6754ad9ce8b62b872288d100ac9d11b6963d0ef519b803e60e039088c8b20f2) |
| Redeem session 6 | `redeem` | relayer | [0x759a…ac34](https://sepolia.basescan.org/tx/0x759a935c0c1d789ff89aa9701974e9e8d0ec42d2846b25194dfb92279f73ac34) |
| Redeem session 7 | `redeem` | relayer | [0x0f5d…d302](https://sepolia.basescan.org/tx/0x0f5daf96f777ebe7c41a9fcf2473b36130c54e7c9dfc477cc5e1f97f5b6fd302) |
| Redeem session 8 | `redeem` | relayer | [0x9833…406a](https://sepolia.basescan.org/tx/0x98337e492e610e9e0b99a7c12a392aa398dc5f469d2197d47c1af12603c2406a) |
| Redeem session 9 | `redeem` | relayer | [0xca43…fbbf](https://sepolia.basescan.org/tx/0xca431228942975958a55e422541ec1638d644a30f0facb3b941ed6388bbffbbf) |
| Redeem session 10 | `redeem` | relayer | [0x6c47…6420](https://sepolia.basescan.org/tx/0x6c4763f1f50c1e347ef51511ed37c65c8859710b8e49054b6f1f2e3d8bf86420) |
| Redeem session 11 | `redeem` | relayer | [0xad04…f13c](https://sepolia.basescan.org/tx/0xad043a9c37405d897f0418484d016be1f8b92c151e15b62640c4495c8b95f13c) |
| Redeem session 12 | `redeem` | relayer | [0x8087…c4b0](https://sepolia.basescan.org/tx/0x8087ede1efcd59066b3fe5e77f1aa9bb2d75e242147b40f54394294ae6c9c4b0) |
| **Attested exit** (Gate allow, app path) | `exitWithAttestation` | agent | [0xa786…b6f5](https://sepolia.basescan.org/tx/0xa786c5bc17c289e87783ae07eec25d85cacb94833b65b44f021097a20068b6f5) |

After the exit: `getPlan(2)` status `exited_attested`, `remaining(2) = 0`; the consumer received the
unused 48 sessions (480,000 fen = ¥4,800). The app shows the exit in Activity with this Basescan
link, the plan as "¥4,800 back with you", and the audit chain verifies.
