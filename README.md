# Quest Board

A sybil-resistant quest board for **Agent ID** holders on BNB Smart Chain.

This is an independent entry for the Binance Wallet × BNB Chain Agent ID Hackathon (60,000 USDC prize pool; submissions 18 November 2026 08:00 UTC to 9 December 2026 08:00 UTC). It is **not affiliated with, endorsed by, or sponsored by Binance, BNB Chain, or SPACE ID**.

Anyone can post a quest (title, description, optional link, max completions, end time, and an optional BNB reward pool). Only addresses that currently hold a SPACE ID Agent ID can complete a quest, and each address can complete a given quest only once. Completions are recorded on-chain, award one point, and — if the quest was funded — pay a fixed BNB amount from that quest’s own pool. The creator can withdraw unused pool BNB after the quest ends or is full.

## The problem

Airdrops, bounty boards, and “complete this task” campaigns still struggle to tell a real person from a farm of wallets. Agent ID is a non-transferable ERC-721 (`name.ai`) with a one-per-user rule. That makes it a practical on-chain credential for sybil-resistant participation: **one Agent ID, one completion per quest**.

## How Agent ID is used

This product uses Agent ID as **access control**, which is one of the official example use cases (access control, payments, identity).

- Official Agent ID contract (BNB Smart Chain mainnet): [`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`](https://bscscan.com/address/0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F) — collection name `SPACE ID Agent ID`, symbol `AI`, ERC-721, non-transferable.
- `completeQuest` calls `agentId.balanceOf(msg.sender)` and reverts unless the result is greater than zero, which is the official check described in the hackathon announcement.
- The same address cannot complete the same quest twice (`hasCompleted[questId][user]`). Combined with the one-ID-per-user rule, this is the sybil resistance.
- The Agent ID address is set in the constructor and is **immutable**.
- The contract **does not** look up other people’s wallets by Agent ID name (`ownerOfHandle` is never called). The optional frontend only reverse-resolves `handleOf` for the *connected* wallet, to display that user’s own handle.

Quest Board does **not** automatically verify that the off-chain task was actually performed. Completions are self-claimed. The on-chain guarantees are identity (Agent ID), uniqueness (one completion per address per quest), and honest custody of any BNB reward pool.

## Permissions disclosure

Owner powers are minimal and are documented in the contract header as well as here.

- You may deploy with `owner = address(0)` for a fully ownerless contract.
- If an owner is set, that address may only:
  1. Pause or unpause the *creation of new quests* (`setCreatePaused`).
  2. Renounce ownership (`renounceOwnership`), which is irreversible.
- The owner **cannot** withdraw quest BNB, change the Agent ID address, edit or cancel quests, alter completions or points, or move any user funds.
- Unused pool BNB can be withdrawn **only by the quest creator**, and only after the quest has ended or reached `maxCompletions`.
- If the owner pauses creation and then renounces, new quests stay paused forever. Unpause first if you want creation to remain open.
- Direct BNB transfers to the contract are rejected so stray funds cannot get stuck. The only payable function is `createQuest`.

## Safety and red lines

- The web app never asks for, stores, or handles a seed phrase or private key. Every write is a normal wallet-confirmed transaction. There is no background signing, no unlimited token approval, and no QR/pairing login.
- Optional BNB amounts are a **payment for completing a specific task**. They are not passive income, yield, staking, or a return on a deposit.
- The project name is **Quest Board**. It does not use Binance or BNB branding in the name.
- The contracts are open-source under MIT and are written as a single Solidity file so they can be verified on BscScan.
- This code is **unaudited**. Use small amounts and do your own research.
- Trading products are out of scope, so no trading-risk warning beyond the general unaudited / DYOR notice is required.

## Repository layout

```
src/QuestBoard.sol      Main contract (Remix-friendly, no imports)
src/MockAgentID.sol     Testnet-only mock Agent ID (do not deploy on mainnet)
test/QuestBoard.t.sol   Unit tests against the mock ERC-721
test/AgentIdMainnetFork.t.sol  Read-only checks of the real Agent ID on BSC
frontend/               Static mobile UI (HTML + ethers.js from CDN)
DEPLOY.md               Beginner deploy, verify, host, and submit steps
```

## Tests

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
forge test
```

Live read-only check of the official Agent ID contract on BNB Smart Chain (no key, no transaction):

```bash
forge test --match-contract AgentIdMainnetFork -vv --fork-url https://bsc-dataseed.binance.org
# or
bash scripts/check-agent-id.sh
```

Results at the time this package was prepared (22 November 2026):

- `QuestBoardTest`: **50 passed**, 0 failed
- `AgentIdMainnetFork` against `https://bsc-dataseed.binance.org`: **5 passed**, 0 failed, including `balanceOf` on a known holder of the `alice` handle returning `1`

## Deploy

See **[DEPLOY.md](DEPLOY.md)** for a numbered, beginner walkthrough: BSC Testnet first (with the mock Agent ID), then BNB Smart Chain mainnet, BscScan verification, free frontend hosting, and hackathon submission. Deploy from Remix in your own browser so the private key never leaves your wallet.

Approximate mainnet deploy cost for `QuestBoard` (measured on a local Anvil node as **1,562,950 gas**):

| Gas price | Approximate deploy cost |
|-----------|-------------------------|
| 0.05 gwei (observed on BSC around 22 Nov 2026) | ~0.000078 BNB |
| 1 gwei (conservative) | ~0.0016 BNB |
| 5 gwei (if the network is busy) | ~0.0078 BNB |

Budget around **0.01 BNB** so you also have gas for contract verification-related txs (verification itself is free) and a few later `createQuest` / `completeQuest` transactions. Create and complete typically use on the order of 0.2–0.4 million gas each, plus any BNB you choose to put in a reward pool.

## License

MIT. See [LICENSE](LICENSE).
