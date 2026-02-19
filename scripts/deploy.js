const { ethers } = require("hardhat");

async function main() {
  console.log("Starting deployment...");

  // Deploy the MockToken first (for testing)
  console.log("Deploying MockToken...");
  const MockToken = await ethers.getContractFactory("MockToken");
  const mockToken = await MockToken.deploy("MockToken", "MOCK", 18);
  await mockToken.waitForDeployment();
  console.log("MockToken deployed to:", await mockToken.getAddress());

  // Deploy the main BetiPredictSimple contract
  console.log("Deploying BetiPredictSimple...");
  const BetiPredictSimple = await ethers.getContractFactory("BetiPredictSimple");
  const betiPredict = await BetiPredictSimple.deploy(await mockToken.getAddress());
  await betiPredict.waitForDeployment();

  console.log("BetiPredictSimple deployed to:", await betiPredict.getAddress());
  console.log("Transaction hash:", betiPredict.deploymentTransaction().hash);

  // Save the addresses for later use
  console.log("\n=== SAVE THESE ADDRESSES ===");
  console.log("MockToken:", await mockToken.getAddress());
  console.log("BetiPredictSimple:", await betiPredict.getAddress());
  console.log("===============================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
