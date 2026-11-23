# How to deploy Quest Board

Yeh guide Android phone se bhi follow ho sakti hai. Har writing step aapke **apne wallet** mein confirm hogi. **Seed phrase ya private key kisi bhi website, Remix, ya is app mein kabhi na likhein.**

English steps are numbered below. Official announcement: [Agent ID Hackathon](https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf). Deadline: **9 December 2026, 08:00 UTC**.

---

## 0. What you need

1. A wallet that can use BNB Smart Chain, such as the Binance App wallet or MetaMask.
2. A little BNB for gas (see the estimate in README.md). For testnet you need free test BNB (tBNB) only.
3. This project folder: `src/QuestBoard.sol`, `src/MockAgentID.sol`, and the `frontend/` files.
4. A GitHub account (yours is `mabozdar`) if you want free hosting on GitHub Pages.

Do **not** send this folder to any “deploy service” that asks for your private key.

---

## A. Testnet first (recommended)

BSC Testnet chain ID is **97**. There is no official Agent ID on testnet, so you deploy the mock first.

### A1. Add BSC Testnet to your wallet

- Network name: `BSC Testnet`
- RPC URL: `https://bsc-testnet-rpc.publicnode.com`
- Chain ID: `97`
- Currency: `tBNB`
- Explorer: `https://testnet.bscscan.com`

### A2. Get free test BNB

Use an official public BSC Testnet faucet (search “BSC testnet faucet” on BNB Chain docs). Send tBNB to your wallet address. If one faucet is empty, try another. Never sign a “secret phrase” prompt on a faucet site.

### A3. Open Remix and deploy Mock Agent ID

