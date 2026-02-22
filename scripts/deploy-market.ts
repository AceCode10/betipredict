import { ethers } from "hardhat";
import hre from "hardhat";

async function main() {
  console.log("=== Deploying BetiPredictMarket Contracts ===\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("ETH Balance:", ethers.formatEther(balance));

  // 1. Deploy Mock USDC (6 decimals, like real USDC)
  console.log("\n1. Deploying Mock USDC...");
  const MockToken = await ethers.getContractFactory("MockToken");
  const usdc = await MockToken.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("   Mock USDC deployed to:", usdcAddress);

  // 2. Deploy BetiPredictMarket
  console.log("\n2. Deploying BetiPredictMarket...");
  const BetiPredictMarket = await ethers.getContractFactory("BetiPredictMarket");
  const market = await BetiPredictMarket.deploy(usdcAddress, 6);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  console.log("   BetiPredictMarket deployed to:", marketAddress);

  // 3. Mint USDC for deployer (1,000,000 USDC)
  console.log("\n3. Minting 1M USDC for deployer...");
  const mintAmount = 1_000_000n * 10n ** 6n; // 1M with 6 decimals
  await usdc.mint(deployer.address, mintAmount);
  console.log("   Minted 1,000,000 USDC");

  // 4. Approve market contract to spend USDC
  console.log("\n4. Approving USDC for market contract...");
  await usdc.approve(marketAddress, mintAmount);
  console.log("   Approved");

  // 5. Create a sample market
  console.log("\n5. Creating sample market...");
  const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
  const initialLiquidity = 10_000n * 10n ** 6n; // 10,000 USDC

  const tx = await market.createMarket(
    "Will Zambia qualify for the 2026 World Cup?",
    resolveTime,
    initialLiquidity,
    ethers.ZeroAddress // owner-only resolution
  );
  const receipt = await tx.wait();
  console.log("   Sample market created (ID: 1)");

  // 6. Test a buy
  console.log("\n6. Testing a YES buy (100 USDC)...");
  const buyAmount = 100n * 10n ** 6n;
  await usdc.approve(marketAddress, buyAmount);
  const buyTx = await market.buyYes(1, buyAmount, 0);
  await buyTx.wait();

  const yesPrice = await market.getYesPrice(1);
  const noPrice = await market.getNoPrice(1);
  console.log("   YES price:", (Number(yesPrice) / 1e18 * 100).toFixed(2) + "%");
  console.log("   NO price:", (Number(noPrice) / 1e18 * 100).toFixed(2) + "%");

  const position = await market.getPosition(1, deployer.address);
  console.log("   YES shares:", position[0].toString());
  console.log("   NO shares:", position[1].toString());

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("DEPLOYMENT SUMMARY");
  console.log("=".repeat(50));
  console.log("Network:           ", hre.network.name);
  console.log("Deployer:          ", deployer.address);
  console.log("Mock USDC:         ", usdcAddress);
  console.log("BetiPredictMarket: ", marketAddress);
  console.log("Sample Market ID:   1");
  console.log("=".repeat(50));

  console.log("\nUpdate your .env.local with:");
  console.log(`NEXT_PUBLIC_MARKET_CONTRACT=${marketAddress}`);
  console.log(`NEXT_PUBLIC_USDC_CONTRACT=${usdcAddress}`);

  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    console.log("\nVerification commands:");
    console.log(`npx hardhat verify --network ${hre.network.name} ${usdcAddress} "USD Coin" "USDC" 6`);
    console.log(`npx hardhat verify --network ${hre.network.name} ${marketAddress} ${usdcAddress} 6`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
