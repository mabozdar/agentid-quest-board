// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Mock Agent ID (TESTNET ONLY)
/// @notice Minimal ERC-721-like token used to test Quest Board on BSC Testnet.
/// @dev Do NOT deploy this on BNB Smart Chain mainnet. Mainnet must use the
///      official SPACE ID Agent ID at 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F.
///      Quest Board only reads `balanceOf(address)`.
///      One token per address, to mirror the real one-Agent-ID-per-user rule.
///      This mock is transferable for test convenience (the real one is not).
contract MockAgentID {
    error ERC721InvalidOwner(address owner);
    error AlreadyMinted();
    error InvalidReceiver();

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    string public constant name = "Mock Agent ID";
    string public constant symbol = "AI-TEST";

    uint256 public totalSupply;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) public ownerOf;

    /// @notice Mint one mock Agent ID to yourself. Reverts if you already have one.
    function mint() external {
        _mint(msg.sender);
    }

    /// @notice Mint one mock Agent ID to `to`. Useful when testing with several wallets.
    function mintTo(
        address to
    ) external {
        _mint(to);
    }

    function balanceOf(
        address owner
    ) external view returns (uint256) {
        if (owner == address(0)) revert ERC721InvalidOwner(address(0));
        return _balances[owner];
    }

    function _mint(
        address to
    ) internal {
        if (to == address(0)) revert InvalidReceiver();
        if (_balances[to] != 0) revert AlreadyMinted();
        uint256 tokenId = ++totalSupply;
        _balances[to] = 1;
        ownerOf[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
    }
}
