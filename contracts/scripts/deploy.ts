import { ethers } from "hardhat";
import { BetiPredict, LiquidityManager } from "../typechain-types";

async function main() {
  console.log("Deploying BetiPredict contracts...");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy Mock Token for testing
  console.log("\n1. Deploying Mock Collateral Token...");
  const MockToken = await ethers.getContractFactory("MockToken");
  const collateralToken = await MockToken.deploy("BetiPredict Collateral", "BPC", 18);
  await collateralToken.deployed();
  console.log("Collateral Token deployed to:", collateralToken.address);

  // Deploy Mock Reward Token
  console.log("\n2. Deploying Mock Reward Token...");
  const rewardToken = await MockToken.deploy("BetiPredict Rewards", "BPR", 18);
  await rewardToken.deployed();
  console.log("Reward Token deployed to:", rewardToken.address);

  // Deploy BetiPredict Contract
  console.log("\n3. Deploying BetiPredict Contract...");
  const BetiPredict = await ethers.getContractFactory("BetiPredict");
  const betiPredict = await BetiPredict.deploy(collateralToken.address) as BetiPredict;
  await betiPredict.deployed();
  console.log("BetiPredict deployed to:", betiPredict.address);

  // Deploy Liquidity Manager
  console.log("\n4. Deploying Liquidity Manager...");
  const LiquidityManager = await ethers.getContractFactory("LiquidityManager");
  const liquidityManager = await LiquidityManager.deploy(
    betiPredict.address,
    collateralToken.address,
    rewardToken.address
  ) as LiquidityManager;
  await liquidityManager.deployed();
  console.log("Liquidity Manager deployed to:", liquidityManager.address);

  // Mint initial tokens for testing
  console.log("\n5. Minting initial tokens...");
  const initialSupply = ethers.utils.parseEther("1000000"); // 1M tokens
  
  await collateralToken.mint(deployer.address, initialSupply);
  await rewardToken.mint(deployer.address, initialSupply);
  
  console.log("Minted 1M collateral tokens to deployer");
  console.log("Minted 1M reward tokens to deployer");

  // Fund the liquidity manager with reward tokens
  const rewardFunding = ethers.utils.parseEther("100000"); // 100K reward tokens
  await rewardToken.transfer(liquidityManager.address, rewardFunding);
  console.log("Funded Liquidity Manager with 100K reward tokens");

  // Create a sample market for testing
  console.log("\n6. Creating sample market...");
  const marketCreationFee = await betiPredict.marketCreationFee();
  const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days from now
  
  const tx = await betiPredict.createMarket(
    "Zambia vs Nigeria",
    "Africa Cup of Nations Qualifier match",
    "football",
    "africa-cup-of-nations",
    "Will Zambia win against Nigeria?",
    resolveTime,
    500000, // 0.50 YES price (scaled by 1e6)
    500000  // 0.50 NO price (scaled by 1e6)
  );
  
  const receipt = await tx.wait();
  const marketCreatedEvent = receipt.events?.find(e => e.event === "MarketCreated");
  const marketId = marketCreatedEvent?.args?.marketId;
  
  console.log("Sample market created with ID:", marketId.toString());

  // Approve tokens for BetiPredict
  console.log("\n7. Approving tokens for BetiPredict...");
  await collateralToken.approve(betiPredict.address, initialSupply);
  console.log("Approved collateral tokens for BetiPredict");

  // Add initial liquidity
  console.log("\n8. Adding initial liquidity...");
  const initialLiquidity = ethers.utils.parseEther("1000"); // 1000 tokens
  
  await betiPredict.addLiquidity(marketId, initialLiquidity);
  console.log("Added 1000 tokens of initial liquidity to market");

  // Add liquidity through Liquidity Manager
  console.log("\n9. Adding liquidity through Liquidity Manager...");
  await liquidityManager.addLiquidityWithRewards(marketId, ethers.utils.parseEther("500"));
  console.log("Added 500 tokens through Liquidity Manager");

  // Create reward schedule
  console.log("\n10. Creating reward schedule...");
  const startTime = Math.floor(Date.now() / 1000);
  const endTime = startTime + (30 * 24 * 60 * 60); // 30 days from now
  const totalRewards = ethers.utils.parseEther("10000"); // 10K reward tokens
  
  await liquidityManager.createRewardSchedule(1, startTime, endTime, totalRewards);
  console.log("Created reward schedule with 10K rewards over 30 days");

  // Get final balances
  const deployerCollateralBalance = await collateralToken.balanceOf(deployer.address);
  const deployerRewardBalance = await rewardToken.balanceOf(deployer.address);
  const liquidityManagerBalance = await collateralToken.balanceOf(liquidityManager.address);

  console.log("\n=== Deployment Summary ===");
  console.log("Collateral Token:", collateralToken.address);
  console.log("Reward Token:", rewardToken.address);
  console.log("BetiPredict:", betiPredict.address);
  console.log("Liquidity Manager:", liquidityManager.address);
  console.log("Sample Market ID:", marketId.toString());
  
  console.log("\n=== Balances ===");
  console.log("Deployer Collateral:", ethers.utils.formatEther(deployerCollateralBalance));
  console.log("Deployer Rewards:", ethers.utils.formatEther(deployerRewardBalance));
  console.log("Liquidity Manager Collateral:", ethers.utils.formatEther(liquidityManagerBalance));

  console.log("\n=== Contract Verification ===");
  console.log("To verify contracts on Etherscan:");
  console.log(`npx hardhat verify --network <network> ${collateralToken.address}`);
  console.log(`npx hardhat verify --network <network> ${rewardToken.address}`);
  console.log(`npx hardhat verify --network <network> ${betiPredict.address} ${collateralToken.address}`);
  console.log(`npx hardhat verify --network <network> ${liquidityManager.address} ${betiPredict.address} ${collateralToken.address} ${rewardToken.address}`);

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    deployer: deployer.address,
    contracts: {
      collateralToken: collateralToken.address,
      rewardToken: rewardToken.address,
      betiPredict: betiPredict.address,
      liquidityManager: liquidityManager.address,
    },
    sampleMarketId: marketId.toString(),
    deployedAt: new Date().toISOString()
  };

  console.log("\n=== Deployment Info ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
