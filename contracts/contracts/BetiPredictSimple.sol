// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BetiPredict
 * @dev A simplified decentralized prediction market platform for African sports betting
 * @notice Users can create, trade, and resolve prediction markets
 */
contract BetiPredictSimple is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // State variables
    IERC20 public collateralToken;
    uint256 public marketCreationFee = 0.01 ether;
    
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
        string question;
        uint256 resolveTime;
        uint256 yesPrice; // Price in collateral token (scaled by 1e6)
        uint256 noPrice;  // Price in collateral token (scaled by 1e6)
        uint256 totalVolume;
        MarketStatus status;
        Outcome resolution;
        address creator;
        uint256 createdAt;
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
    
    // Mappings
    mapping(uint256 => Market) public markets;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256) public userBalances;
    mapping(address => uint256[]) public userOrders;
    
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
    
    event MarketResolved(
        uint256 indexed marketId,
        Outcome resolution,
        uint256 totalPayout
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
        string memory _question,
        uint256 _resolveTime,
        uint256 _initialYesPrice,
        uint256 _initialNoPrice
    ) external payable whenNotPaused returns (uint256) {
        require(msg.value >= marketCreationFee, "Insufficient creation fee");
        require(_resolveTime > block.timestamp, "Invalid resolve time");
        require(_initialYesPrice + _initialNoPrice == 1e6, "Prices must sum to 1");
        
        marketCounter++;
        
        Market storage newMarket = markets[marketCounter];
        newMarket.id = marketCounter;
        newMarket.title = _title;
        newMarket.description = _description;
        newMarket.category = _category;
        newMarket.question = _question;
        newMarket.resolveTime = _resolveTime;
        newMarket.yesPrice = _initialYesPrice;
        newMarket.noPrice = _initialNoPrice;
        newMarket.totalVolume = 0;
        newMarket.status = MarketStatus.Active;
        newMarket.resolution = Outcome.Yes;
        newMarket.creator = msg.sender;
        newMarket.createdAt = block.timestamp;
        
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
            require(userBalances[msg.sender] >= requiredCollateral, "Insufficient balance");
            userBalances[msg.sender] -= requiredCollateral;
        }
        
        orderCounter++;
        
        Order storage newOrder = orders[orderCounter];
        newOrder.id = orderCounter;
        newOrder.marketId = _marketId;
        newOrder.trader = msg.sender;
        newOrder.side = _side;
        newOrder.orderType = OrderType.Limit;
        newOrder.outcome = _outcome;
        newOrder.amount = _amount;
        newOrder.price = _price;
        newOrder.filled = 0;
        newOrder.status = OrderStatus.Open;
        newOrder.createdAt = block.timestamp;
        
        userOrders[msg.sender].push(orderCounter);
        
        emit OrderPlaced(orderCounter, _marketId, msg.sender, _side, _outcome, _amount, _price);
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
        
        Market storage market = markets[_marketId];
        uint256 marketPrice = _outcome == Outcome.Yes ? market.yesPrice : market.noPrice;
        uint256 requiredCollateral = (_amount * marketPrice) / 1e6;
        
        if (_side == OrderSide.Buy) {
            require(userBalances[msg.sender] >= requiredCollateral, "Insufficient balance");
            userBalances[msg.sender] -= requiredCollateral;
        }
        
        // Execute market order immediately
        orderCounter++;
        
        Order storage tempOrder = orders[orderCounter];
        tempOrder.id = orderCounter;
        tempOrder.marketId = _marketId;
        tempOrder.trader = msg.sender;
        tempOrder.side = _side;
        tempOrder.orderType = OrderType.Market;
        tempOrder.outcome = _outcome;
        tempOrder.amount = _amount;
        tempOrder.price = marketPrice;
        tempOrder.filled = _amount;
        tempOrder.status = OrderStatus.Filled;
        tempOrder.createdAt = block.timestamp;
        
        // Update market volume
        market.totalVolume += requiredCollateral;
        
        emit OrderPlaced(orderCounter, _marketId, msg.sender, _side, _outcome, _amount, marketPrice);
        emit OrderFilled(orderCounter, _marketId, msg.sender, _amount, marketPrice);
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
        
        emit MarketResolved(_marketId, _resolution, market.totalVolume);
    }
    
    /**
     * @dev Deposit collateral tokens
     */
    function deposit(uint256 _amount) external whenNotPaused nonReentrant {
        require(_amount > 0, "Amount must be positive");
        
        collateralToken.safeTransferFrom(msg.sender, address(this), _amount);
        userBalances[msg.sender] += _amount;
    }
    
    /**
     * @dev Withdraw collateral tokens
     */
    function withdraw(uint256 _amount) external whenNotPaused nonReentrant {
        require(_amount > 0, "Amount must be positive");
        require(userBalances[msg.sender] >= _amount, "Insufficient balance");
        
        userBalances[msg.sender] -= _amount;
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
     * @dev Get user's orders
     */
    function getUserOrders(address _user) external view returns (uint256[] memory) {
        return userOrders[_user];
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
}
