// Fill in contractAddress after you deploy. See DEPLOY.md.
// Mainnet Agent ID (official SPACE ID Agent ID on BNB Smart Chain):
//   0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F
//
// For BSC Testnet, deploy src/MockAgentID.sol first, then set agentIdAddress
// to that mock and chainId to 97 (see the testnet block at the bottom).

window.QUEST_BOARD_CONFIG = {
  contractAddress: "0x0437bD78F5595F6Ed339C237f98586e9573710fd", // e.g. "0xYourQuestBoardAddress"
  agentIdAddress: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
  chainId: 56,
  chainName: "BNB Smart Chain",
  rpcUrl: "https://bsc-dataseed.bnbchain.org",
  explorerUrl: "https://bscscan.com",
  currencySymbol: "BNB",
};

// --- BSC Testnet example (uncomment and edit, then comment out the mainnet block above) ---
// window.QUEST_BOARD_CONFIG = {
//   contractAddress: "0xYourTestnetQuestBoard",
//   agentIdAddress: "0xYourMockAgentID",
//   chainId: 97,
//   chainName: "BSC Testnet",
//   rpcUrl: "https://bsc-testnet-rpc.publicnode.com",
//   explorerUrl: "https://testnet.bscscan.com",
//   currencySymbol: "tBNB",
// };
