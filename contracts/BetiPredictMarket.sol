// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BetiPredictMarket
 * @dev Decentralized prediction market with CPMM (Constant Product Market Maker).
 *      Users buy/sell YES and NO outcome shares. After resolution, winning shares
 *      redeem 1:1 with the collateral token (USDC). Platform collects fees on trades.
 *
 *      Inspired by Polymarket's design but simplified for MVP.
 *
 * @notice Collateral token should be a stablecoin (USDC, 6 decimals recommended).
 */
contract BetiPredictMarket is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  Constants
    // ──────────────────────────────────────────────
    uint256 public constant SCALE = 1e18;           // internal math precision
    uint256 public constant FEE_DENOMINATOR = 10000; // basis points
    uint256 public constant MIN_LIQUIDITY = 1000;    // minimum initial liquidity (in collateral units)

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────
    IERC20 public immutable collateralToken;
    uint8  public immutable collateralDecimals;

    uint256 public tradingFee = 200;       // 2% fee in basis points
    uint256 public creationFee = 0;        // fee to create a market (in collateral)
    uint256 public platformBalance;        // accumulated fees
    uint256 public marketCount;

    // ──────────────────────────────────────────────
    //  Enums & Structs
    // ──────────────────────────────────────────────
    enum MarketStatus { Active, Resolved, Cancelled }
    enum Outcome { None, Yes, No }

    struct Market {
        uint256 id;
        string  question;
        uint256 resolveTime;
        // CPMM pools
        uint256 yesPool;
        uint256 noPool;
        uint256 totalVolume;
        // Status
        MarketStatus status;
        Outcome resolution;
        // Actors
        address creator;
        address resolver;        // who may resolve (0 = owner only)
        uint256 createdAt;
    }

    // ──────────────────────────────────────────────
    //  Storage
    // ──────────────────────────────────────────────
    mapping(uint256 => Market) public markets;

    // marketId => user => shares
    mapping(uint256 => mapping(address => uint256)) public yesShares;
    mapping(uint256 => mapping(address => uint256)) public noShares;

    // track whether a user already claimed for a resolved market
    mapping(uint256 => mapping(address => bool)) public claimed;

    // authorised resolvers (admin wallets)
    mapping(address => bool) public resolvers;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────
    event MarketCreated(uint256 indexed marketId, string question, uint256 resolveTime, address indexed creator, uint256 initialLiquidity);
    event SharesPurchased(uint256 indexed marketId, address indexed buyer, Outcome outcome, uint256 collateralIn, uint256 sharesOut, uint256 fee);
    event SharesSold(uint256 indexed marketId, address indexed seller, Outcome outcome, uint256 sharesIn, uint256 collateralOut, uint256 fee);
    event MarketResolved(uint256 indexed marketId, Outcome resolution, address indexed resolver);
    event MarketCancelled(uint256 indexed marketId, address indexed canceller);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 payout);
    event RefundClaimed(uint256 indexed marketId, address indexed user, uint256 refund);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event ResolverUpdated(address indexed resolver, bool authorized);
    event TradingFeeUpdated(uint256 oldFee, uint256 newFee);

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────
    modifier onlyActiveMarket(uint256 _id) {
        require(_id > 0 && _id <= marketCount, "Invalid market");
        require(markets[_id].status == MarketStatus.Active, "Market not active");
        require(block.timestamp < markets[_id].resolveTime, "Market expired");
        _;
    }

    modifier onlyResolver(uint256 _id) {
        Market storage m = markets[_id];
        bool isAuthorized = msg.sender == owner() ||
                            resolvers[msg.sender] ||
                            (m.resolver != address(0) && m.resolver == msg.sender);
        require(isAuthorized, "Not authorized to resolve");
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────
    constructor(address _collateralToken, uint8 _decimals) Ownable(msg.sender) {
        require(_collateralToken != address(0), "Invalid token");
        collateralToken = IERC20(_collateralToken);
        collateralDecimals = _decimals;
    }

    // ══════════════════════════════════════════════
    //  MARKET LIFECYCLE
    // ══════════════════════════════════════════════

    /**
     * @notice Create a new prediction market with initial CPMM liquidity.
     * @param _question   The question being predicted (e.g. "Will Zambia beat Nigeria?")
     * @param _resolveTime Unix timestamp when the market can be resolved.
     * @param _initialLiquidity Amount of collateral to seed the pool (split 50/50).
     * @param _resolver   Optional designated resolver address. Use address(0) for owner-only.
     */
    function createMarket(
        string calldata _question,
        uint256 _resolveTime,
        uint256 _initialLiquidity,
        address _resolver
    ) external whenNotPaused nonReentrant returns (uint256) {
        require(bytes(_question).length > 0, "Empty question");
        require(_resolveTime > block.timestamp, "Resolve time must be future");
        require(_initialLiquidity >= MIN_LIQUIDITY, "Liquidity too low");

        uint256 totalCost = _initialLiquidity + creationFee;
        collateralToken.safeTransferFrom(msg.sender, address(this), totalCost);
        platformBalance += creationFee;

        marketCount++;
        uint256 id = marketCount;

        // Initialize CPMM: equal YES and NO pools
        // Each pool gets the full liquidity amount (this represents share supply)
        Market storage m = markets[id];
        m.id = id;
        m.question = _question;
        m.resolveTime = _resolveTime;
        m.yesPool = _initialLiquidity;
        m.noPool = _initialLiquidity;
        m.totalVolume = 0;
        m.status = MarketStatus.Active;
        m.resolution = Outcome.None;
        m.creator = msg.sender;
        m.resolver = _resolver;
        m.createdAt = block.timestamp;

        emit MarketCreated(id, _question, _resolveTime, msg.sender, _initialLiquidity);
        return id;
    }

    // ══════════════════════════════════════════════
    //  TRADING — BUY
    // ══════════════════════════════════════════════

    /**
     * @notice Buy YES shares. Collateral goes into the pool, shares come out.
     * @param _marketId  Market to trade on.
     * @param _amount    Collateral amount to spend (before fee).
     * @param _minShares Minimum shares to receive (slippage protection).
     */
    function buyYes(
        uint256 _marketId,
        uint256 _amount,
        uint256 _minShares
    ) external onlyActiveMarket(_marketId) whenNotPaused nonReentrant returns (uint256 sharesOut) {
        sharesOut = _buy(_marketId, Outcome.Yes, _amount, _minShares);
    }

    /**
     * @notice Buy NO shares.
     */
    function buyNo(
        uint256 _marketId,
        uint256 _amount,
        uint256 _minShares
    ) external onlyActiveMarket(_marketId) whenNotPaused nonReentrant returns (uint256 sharesOut) {
        sharesOut = _buy(_marketId, Outcome.No, _amount, _minShares);
    }

    function _buy(
        uint256 _marketId,
        Outcome _outcome,
        uint256 _amount,
        uint256 _minShares
    ) internal returns (uint256 sharesOut) {
        require(_amount > 0, "Amount must be > 0");

        // Collect fee
        uint256 fee = (_amount * tradingFee) / FEE_DENOMINATOR;
        uint256 netAmount = _amount - fee;

        // Transfer collateral from user
        collateralToken.safeTransferFrom(msg.sender, address(this), _amount);
        platformBalance += fee;

        Market storage m = markets[_marketId];

        // CPMM: constant product formula
        // To buy YES shares: add collateral to noPool, calculate shares from yesPool
        // k = yesPool * noPool (must stay constant)
        if (_outcome == Outcome.Yes) {
            uint256 k = m.yesPool * m.noPool;
            m.noPool += netAmount;
            uint256 newYesPool = k / m.noPool;
            sharesOut = m.yesPool - newYesPool;
            m.yesPool = newYesPool;
            yesShares[_marketId][msg.sender] += sharesOut;
        } else {
            uint256 k = m.yesPool * m.noPool;
            m.yesPool += netAmount;
            uint256 newNoPool = k / m.yesPool;
            sharesOut = m.noPool - newNoPool;
            m.noPool = newNoPool;
            noShares[_marketId][msg.sender] += sharesOut;
        }

        require(sharesOut >= _minShares, "Slippage: insufficient shares");
        m.totalVolume += _amount;

        emit SharesPurchased(_marketId, msg.sender, _outcome, _amount, sharesOut, fee);
    }

    // ══════════════════════════════════════════════
    //  TRADING — SELL
    // ══════════════════════════════════════════════

    /**
     * @notice Sell YES shares back to the pool for collateral.
     * @param _marketId      Market to sell on.
     * @param _shares        Number of shares to sell.
     * @param _minCollateral Minimum collateral to receive (slippage protection).
     */
    function sellYes(
        uint256 _marketId,
        uint256 _shares,
        uint256 _minCollateral
    ) external onlyActiveMarket(_marketId) whenNotPaused nonReentrant returns (uint256 collateralOut) {
        collateralOut = _sell(_marketId, Outcome.Yes, _shares, _minCollateral);
    }

    /**
     * @notice Sell NO shares back to the pool.
     */
    function sellNo(
        uint256 _marketId,
        uint256 _shares,
        uint256 _minCollateral
    ) external onlyActiveMarket(_marketId) whenNotPaused nonReentrant returns (uint256 collateralOut) {
        collateralOut = _sell(_marketId, Outcome.No, _shares, _minCollateral);
    }

    function _sell(
        uint256 _marketId,
        Outcome _outcome,
        uint256 _shares,
        uint256 _minCollateral
    ) internal returns (uint256 collateralOut) {
        require(_shares > 0, "Shares must be > 0");

        Market storage m = markets[_marketId];

        // CPMM: reverse of buy
        if (_outcome == Outcome.Yes) {
            require(yesShares[_marketId][msg.sender] >= _shares, "Insufficient YES shares");
            uint256 k = m.yesPool * m.noPool;
            m.yesPool += _shares;
            uint256 newNoPool = k / m.yesPool;
            collateralOut = m.noPool - newNoPool;
            m.noPool = newNoPool;
            yesShares[_marketId][msg.sender] -= _shares;
        } else {
            require(noShares[_marketId][msg.sender] >= _shares, "Insufficient NO shares");
            uint256 k = m.yesPool * m.noPool;
            m.noPool += _shares;
            uint256 newYesPool = k / m.yesPool;
            collateralOut = m.yesPool - newYesPool;
            m.yesPool = newYesPool;
            noShares[_marketId][msg.sender] -= _shares;
        }

        // Deduct fee
        uint256 fee = (collateralOut * tradingFee) / FEE_DENOMINATOR;
        uint256 netOut = collateralOut - fee;
        platformBalance += fee;

        require(netOut >= _minCollateral, "Slippage: insufficient collateral");

        collateralToken.safeTransfer(msg.sender, netOut);
        m.totalVolume += collateralOut;

        emit SharesSold(_marketId, msg.sender, _outcome, _shares, netOut, fee);
        return netOut;
    }

    // ══════════════════════════════════════════════
    //  RESOLUTION
    // ══════════════════════════════════════════════

    /**
     * @notice Resolve a market. Only callable by owner, authorized resolvers, or
     *         the designated resolver for this market.
     * @param _marketId   Market to resolve.
     * @param _resolution Outcome.Yes or Outcome.No.
     */
    function resolveMarket(
        uint256 _marketId,
        Outcome _resolution
    ) external onlyResolver(_marketId) whenNotPaused {
        require(_marketId > 0 && _marketId <= marketCount, "Invalid market");
        Market storage m = markets[_marketId];
        require(m.status == MarketStatus.Active, "Not active");
        require(_resolution == Outcome.Yes || _resolution == Outcome.No, "Invalid outcome");

        m.status = MarketStatus.Resolved;
        m.resolution = _resolution;

        emit MarketResolved(_marketId, _resolution, msg.sender);
    }

    /**
     * @notice Cancel a market. All users can claim refunds. Only owner or resolver.
     */
    function cancelMarket(uint256 _marketId) external onlyResolver(_marketId) whenNotPaused {
        require(_marketId > 0 && _marketId <= marketCount, "Invalid market");
        Market storage m = markets[_marketId];
        require(m.status == MarketStatus.Active, "Not active");

        m.status = MarketStatus.Cancelled;

        emit MarketCancelled(_marketId, msg.sender);
    }

    // ══════════════════════════════════════════════
    //  CLAIMS
    // ══════════════════════════════════════════════

    /**
     * @notice Claim winnings after a market is resolved.
     *         Winning shares redeem at 1 collateral token per share.
     */
    function claimWinnings(uint256 _marketId) external nonReentrant {
        require(_marketId > 0 && _marketId <= marketCount, "Invalid market");
        Market storage m = markets[_marketId];
        require(m.status == MarketStatus.Resolved, "Not resolved");
        require(!claimed[_marketId][msg.sender], "Already claimed");

        uint256 payout;
        if (m.resolution == Outcome.Yes) {
            payout = yesShares[_marketId][msg.sender];
        } else {
            payout = noShares[_marketId][msg.sender];
        }

        require(payout > 0, "No winning shares");

        claimed[_marketId][msg.sender] = true;
        collateralToken.safeTransfer(msg.sender, payout);

        emit WinningsClaimed(_marketId, msg.sender, payout);
    }

    /**
     * @notice Claim refund for a cancelled market.
     *         Refund proportional to total shares held (YES + NO) vs initial price.
     *         Simplified: refund = shares valued at current CPMM price at cancellation.
     *         For simplicity, we refund the average cost basis: (yesShares + noShares) / 2.
     *         This is fair because both sides were equally priced at creation.
     */
    function claimRefund(uint256 _marketId) external nonReentrant {
        require(_marketId > 0 && _marketId <= marketCount, "Invalid market");
        Market storage m = markets[_marketId];
        require(m.status == MarketStatus.Cancelled, "Not cancelled");
        require(!claimed[_marketId][msg.sender], "Already claimed");

        uint256 yesAmount = yesShares[_marketId][msg.sender];
        uint256 noAmount = noShares[_marketId][msg.sender];
        uint256 totalShares = yesAmount + noAmount;
        require(totalShares > 0, "No shares to refund");

        // Refund: each pair of (1 YES + 1 NO) = 1 collateral
        // Unpaired shares get refunded at 0.5
        uint256 pairs = yesAmount < noAmount ? yesAmount : noAmount;
        uint256 unpaired = totalShares - (pairs * 2);
        uint256 refund = pairs + (unpaired / 2);

        claimed[_marketId][msg.sender] = true;

        if (refund > 0) {
            collateralToken.safeTransfer(msg.sender, refund);
        }

        emit RefundClaimed(_marketId, msg.sender, refund);
    }

    // ══════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ══════════════════════════════════════════════

    /**
     * @notice Get current YES price as a fraction of SCALE (1e18 = 100%).
     *         Price = noPool / (yesPool + noPool)
     */
    function getYesPrice(uint256 _marketId) external view returns (uint256) {
        Market storage m = markets[_marketId];
        if (m.yesPool + m.noPool == 0) return SCALE / 2;
        return (m.noPool * SCALE) / (m.yesPool + m.noPool);
    }

    /**
     * @notice Get current NO price.
     */
    function getNoPrice(uint256 _marketId) external view returns (uint256) {
        Market storage m = markets[_marketId];
        if (m.yesPool + m.noPool == 0) return SCALE / 2;
        return (m.yesPool * SCALE) / (m.yesPool + m.noPool);
    }

    /**
     * @notice Estimate shares out for a given collateral input.
     */
    function estimateBuy(
        uint256 _marketId,
        Outcome _outcome,
        uint256 _amount
    ) external view returns (uint256 sharesOut, uint256 fee) {
        Market storage m = markets[_marketId];
        fee = (_amount * tradingFee) / FEE_DENOMINATOR;
        uint256 netAmount = _amount - fee;

        if (_outcome == Outcome.Yes) {
            uint256 k = m.yesPool * m.noPool;
            uint256 newNoPool = m.noPool + netAmount;
            sharesOut = m.yesPool - (k / newNoPool);
        } else {
            uint256 k = m.yesPool * m.noPool;
            uint256 newYesPool = m.yesPool + netAmount;
            sharesOut = m.noPool - (k / newYesPool);
        }
    }

    /**
     * @notice Estimate collateral out for selling shares.
     */
    function estimateSell(
        uint256 _marketId,
        Outcome _outcome,
        uint256 _shares
    ) external view returns (uint256 collateralOut, uint256 fee) {
        Market storage m = markets[_marketId];

        if (_outcome == Outcome.Yes) {
            uint256 k = m.yesPool * m.noPool;
            uint256 newYesPool = m.yesPool + _shares;
            uint256 rawOut = m.noPool - (k / newYesPool);
            fee = (rawOut * tradingFee) / FEE_DENOMINATOR;
            collateralOut = rawOut - fee;
        } else {
            uint256 k = m.yesPool * m.noPool;
            uint256 newNoPool = m.noPool + _shares;
            uint256 rawOut = m.yesPool - (k / newNoPool);
            fee = (rawOut * tradingFee) / FEE_DENOMINATOR;
            collateralOut = rawOut - fee;
        }
    }

    /**
     * @notice Get full market data.
     */
    function getMarket(uint256 _marketId) external view returns (
        uint256 id,
        string memory question,
        uint256 resolveTime,
        uint256 yesPool,
        uint256 noPool,
        uint256 totalVolume,
        MarketStatus status,
        Outcome resolution,
        address creator,
        uint256 createdAt
    ) {
        Market storage m = markets[_marketId];
        return (m.id, m.question, m.resolveTime, m.yesPool, m.noPool, m.totalVolume, m.status, m.resolution, m.creator, m.createdAt);
    }

    /**
     * @notice Get user position in a market.
     */
    function getPosition(uint256 _marketId, address _user) external view returns (
        uint256 yesAmount,
        uint256 noAmount,
        bool hasClaimed
    ) {
        return (
            yesShares[_marketId][_user],
            noShares[_marketId][_user],
            claimed[_marketId][_user]
        );
    }

    // ══════════════════════════════════════════════
    //  ADMIN
    // ══════════════════════════════════════════════

    function setTradingFee(uint256 _fee) external onlyOwner {
        require(_fee <= 1000, "Fee too high"); // max 10%
        emit TradingFeeUpdated(tradingFee, _fee);
        tradingFee = _fee;
    }

    function setCreationFee(uint256 _fee) external onlyOwner {
        creationFee = _fee;
    }

    function setResolver(address _resolver, bool _authorized) external onlyOwner {
        resolvers[_resolver] = _authorized;
        emit ResolverUpdated(_resolver, _authorized);
    }

    function withdrawFees(address _to) external onlyOwner {
        require(platformBalance > 0, "No fees to withdraw");
        uint256 amount = platformBalance;
        platformBalance = 0;
        collateralToken.safeTransfer(_to, amount);
        emit FeesWithdrawn(_to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
