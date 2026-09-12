// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Digital Slot Machine
/// @notice A 5x3 slot game paid in one ERC-20 token, with ERC-20, ERC-1155, and free-spin prizes.
/// @dev Randomness is derived from a future block hash. This is not safe against a block producer or
///      sequencer willing to manipulate the target block. Use only with an explicitly accepted value-at-risk.
contract DigitalSlotMachine is AccessControlDefaultAdminRules, ERC1155Holder, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum PrizeKind {
        None,
        ERC20,
        ERC1155,
        FreeSpin
    }

    enum GameStatus {
        WaitingForTarget,
        Revealable,
        Expired,
        Won,
        Lost,
        Invalidated
    }

    struct Prize {
        PrizeKind kind;
        address token;
        uint256 tokenId;
        uint256 fiveMatchAmount;
        uint16 threeMatchWeight;
        uint16 fiveMatchWeight;
    }

    struct Game {
        address player;
        uint64 targetBlock;
        uint64 revealDeadline;
        uint8 winningSymbol;
        uint8 matchCount;
        uint8 winningLine;
        bool hasResult;
        bool pending;
        bool won;
        bool invalidated;
        bool freeSpin;
        uint64 catalogVersion;
        bytes32 commitment;
        uint8[15] symbols;
    }

    struct ContractSettings {
        address paymentToken;
        uint256 ticketPrice;
        uint64 revealDelayBlocks;
        uint64 revealWindowBlocks;
        uint16 noWinWeight;
        uint32 totalOutcomeWeight;
        uint64 catalogVersion;
        uint8 configuredPrizeCount;
        bool paused;
        uint256 activeRoundCount;
        uint256 nextGameId;
    }

    uint8 public constant COLUMN_COUNT = 5;
    uint8 public constant ROW_COUNT = 3;
    uint8 public constant CELL_COUNT = 15;
    uint8 public constant PAYLINE_COUNT = 3;
    uint8 public constant MAX_SYMBOLS = 16;
    uint8 public constant THREE_MATCH = 3;
    uint8 public constant FIVE_MATCH = 5;
    uint8 public constant NO_WIN = type(uint8).max;
    uint8 public constant NO_LINE = type(uint8).max;

    /// @dev One unit is 0.1%. The configured paytable must total exactly 1,000 before a spin can start.
    uint16 public constant PROBABILITY_DENOMINATOR = 1_000;
    uint16 public constant DEFAULT_NO_WIN_WEIGHT = 101;

    uint64 public constant DEFAULT_REVEAL_DELAY_BLOCKS = 5;
    uint64 public constant DEFAULT_REVEAL_WINDOW_BLOCKS = 256;
    uint64 public constant MAX_REVEAL_WINDOW_BLOCKS = 256;
    uint16 public constant MAX_ACTIVE_GAMES_PAGE_SIZE = 100;
    uint48 public constant OWNER_TRANSFER_DELAY = 2 days;
    uint256 public constant WELCOME_FREE_SPINS = 2;

    bytes32 public constant GAME_MANAGER_ROLE = keccak256("GAME_MANAGER_ROLE");
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC20 public immutable paymentToken;

    uint256 public ticketPrice;
    uint256 public nextGameId = 1;
    uint256 public activeRoundCount;
    uint32 public totalOutcomeWeight = DEFAULT_NO_WIN_WEIGHT;
    uint64 public catalogVersion;
    uint64 public revealDelayBlocks = DEFAULT_REVEAL_DELAY_BLOCKS;
    uint64 public revealWindowBlocks = DEFAULT_REVEAL_WINDOW_BLOCKS;
    uint16 public noWinWeight = DEFAULT_NO_WIN_WEIGHT;
    uint8 public configuredPrizeCount;

    mapping(uint256 gameId => Game game) private _games;
    mapping(uint8 symbol => Prize prize) private _prizes;
    mapping(address player => uint256 count) public freeSpins;
    mapping(address player => bool granted) public welcomeFreeSpinsGranted;
    mapping(address player => uint256 gameId) public activeGameId;

    uint256[] private _activeGameIds;
    mapping(uint256 gameId => uint256 indexPlusOne) private _activeGameIndex;

    mapping(address token => uint256 amount) public reservedERC20;
    mapping(address token => mapping(uint256 tokenId => uint256 amount)) public reservedERC1155;

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
    event RoundExpired(uint256 indexed gameId, address indexed player);
    event PrizePaid(
        uint256 indexed gameId,
        address indexed recipient,
        uint8 indexed symbol,
        PrizeKind kind,
        address token,
        uint256 tokenId,
        uint256 amount
    );
    event FreeSpinsAwarded(uint256 indexed gameId, address indexed player, uint256 amount, uint256 newBalance);
    event PrizeConfigured(
        uint8 indexed symbol,
        PrizeKind kind,
        address indexed token,
        uint256 tokenId,
        uint256 fiveMatchAmount,
        uint16 threeMatchWeight,
        uint16 fiveMatchWeight,
        uint64 catalogVersion
    );
    event NoWinWeightUpdated(uint16 oldWeight, uint16 newWeight, uint64 catalogVersion);
    event TicketPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event RevealSettingsUpdated(
        uint64 oldDelayBlocks, uint64 newDelayBlocks, uint64 oldWindowBlocks, uint64 newWindowBlocks
    );
    event ERC20Withdrawn(address indexed token, address indexed recipient, uint256 amount);
    event ERC1155Withdrawn(address indexed token, uint256 indexed tokenId, address indexed recipient, uint256 amount);
    event NativeWithdrawn(address indexed recipient, uint256 amount);
    event FreeSpinsSet(address indexed player, uint256 oldCount, uint256 newCount);
    event FreeSpinsGranted(address indexed player, uint256 amount, uint256 newCount);
    event WelcomeFreeSpinsGranted(address indexed player, uint256 amount, uint256 newCount);
    event FreeSpinConsumed(uint256 indexed gameId, address indexed player, uint256 remainingCount);

    error ZeroAddress();
    error WelcomeFreeSpinsAlreadyGranted(address player);
    error InvalidPrice();
    error InvalidRevealDelay(uint64 delayBlocks);
    error InvalidRevealWindow(uint64 windowBlocks, uint64 maximumWindowBlocks);
    error InvalidPageSize(uint256 pageSize, uint256 maximumPageSize);
    error InvalidSymbol(uint8 symbol);
    error InvalidPayline(uint8 line);
    error InvalidMatchCount(uint8 matchCount);
    error InvalidProbabilityRoll(uint16 roll);
    error InvalidDisabledPrize(uint8 symbol);
    error InvalidFreeSpinConfiguration(uint8 symbol);
    error InvalidPrizeToken(uint8 symbol, address token);
    error InvalidPrizeTokenId(uint8 symbol, uint256 tokenId);
    error InvalidPrizeAmount(uint8 symbol, uint256 amount);
    error InvalidPrizeWeights(uint8 symbol, uint16 threeMatchWeight, uint16 fiveMatchWeight);
    error InvalidDividendAmount(uint8 symbol, uint256 fiveMatchAmount);
    error PaymentTokenCannotBePrize();
    error ProbabilityTotalExceeded(uint256 total);
    error IncompletePaytable(uint256 currentTotal, uint256 requiredTotal);
    error InsufficientConfiguredPrizes(uint256 count);
    error PrizeNotConfigured(uint8 symbol);
    error GameNotFound(uint256 gameId);
    error PlayerAlreadyHasActiveGame(address player, uint256 gameId);
    error NoPendingRound(uint256 gameId);
    error RevealTooEarly(uint256 currentBlock, uint256 firstValidBlock);
    error RevealWindowExpired(uint256 currentBlock, uint256 deadline);
    error RevealWindowStillOpen(uint256 currentBlock, uint256 deadline);
    error ActiveRoundsExist(uint256 count);
    error InsufficientPrizeInventory(address token, uint256 tokenId, uint256 required, uint256 available);
    error NativeTransferFailed();
    error NoFreeSpins(address player);
    error InvalidFreeSpinAmount();

    modifier onlyOwnerOrRole(bytes32 role) {
        if (msg.sender != owner()) {
            _checkRole(role, msg.sender);
        }
        _;
    }

    modifier noActiveRounds() {
        if (activeRoundCount != 0) revert ActiveRoundsExist(activeRoundCount);
        _;
    }

    constructor(address initialOwner, IERC20 paymentToken_, uint256 ticketPrice_)
        AccessControlDefaultAdminRules(OWNER_TRANSFER_DELAY, initialOwner)
    {
        if (address(paymentToken_) == address(0)) revert ZeroAddress();
        if (ticketPrice_ == 0) revert InvalidPrice();

        paymentToken = paymentToken_;
        ticketPrice = ticketPrice_;
    }

    /// @notice Pays for a new spin and locks its future target block.
    function startSpin() external whenNotPaused nonReentrant returns (uint256 gameId) {
        return _startSpin(msg.sender, false);
    }

    /// @notice Starts a previously assigned free spin for `player`; only an owner or game manager can call it.
    function startFreeSpin(address player)
        external
        onlyOwnerOrRole(GAME_MANAGER_ROLE)
        whenNotPaused
        nonReentrant
        returns (uint256 gameId)
    {
        if (player == address(0)) revert ZeroAddress();
        uint256 count = freeSpins[player];
        if (count == 0) revert NoFreeSpins(player);

        freeSpins[player] = count - 1;
        gameId = _startSpin(player, true);

        emit FreeSpinConsumed(gameId, player, count - 1);
    }

    /// @notice Reveals a pending round. Anyone may call; a prize always goes to the stored player.
    function revealRound(uint256 gameId) external nonReentrant {
        Game storage game = _game(gameId);
        if (!game.pending) revert NoPendingRound(gameId);

        (uint8[15] memory result, uint8 winningSymbol, uint8 matchCount, uint8 winningLine) = _preview(game);

        game.symbols = result;
        game.hasResult = true;
        game.pending = false;
        game.winningSymbol = winningSymbol;
        game.matchCount = matchCount;
        game.winningLine = winningLine;
        game.won = matchCount != 0;

        _releaseAllPrizes();
        _removeActiveGame(gameId, game.player);

        emit RoundRevealed(gameId, game.player, winningSymbol, matchCount, winningLine, result);

        if (matchCount != 0) {
            _payPrize(gameId, game.player, winningSymbol, matchCount);
        }
    }

    /// @notice Clears a round after its block-hash reveal window has elapsed.
    /// @dev The paid ticket remains in the contract and the game becomes invalid.
    function expireRound(uint256 gameId) external nonReentrant {
        Game storage game = _game(gameId);
        if (!game.pending) revert NoPendingRound(gameId);
        if (block.number <= game.revealDeadline) {
            revert RevealWindowStillOpen(block.number, game.revealDeadline);
        }

        game.pending = false;
        game.invalidated = true;

        _releaseAllPrizes();
        _removeActiveGame(gameId, game.player);

        emit RoundExpired(gameId, game.player);
    }

    /// @notice Returns the exact result a currently revealable round will produce.
    /// @dev Previewing cannot change the result because the ticket has already been paid.
    function previewPendingResult(uint256 gameId)
        external
        view
        returns (uint8[15] memory result, uint8 winningSymbol, uint8 matchCount, uint8 winningLine)
    {
        Game storage game = _game(gameId);
        if (!game.pending) revert NoPendingRound(gameId);
        return _preview(game);
    }

    function getGame(uint256 gameId) external view returns (Game memory game) {
        return _game(gameId);
    }

    /// @notice Returns the user-facing state needed before starting or resuming a game.
    function getPlayerState(address player)
        external
        view
        returns (uint256 freeSpinBalance, uint256 currentGameId, bool hasActiveGame)
    {
        freeSpinBalance = freeSpins[player];
        currentGameId = activeGameId[player];
        hasActiveGame = currentGameId != 0;
    }

    /// @notice Returns the principal operational settings in one frontend call.
    function getContractSettings() external view returns (ContractSettings memory settings) {
        settings = ContractSettings({
            paymentToken: address(paymentToken),
            ticketPrice: ticketPrice,
            revealDelayBlocks: revealDelayBlocks,
            revealWindowBlocks: revealWindowBlocks,
            noWinWeight: noWinWeight,
            totalOutcomeWeight: totalOutcomeWeight,
            catalogVersion: catalogVersion,
            configuredPrizeCount: configuredPrizeCount,
            paused: paused(),
            activeRoundCount: activeRoundCount,
            nextGameId: nextGameId
        });
    }

    /// @notice Returns a bounded page of pending game IDs for admin dashboards and keepers.
    function getActiveGameIds(uint256 offset, uint256 pageSize)
        external
        view
        returns (uint256[] memory gameIds, uint256 total)
    {
        if (pageSize == 0 || pageSize > MAX_ACTIVE_GAMES_PAGE_SIZE) {
            revert InvalidPageSize(pageSize, MAX_ACTIVE_GAMES_PAGE_SIZE);
        }

        total = _activeGameIds.length;
        if (offset >= total) return (new uint256[](0), total);

        uint256 end = offset + pageSize;
        if (end > total) end = total;
        gameIds = new uint256[](end - offset);
        for (uint256 index = offset; index < end; ++index) {
            gameIds[index - offset] = _activeGameIds[index];
        }
    }

    function getGameStatus(uint256 gameId) external view returns (GameStatus status) {
        Game storage game = _game(gameId);
        if (game.invalidated) return GameStatus.Invalidated;
        if (game.pending) {
            if (block.number <= game.targetBlock) return GameStatus.WaitingForTarget;
            if (block.number <= game.revealDeadline && blockhash(game.targetBlock) != bytes32(0)) {
                return GameStatus.Revealable;
            }
            return GameStatus.Expired;
        }
        if (game.won) return GameStatus.Won;
        return GameStatus.Lost;
    }

    function getPrize(uint8 symbol) external view returns (Prize memory prize) {
        if (symbol >= MAX_SYMBOLS) revert InvalidSymbol(symbol);
        return _prizes[symbol];
    }

    /// @notice Returns total, reserved, and currently withdrawable ERC-20 inventory.
    function getERC20Inventory(IERC20 token)
        external
        view
        returns (uint256 balance, uint256 reserved, uint256 available)
    {
        balance = token.balanceOf(address(this));
        reserved = reservedERC20[address(token)];
        if (balance > reserved) available = balance - reserved;
    }

    /// @notice Returns total, reserved, and currently withdrawable ERC-1155 inventory.
    function getERC1155Inventory(IERC1155 token, uint256 tokenId)
        external
        view
        returns (uint256 balance, uint256 reserved, uint256 available)
    {
        balance = token.balanceOf(address(this), tokenId);
        reserved = reservedERC1155[address(token)][tokenId];
        if (balance > reserved) available = balance - reserved;
    }

    /// @notice Returns every configured symbol and its complete paytable entry in one call.
    function getPrizeCatalog() external view returns (uint8[] memory symbols, Prize[] memory prizes) {
        uint256 count = configuredPrizeCount;
        symbols = new uint8[](count);
        prizes = new Prize[](count);

        uint256 outputIndex;
        for (uint8 symbol = 0; symbol < MAX_SYMBOLS; ++symbol) {
            Prize storage prize = _prizes[symbol];
            if (prize.kind == PrizeKind.None) continue;
            symbols[outputIndex] = symbol;
            prizes[outputIndex] = prize;
            ++outputIndex;
        }
    }

    /// @notice Returns the five row-major cell indexes used by one of the three paylines.
    function getPayline(uint8 line) public pure returns (uint8[5] memory cells) {
        if (line == 0) return [uint8(5), 6, 7, 8, 9];
        if (line == 1) return [uint8(0), 1, 7, 13, 14];
        if (line == 2) return [uint8(10), 11, 7, 3, 4];
        revert InvalidPayline(line);
    }

    /// @notice Classifies every 3/5 and 5/5 line in a supplied 5x3 result.
    function evaluateResult(uint8[15] calldata result)
        external
        view
        returns (uint8 winningSymbol, uint8 threeMatchLineMask, uint8 fiveMatchLineMask)
    {
        winningSymbol = result[7];
        if (winningSymbol >= MAX_SYMBOLS || _prizes[winningSymbol].kind == PrizeKind.None) {
            return (NO_WIN, 0, 0);
        }

        for (uint8 line = 0; line < PAYLINE_COUNT; ++line) {
            uint8[5] memory cells = getPayline(line);
            if (!_firstThreeMatch(result, cells, winningSymbol)) continue;

            if (result[cells[3]] == winningSymbol && result[cells[4]] == winningSymbol) {
                fiveMatchLineMask |= uint8(1 << line);
            } else {
                threeMatchLineMask |= uint8(1 << line);
            }
        }

        if (threeMatchLineMask == 0 && fiveMatchLineMask == 0) winningSymbol = NO_WIN;
    }

    /// @notice Resolves one of the 1,000 paytable buckets. Useful for auditing exact configured probabilities.
    function getOutcomeForRoll(uint16 roll) external view returns (uint8 winningSymbol, uint8 matchCount) {
        if (roll >= PROBABILITY_DENOMINATOR) revert InvalidProbabilityRoll(roll);
        _requireCompletePaytable();
        return _outcomeForRoll(roll);
    }

    /// @notice Returns the amount paid by a symbol at the requested match level.
    function payoutAmount(uint8 symbol, uint8 matchCount) external view returns (uint256 amount) {
        if (symbol >= MAX_SYMBOLS) revert InvalidSymbol(symbol);
        Prize storage prize = _prizes[symbol];
        if (prize.kind == PrizeKind.None) revert PrizeNotConfigured(symbol);
        return _payoutAmount(prize, matchCount);
    }

    /// @notice Replaces the number of free spins assigned to a player.
    function setFreeSpins(address player, uint256 count) external onlyOwnerOrRole(GAME_MANAGER_ROLE) {
        if (player == address(0)) revert ZeroAddress();
        uint256 oldCount = freeSpins[player];
        freeSpins[player] = count;
        emit FreeSpinsSet(player, oldCount, count);
    }

    /// @notice Adds promotional credits without overwriting free spins already owned or won by the player.
    function grantFreeSpins(address player, uint256 amount) external onlyOwnerOrRole(GAME_MANAGER_ROLE) {
        if (player == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidFreeSpinAmount();
        uint256 newCount = freeSpins[player] + amount;
        freeSpins[player] = newCount;
        emit FreeSpinsGranted(player, amount, newCount);
    }

    /// @notice Grants exactly two welcome credits once per player, without replacing existing credits.
    /// @dev The trusted backend verifies account eligibility. The contract prevents repeat grants,
    ///      even after the player spends their credits or an operator changes their balance.
    function grantWelcomeFreeSpins(address player) external onlyOwnerOrRole(GAME_MANAGER_ROLE) {
        if (player == address(0)) revert ZeroAddress();
        if (welcomeFreeSpinsGranted[player]) revert WelcomeFreeSpinsAlreadyGranted(player);
        welcomeFreeSpinsGranted[player] = true;
        uint256 newCount = freeSpins[player] + WELCOME_FREE_SPINS;
        freeSpins[player] = newCount;
        emit FreeSpinsGranted(player, WELCOME_FREE_SPINS, newCount);
        emit WelcomeFreeSpinsGranted(player, WELCOME_FREE_SPINS, newCount);
    }

    /// @notice Configures one symbol's 3/5 and 5/5 probabilities and associated prize.
    /// @dev ERC-20 3/5 outcomes are dividends and pay half `fiveMatchAmount`. Other kinds pay the full amount.
    function configurePrize(
        uint8 symbol,
        PrizeKind kind,
        address token,
        uint256 tokenId,
        uint256 fiveMatchAmount,
        uint16 threeMatchWeight,
        uint16 fiveMatchWeight
    ) external onlyOwnerOrRole(GAME_MANAGER_ROLE) noActiveRounds {
        if (symbol >= MAX_SYMBOLS) revert InvalidSymbol(symbol);
        Prize memory configuredPrize = Prize({
            kind: kind,
            token: token,
            tokenId: tokenId,
            fiveMatchAmount: fiveMatchAmount,
            threeMatchWeight: threeMatchWeight,
            fiveMatchWeight: fiveMatchWeight
        });
        _validatePrizeConfiguration(symbol, configuredPrize);
        _configurePrize(symbol, configuredPrize);
    }

    function setNoWinWeight(uint16 newWeight) external onlyOwnerOrRole(GAME_MANAGER_ROLE) noActiveRounds {
        uint256 updatedTotal = uint256(totalOutcomeWeight) - noWinWeight + newWeight;
        if (updatedTotal > PROBABILITY_DENOMINATOR) revert ProbabilityTotalExceeded(updatedTotal);

        uint16 oldWeight = noWinWeight;
        noWinWeight = newWeight;
        totalOutcomeWeight = uint32(updatedTotal);
        uint64 newVersion = ++catalogVersion;
        emit NoWinWeightUpdated(oldWeight, newWeight, newVersion);
    }

    function setTicketPrice(uint256 newPrice) external onlyOwnerOrRole(GAME_MANAGER_ROLE) noActiveRounds {
        if (newPrice == 0) revert InvalidPrice();
        uint256 oldPrice = ticketPrice;
        ticketPrice = newPrice;
        emit TicketPriceUpdated(oldPrice, newPrice);
    }

    /// @notice Changes the future-block delay and reveal window used by subsequently opened games.
    function setRevealSettings(uint64 newDelayBlocks, uint64 newWindowBlocks)
        external
        onlyOwnerOrRole(GAME_MANAGER_ROLE)
        noActiveRounds
    {
        if (newDelayBlocks == 0) revert InvalidRevealDelay(newDelayBlocks);
        if (newWindowBlocks == 0 || newWindowBlocks > MAX_REVEAL_WINDOW_BLOCKS) {
            revert InvalidRevealWindow(newWindowBlocks, MAX_REVEAL_WINDOW_BLOCKS);
        }

        uint64 oldDelayBlocks = revealDelayBlocks;
        uint64 oldWindowBlocks = revealWindowBlocks;
        revealDelayBlocks = newDelayBlocks;
        revealWindowBlocks = newWindowBlocks;
        emit RevealSettingsUpdated(oldDelayBlocks, newDelayBlocks, oldWindowBlocks, newWindowBlocks);
    }

    /// @notice Stops new paid and free spins. Pending reveals and expiry cleanup remain available.
    function pause() external onlyOwnerOrRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyOwnerOrRole(PAUSER_ROLE) {
        _unpause();
    }

    function withdrawERC20(IERC20 token, address recipient, uint256 amount)
        external
        onlyOwnerOrRole(TREASURER_ROLE)
        whenPaused
        noActiveRounds
        nonReentrant
    {
        if (address(token) == address(0) || recipient == address(0)) revert ZeroAddress();
        token.safeTransfer(recipient, amount);
        emit ERC20Withdrawn(address(token), recipient, amount);
    }

    function withdrawERC1155(IERC1155 token, uint256 tokenId, address recipient, uint256 amount)
        external
        onlyOwnerOrRole(TREASURER_ROLE)
        whenPaused
        noActiveRounds
        nonReentrant
    {
        if (address(token) == address(0) || recipient == address(0)) revert ZeroAddress();
        token.safeTransferFrom(address(this), recipient, tokenId, amount, "");
        emit ERC1155Withdrawn(address(token), tokenId, recipient, amount);
    }

    function withdrawNative(address payable recipient, uint256 amount)
        external
        onlyOwnerOrRole(TREASURER_ROLE)
        whenPaused
        noActiveRounds
        nonReentrant
    {
        if (recipient == address(0)) revert ZeroAddress();
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
        emit NativeWithdrawn(recipient, amount);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControlDefaultAdminRules, ERC1155Holder)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _startSpin(address player, bool isFree) private returns (uint256 gameId) {
        _requireCompletePaytable();
        if (configuredPrizeCount < ROW_COUNT) revert InsufficientConfiguredPrizes(configuredPrizeCount);
        uint256 currentGameId = activeGameId[player];
        if (currentGameId != 0) revert PlayerAlreadyHasActiveGame(player, currentGameId);

        gameId = nextGameId++;
        Game storage game = _games[gameId];
        game.player = player;
        game.winningSymbol = NO_WIN;
        game.winningLine = NO_LINE;
        game.pending = true;
        game.freeSpin = isFree;
        game.catalogVersion = catalogVersion;

        uint64 targetBlock = uint64(block.number + revealDelayBlocks);
        game.targetBlock = targetBlock;
        game.revealDeadline = targetBlock + revealWindowBlocks;
        game.commitment =
            keccak256(abi.encode(block.chainid, address(this), gameId, player, block.number, isFree, catalogVersion));

        if (!isFree) paymentToken.safeTransferFrom(player, address(this), ticketPrice);
        _reserveAllPrizes();
        _addActiveGame(gameId, player);

        emit SpinStarted(
            gameId, player, game.targetBlock, game.revealDeadline, isFree ? 0 : ticketPrice, isFree, game.catalogVersion
        );
    }

    function _preview(Game storage game)
        private
        view
        returns (uint8[15] memory result, uint8 winningSymbol, uint8 matchCount, uint8 winningLine)
    {
        uint256 firstValidBlock = uint256(game.targetBlock) + 1;
        if (block.number < firstValidBlock) revert RevealTooEarly(block.number, firstValidBlock);
        if (block.number > game.revealDeadline) {
            revert RevealWindowExpired(block.number, game.revealDeadline);
        }

        bytes32 targetBlockHash = blockhash(game.targetBlock);
        if (targetBlockHash == bytes32(0)) {
            revert RevealWindowExpired(block.number, game.revealDeadline);
        }

        bytes32 entropy = keccak256(abi.encode(game.commitment, targetBlockHash));
        uint16 roll = uint16(uint256(keccak256(abi.encode(entropy, "OUTCOME"))) % PROBABILITY_DENOMINATOR);
        (winningSymbol, matchCount) = _outcomeForRoll(roll);

        if (matchCount == 0) {
            winningLine = NO_LINE;
        } else {
            winningLine = uint8(uint256(keccak256(abi.encode(entropy, "PAYLINE"))) % PAYLINE_COUNT);
        }

        result = _buildResult(entropy, winningSymbol, matchCount, winningLine);
    }

    function _outcomeForRoll(uint16 roll) private view returns (uint8 winningSymbol, uint8 matchCount) {
        uint256 cursor = noWinWeight;
        if (roll < cursor) return (NO_WIN, 0);

        for (uint8 symbol = 0; symbol < MAX_SYMBOLS; ++symbol) {
            Prize storage prize = _prizes[symbol];
            cursor += prize.threeMatchWeight;
            if (roll < cursor) return (symbol, THREE_MATCH);

            cursor += prize.fiveMatchWeight;
            if (roll < cursor) return (symbol, FIVE_MATCH);
        }

        revert IncompletePaytable(cursor, PROBABILITY_DENOMINATOR);
    }

    function _buildResult(bytes32 entropy, uint8 winningSymbol, uint8 matchCount, uint8 winningLine)
        private
        view
        returns (uint8[15] memory result)
    {
        uint8 excludedSymbol = matchCount == 0 ? NO_WIN : winningSymbol;
        uint8[5] memory winningCells;
        if (matchCount != 0) winningCells = getPayline(winningLine);

        for (uint8 column = 0; column < COLUMN_COUNT; ++column) {
            uint8 winningCell = winningCells[column];
            if (matchCount == THREE_MATCH && column >= THREE_MATCH) {
                uint8 alternateRow = (winningCell / COLUMN_COUNT + 1) % ROW_COUNT;
                winningCell = alternateRow * COLUMN_COUNT + column;
            }

            for (uint8 row = 0; row < ROW_COUNT; ++row) {
                uint8 cell = row * COLUMN_COUNT + column;
                if (matchCount != 0 && cell == winningCell) {
                    result[cell] = winningSymbol;
                } else {
                    result[cell] = _drawColumnSymbol(entropy, cell, column, row, excludedSymbol, result);
                }
            }
        }

        if (matchCount == 0) _preventNoWinLine(result);
    }

    function _drawColumnSymbol(
        bytes32 entropy,
        uint8 cell,
        uint8 column,
        uint8 row,
        uint8 excludedSymbol,
        uint8[15] memory result
    ) private view returns (uint8) {
        uint256 candidateCount;
        for (uint8 symbol = 0; symbol < MAX_SYMBOLS; ++symbol) {
            if (
                _prizes[symbol].kind != PrizeKind.None && symbol != excludedSymbol
                    && !_isUsedInColumn(result, column, row, symbol)
            ) {
                ++candidateCount;
            }
        }

        uint256 selected = uint256(keccak256(abi.encode(entropy, "DISPLAY", cell))) % candidateCount;
        for (uint8 symbol = 0; symbol < MAX_SYMBOLS; ++symbol) {
            if (
                _prizes[symbol].kind == PrizeKind.None || symbol == excludedSymbol
                    || _isUsedInColumn(result, column, row, symbol)
            ) {
                continue;
            }
            if (selected == 0) return symbol;
            --selected;
        }

        revert InsufficientConfiguredPrizes(configuredPrizeCount);
    }

    function _isUsedInColumn(uint8[15] memory result, uint8 column, uint8 populatedRows, uint8 symbol)
        private
        pure
        returns (bool)
    {
        for (uint8 row = 0; row < populatedRows; ++row) {
            if (result[row * COLUMN_COUNT + column] == symbol) return true;
        }
        return false;
    }

    function _preventNoWinLine(uint8[15] memory result) private pure {
        // Column uniqueness means at most one payline can match the center symbol across columns 0, 1, and 2.
        uint8 centerSymbol = result[7];
        for (uint8 line = 0; line < PAYLINE_COUNT; ++line) {
            uint8[5] memory cells = getPayline(line);
            if (!_firstThreeMatch(result, cells, centerSymbol)) continue;

            uint8 firstCell = cells[0];
            uint8 swapCell = firstCell == 10 ? 0 : firstCell + COLUMN_COUNT;
            (result[firstCell], result[swapCell]) = (result[swapCell], result[firstCell]);
            return;
        }
    }

    function _firstThreeMatch(uint8[15] memory result, uint8[5] memory cells, uint8 symbol)
        private
        pure
        returns (bool)
    {
        return result[cells[0]] == symbol && result[cells[1]] == symbol && result[cells[2]] == symbol;
    }

    function _payoutAmount(Prize storage prize, uint8 matchCount) private view returns (uint256) {
        if (matchCount == FIVE_MATCH) return prize.fiveMatchAmount;
        if (matchCount == THREE_MATCH) {
            if (prize.kind == PrizeKind.ERC20) return prize.fiveMatchAmount / 2;
            return prize.fiveMatchAmount;
        }
        revert InvalidMatchCount(matchCount);
    }

    function _maximumPayout(Prize storage prize) private view returns (uint256) {
        if (prize.fiveMatchWeight != 0) return prize.fiveMatchAmount;
        return _payoutAmount(prize, THREE_MATCH);
    }

    function _reserveAllPrizes() private {
        for (uint8 symbol = 0; symbol < MAX_SYMBOLS; ++symbol) {
            Prize storage prize = _prizes[symbol];
            uint256 maximumPayout = _maximumPayout(prize);
            if (prize.kind == PrizeKind.ERC20) {
                uint256 required = reservedERC20[prize.token] + maximumPayout;
                uint256 available = IERC20(prize.token).balanceOf(address(this));
                if (available < required) {
                    revert InsufficientPrizeInventory(prize.token, 0, required, available);
                }
                reservedERC20[prize.token] = required;
            } else if (prize.kind == PrizeKind.ERC1155) {
                uint256 required = reservedERC1155[prize.token][prize.tokenId] + maximumPayout;
                uint256 available = IERC1155(prize.token).balanceOf(address(this), prize.tokenId);
                if (available < required) {
                    revert InsufficientPrizeInventory(prize.token, prize.tokenId, required, available);
                }
                reservedERC1155[prize.token][prize.tokenId] = required;
            }
        }
    }

    function _releaseAllPrizes() private {
        for (uint8 symbol = 0; symbol < MAX_SYMBOLS; ++symbol) {
            Prize storage prize = _prizes[symbol];
            uint256 maximumPayout = _maximumPayout(prize);
            if (prize.kind == PrizeKind.ERC20) {
                reservedERC20[prize.token] -= maximumPayout;
            } else if (prize.kind == PrizeKind.ERC1155) {
                reservedERC1155[prize.token][prize.tokenId] -= maximumPayout;
            }
        }
    }

    function _payPrize(uint256 gameId, address recipient, uint8 symbol, uint8 matchCount) private {
        Prize storage prize = _prizes[symbol];
        uint256 amount = _payoutAmount(prize, matchCount);

        if (prize.kind == PrizeKind.ERC20) {
            IERC20(prize.token).safeTransfer(recipient, amount);
        } else if (prize.kind == PrizeKind.ERC1155) {
            IERC1155(prize.token).safeTransferFrom(address(this), recipient, prize.tokenId, amount, "");
        } else if (prize.kind == PrizeKind.FreeSpin) {
            uint256 newBalance = freeSpins[recipient] + amount;
            freeSpins[recipient] = newBalance;
            emit FreeSpinsAwarded(gameId, recipient, amount, newBalance);
        }

        emit PrizePaid(gameId, recipient, symbol, prize.kind, prize.token, prize.tokenId, amount);
    }

    function _validatePrizeConfiguration(uint8 symbol, Prize memory prize) private view {
        if (prize.kind == PrizeKind.None) {
            if (
                prize.token != address(0) || prize.tokenId != 0 || prize.fiveMatchAmount != 0
                    || prize.threeMatchWeight != 0 || prize.fiveMatchWeight != 0
            ) {
                revert InvalidDisabledPrize(symbol);
            }
            return;
        }

        if (prize.threeMatchWeight == 0 && prize.fiveMatchWeight == 0) {
            revert InvalidPrizeWeights(symbol, prize.threeMatchWeight, prize.fiveMatchWeight);
        }
        if (prize.fiveMatchAmount == 0) revert InvalidPrizeAmount(symbol, prize.fiveMatchAmount);

        if (prize.kind == PrizeKind.FreeSpin) {
            if (prize.token != address(0) || prize.tokenId != 0) revert InvalidFreeSpinConfiguration(symbol);
        } else {
            if (prize.token == address(0) || prize.token.code.length == 0) {
                revert InvalidPrizeToken(symbol, prize.token);
            }
            if (prize.token == address(paymentToken)) revert PaymentTokenCannotBePrize();
            if (prize.kind == PrizeKind.ERC20 && prize.tokenId != 0) {
                revert InvalidPrizeTokenId(symbol, prize.tokenId);
            }
        }

        if (prize.kind == PrizeKind.ERC20 && prize.threeMatchWeight != 0 && prize.fiveMatchAmount % 2 != 0) {
            revert InvalidDividendAmount(symbol, prize.fiveMatchAmount);
        }
    }

    function _configurePrize(uint8 symbol, Prize memory configuredPrize) private {
        Prize storage previousPrize = _prizes[symbol];
        uint256 previousWeight = uint256(previousPrize.threeMatchWeight) + previousPrize.fiveMatchWeight;
        uint256 newWeight = uint256(configuredPrize.threeMatchWeight) + configuredPrize.fiveMatchWeight;
        uint256 updatedTotal = uint256(totalOutcomeWeight) - previousWeight + newWeight;
        if (updatedTotal > PROBABILITY_DENOMINATOR) revert ProbabilityTotalExceeded(updatedTotal);

        bool wasConfigured = previousPrize.kind != PrizeKind.None;
        bool isConfigured = configuredPrize.kind != PrizeKind.None;
        if (!wasConfigured && isConfigured) ++configuredPrizeCount;
        if (wasConfigured && !isConfigured) --configuredPrizeCount;

        totalOutcomeWeight = uint32(updatedTotal);
        uint64 newVersion = ++catalogVersion;
        _prizes[symbol] = configuredPrize;

        emit PrizeConfigured(
            symbol,
            configuredPrize.kind,
            configuredPrize.token,
            configuredPrize.tokenId,
            configuredPrize.fiveMatchAmount,
            configuredPrize.threeMatchWeight,
            configuredPrize.fiveMatchWeight,
            newVersion
        );
    }

    function _addActiveGame(uint256 gameId, address player) private {
        activeGameId[player] = gameId;
        _activeGameIds.push(gameId);
        _activeGameIndex[gameId] = _activeGameIds.length;
        activeRoundCount = _activeGameIds.length;
    }

    function _removeActiveGame(uint256 gameId, address player) private {
        uint256 indexPlusOne = _activeGameIndex[gameId];
        assert(indexPlusOne != 0);

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _activeGameIds.length - 1;
        if (index != lastIndex) {
            uint256 lastGameId = _activeGameIds[lastIndex];
            _activeGameIds[index] = lastGameId;
            _activeGameIndex[lastGameId] = index + 1;
        }

        _activeGameIds.pop();
        delete _activeGameIndex[gameId];
        delete activeGameId[player];
        activeRoundCount = _activeGameIds.length;
    }

    function _requireCompletePaytable() private view {
        if (totalOutcomeWeight != PROBABILITY_DENOMINATOR) {
            revert IncompletePaytable(totalOutcomeWeight, PROBABILITY_DENOMINATOR);
        }
    }

    function _game(uint256 gameId) private view returns (Game storage game) {
        game = _games[gameId];
        if (game.player == address(0)) revert GameNotFound(gameId);
    }
}
