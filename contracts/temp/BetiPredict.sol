// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BetiPredict
 * @dev A decentralized prediction market platform for African sports betting
 * @notice Users can create, trade, and resolve prediction markets
 */
contract BetiPredict is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // State variables
    IERC20 public collateralToken;
    uint256 public marketCreationFee = 0.01 ether;
    uint256 public resolutionFee = 100; // 1% in basis points
    uint256 public liquidityProviderFee = 50; // 0.5% in basis points
    
    // Counters
    uint256 public marketCounter;
    uint256 public orderCounter;
    
    // Enums
    enum MarketStatus { Pending, Active, Resolved, Canceled }
    enum OrderSide { Buy, Sell }
    enum OrderType { Market, Limit }
    enum OrderStatus { Open, Filled, Canceled }
    enum Outcome { Yes, No }
    
    // Structs
    struct Market {
        uint256 id;
        string title;
        string description;
        string category;
        string subcategory;
        string question;
        uint256 resolveTime;
        uint256 yesPrice; // Price in collateral token (scaled by 1e6)
        uint256 noPrice;  // Price in collateral token (scaled by 1e6)
        uint256 totalVolume;
        uint256 liquidity;
        MarketStatus status;
        Outcome resolution;
        address creator;
        uint256 createdAt;
        uint256 resolvedAt;
    }
    
    struct Order {
        uint256 id;
        uint256 marketId;
        address trader;
        OrderSide side;
        OrderType orderType;
        Outcome outcome;
        uint256 amount;
        uint256 price; // Price in collateral token (scaled by 1e6)
        uint256 filled;
        OrderStatus status;
        uint256 createdAt;
    }
    
    struct Position {
        address trader;
        uint256 marketId;
        Outcome outcome;
        uint256 amount;
        uint256 averagePrice; // Scaled by 1e6
    }
    
    struct LiquidityPool {
        uint256 marketId;
        uint256 yesLiquidity;
        uint256 noLiquidity;
        uint256 totalLiquidity;
        mapping(address => uint256) liquidityProviderShares;
    }
    
    // Mappings
    mapping(uint256 => Market) public markets;
    mapping(uint256 => Order) public orders;
    mapping(address => mapping(uint256 => Position)) public positions;
    mapping(uint256 => LiquidityPool) public liquidityPools;
    mapping(address => uint256) public userBalances;
    mapping(address => uint256[]) public userOrders;
    mapping(address => uint256[]) public userPositions;
    
    // Events
    event MarketCreated(
        uint256 indexed marketId,
        string title,
        string question,
        uint256 resolveTime,
        address indexed creator
    );
    
    event OrderPlaced(
        uint256 indexed orderId,
        uint256 indexed marketId,
        address indexed trader,
        OrderSide side,
        Outcome outcome,
        uint256 amount,
        uint256 price
    );
    
    event OrderFilled(
        uint256 indexed orderId,
        uint256 indexed marketId,
        address indexed trader,
        uint256 filledAmount,
        uint256 fillPrice
    );
    
    event OrderCanceled(
        uint256 indexed orderId,
        uint256 indexed marketId,
        address indexed trader
    );
    
    event MarketResolved(
        uint256 indexed marketId,
        Outcome resolution,
        uint256 totalPayout
    );
    
    event LiquidityAdded(
        uint256 indexed marketId,
        address indexed provider,
        uint256 amount,
        uint256 shares
    );
    
    event LiquidityRemoved(
        uint256 indexed marketId,
        address indexed provider,
        uint256 amount,
        uint256 shares
    );
    
    modifier onlyValidMarket(uint256 _marketId) {
        require(_marketId > 0 && _marketId <= marketCounter, "Invalid market ID");
        _;
    }
    
    modifier onlyActiveMarket(uint256 _marketId) {
        require(markets[_marketId].status == MarketStatus.Active, "Market not active");
        require(block.timestamp < markets[_marketId].resolveTime, "Market expired");
        _;
    }
    
    modifier onlyMarketCreator(uint256 _marketId) {
        require(msg.sender == markets[_marketId].creator, "Not market creator");
        _;
    }
    
    constructor(address _collateralToken) Ownable(msg.sender) {
        collateralToken = IERC20(_collateralToken);
    }
    
    /**
     * @dev Create a new prediction market
     */
    function createMarket(
        string memory _title,
        string memory _description,
        string memory _category,
        string memory _subcategory,
        string memory _question,
        uint256 _resolveTime,
        uint256 _initialYesPrice,
        uint256 _initialNoPrice
    ) external payable whenNotPaused returns (uint256) {
        require(msg.value >= marketCreationFee, "Insufficient creation fee");
        require(_resolveTime > block.timestamp, "Invalid resolve time");
        require(_initialYesPrice + _initialNoPrice == 1e6, "Prices must sum to 1");
        
        marketCounter++;
        
        Market memory newMarket = Market({
            id: marketCounter,
            title: _title,
            description: _description,
            category: _category,
            subcategory: _subcategory,
            question: _question,
            resolveTime: _resolveTime,
            yesPrice: _initialYesPrice,
            noPrice: _initialNoPrice,
            totalVolume: 0,
            liquidity: 0,
            status: MarketStatus.Active,
            resolution: Outcome.Yes, // Default, will be set on resolution
            creator: msg.sender,
            createdAt: block.timestamp,
            resolvedAt: 0
        });
        
        markets[marketCounter] = newMarket;
        
        // Initialize liquidity pool
        LiquidityPool storage pool = liquidityPools[marketCounter];
        pool.marketId = marketCounter;
        pool.yesLiquidity = 0;
        pool.noLiquidity = 0;
        pool.totalLiquidity = 0;
        
        emit MarketCreated(marketCounter, _title, _question, _resolveTime, msg.sender);
        
        return marketCounter;
    }
    
    /**
     * @dev Place a limit order
     */
    function placeLimitOrder(
        uint256 _marketId,
        OrderSide _side,
        Outcome _outcome,
        uint256 _amount,
        uint256 _price
    ) external onlyValidMarket(_marketId) onlyActiveMarket(_marketId) whenNotPaused nonReentrant {
        require(_amount > 0, "Amount must be positive");
        require(_price > 0 && _price <= 1e6, "Invalid price");
        
        uint256 requiredCollateral;
        if (_side == OrderSide.Buy) {
            requiredCollateral = (_amount * _price) / 1e6;
        } else {
            // For sell orders, user must have the position
            Position storage position = positions[msg.sender][_marketId];
            require(position.outcome == _outcome && position.amount >= _amount, "Insufficient position");
        }
        
        if (_side == OrderSide.Buy) {
            require(userBalances[msg.sender] >= requiredCollateral, "Insufficient balance");
            userBalances[msg.sender] = userBalances[msg.sender].sub(requiredCollateral);
        }
        
        orderCounter++;
        
        Order memory newOrder = Order({
            id: orderCounter,
            marketId: _marketId,
            trader: msg.sender,
            side: _side,
            orderType: OrderType.Limit,
            outcome: _outcome,
            amount: _amount,
            price: _price,
            filled: 0,
            status: OrderStatus.Open,
            createdAt: block.timestamp
        });
        
        orders[orderCounter] = newOrder;
        userOrders[msg.sender].push(orderCounter);
        
        emit OrderPlaced(orderCounter, _marketId, msg.sender, _side, _outcome, _amount, _price);
        
        // Try to match the order
        _matchOrders(_marketId, _outcome);
    }
    
    /**
     * @dev Place a market order
     */
    function placeMarketOrder(
        uint256 _marketId,
        OrderSide _side,
        Outcome _outcome,
        uint256 _amount
    ) external onlyValidMarket(_marketId) onlyActiveMarket(_marketId) whenNotPaused nonReentrant {
        require(_amount > 0, "Amount must be positive");
        
        uint256 marketPrice = _outcome == Outcome.Yes ? markets[_marketId].yesPrice : markets[_marketId].noPrice;
        uint256 requiredCollateral = _amount.mul(marketPrice).div(1e6);
        
        if (_side == OrderSide.Buy) {
            require(userBalances[msg.sender] >= requiredCollateral, "Insufficient balance");
            userBalances[msg.sender] = userBalances[msg.sender].sub(requiredCollateral);
        } else {
            Position storage position = positions[msg.sender][_marketId];
            require(position.outcome == _outcome && position.amount >= _amount, "Insufficient position");
        }
        
        // Execute market order immediately
        _executeMarketOrder(_marketId, _side, _outcome, _amount, marketPrice);
    }
    
    /**
     * @dev Add liquidity to a market
     */
    function addLiquidity(uint256 _marketId, uint256 _amount) external onlyValidMarket(_marketId) whenNotPaused nonReentrant {
        require(_amount > 0, "Amount must be positive");
        require(userBalances[msg.sender] >= _amount, "Insufficient balance");
        
        userBalances[msg.sender] = userBalances[msg.sender].sub(_amount);
        
        LiquidityPool storage pool = liquidityPools[_marketId];
        Market storage market = markets[_marketId];
        
        // Add liquidity proportionally to both sides
        uint256 yesAmount = _amount.mul(market.yesPrice).div(1e6);
        uint256 noAmount = _amount.mul(market.noPrice).div(1e6);
        
        pool.yesLiquidity = pool.yesLiquidity.add(yesAmount);
        pool.noLiquidity = pool.noLiquidity.add(noAmount);
        pool.totalLiquidity = pool.totalLiquidity.add(_amount);
        
        // Calculate and mint liquidity shares
        uint256 shares;
        if (pool.totalLiquidity == _amount) {
            shares = _amount; // First liquidity provider
        } else {
            shares = _amount.mul(pool.liquidityProviderShares[msg.sender]).div(pool.totalLiquidity.sub(_amount));
        }
        
        pool.liquidityProviderShares[msg.sender] = pool.liquidityProviderShares[msg.sender].add(shares);
        market.liquidity = market.liquidity.add(_amount);
        
        emit LiquidityAdded(_marketId, msg.sender, _amount, shares);
    }
    
    /**
     * @dev Remove liquidity from a market
     */
    function removeLiquidity(uint256 _marketId, uint256 _shares) external onlyValidMarket(_marketId) whenNotPaused nonReentrant {
        LiquidityPool storage pool = liquidityPools[_marketId];
        Market storage market = markets[_marketId];
        
        require(pool.liquidityProviderShares[msg.sender] >= _shares, "Insufficient shares");
        
        uint256 proportion = _shares.mul(1e6).div(pool.liquidityProviderShares[msg.sender]);
        uint256 withdrawAmount = pool.totalLiquidity.mul(proportion).div(1e6);
        
        pool.liquidityProviderShares[msg.sender] = pool.liquidityProviderShares[msg.sender].sub(_shares);
        pool.totalLiquidity = pool.totalLiquidity.sub(withdrawAmount);
        market.liquidity = market.liquidity.sub(withdrawAmount);
        
        userBalances[msg.sender] = userBalances[msg.sender].add(withdrawAmount);
        
        emit LiquidityRemoved(_marketId, msg.sender, withdrawAmount, _shares);
    }
    
    /**
     * @dev Resolve a market and distribute payouts
     */
    function resolveMarket(uint256 _marketId, Outcome _resolution) external onlyValidMarket(_marketId) onlyMarketCreator(_marketId) whenNotPaused {
        Market storage market = markets[_marketId];
        require(market.status == MarketStatus.Active, "Market not active");
        require(block.timestamp >= market.resolveTime, "Market not expired");
        
        market.status = MarketStatus.Resolved;
        market.resolution = _resolution;
        market.resolvedAt = block.timestamp;
        
        uint256 totalPayout = _distributePayouts(_marketId, _resolution);
        
        emit MarketResolved(_marketId, _resolution, totalPayout);
    }
    
    /**
     * @dev Deposit collateral tokens
     */
    function deposit(uint256 _amount) external whenNotPaused nonReentrant {
        require(_amount > 0, "Amount must be positive");
        
        collateralToken.safeTransferFrom(msg.sender, address(this), _amount);
        userBalances[msg.sender] = userBalances[msg.sender].add(_amount);
    }
    
    /**
     * @dev Withdraw collateral tokens
     */
    function withdraw(uint256 _amount) external whenNotPaused nonReentrant {
        require(_amount > 0, "Amount must be positive");
        require(userBalances[msg.sender] >= _amount, "Insufficient balance");
        
        userBalances[msg.sender] = userBalances[msg.sender].sub(_amount);
        collateralToken.safeTransfer(msg.sender, _amount);
    }
    
    /**
     * @dev Get user's balance
     */
    function getBalance(address _user) external view returns (uint256) {
        return userBalances[_user];
    }
    
    /**
     * @dev Get market details
     */
    function getMarket(uint256 _marketId) external view returns (Market memory) {
        return markets[_marketId];
    }
    
    /**
     * @dev Get order details
     */
    function getOrder(uint256 _orderId) external view returns (Order memory) {
        return orders[_orderId];
    }
    
    /**
     * @dev Get user's position in a market
     */
    function getPosition(address _user, uint256 _marketId) external view returns (Position memory) {
        return positions[_user][_marketId];
    }
    
    /**
     * @dev Get user's orders
     */
    function getUserOrders(address _user) external view returns (uint256[] memory) {
        return userOrders[_user];
    }
    
    /**
     * @dev Get user's positions
     */
    function getUserPositions(address _user) external view returns (uint256[] memory) {
        return userPositions[_user];
    }
    
    /**
     * @dev Get liquidity pool info
     */
    function getLiquidityPool(uint256 _marketId) external view returns (uint256 yesLiquidity, uint256 noLiquidity, uint256 totalLiquidity) {
        LiquidityPool storage pool = liquidityPools[_marketId];
        return (pool.yesLiquidity, pool.noLiquidity, pool.totalLiquidity);
    }
    
    /**
     * @dev Internal function to match orders
     */
    function _matchOrders(uint256 _marketId, Outcome _outcome) internal {
        // This is a simplified order matching algorithm
        // In production, this would be more sophisticated with price-time priority
        
        OrderSide[] memory sides = [OrderSide.Buy, OrderSide.Sell];
        
        for (uint i = 0; i < 2; i++) {
            OrderSide side = sides[i];
            OrderSide oppositeSide = side == OrderSide.Buy ? OrderSide.Sell : OrderSide.Buy;
            
            // Find matching orders
            for (uint j = 1; j <= orderCounter; j++) {
                Order storage buyOrder = orders[j];
                Order storage sellOrder = orders[j];
                
                if (buyOrder.status == OrderStatus.Open && 
                    sellOrder.status == OrderStatus.Open &&
                    buyOrder.marketId == _marketId &&
                    sellOrder.marketId == _marketId &&
                    buyOrder.outcome == _outcome &&
                    sellOrder.outcome == _outcome &&
                    buyOrder.side == OrderSide.Buy &&
                    sellOrder.side == OrderSide.Sell &&
                    buyOrder.price >= sellOrder.price) {
                    
                    uint256 tradeAmount = _min(buyOrder.amount.sub(buyOrder.filled), sellOrder.amount.sub(sellOrder.filled));
                    uint256 tradePrice = (buyOrder.price.add(sellOrder.price)).div(2);
                    
                    _fillOrder(buyOrder.id, tradeAmount, tradePrice);
                    _fillOrder(sellOrder.id, tradeAmount, tradePrice);
                    
                    // Update market prices
                    Market storage market = markets[_marketId];
                    if (_outcome == Outcome.Yes) {
                        market.yesPrice = tradePrice;
                        market.noPrice = 1e6.sub(tradePrice);
                    } else {
                        market.noPrice = tradePrice;
                        market.yesPrice = 1e6.sub(tradePrice);
                    }
                    
                    break;
                }
            }
        }
    }
    
    /**
     * @dev Internal function to fill an order
     */
    function _fillOrder(uint256 _orderId, uint256 _amount, uint256 _price) internal {
        Order storage order = orders[_orderId];
        require(order.status == OrderStatus.Open, "Order not open");
        
        uint256 remainingAmount = order.amount.sub(order.filled);
        uint256 fillAmount = _min(_amount, remainingAmount);
        
        order.filled = order.filled.add(fillAmount);
        
        if (order.filled == order.amount) {
            order.status = OrderStatus.Filled;
        }
        
        // Update position
        _updatePosition(order.trader, order.marketId, order.outcome, fillAmount, _price, order.side);
        
        emit OrderFilled(_orderId, order.marketId, order.trader, fillAmount, _price);
    }
    
    /**
     * @dev Internal function to execute market order
     */
    function _executeMarketOrder(uint256 _marketId, OrderSide _side, Outcome _outcome, uint256 _amount, uint256 _price) internal {
        // Create a temporary order for execution
        orderCounter++;
        
        Order memory tempOrder = Order({
            id: orderCounter,
            marketId: _marketId,
            trader: msg.sender,
            side: _side,
            orderType: OrderType.Market,
            outcome: _outcome,
            amount: _amount,
            price: _price,
            filled: 0,
            status: OrderStatus.Filled,
            createdAt: block.timestamp
        });
        
        orders[orderCounter] = tempOrder;
        
        _fillOrder(orderCounter, _amount, _price);
        
        // Update market volume
        Market storage market = markets[_marketId];
        market.totalVolume = market.totalVolume.add(_amount.mul(_price).div(1e6));
    }
    
    /**
     * @dev Internal function to update user position
     */
    function _updatePosition(address _trader, uint256 _marketId, Outcome _outcome, uint256 _amount, uint256 _price, OrderSide _side) internal {
        Position storage position = positions[_trader][_marketId];
        
        if (position.amount == 0) {
            // New position
            position.trader = _trader;
            position.marketId = _marketId;
            position.outcome = _outcome;
            position.amount = _amount;
            position.averagePrice = _price;
        } else if (position.outcome == _outcome) {
            // Add to existing position
            uint256 totalCost = position.amount.mul(position.averagePrice).add(_amount.mul(_price));
            position.amount = position.amount.add(_amount);
            position.averagePrice = totalCost.div(position.amount);
        } else {
            // Reduce position (opposite outcome)
            position.amount = position.amount.sub(_amount);
            if (position.amount == 0) {
                delete positions[_trader][_marketId];
            }
        }
    }
    
    /**
     * @dev Internal function to distribute payouts
     */
    function _distributePayouts(uint256 _marketId, Outcome _resolution) internal returns (uint256) {
        Market storage market = markets[_marketId];
        uint256 totalPayout = 0;
        
        // Iterate through all positions and distribute payouts
        // This is simplified - in production, you'd want to optimize this
        for (uint i = 1; i <= orderCounter; i++) {
            Order storage order = orders[i];
            if (order.marketId == _marketId && order.status == OrderStatus.Filled) {
                Position storage position = positions[order.trader][_marketId];
                if (position.outcome == _resolution && position.amount > 0) {
                    uint256 payout = position.amount.mul(1e6).div(1e6); // Full payout for winners
                    userBalances[order.trader] = userBalances[order.trader].add(payout);
                    totalPayout = totalPayout.add(payout);
                }
            }
        }
        
        return totalPayout;
    }
    
    /**
     * @dev Utility function for minimum
     */
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
    
    /**
     * @dev Pause contract (emergency only)
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Update market creation fee
     */
    function setMarketCreationFee(uint256 _fee) external onlyOwner {
        marketCreationFee = _fee;
    }
    
    /**
     * @dev Update resolution fee
     */
    function setResolutionFee(uint256 _fee) external onlyOwner {
        require(_fee <= 1000, "Fee too high"); // Max 10%
        resolutionFee = _fee;
    }
    
    /**
     * @dev Emergency withdraw (only owner)
     */
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        if (_token == address(0)) {
            payable(owner()).transfer(_amount);
        } else {
            IERC20(_token).safeTransfer(owner(), _amount);
        }
    }
}
