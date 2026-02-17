const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying BetiPredict Simple contracts...");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance));

  // Deploy Mock Token
  console.log("\n1. Deploying Mock Collateral Token...");
  const MockToken = await ethers.getContractFactory("MockToken");
  const collateralToken = await MockToken.deploy("BetiPredict Collateral", "BPC", 18);
  await collateralToken.waitForDeployment();
  console.log("Collateral Token deployed to:", collateralToken.target);

  // Deploy BetiPredict Simple
  console.log("\n2. Deploying BetiPredict Simple Contract...");
  const BetiPredictSimple = await ethers.getContractFactory("BetiPredictSimple");
  const betiPredict = await BetiPredictSimple.deploy(collateralToken.target);
  await betiPredict.waitForDeployment();
  console.log("BetiPredict Simple deployed to:", betiPredict.target);

  // Mint initial tokens for testing
  console.log("\n3. Minting initial tokens...");
  const initialSupply = ethers.parseEther("1000000"); // 1M tokens
  
  await collateralToken.mint(deployer.address, initialSupply);
  console.log("Minted 1M collateral tokens to deployer");

  // Approve tokens for BetiPredict
  console.log("\n4. Approving tokens for BetiPredict...");
  await collateralToken.approve(betiPredict.target, initialSupply);
  console.log("Approved collateral tokens for BetiPredict");

  // Create a sample market
  console.log("\n5. Creating sample market...");
  const marketCreationFee = await betiPredict.marketCreationFee();
  const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days from now
  
  const tx = await betiPredict.createMarket(
    "Zambia vs Nigeria",
    "Africa Cup of Nations Qualifier match",
    "football",
    "Will Zambia win against Nigeria?",
    resolveTime,
    500000, // 0.50 YES price (scaled by 1e6)
    500000,  // 0.50 NO price (scaled by 1e6)
    { value: marketCreationFee }
  );
  
  const receipt = await tx.wait();
  const marketCreatedEvent = receipt.logs.find(log => log.fragment && log.fragment.name === "MarketCreated");
  const marketId = marketCreatedEvent ? marketCreatedEvent.args[0] : null;
  
  if (!marketId) {
    console.error("Could not find MarketCreated event");
    return;
  }
  
  console.log("Sample market created with ID:", marketId.toString());

  // Deposit tokens for trading
  console.log("\n6. Depositing tokens for trading...");
  const depositAmount = ethers.parseEther("10000"); // 10K tokens
  await betiPredict.deposit(depositAmount);
  console.log("Deposited 10K tokens for trading");

  // Place a sample order
  console.log("\n7. Placing sample order...");
  const orderAmount = ethers.parseEther("100"); // 100 tokens
  await betiPredict.placeLimitOrder(
    marketId,
    0, // Buy
    0, // Yes
    orderAmount,
    400000 // 0.40 price
  );
  console.log("Placed sample limit order");

  // Get final balances
  const deployerBalance = await collateralToken.balanceOf(deployer.address);
  const betiPredictBalance = await betiPredict.getBalance(deployer.address);

  console.log("\n=== Deployment Summary ===");
  console.log("Collateral Token:", collateralToken.target);
  console.log("BetiPredict Simple:", betiPredict.target);
  console.log("Sample Market ID:", marketId.toString());
  
  console.log("\n=== Balances ===");
  console.log("Deployer Collateral:", ethers.formatEther(deployerBalance));
  console.log("Deployer BetiPredict Balance:", ethers.formatEther(betiPredictBalance));

  console.log("\n=== Contract Verification ===");
  console.log("To verify contracts on Etherscan:");
  console.log(`npx hardhat verify --network <network> ${collateralToken.target} "BetiPredict Collateral" "BPC" 18`);
  console.log(`npx hardhat verify --network <network> ${betiPredict.target} ${collateralToken.target}`);

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    deployer: deployer.address,
    contracts: {
      collateralToken: collateralToken.target,
      betiPredict: betiPredict.target,
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
