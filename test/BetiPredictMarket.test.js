const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("BetiPredictMarket", function () {
  async function deployFixture() {
    const [owner, user1, user2, resolver] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    const usdc = await MockToken.deploy("USD Coin", "USDC", 6);

    const BetiPredictMarket = await ethers.getContractFactory("BetiPredictMarket");
    const market = await BetiPredictMarket.deploy(await usdc.getAddress(), 6);

    const usdcAddr = await usdc.getAddress();
    const marketAddr = await market.getAddress();

    const mintAmount = 100_000n * 10n ** 6n;
    await usdc.mint(owner.address, mintAmount);
    await usdc.mint(user1.address, mintAmount);
    await usdc.mint(user2.address, mintAmount);

    await usdc.connect(owner).approve(marketAddr, mintAmount);
    await usdc.connect(user1).approve(marketAddr, mintAmount);
    await usdc.connect(user2).approve(marketAddr, mintAmount);

    return { market, usdc, owner, user1, user2, resolver, marketAddr, usdcAddr };
  }

  const LIQUIDITY = 10_000n * 10n ** 6n; // 10,000 USDC (6 decimals)
  const futureTime = () => Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { market, owner } = await loadFixture(deployFixture);
      expect(await market.owner()).to.equal(owner.address);
    });

    it("Should set the correct collateral token", async function () {
      const { market, usdcAddr } = await loadFixture(deployFixture);
      expect(await market.collateralToken()).to.equal(usdcAddr);
    });

    it("Should have correct initial trading fee (2%)", async function () {
      const { market } = await loadFixture(deployFixture);
      expect(await market.tradingFee()).to.equal(200);
    });
  });

  describe("Market Creation", function () {
    it("Should create a market with valid parameters", async function () {
      const { market, owner } = await loadFixture(deployFixture);
      const resolve = futureTime();

      const tx = await market.createMarket("Will it rain?", resolve, LIQUIDITY, ethers.ZeroAddress);
      await expect(tx).to.emit(market, "MarketCreated");
      expect(await market.marketCount()).to.equal(1);
    });

    it("Should set equal YES/NO pools on creation", async function () {
      const { market } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const m = await market.getMarket(1);
      expect(m.yesPool).to.equal(LIQUIDITY);
      expect(m.noPool).to.equal(LIQUIDITY);
    });

    it("Should have 50/50 prices at creation", async function () {
      const { market } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const yesPrice = await market.getYesPrice(1);
      const noPrice = await market.getNoPrice(1);
      expect(yesPrice).to.equal(ethers.parseEther("0.5"));
      expect(noPrice).to.equal(ethers.parseEther("0.5"));
    });

    it("Should fail with empty question", async function () {
      const { market } = await loadFixture(deployFixture);
      await expect(market.createMarket("", futureTime(), LIQUIDITY, ethers.ZeroAddress))
        .to.be.revertedWith("Empty question");
    });

    it("Should fail with past resolve time", async function () {
      const { market } = await loadFixture(deployFixture);
      const pastTime = Math.floor(Date.now() / 1000) - 3600;
      await expect(market.createMarket("Test?", pastTime, LIQUIDITY, ethers.ZeroAddress))
        .to.be.revertedWith("Resolve time must be future");
    });

    it("Should fail with insufficient liquidity", async function () {
      const { market } = await loadFixture(deployFixture);
      await expect(market.createMarket("Test?", futureTime(), 500, ethers.ZeroAddress))
        .to.be.revertedWith("Liquidity too low");
    });
  });

  describe("Trading - Buy", function () {
    it("Should buy YES shares and move price up", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const buyAmount = 1000n * 10n ** 6n;
      const tx = await market.connect(user1).buyYes(1, buyAmount, 0);
      await expect(tx).to.emit(market, "SharesPurchased");

      const yesPrice = await market.getYesPrice(1);
      expect(yesPrice).to.be.gt(ethers.parseEther("0.5"));

      const pos = await market.getPosition(1, user1.address);
      expect(pos.yesAmount).to.be.gt(0);
      expect(pos.noAmount).to.equal(0);
    });

    it("Should buy NO shares and move NO price up", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const buyAmount = 1000n * 10n ** 6n;
      await market.connect(user1).buyNo(1, buyAmount, 0);

      const noPrice = await market.getNoPrice(1);
      expect(noPrice).to.be.gt(ethers.parseEther("0.5"));

      const pos = await market.getPosition(1, user1.address);
      expect(pos.noAmount).to.be.gt(0);
    });

    it("Should deduct trading fee (2%)", async function () {
      const { market, user1, usdc } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const buyAmount = 1000n * 10n ** 6n;
      const balBefore = await usdc.balanceOf(user1.address);
      await market.connect(user1).buyYes(1, buyAmount, 0);
      const balAfter = await usdc.balanceOf(user1.address);

      expect(balBefore - balAfter).to.equal(buyAmount);

      const platformBal = await market.platformBalance();
      const expectedFee = (buyAmount * 200n) / 10000n;
      expect(platformBal).to.equal(expectedFee);
    });

    it("Should respect slippage protection", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const buyAmount = 100n * 10n ** 6n;
      const absurdMinShares = 10_000n * 10n ** 6n;

      await expect(market.connect(user1).buyYes(1, buyAmount, absurdMinShares))
        .to.be.revertedWith("Slippage: insufficient shares");
    });

    it("Should increase volume on trades", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const buyAmount = 500n * 10n ** 6n;
      await market.connect(user1).buyYes(1, buyAmount, 0);

      const m = await market.getMarket(1);
      expect(m.totalVolume).to.equal(buyAmount);
    });
  });

  describe("Trading - Sell", function () {
    it("Should sell YES shares back for collateral", async function () {
      const { market, user1, usdc } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const buyAmount = 1000n * 10n ** 6n;
      await market.connect(user1).buyYes(1, buyAmount, 0);

      const pos = await market.getPosition(1, user1.address);
      const sharesToSell = pos.yesAmount;

      const balBefore = await usdc.balanceOf(user1.address);
      await market.connect(user1).sellYes(1, sharesToSell, 0);
      const balAfter = await usdc.balanceOf(user1.address);

      expect(balAfter).to.be.gt(balBefore);

      const posAfter = await market.getPosition(1, user1.address);
      expect(posAfter.yesAmount).to.equal(0);
    });

    it("Should fail selling more shares than owned", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      await expect(market.connect(user1).sellYes(1, 1000, 0))
        .to.be.revertedWith("Insufficient YES shares");
    });
  });

  describe("Resolution", function () {
    it("Owner should resolve market as YES", async function () {
      const { market, owner } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const tx = await market.resolveMarket(1, 1); // Outcome.Yes = 1
      await expect(tx).to.emit(market, "MarketResolved").withArgs(1, 1, owner.address);

      const m = await market.getMarket(1);
      expect(m.status).to.equal(1); // Resolved
      expect(m.resolution).to.equal(1); // Yes
    });

    it("Authorized resolver should be able to resolve", async function () {
      const { market, resolver } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);
      await market.setResolver(resolver.address, true);

      await expect(market.connect(resolver).resolveMarket(1, 2)).to.not.be.reverted;
    });

    it("Non-authorized user should not resolve", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      await expect(market.connect(user1).resolveMarket(1, 1))
        .to.be.revertedWith("Not authorized to resolve");
    });

    it("Should fail resolving with invalid outcome (None)", async function () {
      const { market } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      await expect(market.resolveMarket(1, 0))
        .to.be.revertedWith("Invalid outcome");
    });
  });

  describe("Claims", function () {
    it("YES winners should claim winnings after resolution", async function () {
      const { market, user1, usdc } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const buyAmount = 1000n * 10n ** 6n;
      await market.connect(user1).buyYes(1, buyAmount, 0);

      const pos = await market.getPosition(1, user1.address);
      const winningShares = pos.yesAmount;

      await market.resolveMarket(1, 1); // YES wins

      const balBefore = await usdc.balanceOf(user1.address);
      const tx = await market.connect(user1).claimWinnings(1);
      await expect(tx).to.emit(market, "WinningsClaimed");
      const balAfter = await usdc.balanceOf(user1.address);

      expect(balAfter - balBefore).to.equal(winningShares);
    });

    it("NO winners should claim winnings", async function () {
      const { market, user1, usdc } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const buyAmount = 1000n * 10n ** 6n;
      await market.connect(user1).buyNo(1, buyAmount, 0);

      const pos = await market.getPosition(1, user1.address);
      const winningShares = pos.noAmount;

      await market.resolveMarket(1, 2); // NO wins

      const balBefore = await usdc.balanceOf(user1.address);
      await market.connect(user1).claimWinnings(1);
      const balAfter = await usdc.balanceOf(user1.address);

      expect(balAfter - balBefore).to.equal(winningShares);
    });

    it("Losers should not be able to claim", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      await market.connect(user1).buyYes(1, 1000n * 10n ** 6n, 0);
      await market.resolveMarket(1, 2); // NO wins, user has YES

      await expect(market.connect(user1).claimWinnings(1))
        .to.be.revertedWith("No winning shares");
    });

    it("Should not allow double claim", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      await market.connect(user1).buyYes(1, 1000n * 10n ** 6n, 0);
      await market.resolveMarket(1, 1);

      await market.connect(user1).claimWinnings(1);
      await expect(market.connect(user1).claimWinnings(1))
        .to.be.revertedWith("Already claimed");
    });
  });

  describe("Cancellation & Refund", function () {
    it("Should cancel market and allow refunds", async function () {
      const { market, user1, usdc } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      await market.connect(user1).buyYes(1, 1000n * 10n ** 6n, 0);

      await market.cancelMarket(1);

      const balBefore = await usdc.balanceOf(user1.address);
      await market.connect(user1).claimRefund(1);
      const balAfter = await usdc.balanceOf(user1.address);

      expect(balAfter).to.be.gt(balBefore);
    });
  });

  describe("View Functions", function () {
    it("estimateBuy should match actual buy", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      const buyAmount = 500n * 10n ** 6n;
      const estimate = await market.estimateBuy(1, 1, buyAmount); // Outcome.Yes = 1

      await market.connect(user1).buyYes(1, buyAmount, 0);
      const pos = await market.getPosition(1, user1.address);

      expect(pos.yesAmount).to.equal(estimate.sharesOut);
    });
  });

  describe("Admin", function () {
    it("Should update trading fee", async function () {
      const { market } = await loadFixture(deployFixture);
      await market.setTradingFee(100); // 1%
      expect(await market.tradingFee()).to.equal(100);
    });

    it("Should not allow fee > 10%", async function () {
      const { market } = await loadFixture(deployFixture);
      await expect(market.setTradingFee(1001)).to.be.revertedWith("Fee too high");
    });

    it("Should withdraw platform fees", async function () {
      const { market, user1, owner, usdc } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      await market.connect(user1).buyYes(1, 1000n * 10n ** 6n, 0);

      const platformBal = await market.platformBalance();
      expect(platformBal).to.be.gt(0);

      const ownerBalBefore = await usdc.balanceOf(owner.address);
      await market.withdrawFees(owner.address);
      const ownerBalAfter = await usdc.balanceOf(owner.address);

      expect(ownerBalAfter - ownerBalBefore).to.equal(platformBal);
      expect(await market.platformBalance()).to.equal(0);
    });

    it("Should pause and unpause", async function () {
      const { market, user1 } = await loadFixture(deployFixture);
      await market.createMarket("Test?", futureTime(), LIQUIDITY, ethers.ZeroAddress);

      await market.pause();
      await expect(market.connect(user1).buyYes(1, 100n * 10n ** 6n, 0))
        .to.be.reverted;

      await market.unpause();
      await expect(market.connect(user1).buyYes(1, 100n * 10n ** 6n, 0))
        .to.not.be.reverted;
    });
  });
});
