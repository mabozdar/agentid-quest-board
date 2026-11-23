// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

interface IAgentIdMainnet {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function balanceOf(
        address owner
    ) external view returns (uint256);
    function handleOf(
        address owner
    ) external view returns (string memory);
    function supportsInterface(
        bytes4 interfaceId
    ) external view returns (bool);
}

/// @notice Live read-only checks against the official SPACE ID Agent ID
///         contract on BNB Smart Chain. Run with:
///         forge test --match-contract AgentIdMainnetFork -vv --fork-url https://bsc-dataseed.binance.org
///         These tests are skipped when not forking BSC mainnet (chain id 56).
contract AgentIdMainnetFork is Test {
    address internal constant AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    // Public holder of the "alice" handle, confirmed via agentid.prd.space.id
    // and a direct balanceOf/handleOf read at the time the tests were written.
    address internal constant ALICE_HOLDER = 0xA506ac7069937571DC56C5f8FDa53c4A729456c6;
    bytes4 internal constant ERC721_INTERFACE = 0x80ac58cd;

    modifier onlyBscMainnet() {
        if (block.chainid != 56) {
            emit log("skip: not forking BSC mainnet (chain id 56)");
            return;
        }
        _;
    }

    function test_nameAndSymbol() public onlyBscMainnet {
        IAgentIdMainnet nft = IAgentIdMainnet(AGENT_ID);
        assertEq(nft.name(), "SPACE ID Agent ID");
        assertEq(nft.symbol(), "AI");
    }

    function test_supportsErc721() public onlyBscMainnet {
        IAgentIdMainnet nft = IAgentIdMainnet(AGENT_ID);
        assertTrue(nft.supportsInterface(ERC721_INTERFACE));
    }

    function test_balanceOfExists_nonHolderIsZero() public onlyBscMainnet {
        IAgentIdMainnet nft = IAgentIdMainnet(AGENT_ID);
        assertEq(nft.balanceOf(address(0x1111111111111111111111111111111111111111)), 0);
    }

    function test_knownHolderHasBalanceAndHandle() public onlyBscMainnet {
        IAgentIdMainnet nft = IAgentIdMainnet(AGENT_ID);
        assertEq(nft.balanceOf(ALICE_HOLDER), 1);
        assertEq(nft.handleOf(ALICE_HOLDER), "alice");
    }

    function test_balanceOfZeroAddressRevertsLikeErc721() public onlyBscMainnet {
        IAgentIdMainnet nft = IAgentIdMainnet(AGENT_ID);
        vm.expectRevert();
        nft.balanceOf(address(0));
    }
}
