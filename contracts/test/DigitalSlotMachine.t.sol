// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {DigitalSlotMachine} from "../src/DigitalSlotMachine.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC1155} from "./mocks/MockERC1155.sol";

contract DigitalSlotMachineTest is Test {
    uint256 private constant TICKET_PRICE = 1_000_000;
    uint256 private constant ERC20_PRIZE_AMOUNT = 10 ether;
    uint256 private constant ERC1155_TOKEN_ID = 7;

    address private constant PLAYER = address(0xA11CE);
    address private constant OTHER_PLAYER = address(0xB0B);
    address private constant FREE_PLAYER = address(0xF123);
    address private constant OPERATOR = address(0xCAFE);
    address private constant TREASURY = address(0xFEE);

    MockERC20 private usdc;
    MockERC20 private prizeToken;
    MockERC1155 private prize1155;
    DigitalSlotMachine private slot;

    event SpinStarted(
        uint256 indexed gameId,
        address indexed player,
        uint64 targetBlock,
        uint64 revealDeadline,
        uint256 price,
        bool freeSpin,
        uint64 catalogVersion
    );
    event RoundRevealed(
        uint256 indexed gameId,
        address indexed player,
        uint8 indexed winningSymbol,
        uint8 matchCount,
        uint8 winningLine,
        uint8[15] symbols
    );
    event PrizePaid(
        uint256 indexed gameId,
        address indexed recipient,
        uint8 indexed symbol,
        DigitalSlotMachine.PrizeKind kind,
        address token,
        uint256 tokenId,
        uint256 amount
    );
    event RevealSettingsUpdated(
        uint64 oldDelayBlocks, uint64 newDelayBlocks, uint64 oldWindowBlocks, uint64 newWindowBlocks
    );
    event FreeSpinsGranted(address indexed player, uint256 amount, uint256 newCount);

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        prizeToken = new MockERC20("Stock 1", "STOCK1", 18);
        prize1155 = new MockERC1155();
        slot = new DigitalSlotMachine(address(this), address(this), usdc, TICKET_PRICE);

        // Three configured symbols are the minimum needed to keep each three-cell column unique.
        slot.configurePrize(0, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, ERC20_PRIZE_AMOUNT, 404, 100);
        slot.configurePrize(1, DigitalSlotMachine.PrizeKind.ERC1155, address(prize1155), ERC1155_TOKEN_ID, 1, 0, 394);
        slot.configurePrize(2, DigitalSlotMachine.PrizeKind.FreeSpin, address(0), 0, 1, 0, 1);

        usdc.mint(PLAYER, 20_000_000);
        usdc.mint(OTHER_PLAYER, 20_000_000);
        prizeToken.mint(address(slot), 1_000 ether);
        prize1155.mint(address(slot), ERC1155_TOKEN_ID, 100);

        _approvePayment(slot, PLAYER);
        _approvePayment(slot, OTHER_PLAYER);
    }

    function testInitialConfigurationAndExactTotal() public view {
        assertEq(slot.owner(), address(this));
        assertTrue(slot.hasRole(slot.GAME_MANAGER_ROLE(), address(this)));
        assertEq(address(slot.paymentToken()), address(usdc));
        assertEq(slot.ticketPrice(), TICKET_PRICE);
        assertEq(slot.noWinWeight(), 101);
        assertEq(slot.totalOutcomeWeight(), 1_000);
        assertEq(slot.configuredPrizeCount(), 3);
        assertEq(slot.PROBABILITY_DENOMINATOR(), 1_000);
        assertEq(slot.COLUMN_COUNT(), 5);
        assertEq(slot.ROW_COUNT(), 3);
        assertEq(slot.CELL_COUNT(), 15);
    }

    function testInitialGameManagerIsIndependentFromOwner() public {
        DigitalSlotMachine managed = new DigitalSlotMachine(TREASURY, OPERATOR, usdc, TICKET_PRICE);

        assertEq(managed.owner(), TREASURY);
        assertTrue(managed.hasRole(managed.GAME_MANAGER_ROLE(), OPERATOR));
        assertFalse(managed.hasRole(bytes32(0), OPERATOR));

        vm.prank(OPERATOR);
        managed.setTicketPrice(TICKET_PRICE + 1);
        assertEq(managed.ticketPrice(), TICKET_PRICE + 1);
    }

    function testPlayerCannotOpenTwoPendingGames() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        uint256 paymentBalance = usdc.balanceOf(PLAYER);

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.PlayerAlreadyHasActiveGame.selector, PLAYER, gameId));
        vm.prank(PLAYER);
        slot.startSpin();

        assertEq(slot.activeGameId(PLAYER), gameId);
        assertEq(slot.activeRoundCount(), 1);
        assertEq(usdc.balanceOf(PLAYER), paymentBalance);
    }

    function testFreeSpinCannotBypassPlayerActiveGameLimit() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        slot.setFreeSpins(PLAYER, 1);

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.PlayerAlreadyHasActiveGame.selector, PLAYER, gameId));
        slot.startFreeSpin(PLAYER);

        assertEq(slot.freeSpins(PLAYER), 1);
        assertEq(slot.activeGameId(PLAYER), gameId);
    }

    function testPlayerCanStartAgainAfterReveal() public {
        uint256 firstGameId = _startSpin(slot, PLAYER);
        _setBlockHashForOutcome(slot, firstGameId, slot.NO_WIN(), 0, slot.NO_LINE());
        slot.revealRound(firstGameId);

        assertEq(slot.activeGameId(PLAYER), 0);
        uint256 secondGameId = _startSpin(slot, PLAYER);
        assertEq(slot.activeGameId(PLAYER), secondGameId);
        assertNotEq(secondGameId, firstGameId);
    }

    function testDifferentPlayersCanHaveConcurrentGamesAndAdminCanPageThem() public {
        uint256 playerGameId = _startSpin(slot, PLAYER);
        uint256 otherGameId = _startSpin(slot, OTHER_PLAYER);

        (uint256[] memory firstPage, uint256 total) = slot.getActiveGameIds(0, 1);
        assertEq(total, 2);
        assertEq(firstPage.length, 1);
        assertEq(firstPage[0], playerGameId);

        (uint256[] memory secondPage,) = slot.getActiveGameIds(1, 100);
        assertEq(secondPage.length, 1);
        assertEq(secondPage[0], otherGameId);

        _setBlockHashForOutcome(slot, playerGameId, slot.NO_WIN(), 0, slot.NO_LINE());
        slot.revealRound(playerGameId);

        (uint256[] memory remainingGames, uint256 remainingTotal) = slot.getActiveGameIds(0, 100);
        assertEq(remainingTotal, 1);
        assertEq(remainingGames[0], otherGameId);
    }

    function testFrontendAggregateReadsExposeUserAdminAndInventoryState() public {
        (uint256 freeSpinBalance, uint256 currentGameId, bool hasActiveGame) = slot.getPlayerState(PLAYER);
        assertEq(freeSpinBalance, 0);
        assertEq(currentGameId, 0);
        assertFalse(hasActiveGame);

        DigitalSlotMachine.ContractSettings memory settings = slot.getContractSettings();
        assertEq(settings.paymentToken, address(usdc));
        assertEq(settings.ticketPrice, TICKET_PRICE);
        assertEq(settings.revealDelayBlocks, 5);
        assertEq(settings.revealWindowBlocks, 256);
        assertEq(settings.totalOutcomeWeight, 1_000);
        assertEq(settings.configuredPrizeCount, 3);
        assertFalse(settings.paused);
        assertEq(settings.activeRoundCount, 0);

        (uint256 erc20Balance, uint256 erc20Reserved, uint256 erc20Available) = slot.getERC20Inventory(prizeToken);
        assertEq(erc20Balance, 1_000 ether);
        assertEq(erc20Reserved, 0);
        assertEq(erc20Available, erc20Balance);

        (uint256 erc1155Balance, uint256 erc1155Reserved, uint256 erc1155Available) =
            slot.getERC1155Inventory(prize1155, ERC1155_TOKEN_ID);
        assertEq(erc1155Balance, 100);
        assertEq(erc1155Reserved, 0);
        assertEq(erc1155Available, erc1155Balance);

        uint256 gameId = _startSpin(slot, PLAYER);
        (freeSpinBalance, currentGameId, hasActiveGame) = slot.getPlayerState(PLAYER);
        assertEq(freeSpinBalance, 0);
        assertEq(currentGameId, gameId);
        assertTrue(hasActiveGame);

        (, erc20Reserved, erc20Available) = slot.getERC20Inventory(prizeToken);
        assertEq(erc20Reserved, ERC20_PRIZE_AMOUNT);
        assertEq(erc20Available, erc20Balance - ERC20_PRIZE_AMOUNT);
    }

    function testAdminCanChangeRevealSettingsForNewGames() public {
        vm.expectEmit(false, false, false, true, address(slot));
        emit RevealSettingsUpdated(5, 8, 256, 120);
        slot.setRevealSettings(8, 120);
        assertEq(slot.revealDelayBlocks(), 8);
        assertEq(slot.revealWindowBlocks(), 120);

        uint256 startedAt = block.number;
        uint256 gameId = _startSpin(slot, PLAYER);
        DigitalSlotMachine.Game memory game = slot.getGame(gameId);
        assertEq(game.targetBlock, startedAt + 8);
        assertEq(game.revealDeadline, game.targetBlock + 120);
    }

    function testInvalidRevealSettingsAreRejected() public {
        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.InvalidRevealDelay.selector, 0));
        slot.setRevealSettings(0, 100);

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.InvalidRevealWindow.selector, 0, uint64(256)));
        slot.setRevealSettings(5, 0);

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.InvalidRevealWindow.selector, 257, uint64(256)));
        slot.setRevealSettings(5, 257);
    }

    function testGrantFreeSpinsAddsWithoutOverwritingExistingBalance() public {
        slot.setFreeSpins(FREE_PLAYER, 2);
        vm.expectEmit(true, false, false, true, address(slot));
        emit FreeSpinsGranted(FREE_PLAYER, 3, 5);
        slot.grantFreeSpins(FREE_PLAYER, 3);
        assertEq(slot.freeSpins(FREE_PLAYER), 5);
    }

    function testSpinStartedEventContainsFrontendReceiptData() public {
        uint256 expectedGameId = slot.nextGameId();
        uint64 targetBlock = uint64(block.number + slot.revealDelayBlocks());
        uint64 revealDeadline = targetBlock + slot.revealWindowBlocks();

        vm.expectEmit(true, true, false, true, address(slot));
        emit SpinStarted(
            expectedGameId, PLAYER, targetBlock, revealDeadline, TICKET_PRICE, false, slot.catalogVersion()
        );
        _startSpin(slot, PLAYER);
    }

    function testRevealAndPrizeEventsContainCompleteFrontendResult() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        _setBlockHashForOutcome(slot, gameId, 0, 3, 1);
        (uint8[15] memory result, uint8 symbol, uint8 matchCount, uint8 winningLine) = slot.previewPendingResult(gameId);

        vm.expectEmit(true, true, true, true, address(slot));
        emit RoundRevealed(gameId, PLAYER, symbol, matchCount, winningLine, result);
        vm.expectEmit(true, true, true, true, address(slot));
        emit PrizePaid(
            gameId, PLAYER, symbol, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, ERC20_PRIZE_AMOUNT / 2
        );
        slot.revealRound(gameId);
    }

    function testActiveGamesPaginationRejectsInvalidPageSize() public {
        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.InvalidPageSize.selector, 0, uint256(100)));
        slot.getActiveGameIds(0, 0);

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.InvalidPageSize.selector, 101, uint256(100)));
        slot.getActiveGameIds(0, 101);
    }

    function testPaytableBucketBoundariesAreExact() public view {
        _assertOutcome(0, slot.NO_WIN(), 0);
        _assertOutcome(100, slot.NO_WIN(), 0);
        _assertOutcome(101, 0, 3);
        _assertOutcome(504, 0, 3);
        _assertOutcome(505, 0, 5);
        _assertOutcome(604, 0, 5);
        _assertOutcome(605, 1, 5);
        _assertOutcome(998, 1, 5);
        _assertOutcome(999, 2, 5);
    }

    function testConfirmedTwelveSymbolPaytableTotals() public {
        DigitalSlotMachine paytableSlot = new DigitalSlotMachine(address(this), address(this), usdc, TICKET_PRICE);

        paytableSlot.configurePrize(0, DigitalSlotMachine.PrizeKind.ERC1155, address(prize1155), 1, 1, 94, 62); // MAGNET
        paytableSlot.configurePrize(1, DigitalSlotMachine.PrizeKind.FreeSpin, address(0), 0, 1, 73, 48); // FREE_SPIN
        paytableSlot.configurePrize(2, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, 10 ether, 48, 32); // STOCK1
        paytableSlot.configurePrize(3, DigitalSlotMachine.PrizeKind.ERC1155, address(prize1155), 2, 1, 45, 30); // GADGET
        paytableSlot.configurePrize(4, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, 10 ether, 38, 26); // STOCK2
        paytableSlot.configurePrize(5, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, 10 ether, 38, 26); // STOCK3
        paytableSlot.configurePrize(6, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, 10 ether, 38, 26); // STOCK4
        paytableSlot.configurePrize(7, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, 10 ether, 30, 20); // STOCK5
        paytableSlot.configurePrize(8, DigitalSlotMachine.PrizeKind.ERC1155, address(prize1155), 3, 1, 0, 100); // ENS_REGISTRATION
        paytableSlot.configurePrize(9, DigitalSlotMachine.PrizeKind.ERC1155, address(prize1155), 4, 1, 0, 67); // URBE_HUB_DAY_PASS
        paytableSlot.configurePrize(10, DigitalSlotMachine.PrizeKind.ERC1155, address(prize1155), 5, 1, 0, 45); // SHIRT
        paytableSlot.configurePrize(11, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, 1 ether, 0, 13); // GOLD

        (, DigitalSlotMachine.Prize[] memory prizes) = paytableSlot.getPrizeCatalog();
        uint256 threeMatchTotal;
        uint256 fiveMatchTotal;
        for (uint256 index = 0; index < prizes.length; ++index) {
            threeMatchTotal += prizes[index].threeMatchWeight;
            fiveMatchTotal += prizes[index].fiveMatchWeight;
        }

        assertEq(prizes.length, 12);
        assertEq(threeMatchTotal, 404);
        assertEq(fiveMatchTotal, 495);
        assertEq(paytableSlot.noWinWeight(), 101);
        assertEq(paytableSlot.totalOutcomeWeight(), 1_000);
    }

    function testIncompletePaytableBlocksSpin() public {
        DigitalSlotMachine incomplete = new DigitalSlotMachine(address(this), address(this), usdc, TICKET_PRICE);
        incomplete.configurePrize(
            0, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, ERC20_PRIZE_AMOUNT, 100, 100
        );

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.IncompletePaytable.selector, 301, uint256(1_000)));
        vm.prank(PLAYER);
        incomplete.startSpin();
    }

    function testAtLeastThreeSymbolsAreRequiredForUniqueColumns() public {
        DigitalSlotMachine twoSymbolSlot = new DigitalSlotMachine(address(this), address(this), usdc, TICKET_PRICE);
        twoSymbolSlot.configurePrize(0, DigitalSlotMachine.PrizeKind.FreeSpin, address(0), 0, 1, 0, 898);
        twoSymbolSlot.configurePrize(1, DigitalSlotMachine.PrizeKind.FreeSpin, address(0), 0, 1, 0, 1);

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.InsufficientConfiguredPrizes.selector, 2));
        vm.prank(PLAYER);
        twoSymbolSlot.startSpin();
    }

    function testConfigurationCannotExceedOneThousandBuckets() public {
        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.ProbabilityTotalExceeded.selector, 1_001));
        slot.setNoWinWeight(102);
    }

    function testNoWinWeightCanBeChangedButTableMustBeCompletedAgain() public {
        slot.setNoWinWeight(100);
        assertEq(slot.totalOutcomeWeight(), 999);

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.IncompletePaytable.selector, 999, uint256(1_000)));
        vm.prank(PLAYER);
        slot.startSpin();

        slot.configurePrize(1, DigitalSlotMachine.PrizeKind.ERC1155, address(prize1155), ERC1155_TOKEN_ID, 1, 0, 395);
        assertEq(slot.totalOutcomeWeight(), 1_000);
    }

    function testDividendIsExactlyHalfTheFiveMatchAmount() public view {
        assertEq(slot.payoutAmount(0, 3), ERC20_PRIZE_AMOUNT / 2);
        assertEq(slot.payoutAmount(0, 5), ERC20_PRIZE_AMOUNT);
        assertEq(slot.payoutAmount(1, 3), 1);
        assertEq(slot.payoutAmount(1, 5), 1);
    }

    function testOddERC20DividendAmountIsRejected() public {
        slot.configurePrize(1, DigitalSlotMachine.PrizeKind.None, address(0), 0, 0, 0, 0);

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.InvalidDividendAmount.selector, 2, 3));
        slot.configurePrize(2, DigitalSlotMachine.PrizeKind.ERC20, address(prizeToken), 0, 3, 1, 0);
    }

    function testUSDCIsRejectedAsPrize() public {
        slot.configurePrize(1, DigitalSlotMachine.PrizeKind.None, address(0), 0, 0, 0, 0);

        vm.expectRevert(DigitalSlotMachine.PaymentTokenCannotBePrize.selector);
        slot.configurePrize(2, DigitalSlotMachine.PrizeKind.ERC20, address(usdc), 0, 2, 1, 0);
    }

    function testCatalogCanBeReadInOneCall() public view {
        (uint8[] memory symbols, DigitalSlotMachine.Prize[] memory prizes) = slot.getPrizeCatalog();
        assertEq(symbols.length, 3);
        assertEq(prizes.length, 3);
        assertEq(symbols[0], 0);
        assertEq(symbols[1], 1);
        assertEq(symbols[2], 2);
        assertEq(uint8(prizes[0].kind), uint8(DigitalSlotMachine.PrizeKind.ERC20));
        assertEq(prizes[0].threeMatchWeight, 404);
        assertEq(prizes[1].fiveMatchWeight, 394);
    }

    function testConfirmedPaylineShapes() public view {
        uint8[5] memory line0 = slot.getPayline(0);
        uint8[5] memory line1 = slot.getPayline(1);
        uint8[5] memory line2 = slot.getPayline(2);

        uint8[5] memory expectedLine0 = [uint8(5), 6, 7, 8, 9];
        uint8[5] memory expectedLine1 = [uint8(0), 1, 7, 13, 14];
        uint8[5] memory expectedLine2 = [uint8(10), 11, 7, 3, 4];
        for (uint8 position = 0; position < 5; ++position) {
            assertEq(line0[position], expectedLine0[position]);
            assertEq(line1[position], expectedLine1[position]);
            assertEq(line2[position], expectedLine2[position]);
        }
    }

    function testThreeMatchCanAppearOnEveryPaylineWithoutExtraWins() public {
        for (uint8 expectedLine = 0; expectedLine < 3; ++expectedLine) {
            uint256 gameId = _startSpin(slot, PLAYER);
            _setBlockHashForOutcome(slot, gameId, 0, 3, expectedLine);

            (uint8[15] memory result, uint8 symbol, uint8 matchCount, uint8 winningLine) =
                slot.previewPendingResult(gameId);
            assertEq(symbol, 0);
            assertEq(matchCount, 3);
            assertEq(winningLine, expectedLine);
            _assertColumnUniqueness(result);

            uint8[5] memory cells = slot.getPayline(expectedLine);
            assertEq(result[cells[0]], 0);
            assertEq(result[cells[1]], 0);
            assertEq(result[cells[2]], 0);
            assertNotEq(result[cells[3]], 0);
            assertNotEq(result[cells[4]], 0);

            (uint8 evaluatedSymbol, uint8 threeMask, uint8 fiveMask) = slot.evaluateResult(result);
            assertEq(evaluatedSymbol, 0);
            assertEq(threeMask, uint8(1 << expectedLine));
            assertEq(fiveMask, 0);

            slot.revealRound(gameId);
        }
    }

    function testFiveMatchCanAppearOnEveryPaylineWithoutExtraWins() public {
        for (uint8 expectedLine = 0; expectedLine < 3; ++expectedLine) {
            uint256 gameId = _startSpin(slot, PLAYER);
            _setBlockHashForOutcome(slot, gameId, 1, 5, expectedLine);

            (uint8[15] memory result, uint8 symbol, uint8 matchCount, uint8 winningLine) =
                slot.previewPendingResult(gameId);
            assertEq(symbol, 1);
            assertEq(matchCount, 5);
            assertEq(winningLine, expectedLine);
            _assertColumnUniqueness(result);

            uint8[5] memory cells = slot.getPayline(expectedLine);
            for (uint8 position = 0; position < 5; ++position) {
                assertEq(result[cells[position]], 1);
            }

            (uint8 evaluatedSymbol, uint8 threeMask, uint8 fiveMask) = slot.evaluateResult(result);
            assertEq(evaluatedSymbol, 1);
            assertEq(threeMask, 0);
            assertEq(fiveMask, uint8(1 << expectedLine));

            slot.revealRound(gameId);
        }
    }

    function testNoWinGridContainsNoAccidentalWinningLine() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        _setBlockHashForOutcome(slot, gameId, slot.NO_WIN(), 0, slot.NO_LINE());

        (uint8[15] memory result, uint8 symbol, uint8 matchCount, uint8 winningLine) = slot.previewPendingResult(gameId);
        assertEq(symbol, slot.NO_WIN());
        assertEq(matchCount, 0);
        assertEq(winningLine, slot.NO_LINE());
        _assertColumnUniqueness(result);

        (uint8 evaluatedSymbol, uint8 threeMask, uint8 fiveMask) = slot.evaluateResult(result);
        assertEq(evaluatedSymbol, slot.NO_WIN());
        assertEq(threeMask, 0);
        assertEq(fiveMask, 0);
    }

    function testEveryGeneratedColumnContainsThreeDifferentSymbols() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        DigitalSlotMachine.Game memory game = slot.getGame(gameId);
        vm.roll(uint256(game.targetBlock) + 1);

        for (uint256 candidate = 1; candidate <= 100; ++candidate) {
            vm.setBlockhash(game.targetBlock, bytes32(candidate));
            (uint8[15] memory result,,,) = slot.previewPendingResult(gameId);
            _assertColumnUniqueness(result);
        }
    }

    function testERC20DividendIsPaidImmediately() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        _setBlockHashForOutcome(slot, gameId, 0, 3, 0);

        uint256 balanceBefore = prizeToken.balanceOf(PLAYER);
        slot.revealRound(gameId);

        DigitalSlotMachine.Game memory game = slot.getGame(gameId);
        assertTrue(game.won);
        assertEq(game.matchCount, 3);
        assertEq(prizeToken.balanceOf(PLAYER), balanceBefore + ERC20_PRIZE_AMOUNT / 2);
    }

    function testERC20FiveMatchIsPaidInFull() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        _setBlockHashForOutcome(slot, gameId, 0, 5, 1);

        uint256 balanceBefore = prizeToken.balanceOf(PLAYER);
        slot.revealRound(gameId);

        assertEq(prizeToken.balanceOf(PLAYER), balanceBefore + ERC20_PRIZE_AMOUNT);
    }

    function testERC1155PrizeIsPaidImmediately() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        _setBlockHashForOutcome(slot, gameId, 1, 5, 2);

        uint256 balanceBefore = prize1155.balanceOf(PLAYER, ERC1155_TOKEN_ID);
        slot.revealRound(gameId);

        assertEq(prize1155.balanceOf(PLAYER, ERC1155_TOKEN_ID), balanceBefore + 1);
    }

    function testWinningFreeSpinIncrementsTheOnchainCounter() public {
        DigitalSlotMachine freePrizeSlot = new DigitalSlotMachine(address(this), address(this), usdc, TICKET_PRICE);
        freePrizeSlot.configurePrize(0, DigitalSlotMachine.PrizeKind.FreeSpin, address(0), 0, 1, 0, 500);
        freePrizeSlot.configurePrize(
            1, DigitalSlotMachine.PrizeKind.ERC1155, address(prize1155), ERC1155_TOKEN_ID, 1, 0, 398
        );
        freePrizeSlot.configurePrize(2, DigitalSlotMachine.PrizeKind.FreeSpin, address(0), 0, 1, 0, 1);
        prize1155.mint(address(freePrizeSlot), ERC1155_TOKEN_ID, 10);
        _approvePayment(freePrizeSlot, PLAYER);

        uint256 gameId = _startSpin(freePrizeSlot, PLAYER);
        _setBlockHashForOutcome(freePrizeSlot, gameId, 0, 5, 0);
        freePrizeSlot.revealRound(gameId);

        assertEq(freePrizeSlot.freeSpins(PLAYER), 1);
    }

    function testAnyoneCanRevealButPrizeAlwaysGoesToPlayer() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        _setBlockHashForOutcome(slot, gameId, 0, 5, 0);

        uint256 playerBalanceBefore = prizeToken.balanceOf(PLAYER);
        uint256 callerBalanceBefore = prizeToken.balanceOf(OTHER_PLAYER);
        vm.prank(OTHER_PLAYER);
        slot.revealRound(gameId);

        assertEq(prizeToken.balanceOf(PLAYER), playerBalanceBefore + ERC20_PRIZE_AMOUNT);
        assertEq(prizeToken.balanceOf(OTHER_PLAYER), callerBalanceBefore);
    }

    function testAdminCanAssignAndConsumeFreeSpinWithoutChargingPlayer() public {
        slot.setFreeSpins(FREE_PLAYER, 2);
        uint256 playerBalanceBefore = usdc.balanceOf(FREE_PLAYER);

        uint256 gameId = slot.startFreeSpin(FREE_PLAYER);

        DigitalSlotMachine.Game memory game = slot.getGame(gameId);
        assertEq(game.player, FREE_PLAYER);
        assertTrue(game.freeSpin);
        assertTrue(game.pending);
        assertEq(slot.freeSpins(FREE_PLAYER), 1);
        assertEq(usdc.balanceOf(FREE_PLAYER), playerBalanceBefore);
        assertEq(usdc.balanceOf(address(slot)), 0);
    }

    function testDelegatedManagerCanAssignAndStartFreeSpin() public {
        slot.grantRole(slot.GAME_MANAGER_ROLE(), OPERATOR);

        vm.startPrank(OPERATOR);
        slot.setFreeSpins(FREE_PLAYER, 1);
        uint256 gameId = slot.startFreeSpin(FREE_PLAYER);
        vm.stopPrank();

        assertEq(slot.getGame(gameId).player, FREE_PLAYER);
        assertEq(slot.freeSpins(FREE_PLAYER), 0);
    }

    function testFreeSpinRequiresAssignedCredit() public {
        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.NoFreeSpins.selector, FREE_PLAYER));
        slot.startFreeSpin(FREE_PLAYER);
    }

    function testPauseBlocksNewSpinsButDoesNotBlockReveal() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        slot.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(OTHER_PLAYER);
        slot.startSpin();

        _setBlockHashForOutcome(slot, gameId, slot.NO_WIN(), 0, slot.NO_LINE());
        vm.prank(OTHER_PLAYER);
        slot.revealRound(gameId);

        assertEq(slot.activeRoundCount(), 0);
    }

    function testGameStatusCoversCompleteLifecycle() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        assertEq(uint8(slot.getGameStatus(gameId)), uint8(DigitalSlotMachine.GameStatus.WaitingForTarget));

        _setBlockHashForOutcome(slot, gameId, 1, 5, 0);
        assertEq(uint8(slot.getGameStatus(gameId)), uint8(DigitalSlotMachine.GameStatus.Revealable));

        slot.revealRound(gameId);
        assertEq(uint8(slot.getGameStatus(gameId)), uint8(DigitalSlotMachine.GameStatus.Won));

        uint256 losingGameId = _startSpin(slot, PLAYER);
        _setBlockHashForOutcome(slot, losingGameId, slot.NO_WIN(), 0, slot.NO_LINE());
        slot.revealRound(losingGameId);
        assertEq(uint8(slot.getGameStatus(losingGameId)), uint8(DigitalSlotMachine.GameStatus.Lost));
    }

    function testExpiredRoundBecomesInvalidAndKeepsTicket() public {
        uint256 gameId = _startSpin(slot, PLAYER);
        DigitalSlotMachine.Game memory pendingGame = slot.getGame(gameId);

        vm.roll(uint256(pendingGame.revealDeadline) + 1);
        assertEq(uint8(slot.getGameStatus(gameId)), uint8(DigitalSlotMachine.GameStatus.Expired));

        vm.prank(OTHER_PLAYER);
        slot.expireRound(gameId);

        DigitalSlotMachine.Game memory expiredGame = slot.getGame(gameId);
        assertTrue(expiredGame.invalidated);
        assertFalse(expiredGame.pending);
        assertEq(uint8(slot.getGameStatus(gameId)), uint8(DigitalSlotMachine.GameStatus.Invalidated));
        assertEq(usdc.balanceOf(address(slot)), TICKET_PRICE);
        assertEq(slot.activeRoundCount(), 0);
        assertEq(slot.activeGameId(PLAYER), 0);
    }

    function testWithdrawRequiresPauseAndExpiredRoundCleanup() public {
        uint256 gameId = _startSpin(slot, PLAYER);

        vm.expectRevert(Pausable.ExpectedPause.selector);
        slot.withdrawERC20(usdc, TREASURY, TICKET_PRICE);

        slot.pause();
        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.ActiveRoundsExist.selector, 1));
        slot.withdrawERC20(usdc, TREASURY, TICKET_PRICE);

        DigitalSlotMachine.Game memory game = slot.getGame(gameId);
        vm.roll(uint256(game.revealDeadline) + 1);
        slot.expireRound(gameId);

        slot.withdrawERC20(usdc, TREASURY, TICKET_PRICE);
        assertEq(usdc.balanceOf(TREASURY), TICKET_PRICE);
    }

    function testInventoryReservationPreventsInsolventConcurrentSpin() public {
        DigitalSlotMachine scarceSlot = new DigitalSlotMachine(address(this), address(this), usdc, TICKET_PRICE);
        scarceSlot.configurePrize(
            0, DigitalSlotMachine.PrizeKind.ERC1155, address(prize1155), ERC1155_TOKEN_ID, 1, 0, 897
        );
        scarceSlot.configurePrize(1, DigitalSlotMachine.PrizeKind.FreeSpin, address(0), 0, 1, 0, 1);
        scarceSlot.configurePrize(2, DigitalSlotMachine.PrizeKind.FreeSpin, address(0), 0, 1, 0, 1);
        prize1155.mint(address(scarceSlot), ERC1155_TOKEN_ID, 1);
        _approvePayment(scarceSlot, PLAYER);
        _approvePayment(scarceSlot, OTHER_PLAYER);

        _startSpin(scarceSlot, PLAYER);

        vm.expectRevert(
            abi.encodeWithSelector(
                DigitalSlotMachine.InsufficientPrizeInventory.selector, address(prize1155), ERC1155_TOKEN_ID, 2, 1
            )
        );
        vm.prank(OTHER_PLAYER);
        scarceSlot.startSpin();
    }

    function testCannotChangeConfigurationWhileRoundIsActive() public {
        _startSpin(slot, PLAYER);

        vm.expectRevert(abi.encodeWithSelector(DigitalSlotMachine.ActiveRoundsExist.selector, 1));
        slot.setTicketPrice(2_000_000);
    }

    function testUnauthorizedAccountCannotConfigureOrSetFreeSpins() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, OTHER_PLAYER, slot.GAME_MANAGER_ROLE()
            )
        );
        vm.prank(OTHER_PLAYER);
        slot.setTicketPrice(2_000_000);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, OTHER_PLAYER, slot.GAME_MANAGER_ROLE()
            )
        );
        vm.prank(OTHER_PLAYER);
        slot.setFreeSpins(FREE_PLAYER, 1);
    }

    function testStartSpinCollectsTicketAndReservesMaximumPrizes() public {
        uint256 startedAt = block.number;
        uint256 gameId = _startSpin(slot, PLAYER);

        DigitalSlotMachine.Game memory game = slot.getGame(gameId);
        assertEq(game.player, PLAYER);
        assertTrue(game.pending);
        assertEq(game.targetBlock, startedAt + slot.revealDelayBlocks());
        assertEq(game.revealDeadline, game.targetBlock + slot.revealWindowBlocks());
        assertEq(slot.activeRoundCount(), 1);
        assertEq(usdc.balanceOf(address(slot)), TICKET_PRICE);
        assertEq(slot.reservedERC20(address(prizeToken)), ERC20_PRIZE_AMOUNT);
        assertEq(slot.reservedERC1155(address(prize1155), ERC1155_TOKEN_ID), 1);
    }

    function _assertOutcome(uint16 roll, uint8 expectedSymbol, uint8 expectedMatchCount) private view {
        (uint8 symbol, uint8 matchCount) = slot.getOutcomeForRoll(roll);
        assertEq(symbol, expectedSymbol);
        assertEq(matchCount, expectedMatchCount);
    }

    function _assertColumnUniqueness(uint8[15] memory result) private pure {
        for (uint8 column = 0; column < 5; ++column) {
            assertNotEq(result[column], result[5 + column]);
            assertNotEq(result[column], result[10 + column]);
            assertNotEq(result[5 + column], result[10 + column]);
        }
    }

    function _approvePayment(DigitalSlotMachine target, address player) private {
        vm.prank(player);
        usdc.approve(address(target), type(uint256).max);
    }

    function _startSpin(DigitalSlotMachine target, address player) private returns (uint256 gameId) {
        vm.prank(player);
        gameId = target.startSpin();
    }

    function _setBlockHashForOutcome(
        DigitalSlotMachine target,
        uint256 gameId,
        uint8 desiredSymbol,
        uint8 desiredMatchCount,
        uint8 desiredLine
    ) private {
        DigitalSlotMachine.Game memory game = target.getGame(gameId);
        vm.roll(uint256(game.targetBlock) + 1);

        for (uint256 candidate = 1; candidate < 50_000; ++candidate) {
            vm.setBlockhash(game.targetBlock, bytes32(candidate));
            (, uint8 symbol, uint8 matchCount, uint8 winningLine) = target.previewPendingResult(gameId);
            if (symbol == desiredSymbol && matchCount == desiredMatchCount && winningLine == desiredLine) return;
        }

        fail("no block hash found for requested outcome");
    }
}
