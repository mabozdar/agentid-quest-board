// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Quest Board
/// @author Crypto Man MAB
/// @notice A sybil-resistant quest board gated by SPACE ID Agent ID (ERC-721).
/// @dev Agent ID is used only as access control: an address may complete a quest
///      if and only if `agentId.balanceOf(address) > 0`, and each address may
///      complete each quest only once. This contract never looks up other
///      people's wallets by Agent ID name.
///
/// Permissions disclosure (please read before deploying):
/// - The Agent ID contract address is immutable and cannot be changed.
/// - If `owner` is not the zero address, the owner may only:
///     1. Pause or unpause the creation of *new* quests (`setCreatePaused`).
///     2. Renounce ownership (`renounceOwnership`).
/// - The owner CANNOT withdraw quest BNB, edit or cancel quests, change
///   completions or points, or move any user funds.
/// - If the owner pauses creation and then renounces, new quests stay paused
///   forever. Unpause first if you want creation to remain open.
/// - Anyone can create a quest (projects may use a team wallet that does not
///   itself hold an Agent ID). Only Agent ID holders can complete quests.
/// - Completions are self-claimed. The contract does not verify that the
///   off-chain task was actually performed. It records the claim, awards one
///   point, and pays the optional per-completion BNB reward from that quest's
///   own pool.
/// - BNB sent with `createQuest` is the only value this contract accepts.
///   Direct transfers are rejected so funds cannot get stuck.
/// - Unused pool BNB can be withdrawn only by the quest creator, and only
///   after the quest has ended or reached `maxCompletions`.
/// - Optional BNB rewards are a payment for completing a specific task. They
///   are not passive income, yield, or a return on a deposit.
interface IAgentIdNft {
    function balanceOf(
        address owner
    ) external view returns (uint256);
}

