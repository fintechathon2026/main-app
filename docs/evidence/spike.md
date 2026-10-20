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
