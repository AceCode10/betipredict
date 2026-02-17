import { expect } from "chai";
import { ethers } from "hardhat";
import { BetiPredict, MockToken } from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("BetiPredict", function () {
  let betiPredict: BetiPredict;
  let collateralToken: MockToken;
  let rewardToken: MockToken;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy MockToken
    const MockToken = await ethers.getContractFactory("MockToken");
    collateralToken = await MockToken.deploy("BetiPredict Collateral", "BPC", 18);
    await collateralToken.deployed();

    rewardToken = await MockToken.deploy("BetiPredict Rewards", "BPR", 18);
    await rewardToken.deployed();

    // Deploy BetiPredict
    const BetiPredict = await ethers.getContractFactory("BetiPredict");
    betiPredict = await BetiPredict.deploy(collateralToken.address);
    await betiPredict.deployed();

    // Mint tokens for testing
    const initialSupply = ethers.utils.parseEther("1000000");
    await collateralToken.mint(owner.address, initialSupply);
    await collateralToken.mint(user1.address, initialSupply);
    await collateralToken.mint(user2.address, initialSupply);
    await collateralToken.mint(user3.address, initialSupply);

    // Approve tokens
    await collateralToken.connect(user1).approve(betiPredict.address, initialSupply);
    await collateralToken.connect(user2).approve(betiPredict.address, initialSupply);
    await collateralToken.connect(user3).approve(betiPredict.address, initialSupply);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await betiPredict.owner()).to.equal(owner.address);
    });

    it("Should set the correct collateral token", async function () {
      expect(await betiPredict.collateralToken()).to.equal(collateralToken.address);
    });

    it("Should set default market creation fee", async function () {
      expect(await betiPredict.marketCreationFee()).to.equal(ethers.utils.parseEther("0.01"));
    });
  });

  describe("Market Creation", function () {
    it("Should create a market with valid parameters", async function () {
      const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
      const marketCreationFee = await betiPredict.marketCreationFee();

      const tx = await betiPredict.connect(user1).createMarket(
        "Test Market",
        "Test Description",
        "football",
        "premier-league",
        "Will Team A win?",
        resolveTime,
        500000, // 0.50 YES price
        500000  // 0.50 NO price
      );

      const receipt = await tx.wait();
      const marketCreatedEvent = receipt.events?.find(e => e.event === "MarketCreated");
      const marketId = marketCreatedEvent?.args?.marketId;

      expect(marketId).to.equal(1);

      const market = await betiPredict.getMarket(marketId);
      expect(market.title).to.equal("Test Market");
      expect(market.creator).to.equal(user1.address);
      expect(market.status).to.equal(1); // Active
      expect(market.yesPrice).to.equal(500000);
      expect(market.noPrice).to.equal(500000);
    });

    it("Should fail with invalid resolve time", async function () {
      const pastTime = Math.floor(Date.now() / 1000) - 3600;

      await expect(
        betiPredict.connect(user1).createMarket(
          "Test Market",
          "Test Description",
          "football",
          "premier-league",
          "Will Team A win?",
          pastTime,
          500000,
          500000
        )
      ).to.be.revertedWith("Invalid resolve time");
    });

    it("Should fail with prices that don't sum to 1", async function () {
      const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

      await expect(
        betiPredict.connect(user1).createMarket(
          "Test Market",
          "Test Description",
          "football",
          "premier-league",
          "Will Team A win?",
          resolveTime,
          600000, // 0.60 YES price
          500000  // 0.50 NO price (sums to 1.10)
        )
      ).to.be.revertedWith("Prices must sum to 1");
    });
  });

  describe("Order Placement", function () {
    let marketId: number;

    beforeEach(async function () {
      const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
      const marketCreationFee = await betiPredict.marketCreationFee();

      const tx = await betiPredict.connect(user1).createMarket(
        "Test Market",
        "Test Description",
        "football",
        "premier-league",
        "Will Team A win?",
        resolveTime,
        500000,
        500000
      );

      const receipt = await tx.wait();
      const marketCreatedEvent = receipt.events?.find(e => e.event === "MarketCreated");
      marketId = marketCreatedEvent?.args?.marketId;
    });

    it("Should place a limit buy order", async function () {
      const amount = ethers.utils.parseEther("100");
      const price = 400000; // 0.40

      await betiPredict.connect(user1).deposit(amount);

      const tx = await betiPredict.connect(user1).placeLimitOrder(
        marketId,
        0, // Buy
        0, // Yes
        amount,
        price
      );

      const receipt = await tx.wait();
      const orderPlacedEvent = receipt.events?.find(e => e.event === "OrderPlaced");
      const orderId = orderPlacedEvent?.args?.orderId;

      expect(orderId).to.equal(1);

      const order = await betiPredict.getOrder(orderId);
      expect(order.trader).to.equal(user1.address);
      expect(order.side).to.equal(0); // Buy
      expect(order.amount).to.equal(amount);
      expect(order.price).to.equal(price);
    });

    it("Should place a market buy order", async function () {
      const amount = ethers.utils.parseEther("100");

      await betiPredict.connect(user1).deposit(amount);

      const tx = await betiPredict.connect(user1).placeMarketOrder(
        marketId,
        0, // Buy
        0, // Yes
        amount
      );

      const receipt = await tx.wait();
      const orderPlacedEvent = receipt.events?.find(e => e.event === "OrderPlaced");
      const orderId = orderPlacedEvent?.args?.orderId;

      expect(orderId).to.equal(1);

      const order = await betiPredict.getOrder(orderId);
      expect(order.trader).to.equal(user1.address);
      expect(order.side).to.equal(0); // Buy
      expect(order.status).to.equal(1); // Filled
    });

    it("Should fail with insufficient balance", async function () {
      const amount = ethers.utils.parseEther("1000000"); // More than user has

      await expect(
        betiPredict.connect(user1).placeLimitOrder(
          marketId,
          0, // Buy
          0, // Yes
          amount,
          400000
        )
      ).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Liquidity Management", function () {
    let marketId: number;

    beforeEach(async function () {
      const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

      const tx = await betiPredict.connect(user1).createMarket(
        "Test Market",
        "Test Description",
        "football",
        "premier-league",
        "Will Team A win?",
        resolveTime,
        500000,
        500000
      );

      const receipt = await tx.wait();
      const marketCreatedEvent = receipt.events?.find(e => e.event === "MarketCreated");
      marketId = marketCreatedEvent?.args?.marketId;
    });

    it("Should add liquidity", async function () {
      const amount = ethers.utils.parseEther("1000");

      await betiPredict.connect(user1).deposit(amount);

      const tx = await betiPredict.connect(user1).addLiquidity(marketId, amount);
      
      const receipt = await tx.wait();
      const liquidityAddedEvent = receipt.events?.find(e => e.event === "LiquidityAdded");
      
      expect(liquidityAddedEvent).to.exist;

      const market = await betiPredict.getMarket(marketId);
      expect(market.liquidity).to.equal(amount);
    });

    it("Should remove liquidity", async function () {
      const amount = ethers.utils.parseEther("1000");

      await betiPredict.connect(user1).deposit(amount);
      await betiPredict.connect(user1).addLiquidity(marketId, amount);

      const tx = await betiPredict.connect(user1).removeLiquidity(marketId, amount);
      
      const receipt = await tx.wait();
      const liquidityRemovedEvent = receipt.events?.find(e => e.event === "LiquidityRemoved");
      
      expect(liquidityRemovedEvent).to.exist;
    });
  });

  describe("Market Resolution", function () {
    let marketId: number;

    beforeEach(async function () {
      const resolveTime = Math.floor(Date.now() / 1000) + 1; // 1 second from now

      const tx = await betiPredict.connect(user1).createMarket(
        "Test Market",
        "Test Description",
        "football",
        "premier-league",
        "Will Team A win?",
        resolveTime,
        500000,
        500000
      );

      const receipt = await tx.wait();
      const marketCreatedEvent = receipt.events?.find(e => e.event === "MarketCreated");
      marketId = marketCreatedEvent?.args?.marketId;

      // Wait for market to expire
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    it("Should resolve market as YES", async function () {
      const tx = await betiPredict.connect(user1).resolveMarket(marketId, 0); // Yes
      
      const receipt = await tx.wait();
      const marketResolvedEvent = receipt.events?.find(e => e.event === "MarketResolved");
      
      expect(marketResolvedEvent).to.exist;
      expect(marketResolvedEvent?.args?.resolution).to.equal(0); // Yes

      const market = await betiPredict.getMarket(marketId);
      expect(market.status).to.equal(2); // Resolved
      expect(market.resolution).to.equal(0); // Yes
    });

    it("Should fail to resolve before expiry", async function () {
      // Create a new market that hasn't expired
      const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

      const tx = await betiPredict.connect(user2).createMarket(
        "Future Market",
        "Test Description",
        "football",
        "premier-league",
        "Will Team B win?",
        resolveTime,
        500000,
        500000
      );

      const receipt = await tx.wait();
      const marketCreatedEvent = receipt.events?.find(e => e.event === "MarketCreated");
      const newMarketId = marketCreatedEvent?.args?.marketId;

      await expect(
        betiPredict.connect(user2).resolveMarket(newMarketId, 0)
      ).to.be.revertedWith("Market not expired");
    });
  });

  describe("Deposits and Withdrawals", function () {
    it("Should deposit tokens", async function () {
      const amount = ethers.utils.parseEther("100");

      await collateralToken.connect(user1).approve(betiPredict.address, amount);
      await betiPredict.connect(user1).deposit(amount);

      const balance = await betiPredict.getBalance(user1.address);
      expect(balance).to.equal(amount);
    });

    it("Should withdraw tokens", async function () {
      const amount = ethers.utils.parseEther("100");

      await collateralToken.connect(user1).approve(betiPredict.address, amount);
      await betiPredict.connect(user1).deposit(amount);
      await betiPredict.connect(user1).withdraw(amount);

      const balance = await betiPredict.getBalance(user1.address);
      expect(balance).to.equal(0);
    });

    it("Should fail withdrawal with insufficient balance", async function () {
      const amount = ethers.utils.parseEther("100");

      await expect(
        betiPredict.connect(user1).withdraw(amount)
      ).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Position Management", function () {
    let marketId: number;

    beforeEach(async function () {
      const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

      const tx = await betiPredict.connect(user1).createMarket(
        "Test Market",
        "Test Description",
        "football",
        "premier-league",
        "Will Team A win?",
        resolveTime,
        500000,
        500000
      );

      const receipt = await tx.wait();
      const marketCreatedEvent = receipt.events?.find(e => e.event === "MarketCreated");
      marketId = marketCreatedEvent?.args?.marketId;
    });

    it("Should create position after buy order", async function () {
      const amount = ethers.utils.parseEther("100");

      await betiPredict.connect(user1).deposit(amount);
      await betiPredict.connect(user1).placeMarketOrder(marketId, 0, 0, amount);

      const position = await betiPredict.getPosition(user1.address, marketId);
      expect(position.amount).to.equal(amount);
      expect(position.outcome).to.equal(0); // Yes
    });

    it("Should update position on additional orders", async function () {
      const amount = ethers.utils.parseEther("100");

      await betiPredict.connect(user1).deposit(amount);
      await betiPredict.connect(user1).placeMarketOrder(marketId, 0, 0, amount);
      await betiPredict.connect(user1).placeMarketOrder(marketId, 0, 0, amount);

      const position = await betiPredict.getPosition(user1.address, marketId);
      expect(position.amount).to.equal(amount.mul(2));
    });
  });

  describe("Gas Optimization", function () {
    it("Should measure gas usage for market creation", async function () {
      const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

      const tx = await betiPredict.connect(user1).createMarket(
        "Test Market",
        "Test Description",
        "football",
        "premier-league",
        "Will Team A win?",
        resolveTime,
        500000,
        500000
      );

      const receipt = await tx.wait();
      console.log("Market creation gas:", receipt.gasUsed.toString());
    });

    it("Should measure gas usage for limit order", async function () {
      const resolveTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

      const tx = await betiPredict.connect(user1).createMarket(
        "Test Market",
        "Test Description",
        "football",
        "premier-league",
        "Will Team A win?",
        resolveTime,
        500000,
        500000
      );

      const receipt = await tx.wait();
      const marketCreatedEvent = receipt.events?.find(e => e.event === "MarketCreated");
      const marketId = marketCreatedEvent?.args?.marketId;

      const amount = ethers.utils.parseEther("100");
      await betiPredict.connect(user1).deposit(amount);

      const orderTx = await betiPredict.connect(user1).placeLimitOrder(
        marketId,
        0,
        0,
        amount,
        400000
      );

      const orderReceipt = await orderTx.wait();
      console.log("Limit order gas:", orderReceipt.gasUsed.toString());
    });
  });
});