contract QuestBoard {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct Quest {
        address creator;
        uint32 maxCompletions;
        uint32 completionCount;
        uint64 endsAt;
        uint256 rewardPerCompletion;
        uint256 remainingPool;
        string title;
        string description;
        string link;
    }

    struct QuestView {
        uint256 id;
        address creator;
        string title;
        string description;
        string link;
        uint32 maxCompletions;
        uint32 completionCount;
        uint64 endsAt;
        uint256 rewardPerCompletion;
        uint256 remainingPool;
    }

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error InvalidAgentId();
    error NotOwner();
    error NoOwner();
    error CreateIsPaused();
    error EmptyTitle();
    error EmptyDescription();
    error TitleTooLong();
    error DescriptionTooLong();
    error LinkTooLong();
    error InvalidMaxCompletions();
    error InvalidEndTime();
    error QuestNotFound();
    error NotAgentIdHolder();
    error AlreadyCompleted();
    error QuestEnded();
    error QuestFull();
    error NotCreator();
    error QuestStillOpen();
    error NothingToWithdraw();
    error TransferFailed();
    error DirectTransferDisabled();
    error Reentrant();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event QuestCreated(
        uint256 indexed questId,
        address indexed creator,
        string title,
        string description,
        string link,
        uint32 maxCompletions,
        uint64 endsAt,
        uint256 rewardPerCompletion,
        uint256 pool
    );
    event QuestCompleted(
        uint256 indexed questId, address indexed user, uint256 rewardPaid, uint256 newPoints
    );
    event UnusedPoolWithdrawn(uint256 indexed questId, address indexed creator, uint256 amount);
    event CreatePausedSet(bool paused);
    event OwnershipRenounced(address indexed previousOwner);

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    string public constant CONTRACT_NAME = "Quest Board";
    uint256 public constant MAX_TITLE_BYTES = 80;
    uint256 public constant MAX_DESCRIPTION_BYTES = 280;
    uint256 public constant MAX_LINK_BYTES = 200;
    uint32 public constant MAX_COMPLETIONS_CAP = 10_000;
    uint64 public constant MAX_QUEST_DURATION = 365 days;
    uint256 public constant POINTS_PER_COMPLETION = 1;

    // -------------------------------------------------------------------------
    // Immutable / storage
    // -------------------------------------------------------------------------

    /// @notice Official SPACE ID Agent ID registry on BNB Chain, or a mock on testnet.
    IAgentIdNft public immutable agentId;

    /// @notice Optional owner. May be address(0) for a fully ownerless deploy.
    address public owner;

    /// @notice When true, `createQuest` reverts. Completions and withdrawals still work.
    bool public createPaused;

    uint256 public questCount;

    mapping(uint256 => Quest) private _quests;
    mapping(uint256 => mapping(address => bool)) public hasCompleted;
    mapping(address => uint256) public points;

    address[] private _pointHolders;
    mapping(address => bool) private _isPointHolder;

    uint256 private _locked;

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier nonReentrant() {
        if (_locked != 0) revert Reentrant();
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier onlyOwner() {
        if (owner == address(0)) revert NoOwner();
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param agentId_ Agent ID ERC-721 address (mainnet: 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F).
    /// @param owner_ Owner address, or address(0) for no owner.
    constructor(
        address agentId_,
        address owner_
    ) {
        if (agentId_ == address(0)) revert InvalidAgentId();
        agentId = IAgentIdNft(agentId_);
        owner = owner_;
    }

    // -------------------------------------------------------------------------
    // External: writes
    // -------------------------------------------------------------------------

    /// @notice Create a quest. Optionally fund a BNB reward pool with `msg.value`.
    /// @param title Short title (1–80 bytes).
    /// @param description What to do (1–280 bytes).
    /// @param link Task URL (may be empty, max 200 bytes).
    /// @param maxCompletions How many unique Agent ID holders may complete it (1–10000).
    /// @param endsAt Unix timestamp when the quest closes. Must be in the future
    ///        and at most 365 days from now.
    /// @return questId The new quest id (starts at 1).
    function createQuest(
        string calldata title,
        string calldata description,
        string calldata link,
        uint32 maxCompletions,
        uint64 endsAt
    ) external payable nonReentrant returns (uint256 questId) {
        if (createPaused) revert CreateIsPaused();

        uint256 titleLen = bytes(title).length;
        if (titleLen == 0) revert EmptyTitle();
        if (titleLen > MAX_TITLE_BYTES) revert TitleTooLong();
        uint256 descLen = bytes(description).length;
        if (descLen == 0) revert EmptyDescription();
        if (descLen > MAX_DESCRIPTION_BYTES) revert DescriptionTooLong();
        if (bytes(link).length > MAX_LINK_BYTES) revert LinkTooLong();
        if (maxCompletions == 0 || maxCompletions > MAX_COMPLETIONS_CAP) {
            revert InvalidMaxCompletions();
        }
        if (endsAt <= block.timestamp || endsAt > block.timestamp + MAX_QUEST_DURATION) {
            revert InvalidEndTime();
        }

        uint256 rewardPerCompletion = 0;
        if (msg.value > 0) {
            rewardPerCompletion = msg.value / maxCompletions;
        }

        questId = ++questCount;
        Quest storage q = _quests[questId];
        q.creator = msg.sender;
        q.maxCompletions = maxCompletions;
        q.endsAt = endsAt;
        q.rewardPerCompletion = rewardPerCompletion;
        q.remainingPool = msg.value;
        q.title = title;
        q.description = description;
        q.link = link;

        emit QuestCreated(
            questId,
            msg.sender,
            title,
            description,
            link,
            maxCompletions,
            endsAt,
            rewardPerCompletion,
            msg.value
        );
    }

    /// @notice Self-claim completion of a quest. Requires an Agent ID.
    ///         Each address may complete each quest only once.
    function completeQuest(
        uint256 questId
    ) external nonReentrant {
        Quest storage q = _quests[questId];
        if (q.creator == address(0)) revert QuestNotFound();
        if (block.timestamp >= q.endsAt) revert QuestEnded();
        if (q.completionCount >= q.maxCompletions) revert QuestFull();
        if (hasCompleted[questId][msg.sender]) revert AlreadyCompleted();
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();

        hasCompleted[questId][msg.sender] = true;
        q.completionCount += 1;

        uint256 newPoints = points[msg.sender] + POINTS_PER_COMPLETION;
        points[msg.sender] = newPoints;
        if (!_isPointHolder[msg.sender]) {
            _isPointHolder[msg.sender] = true;
            _pointHolders.push(msg.sender);
        }

        uint256 reward = q.rewardPerCompletion;
        if (reward > 0) {
            q.remainingPool -= reward;
            (bool ok,) = payable(msg.sender).call{value: reward}("");
            if (!ok) revert TransferFailed();
        }

        emit QuestCompleted(questId, msg.sender, reward, newPoints);
    }

    /// @notice Creator withdraws leftover pool BNB after the quest ends or is full.
    function withdrawUnused(
        uint256 questId
    ) external nonReentrant {
        Quest storage q = _quests[questId];
        if (q.creator == address(0)) revert QuestNotFound();
        if (msg.sender != q.creator) revert NotCreator();
        if (block.timestamp < q.endsAt && q.completionCount < q.maxCompletions) {
            revert QuestStillOpen();
        }
        uint256 amount = q.remainingPool;
        if (amount == 0) revert NothingToWithdraw();
        q.remainingPool = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit UnusedPoolWithdrawn(questId, msg.sender, amount);
    }

    /// @notice Pause or unpause creation of new quests. Does not affect
    ///         existing quests, completions, or withdrawals.
    function setCreatePaused(
        bool paused
    ) external onlyOwner {
        createPaused = paused;
        emit CreatePausedSet(paused);
    }

    /// @notice Irreversibly set owner to address(0). Does not change `createPaused`.
    function renounceOwnership() external onlyOwner {
        address previous = owner;
        owner = address(0);
        emit OwnershipRenounced(previous);
    }

    // -------------------------------------------------------------------------
    // External: views
    // -------------------------------------------------------------------------

    /// @notice True if `account` currently holds at least one Agent ID token.
    function holdsAgentId(
        address account
    ) external view returns (bool) {
        if (account == address(0)) return false;
        return agentId.balanceOf(account) > 0;
    }

    function getQuest(
        uint256 questId
    ) public view returns (QuestView memory view_) {
        Quest storage q = _quests[questId];
        if (q.creator == address(0)) revert QuestNotFound();
        return QuestView({
            id: questId,
            creator: q.creator,
            title: q.title,
            description: q.description,
            link: q.link,
            maxCompletions: q.maxCompletions,
            completionCount: q.completionCount,
            endsAt: q.endsAt,
            rewardPerCompletion: q.rewardPerCompletion,
            remainingPool: q.remainingPool
        });
    }

    /// @notice Page through quests. IDs start at 1. Returns fewer items at the end.
    function getQuests(
        uint256 offset,
        uint256 limit
    ) external view returns (QuestView[] memory list) {
        uint256 total = questCount;
        if (offset >= total || limit == 0) {
            return new QuestView[](0);
        }
        uint256 end_ = offset + limit;
        if (end_ > total) end_ = total;
        uint256 n = end_ - offset;
        list = new QuestView[](n);
        for (uint256 i = 0; i < n; i++) {
            list[i] = getQuest(offset + i + 1);
        }
    }

    function getPointHolderCount() external view returns (uint256) {
        return _pointHolders.length;
    }

    /// @notice Page through point holders (unsorted). The frontend sorts the leaderboard.
    function getPointHolders(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory accounts, uint256[] memory pts) {
        uint256 total = _pointHolders.length;
        if (offset >= total || limit == 0) {
            return (new address[](0), new uint256[](0));
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 n = end - offset;
        accounts = new address[](n);
        pts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            address a = _pointHolders[offset + i];
            accounts[i] = a;
            pts[i] = points[a];
        }
    }

    // -------------------------------------------------------------------------
    // Reject stray BNB
    // -------------------------------------------------------------------------

    receive() external payable {
        revert DirectTransferDisabled();
    }

    fallback() external payable {
        revert DirectTransferDisabled();
    }
}
