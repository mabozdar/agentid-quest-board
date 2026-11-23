// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuestBoard} from "../src/QuestBoard.sol";
import {MockAgentID} from "../src/MockAgentID.sol";

/// @dev On receiving BNB, tries to complete a quest again (or a second quest).
///      Uses try/catch so a failed re-enter does not fail the outer transfer.
contract ReentrantAttacker {
    QuestBoard public board;
    uint256 public targetId;
    bool public attackEnabled;
    uint256 public extraId;
    bool public reenterSucceeded;
    bool public reenterFailed;

    constructor(
        QuestBoard board_
    ) {
        board = board_;
    }

    function setTarget(
        uint256 id
    ) external {
        targetId = id;
    }

    function setExtra(
        uint256 id
    ) external {
        extraId = id;
    }

    function enableAttack(
        bool on
    ) external {
        attackEnabled = on;
    }

    function complete() external {
        board.completeQuest(targetId);
    }

    receive() external payable {
        if (attackEnabled) {
            attackEnabled = false;
            uint256 id = extraId != 0 ? extraId : targetId;
            try board.completeQuest(id) {
                reenterSucceeded = true;
            } catch {
                reenterFailed = true;
            }
        }
    }
}

contract QuestBoardTest is Test {
    MockAgentID internal agent;
    QuestBoard internal board;

    address internal owner = makeAddr("owner");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol"); // no Agent ID

    uint64 internal constant TWO_DAYS = 2 days;

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

    function setUp() public {
        agent = new MockAgentID();
        board = new QuestBoard(address(agent), owner);
        agent.mintTo(alice);
        agent.mintTo(bob);
        vm.deal(creator, 100 ether);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
    }

    function _ends() internal view returns (uint64) {
        return uint64(block.timestamp + TWO_DAYS);
    }

    function _create(
        address from,
        string memory title,
        uint32 maxC,
        uint256 value
    ) internal returns (uint256 id) {
        vm.prank(from);
        id = board.createQuest{value: value}(
            title, "Do the task", "https://example.com/quest", maxC, _ends()
        );
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    function test_constructor_rejectsZeroAgentId() public {
        vm.expectRevert(QuestBoard.InvalidAgentId.selector);
        new QuestBoard(address(0), owner);
    }

    function test_constructor_allowsZeroOwner() public {
        QuestBoard b = new QuestBoard(address(agent), address(0));
        assertEq(b.owner(), address(0));
        assertEq(address(b.agentId()), address(agent));
    }

    // -------------------------------------------------------------------------
    // Create
    // -------------------------------------------------------------------------

    function test_createQuest_storesFieldsAndZeroReward() public {
        uint256 id = _create(creator, "First quest", 10, 0);
        assertEq(id, 1);
        assertEq(board.questCount(), 1);

        QuestBoard.QuestView memory q = board.getQuest(1);

        assertEq(q.creator, creator);
        assertEq(q.title, "First quest");
        assertEq(q.description, "Do the task");
        assertEq(q.link, "https://example.com/quest");
        assertEq(q.maxCompletions, 10);
        assertEq(q.completionCount, 0);
        assertEq(q.endsAt, _ends());
        assertEq(q.rewardPerCompletion, 0);
        assertEq(q.remainingPool, 0);
        assertEq(q.id, 1);
    }

    function test_createQuest_splitsPoolEvenlyAndKeepsDust() public {
        uint256 value = 10 ether + 3; // 3 wei dust if max=10
        uint256 id = _create(creator, "Paid quest", 10, value);
        QuestBoard.QuestView memory q = board.getQuest(id);
        assertEq(q.rewardPerCompletion, value / 10);
        assertEq(q.remainingPool, value);
        assertEq(address(board).balance, value);
    }

    function test_createQuest_emitsEvent() public {
        uint64 endsAt = _ends();
        vm.expectEmit(true, true, false, true);
        emit QuestCreated(
            1, creator, "Title", "Do the task", "https://example.com/quest", 5, endsAt, 0, 0
        );
        vm.prank(creator);
        board.createQuest("Title", "Do the task", "https://example.com/quest", 5, endsAt);
    }

    function test_createQuest_revertsOnEmptyTitle() public {
        vm.prank(creator);
        vm.expectRevert(QuestBoard.EmptyTitle.selector);
        board.createQuest("", "desc", "", 1, _ends());
    }

    function test_createQuest_revertsOnEmptyDescription() public {
        vm.prank(creator);
        vm.expectRevert(QuestBoard.EmptyDescription.selector);
        board.createQuest("title", "", "", 1, _ends());
    }

    function test_createQuest_revertsOnTitleTooLong() public {
        string memory longTitle = string(new bytes(81));
        vm.prank(creator);
        vm.expectRevert(QuestBoard.TitleTooLong.selector);
        board.createQuest(longTitle, "desc", "", 1, _ends());
    }

    function test_createQuest_revertsOnDescriptionTooLong() public {
        string memory longDesc = string(new bytes(281));
        vm.prank(creator);
        vm.expectRevert(QuestBoard.DescriptionTooLong.selector);
        board.createQuest("title", longDesc, "", 1, _ends());
    }

    function test_createQuest_revertsOnLinkTooLong() public {
        string memory longLink = string(new bytes(201));
        vm.prank(creator);
        vm.expectRevert(QuestBoard.LinkTooLong.selector);
        board.createQuest("title", "desc", longLink, 1, _ends());
    }

    function test_createQuest_revertsOnZeroMax() public {
        vm.prank(creator);
        vm.expectRevert(QuestBoard.InvalidMaxCompletions.selector);
        board.createQuest("title", "desc", "", 0, _ends());
    }

    function test_createQuest_revertsOnMaxTooHigh() public {
        vm.prank(creator);
        vm.expectRevert(QuestBoard.InvalidMaxCompletions.selector);
        board.createQuest("title", "desc", "", 10_001, _ends());
    }

    function test_createQuest_revertsOnEndInPast() public {
        vm.prank(creator);
        vm.expectRevert(QuestBoard.InvalidEndTime.selector);
        board.createQuest("title", "desc", "", 1, uint64(block.timestamp));
    }

    function test_createQuest_revertsOnEndTooFar() public {
        vm.prank(creator);
        vm.expectRevert(QuestBoard.InvalidEndTime.selector);
        board.createQuest("title", "desc", "", 1, uint64(block.timestamp + 365 days + 1));
    }

    function test_createQuest_allowsMaxDuration() public {
        vm.prank(creator);
        uint256 id = board.createQuest("title", "desc", "", 1, uint64(block.timestamp + 365 days));
        assertEq(id, 1);
    }

    function test_createQuest_idsIncrement() public {
        uint256 a = _create(creator, "A", 1, 0);
        uint256 b_ = _create(creator, "B", 1, 0);
        assertEq(a, 1);
        assertEq(b_, 2);
        assertEq(board.questCount(), 2);
    }

    // -------------------------------------------------------------------------
    // Complete
    // -------------------------------------------------------------------------

    function test_completeQuest_recordsAndAwardsPoint() public {
        uint256 id = _create(creator, "Open", 5, 0);
        vm.prank(alice);
        board.completeQuest(id);

        assertTrue(board.hasCompleted(id, alice));
        assertEq(board.points(alice), 1);
        assertEq(board.getQuest(id).completionCount, 1);
        assertEq(board.getPointHolderCount(), 1);
    }

    function test_completeQuest_paysReward() public {
        uint256 id = _create(creator, "Paid", 2, 2 ether);
        uint256 beforeBal = alice.balance;
        vm.prank(alice);
        board.completeQuest(id);
        assertEq(alice.balance, beforeBal + 1 ether);
        QuestBoard.QuestView memory qPaid = board.getQuest(id);
        assertEq(qPaid.rewardPerCompletion, 1 ether);
        assertEq(qPaid.remainingPool, 1 ether);
        assertEq(board.points(alice), 1);
    }

    function test_completeQuest_emitsEvent() public {
        uint256 id = _create(creator, "Open", 5, 0);
        vm.expectEmit(true, true, false, true);
        emit QuestCompleted(id, alice, 0, 1);
        vm.prank(alice);
        board.completeQuest(id);
    }

    function test_completeQuest_revertsWithoutAgentId() public {
        uint256 id = _create(creator, "Open", 5, 0);
        vm.prank(carol);
        vm.expectRevert(QuestBoard.NotAgentIdHolder.selector);
        board.completeQuest(id);
    }

    function test_completeQuest_revertsOnSecondTime() public {
        uint256 id = _create(creator, "Open", 5, 0);
        vm.prank(alice);
        board.completeQuest(id);
        vm.prank(alice);
        vm.expectRevert(QuestBoard.AlreadyCompleted.selector);
        board.completeQuest(id);
    }

    function test_completeQuest_twoHoldersEachOnce() public {
        uint256 id = _create(creator, "Open", 5, 0);
        vm.prank(alice);
        board.completeQuest(id);
        vm.prank(bob);
        board.completeQuest(id);
        assertEq(board.points(alice), 1);
        assertEq(board.points(bob), 1);
        assertEq(board.getPointHolderCount(), 2);
        assertEq(board.getQuest(id).completionCount, 2);
    }

    function test_completeQuest_revertsWhenFull() public {
        uint256 id = _create(creator, "Tiny", 1, 0);
        vm.prank(alice);
        board.completeQuest(id);
        vm.prank(bob);
        vm.expectRevert(QuestBoard.QuestFull.selector);
        board.completeQuest(id);
    }

    function test_completeQuest_revertsAfterEnd() public {
        uint256 id = _create(creator, "Open", 5, 0);
        vm.warp(block.timestamp + TWO_DAYS);
        vm.prank(alice);
        vm.expectRevert(QuestBoard.QuestEnded.selector);
        board.completeQuest(id);
    }

    function test_completeQuest_revertsOnUnknownId() public {
        vm.prank(alice);
        vm.expectRevert(QuestBoard.QuestNotFound.selector);
        board.completeQuest(99);
    }

    function test_completeQuest_pointsAccumulateAcrossQuests() public {
        uint256 a = _create(creator, "A", 5, 0);
        uint256 b_ = _create(creator, "B", 5, 0);
        vm.startPrank(alice);
        board.completeQuest(a);
        board.completeQuest(b_);
        vm.stopPrank();
        assertEq(board.points(alice), 2);
        assertEq(board.getPointHolderCount(), 1);
    }

    function test_holdsAgentId() public view {
        assertTrue(board.holdsAgentId(alice));
        assertTrue(board.holdsAgentId(bob));
        assertFalse(board.holdsAgentId(carol));
        assertFalse(board.holdsAgentId(address(0)));
    }

    // -------------------------------------------------------------------------
    // Withdraw
    // -------------------------------------------------------------------------

    function test_withdrawUnused_afterEnd_returnsRemainder() public {
        uint256 id = _create(creator, "Paid", 4, 4 ether);
        vm.prank(alice);
        board.completeQuest(id); // 1 ether paid
        vm.warp(block.timestamp + TWO_DAYS);
        uint256 beforeBal = creator.balance;
        vm.prank(creator);
        board.withdrawUnused(id);
        assertEq(creator.balance, beforeBal + 3 ether);
        assertEq(board.getQuest(id).remainingPool, 0);
    }

    function test_withdrawUnused_whenFull_beforeEnd() public {
        // value 2 ether + 7, max 2 => reward = 1 ether + 3 each, dust = 1 wei
        uint256 id = _create(creator, "Paid2", 2, 2 ether + 7);
        vm.prank(alice);
        board.completeQuest(id);
        vm.prank(bob);
        board.completeQuest(id);
        assertEq(board.getQuest(id).remainingPool, 1);
        uint256 beforeBal = creator.balance;
        vm.prank(creator);
        board.withdrawUnused(id);
        assertEq(creator.balance, beforeBal + 1);
        assertEq(board.getQuest(id).remainingPool, 0);
    }

    function test_withdrawUnused_revertsBeforeEndIfNotFull() public {
        uint256 id = _create(creator, "Paid", 4, 4 ether);
        vm.prank(alice);
        board.completeQuest(id);
        vm.prank(creator);
        vm.expectRevert(QuestBoard.QuestStillOpen.selector);
        board.withdrawUnused(id);
    }

    function test_withdrawUnused_revertsForNonCreator() public {
        uint256 id = _create(creator, "Paid", 4, 4 ether);
        vm.warp(block.timestamp + TWO_DAYS);
        vm.prank(alice);
        vm.expectRevert(QuestBoard.NotCreator.selector);
        board.withdrawUnused(id);
    }

    function test_withdrawUnused_revertsWhenEmpty() public {
        uint256 id = _create(creator, "Free", 4, 0);
        vm.warp(block.timestamp + TWO_DAYS);
        vm.prank(creator);
        vm.expectRevert(QuestBoard.NothingToWithdraw.selector);
        board.withdrawUnused(id);
    }

    function test_withdrawUnused_revertsSecondTime() public {
        uint256 id = _create(creator, "Paid", 4, 4 ether);
        vm.warp(block.timestamp + TWO_DAYS);
        vm.prank(creator);
        board.withdrawUnused(id);
        vm.prank(creator);
        vm.expectRevert(QuestBoard.NothingToWithdraw.selector);
        board.withdrawUnused(id);
    }

    function test_withdrawUnused_emitsEvent() public {
        uint256 id = _create(creator, "Paid", 2, 2 ether);
        vm.warp(block.timestamp + TWO_DAYS);
        vm.expectEmit(true, true, false, true);
        emit UnusedPoolWithdrawn(id, creator, 2 ether);
        vm.prank(creator);
        board.withdrawUnused(id);
    }

    function test_withdrawUnused_revertsOnUnknownId() public {
        vm.prank(creator);
        vm.expectRevert(QuestBoard.QuestNotFound.selector);
        board.withdrawUnused(99);
    }

    // -------------------------------------------------------------------------
    // Owner / pause
    // -------------------------------------------------------------------------

    function test_setCreatePaused_blocksNewQuestsOnly() public {
        uint256 id = _create(creator, "Open", 5, 0);
        vm.prank(owner);
        board.setCreatePaused(true);
        assertTrue(board.createPaused());

        vm.prank(creator);
        vm.expectRevert(QuestBoard.CreateIsPaused.selector);
        board.createQuest("Nope", "desc", "", 1, _ends());

        // completions still work
        vm.prank(alice);
        board.completeQuest(id);
        assertEq(board.points(alice), 1);
    }

    function test_setCreatePaused_unpauseAllowsCreate() public {
        vm.prank(owner);
        board.setCreatePaused(true);
        vm.prank(owner);
        board.setCreatePaused(false);
        uint256 id = _create(creator, "Open", 5, 0);
        assertEq(id, 1);
    }

    function test_setCreatePaused_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit CreatePausedSet(true);
        vm.prank(owner);
        board.setCreatePaused(true);
    }

    function test_setCreatePaused_revertsForNonOwner() public {
        vm.prank(creator);
        vm.expectRevert(QuestBoard.NotOwner.selector);
        board.setCreatePaused(true);
    }

    function test_renounceOwnership() public {
        vm.expectEmit(true, false, false, true);
        emit OwnershipRenounced(owner);
        vm.prank(owner);
        board.renounceOwnership();
        assertEq(board.owner(), address(0));
        vm.prank(owner);
        vm.expectRevert(QuestBoard.NoOwner.selector);
        board.setCreatePaused(true);
    }

    function test_ownerless_cannotPause() public {
        QuestBoard b = new QuestBoard(address(agent), address(0));
        vm.prank(owner);
        vm.expectRevert(QuestBoard.NoOwner.selector);
        b.setCreatePaused(true);
        // anyone can still create
        vm.prank(creator);
        uint256 id = b.createQuest("title", "desc", "", 1, uint64(block.timestamp + 1 days));
        assertEq(id, 1);
    }

    function test_ownerCannotWithdrawQuestFunds() public {
        uint256 id = _create(creator, "Paid", 4, 4 ether);
        vm.warp(block.timestamp + TWO_DAYS);
        vm.prank(owner);
        vm.expectRevert(QuestBoard.NotCreator.selector);
        board.withdrawUnused(id);
    }

    // -------------------------------------------------------------------------
    // Views / pagination
    // -------------------------------------------------------------------------

    function test_getQuests_pagination() public {
        _create(creator, "A", 1, 0);
        _create(creator, "B", 2, 0);
        _create(creator, "C", 3, 0);

        QuestBoard.QuestView[] memory page = board.getQuests(0, 2);
        assertEq(page.length, 2);
        assertEq(page[0].id, 1);
        assertEq(page[1].id, 2);
        assertEq(page[0].title, "A");
        assertEq(page[1].title, "B");
        assertEq(page[0].maxCompletions, 1);

        QuestBoard.QuestView[] memory page2 = board.getQuests(2, 10);
        assertEq(page2.length, 1);
        assertEq(page2[0].id, 3);
        assertEq(page2[0].title, "C");

        QuestBoard.QuestView[] memory empty = board.getQuests(3, 10);
        assertEq(empty.length, 0);
        QuestBoard.QuestView[] memory zero = board.getQuests(0, 0);
        assertEq(zero.length, 0);
    }

    function test_getQuest_revertsOnUnknownId() public {
        vm.expectRevert(QuestBoard.QuestNotFound.selector);
        board.getQuest(1);
    }

    function test_getPointHolders_paginationAndValues() public {
        uint256 a = _create(creator, "A", 5, 0);
        uint256 b_ = _create(creator, "B", 5, 0);
        vm.prank(alice);
        board.completeQuest(a);
        vm.prank(alice);
        board.completeQuest(b_);
        vm.prank(bob);
        board.completeQuest(a);

        (address[] memory accounts, uint256[] memory pts) = board.getPointHolders(0, 10);
        assertEq(accounts.length, 2);
        assertEq(accounts[0], alice);
        assertEq(pts[0], 2);
        assertEq(accounts[1], bob);
        assertEq(pts[1], 1);

        (address[] memory page, uint256[] memory pagePts) = board.getPointHolders(1, 1);
        assertEq(page.length, 1);
        assertEq(page[0], bob);
        assertEq(pagePts[0], 1);
    }

    // -------------------------------------------------------------------------
    // Reentrancy and stray BNB
    // -------------------------------------------------------------------------

    function test_completeQuest_blocksReentrancy() public {
        ReentrantAttacker attacker = new ReentrantAttacker(board);
        agent.mintTo(address(attacker));

        uint256 id = _create(creator, "Paid", 2, 2 ether);
        attacker.setTarget(id);
        attacker.enableAttack(true);

        attacker.complete();

        // CEI already blocks a second completion of the same quest; the guard
        // also fires. Either way the first completion is recorded once only.
        assertTrue(board.hasCompleted(id, address(attacker)));
        assertEq(board.points(address(attacker)), 1);
        assertEq(board.getQuest(id).completionCount, 1);
        assertFalse(attacker.reenterSucceeded());
        assertTrue(attacker.reenterFailed());
    }

    function test_completeQuest_blocksReentrancyIntoSecondQuest() public {
        ReentrantAttacker attacker = new ReentrantAttacker(board);
        agent.mintTo(address(attacker));

        uint256 id1 = _create(creator, "Paid1", 2, 2 ether);
        uint256 id2 = _create(creator, "Paid2", 2, 2 ether);
        attacker.setTarget(id1);
        attacker.setExtra(id2);
        attacker.enableAttack(true);

        attacker.complete();

        assertTrue(board.hasCompleted(id1, address(attacker)));
        assertFalse(board.hasCompleted(id2, address(attacker)));
        assertEq(board.points(address(attacker)), 1);
        assertFalse(attacker.reenterSucceeded());
        assertTrue(attacker.reenterFailed());
    }

    function test_receive_rejectsDirectBnb() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(QuestBoard.DirectTransferDisabled.selector);
        payable(address(board)).transfer(0.1 ether);
    }

    function test_fallback_rejectsDirectBnb() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(QuestBoard.DirectTransferDisabled.selector);
        (bool ok,) = payable(address(board)).call{value: 0.1 ether}(hex"1234");
        ok;
    }

    // -------------------------------------------------------------------------
    // Gas snapshots for deploy estimate
    // -------------------------------------------------------------------------

    function test_gas_deploy() public {
        uint256 gasBefore = gasleft();
        new QuestBoard(address(agent), owner);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("deploy gas (approx)", used);
        // Sanity: a real deploy includes intrinsic 21000 + constructor + code deposit.
        // This number is only the runtime constructor body, not the full tx.
        assertGt(used, 100_000);
    }
}
