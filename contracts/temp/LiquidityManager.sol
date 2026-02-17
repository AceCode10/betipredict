// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

import "./BetiPredict.sol";

/**
 * @title LiquidityManager
 * @dev Manages liquidity pools and automated market making for BetiPredict
 * @notice Provides liquidity incentives and automated market making
 */
contract LiquidityManager is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // State variables
    BetiPredict public betiPredict;
    IERC20 public collateralToken;
    IERC20 public rewardToken;
    
    uint256 public liquidityMiningRate = 100; // 1% daily in basis points
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant SECONDS_PER_DAY = 86400;
    
    // Structs
    struct LiquidityPosition {
        uint256 marketId;
        address provider;
        uint256 amount;
        uint256 shares;
        uint256 lastRewardTime;
        uint256 accumulatedRewards;
    }
    
    struct MarketLiquidity {
        uint256 marketId;
        uint256 totalLiquidity;
        uint256 totalShares;
        uint256 yesLiquidity;
        uint256 noLiquidity;
        uint256 apr; // Annual Percentage Rate in basis points
        uint256 lastUpdateTime;
        mapping(address => LiquidityPosition) positions;
        address[] providers;
    }
    
    struct RewardSchedule {
        uint256 startTime;
        uint256 endTime;
        uint256 totalRewards;
        uint256 rewardsPerSecond;
        bool active;
    }
    
    // Mappings
    mapping(uint256 => MarketLiquidity) public marketLiquidity;
    mapping(address => uint256[]) public userLiquidityMarkets;
    mapping(address => uint256) public totalUserRewards;
    mapping(uint256 => RewardSchedule) public rewardSchedules;
    
    // Events
    event LiquidityAdded(
        uint256 indexed marketId,
        address indexed provider,
        uint256 amount,
        uint256 shares,
        uint256 apr
    );
    
    event LiquidityRemoved(
        uint256 indexed marketId,
        address indexed provider,
        uint256 amount,
        uint256 shares,
        uint256 rewardsClaimed
    );
    
    event RewardsClaimed(
        address indexed provider,
        uint256 indexed marketId,
        uint256 rewardAmount
    );
    
    event RewardScheduleCreated(
        uint256 indexed scheduleId,
        uint256 startTime,
        uint256 endTime,
        uint256 totalRewards
    );
    
    event APRUpdated(
        uint256 indexed marketId,
        uint256 oldApr,
        uint256 newApr
    );
    
    modifier onlyValidMarket(uint256 _marketId) {
        require(_marketId > 0, "Invalid market ID");
        _;
    }
    
    constructor(address _betiPredict, address _collateralToken, address _rewardToken) {
        betiPredict = BetiPredict(_betiPredict);
        collateralToken = IERC20(_collateralToken);
        rewardToken = IERC20(_rewardToken);
    }
    
    /**
     * @dev Add liquidity to a market with rewards
     */
    function addLiquidityWithRewards(
        uint256 _marketId,
        uint256 _amount
    ) external onlyValidMarket(_marketId) whenNotPaused nonReentrant {
        require(_amount > 0, "Amount must be positive");
        
        MarketLiquidity storage market = marketLiquidity[_marketId];
        
        // Calculate shares based on current liquidity
        uint256 shares;
        if (market.totalLiquidity == 0) {
            shares = _amount;
            market.providers.push(msg.sender);
        } else {
            shares = _amount.mul(market.totalShares).div(market.totalLiquidity);
        }
        
        // Update user position
        LiquidityPosition storage position = market.positions[msg.sender];
        if (position.amount == 0) {
            position.marketId = _marketId;
            position.provider = msg.sender;
            position.lastRewardTime = block.timestamp;
            userLiquidityMarkets[msg.sender].push(_marketId);
        } else {
            // Claim pending rewards before adding more liquidity
            _claimRewards(_marketId, msg.sender);
        }
        
        position.amount = position.amount.add(_amount);
        position.shares = position.shares.add(shares);
        
        // Update market liquidity
        market.totalLiquidity = market.totalLiquidity.add(_amount);
        market.totalShares = market.totalShares.add(shares);
        market.lastUpdateTime = block.timestamp;
        
        // Transfer tokens
        collateralToken.safeTransferFrom(msg.sender, address(this), _amount);
        
        // Add liquidity to BetiPredict contract
        collateralToken.approve(address(betiPredict), _amount);
        betiPredict.addLiquidity(_marketId, _amount);
        
        // Update APR based on liquidity utilization
        _updateAPR(_marketId);
        
        emit LiquidityAdded(_marketId, msg.sender, _amount, shares, market.apr);
    }
    
    /**
     * @dev Remove liquidity and claim rewards
     */
    function removeLiquidityWithRewards(
        uint256 _marketId,
        uint256 _shares
    ) external onlyValidMarket(_marketId) whenNotPaused nonReentrant {
        MarketLiquidity storage market = marketLiquidity[_marketId];
        LiquidityPosition storage position = market.positions[msg.sender];
        
        require(position.shares >= _shares, "Insufficient shares");
        require(_shares > 0, "Shares must be positive");
        
        // Claim pending rewards
        uint256 rewards = _claimRewards(_marketId, msg.sender);
        
        // Calculate withdrawal amount
        uint256 withdrawAmount = _shares.mul(market.totalLiquidity).div(market.totalShares);
        
        // Update position
        position.amount = position.amount.sub(withdrawAmount);
        position.shares = position.shares.sub(_shares);
        
        // Update market liquidity
        market.totalLiquidity = market.totalLiquidity.sub(withdrawAmount);
        market.totalShares = market.totalShares.sub(_shares);
        market.lastUpdateTime = block.timestamp;
        
        // Remove liquidity from BetiPredict contract
        betiPredict.removeLiquidity(_marketId, _shares);
        
        // Transfer tokens back to user
        collateralToken.safeTransfer(msg.sender, withdrawAmount);
        
        // Update APR
        _updateAPR(_marketId);
        
        emit LiquidityRemoved(_marketId, msg.sender, withdrawAmount, _shares, rewards);
    }
    
    /**
     * @dev Claim rewards for a specific market
     */
    function claimRewards(uint256 _marketId) external onlyValidMarket(_marketId) whenNotPaused nonReentrant {
        uint256 rewards = _claimRewards(_marketId, msg.sender);
        require(rewards > 0, "No rewards to claim");
        
        rewardToken.safeTransfer(msg.sender, rewards);
        emit RewardsClaimed(msg.sender, _marketId, rewards);
    }
    
    /**
     * @dev Claim all rewards from all markets
     */
    function claimAllRewards() external whenNotPaused nonReentrant {
        uint256[] memory markets = userLiquidityMarkets[msg.sender];
        uint256 totalRewards = 0;
        
        for (uint i = 0; i < markets.length; i++) {
            uint256 rewards = _claimRewards(markets[i], msg.sender);
            totalRewards = totalRewards.add(rewards);
        }
        
        require(totalRewards > 0, "No rewards to claim");
        
        rewardToken.safeTransfer(msg.sender, totalRewards);
    }
    
    /**
     * @dev Create a reward schedule for liquidity mining
     */
    function createRewardSchedule(
        uint256 _scheduleId,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _totalRewards
    ) external onlyOwner {
        require(_startTime < _endTime, "Invalid time range");
        require(_totalRewards > 0, "Rewards must be positive");
        
        uint256 duration = _endTime.sub(_startTime);
        uint256 rewardsPerSecond = _totalRewards.mul(BASIS_POINTS).div(duration);
        
        RewardSchedule storage schedule = rewardSchedules[_scheduleId];
        schedule.startTime = _startTime;
        schedule.endTime = _endTime;
        schedule.totalRewards = _totalRewards;
        schedule.rewardsPerSecond = rewardsPerSecond;
        schedule.active = true;
        
        emit RewardScheduleCreated(_scheduleId, _startTime, _endTime, _totalRewards);
    }
    
    /**
     * @dev Get pending rewards for a user in a market
     */
    function getPendingRewards(uint256 _marketId, address _user) external view returns (uint256) {
        MarketLiquidity storage market = marketLiquidity[_marketId];
        LiquidityPosition storage position = market.positions[_user];
        
        if (position.shares == 0) return 0;
        
        uint256 timeElapsed = block.timestamp.sub(position.lastRewardTime);
        uint256 shareRatio = position.shares.mul(BASIS_POINTS).div(market.totalShares);
        uint256 rewards = timeElapsed.mul(market.apr).mul(position.amount).div(SECONDS_PER_DAY).div(BASIS_POINTS);
        
        return position.accumulatedRewards.add(rewards);
    }
    
    /**
     * @dev Get liquidity position details
     */
    function getLiquidityPosition(uint256 _marketId, address _provider) external view returns (
        uint256 amount,
        uint256 shares,
        uint256 lastRewardTime,
        uint256 accumulatedRewards
    ) {
        LiquidityPosition storage position = marketLiquidity[_marketId].positions[_provider];
        return (position.amount, position.shares, position.lastRewardTime, position.accumulatedRewards);
    }
    
    /**
     * @dev Get market liquidity details
     */
    function getMarketLiquidity(uint256 _marketId) external view returns (
        uint256 totalLiquidity,
        uint256 totalShares,
        uint256 yesLiquidity,
        uint256 noLiquidity,
        uint256 apr,
        address[] memory providers
    ) {
        MarketLiquidity storage market = marketLiquidity[_marketId];
        return (
            market.totalLiquidity,
            market.totalShares,
            market.yesLiquidity,
            market.noLiquidity,
            market.apr,
            market.providers
        );
    }
    
    /**
     * @dev Get user's liquidity markets
     */
    function getUserLiquidityMarkets(address _user) external view returns (uint256[] memory) {
        return userLiquidityMarkets[_user];
    }
    
    /**
     * @dev Update APR for a market based on utilization
     */
    function _updateAPR(uint256 _marketId) internal {
        MarketLiquidity storage market = marketLiquidity[_marketId];
        
        // Calculate utilization rate (simplified)
        // In production, this would consider actual trading volume
        uint256 utilizationRate = market.totalLiquidity > 0 ? 
            market.totalLiquidity.mul(5000).div(market.totalLiquidity.add(100000)) : 0; // Max 50%
        
        // Base APR + utilization bonus
        uint256 baseAPR = 500; // 5% base
        uint256 utilizationBonus = utilizationRate.mul(1500).div(BASIS_POINTS); // Up to 15% bonus
        
        uint256 newAPR = baseAPR.add(utilizationBonus);
        
        if (market.apr != newAPR) {
            uint256 oldAPR = market.apr;
            market.apr = newAPR;
            emit APRUpdated(_marketId, oldAPR, newAPR);
        }
    }
    
    /**
     * @dev Internal function to claim rewards
     */
    function _claimRewards(uint256 _marketId, address _user) internal returns (uint256) {
        MarketLiquidity storage market = marketLiquidity[_marketId];
        LiquidityPosition storage position = market.positions[_user];
        
        if (position.shares == 0) return 0;
        
        uint256 timeElapsed = block.timestamp.sub(position.lastRewardTime);
        uint256 rewards = timeElapsed.mul(market.apr).mul(position.amount).div(SECONDS_PER_DAY).div(BASIS_POINTS);
        
        position.accumulatedRewards = position.accumulatedRewards.add(rewards);
        position.lastRewardTime = block.timestamp;
        
        uint256 totalRewards = position.accumulatedRewards;
        position.accumulatedRewards = 0;
        
        totalUserRewards[_user] = totalUserRewards[_user].add(totalRewards);
        
        return totalRewards;
    }
    
    /**
     * @dev Set liquidity mining rate
     */
    function setLiquidityMiningRate(uint256 _rate) external onlyOwner {
        require(_rate <= 1000, "Rate too high"); // Max 10%
        liquidityMiningRate = _rate;
    }
    
    /**
     * @dev Emergency pause
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Withdraw rewards (only owner)
     */
    function withdrawRewards(uint256 _amount) external onlyOwner {
        rewardToken.safeTransfer(owner(), _amount);
    }
    
    /**
     * @dev Set reward token
     */
    function setRewardToken(address _rewardToken) external onlyOwner {
        rewardToken = IERC20(_rewardToken);
    }
}
