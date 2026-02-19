import { ethers } from "hardhat";

async function main() {
  console.log("Starting deployment...");

  // Deploy the MockToken first (for testing)
  console.log("Deploying MockToken...");
  const MockToken = await ethers.getContractFactory("MockToken");
  const mockToken = await MockToken.deploy();
  await mockToken.deployed();
  console.log("MockToken deployed to:", mockToken.address);

  // Deploy the main BetiPredictSimple contract
  console.log("Deploying BetiPredictSimple...");
  const BetiPredictSimple = await ethers.getContractFactory("BetiPredictSimple");
  const betiPredict = await BetiPredictSimple.deploy(mockToken.address);
  await betiPredict.deployed();

  console.log("BetiPredictSimple deployed to:", betiPredict.address);
  console.log("Transaction hash:", betiPredict.deployTransaction.hash);

  // Save the addresses for later use
  console.log("\n=== SAVE THESE ADDRESSES ===");
  console.log("MockToken:", mockToken.address);
  console.log("BetiPredictSimple:", betiPredict.address);
  console.log("===============================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