1. On your phone or computer, open [https://remix.ethereum.org](https://remix.ethereum.org) in the browser.
2. Create a file `MockAgentID.sol` and paste the **full** contents of `src/MockAgentID.sol`.
3. In the Solidity compiler tab, set the compiler to **0.8.24**. Enable optimization (200 runs). EVM version: **shanghai** (or the Remix default if shanghai is not listed).
4. Compile. You should see a green check, no errors.
5. Open the **Deploy & Run** tab.
6. Environment: **Injected Provider**. Connect your wallet and switch it to **BSC Testnet (97)**. Confirm the connection pop-up. Remix should show your address and some tBNB.
7. Select contract `MockAgentID` and press **Deploy**. Confirm the transaction in your wallet.
8. Copy the deployed mock address. Save it in a note.

### A4. Mint a test Agent ID to yourself

In Remix, under “Deployed Contracts”, expand your MockAgentID and press **mint**. Confirm in the wallet. After it confirms, `balanceOf` for your address should be `1`. You can also `mintTo` a second test wallet if you have one.

### A5. Deploy QuestBoard on testnet

1. In Remix, create `QuestBoard.sol` and paste the **full** contents of `src/QuestBoard.sol` (one file, no imports).
2. Compile with the same settings as A3 (0.8.24, optimizer 200, shanghai).
3. In Deploy & Run, select contract **QuestBoard**.
4. Constructor arguments:
   - `agentId_`: the **MockAgentID** address from A3
   - `owner_`: your wallet address if you want the ability to pause new quests, **or** `0x0000000000000000000000000000000000000000` for no owner
5. Press **Deploy** and confirm in your wallet.
6. Copy the QuestBoard address. Save it.

### A6. Verify both contracts on testnet BscScan

1. Open `https://testnet.bscscan.com/address/YOUR_CONTRACT_ADDRESS#code`
2. Click **Verify and Publish**.
3. Compiler: `0.8.24`, license **MIT**, optimization **Yes, 200 runs**, EVM **shanghai**.
4. Paste the exact same source you deployed. QuestBoard and MockAgentID are each a single file, so you do not need flattening.
5. For QuestBoard, constructor arguments must be encoded (BscScan has a constructor argument helper; Remix also shows the ABI-encoded args in the tx data). If verification fails on constructor args, use the “I already added constructor arguments” / ABI-encoded field, or verify via the Remix BscScan plugin.
6. Repeat for MockAgentID (no constructor arguments).

### A7. Point the frontend at testnet and try the flow

1. Open `frontend/config.js`.
2. Comment out the mainnet `QUEST_BOARD_CONFIG` block and uncomment the testnet example.
3. Set `contractAddress` to your testnet QuestBoard and `agentIdAddress` to your MockAgentID.
4. To try it on the phone before public hosting, you can temporarily host the `frontend/` folder (see section C). Or, after step C, open the site, connect the wallet on BSC Testnet, confirm it shows you as an Agent ID holder, create a small quest, and complete it.

If that works, you are ready for mainnet.

---

## B. Mainnet (BNB Smart Chain, chain ID 56)

Use the **official** Agent ID, not the mock.

Official Agent ID:

`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`

Claim an Agent ID only inside the Binance App: Wallet → homepage banner → Agent ID (as described in the official announcement). You do **not** need an Agent ID to *deploy* or to *create* a quest, but you do need one to *complete* a quest on mainnet.

### B1. Deploy QuestBoard

1. In your wallet, switch to **BNB Smart Chain** (chain ID 56). Make sure you have enough BNB (budget about 0.01 BNB; see README.md).
2. Open Remix again, with the same `QuestBoard.sol` already compiled (0.8.24, optimizer 200, shanghai).
3. Environment: **Injected Provider**, connected to mainnet.
4. Constructor arguments:
   - `agentId_`: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
   - `owner_`: your wallet, or the zero address for no owner
5. Press **Deploy**. Read the wallet confirmation carefully (network, gas, no unexpected value). Confirm.
6. Save the new QuestBoard address and the transaction hash.

**Do not deploy MockAgentID on mainnet.**

### B2. Verify on BscScan

1. Open `https://bscscan.com/address/YOUR_MAINNET_QUESTBOARD#code`
2. Verify and Publish, same compiler settings as A6, MIT license, paste the exact source.
3. Fill constructor arguments: official Agent ID address + your owner address (or zero).
4. When it says “Verified”, the open-source rule of the hackathon is met for this contract.

---

## C. Host the frontend for free (GitHub Pages)

1. Edit `frontend/config.js`:
   - `contractAddress`: your **mainnet** QuestBoard address
   - `agentIdAddress`: `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`
   - `chainId`: `56`
   - `rpcUrl`: `https://bsc-dataseed.bnbchain.org`
   - `explorerUrl`: `https://bscscan.com`
2. On GitHub, create a new **public** repository (for example `quest-board`). Public is required for the usual GitHub Pages setup and matches the hackathon’s open-source expectation.
3. Upload these files to the repository **root** (or to a `docs/` folder if you prefer):
   - `index.html`
   - `config.js`
   - `abi.js`
   - `app.js`
   You can also upload the Solidity sources and this README so judges can find everything in one repo.
4. In the repo: **Settings → Pages → Deploy from a branch → main** (or `docs` folder). Save.
5. After a minute, the site will be at `https://mabozdar.github.io/quest-board/` (replace with your repo name). Open it on your phone.
6. Connect the wallet, confirm the UI shows whether you hold an Agent ID, and create a first quest so testers have something to complete.

If GitHub Pages is inconvenient, any static host works (Cloudflare Pages, Netlify). Upload the same four frontend files. Still never paste a private key into a host or CI setting.

---

## D. Submit to the hackathon

Required materials (from the official announcement):

- Project name: **Quest Board**
- Website: your GitHub Pages URL
- Contract address(es): the verified mainnet QuestBoard (and mention that it reads the official Agent ID at `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`)
- Agent ID usage: *Access control. `completeQuest` requires `agentId.balanceOf(msg.sender) > 0`. Each Agent ID holder address may complete each quest only once. The contract does not look up other wallets by name.*
- One project per team. Source must stay verified and open on BscScan.

**Submission form:** as of 22 November 2026, the official announcement says to submit the materials above during the period and that no pre-registration is needed, but it does **not** publish a project-submission form URL. The survey linked in the announcement is for the separate Community Promotion (X post) award, not for project entries. Before 9 December 2026 08:00 UTC, check again:

- The [announcement page](https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf)
- Binance Wallet in the Binance App
- Official accounts such as [@BinanceWallet](https://x.com/BinanceWallet) and [@BNBCHAIN](https://x.com/BNBCHAIN)

Do not submit through unofficial Google Forms or DMs.

### After you submit: get 30+ Agent ID holders to interact

The Innovation award requires at least **30 Agent ID addresses** to interact with your contract during the submission period (ends 9 December 2026 08:00 UTC). Plan for this:

1. Create 2–3 clear quests (for example: follow you on X, try the board, share feedback).
2. Post on X with `#BinanceWalletHackathon` and `#AgenticWallet`, and share in your Binance Square / community chats.
3. Ask people to complete a quest from a wallet that already has an Agent ID (claimed in the Binance App).
4. Track unique completers on BscScan (the `QuestCompleted` event) or on the in-app leaderboard.

---

## Quick reference

| Item | Value |
|------|--------|
| Mainnet chain ID | 56 |
| Official Agent ID | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |
| Compiler | Solidity 0.8.24, optimizer 200 runs, EVM shanghai |
| License | MIT |
| Testnet chain ID | 97 |
| Remix | https://remix.ethereum.org |
| Mainnet explorer | https://bscscan.com |
| Testnet explorer | https://testnet.bscscan.com |
| Submission deadline | 9 December 2026, 08:00 UTC |

Constructor for mainnet:

```text
agentId_ = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
owner_   = <your address or 0x0000000000000000000000000000000000000000>
```
