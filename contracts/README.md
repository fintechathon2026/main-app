# Prepaid escrow contracts

`PrepaidEscrow` holds prepaid package money; `TestCNY` (tCNY, 2 decimals, no value) is the token.
Spec, tests and integration: [`docs/PRD_PrepaidEscrow_Contract.md`](../docs/PRD_PrepaidEscrow_Contract.md);
background: `docs/architecture.md` §24.

Money leaves the escrow only as one session's price to the plan's merchant (consumer **and** merchant
signatures), the unused balance to the plan's consumer on an oracle attestation, or the unused balance
minus a capped fee on the consumer's signature. No recipient parameters, no admin.

## Setup

[Foundry](https://getfoundry.sh) (`curl -L https://foundry.paradigm.xyz | bash && foundryup`), then:

```bash
git submodule update --init --recursive   # forge-std v1.17.0, OpenZeppelin v5.7.0
cd contracts
forge build
forge test                                # unit, fuzz (256 runs), invariant (64 × 32)
FOUNDRY_PROFILE=ci forge test             # more fuzz and invariant runs
```

After changing a contract, regenerate the TypeScript ABI (a test fails if you forget):

```bash
node --no-warnings --experimental-transform-types scripts/export-contract-abi.ts   # from the repo root
```

## Local rehearsal (anvil)

```bash
anvil                                     # terminal 1
./script/anvil-rehearsal.sh               # terminal 2: deploy + spike, prints 3 tx hashes
```

The rehearsal uses anvil's public test keys. With local Supabase running, `scripts/chain-demo-setup.ts`
then puts Lin's FitBox plan on the same anvil (see the header of that file for the env). On a
restarted anvil the addresses repeat; the setup script clears stale local chain state (chain 31337 only).
A rerun resumes Lin's existing active FitBox plan instead of buying a second one.

## Base Sepolia

1. Keys: `cast wallet new` five times (deployer, relayer, agent, merchant sim, oracle). Fund deployer,
   relayer and agent from a Base Sepolia faucet. Keep keys out of git.
2. Deploy: `DEPLOYER_PRIVATE_KEY=… ORACLE_ADDRESS=<oracle> forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast`
   (add `--verify` with a Basescan key). Writes `deployments/84532.json`; commit it.
3. Spike: set `TOKEN_MINTER_PRIVATE_KEY` (the deployer by default), `RELAYER_PRIVATE_KEY`,
   `AGENT_PRIVATE_KEY`, `MERCHANT_SIM_PRIVATE_KEY`, `ORACLE_PRIVATE_KEY`, `SPIKE_CONSUMER_PRIVATE_KEY`,
   then `forge script script/Spike.s.sol --rpc-url base_sepolia --broadcast`. Record the purchase, redeem
   and exit hashes from `broadcast/Spike.s.sol/84532/run-latest.json` in `docs/evidence/spike.md`.
4. App env: `REINS_ESCROW=chain`, `ESCROW_ADDRESS`, `TOKEN_ADDRESS`, `CHAIN_START_BLOCK` (deploy block),
   `AGENT_ADDRESS` (= agent key's address), `ORACLE_ADDRESS`, plus the keys in their modules only.
   When `CHAIN_START_BLOCK` is unset, chain-sync uses `deployBlock` from `deployments/84532.json` if
   `ESCROW_ADDRESS` matches its `escrow` (copied in `src/server/chain/deployments.ts`; a test checks).
   `CHAIN_LOG_CHUNK` is the max getLogs range in blocks (default 2000; shrunk automatically when the RPC
   rejects the range). On Alchemy Free tier set `CHAIN_LOG_CHUNK=10`. `CHAIN_LOG_DELAY_MS` (default 0)
   pauses between getLogs calls if the RPC answers 429.
