#!/usr/bin/env bash
# Rehearses Deploy + Spike on a local anvil (PRD_PrepaidEscrow_Contract §9). Start `anvil` first.
# Uses anvil's well-known public test accounts; never use these keys on a real network.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC="${RPC:-http://127.0.0.1:8545}"
K0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # deployer, tCNY minter
K1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d # oracle (= tests' TEST_ORACLE_KEY)
K2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a # relayer
K3=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 # agent
K4=0x47e179ec197488593b187f80a00eb0da91f1c9b0b28dd4a3c7f0cdf4e4b8c3fc # merchant (FitBox sim)
K5=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba # spike consumer

export DEPLOYER_PRIVATE_KEY=$K0 TOKEN_MINTER_PRIVATE_KEY=$K0 ORACLE_PRIVATE_KEY=$K1 RELAYER_PRIVATE_KEY=$K2
export AGENT_PRIVATE_KEY=$K3 MERCHANT_SIM_PRIVATE_KEY=$K4 SPIKE_CONSUMER_PRIVATE_KEY=$K5
ORACLE_ADDRESS=$(cast wallet address "$K1")
export ORACLE_ADDRESS

forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --quiet
forge script script/Spike.s.sol --rpc-url "$RPC" --broadcast --quiet

CHAIN_ID=$(cast chain-id --rpc-url "$RPC")
echo "deployment: deployments/${CHAIN_ID}.json"
cat "deployments/${CHAIN_ID}.json"; echo
echo "spike transactions (function, hash, status):"
RUN="broadcast/Spike.s.sol/${CHAIN_ID}/run-latest.json"
for h in $(jq -r '.receipts[].transactionHash' "$RUN"); do
  fn=$(jq -r --arg h "$h" '.transactions[] | select(.hash == $h) | .function' "$RUN")
  echo "  ${fn%%(*} $h $(cast receipt "$h" status --rpc-url "$RPC")"
done
