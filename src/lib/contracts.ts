import { ethers } from 'ethers'
import { useWallet } from '@/components/WalletConnect'

// ──────────────────────────────────────────────
//  ABIs — BetiPredictMarket (CPMM) + ERC20
// ──────────────────────────────────────────────
const BETI_MARKET_ABI = [
  // Market lifecycle
  "function createMarket(string question, uint256 resolveTime, uint256 initialLiquidity, address resolver) external returns (uint256)",
  "function resolveMarket(uint256 marketId, uint8 resolution) external",
  "function cancelMarket(uint256 marketId) external",
  // Trading
  "function buyYes(uint256 marketId, uint256 amount, uint256 minShares) external returns (uint256)",
  "function buyNo(uint256 marketId, uint256 amount, uint256 minShares) external returns (uint256)",
  "function sellYes(uint256 marketId, uint256 shares, uint256 minCollateral) external returns (uint256)",
  "function sellNo(uint256 marketId, uint256 shares, uint256 minCollateral) external returns (uint256)",
  // Claims
  "function claimWinnings(uint256 marketId) external",
  "function claimRefund(uint256 marketId) external",
  // Views
  "function getMarket(uint256 marketId) external view returns (uint256 id, string question, uint256 resolveTime, uint256 yesPool, uint256 noPool, uint256 totalVolume, uint8 status, uint8 resolution, address creator, uint256 createdAt)",
  "function getPosition(uint256 marketId, address user) external view returns (uint256 yesAmount, uint256 noAmount, bool hasClaimed)",
  "function getYesPrice(uint256 marketId) external view returns (uint256)",
  "function getNoPrice(uint256 marketId) external view returns (uint256)",
  "function estimateBuy(uint256 marketId, uint8 outcome, uint256 amount) external view returns (uint256 sharesOut, uint256 fee)",
  "function estimateSell(uint256 marketId, uint8 outcome, uint256 shares) external view returns (uint256 collateralOut, uint256 fee)",
  "function marketCount() external view returns (uint256)",
  "function tradingFee() external view returns (uint256)",
  "function platformBalance() external view returns (uint256)",
  "function collateralToken() external view returns (address)",
  "function collateralDecimals() external view returns (uint8)",
  // Admin
  "function setTradingFee(uint256 fee) external",
  "function setResolver(address resolver, bool authorized) external",
  "function withdrawFees(address to) external",
  "function pause() external",
  "function unpause() external",
  "function owner() external view returns (address)",
  // Events
  "event MarketCreated(uint256 indexed marketId, string question, uint256 resolveTime, address indexed creator, uint256 initialLiquidity)",
  "event SharesPurchased(uint256 indexed marketId, address indexed buyer, uint8 outcome, uint256 collateralIn, uint256 sharesOut, uint256 fee)",
  "event SharesSold(uint256 indexed marketId, address indexed seller, uint8 outcome, uint256 sharesIn, uint256 collateralOut, uint256 fee)",
  "event MarketResolved(uint256 indexed marketId, uint8 resolution, address indexed resolver)",
  "event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 payout)",
]

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function transfer(address to, uint256 amount) external returns (bool)",
]

// ──────────────────────────────────────────────
//  Contract addresses per network
//  Update after each deployment
// ──────────────────────────────────────────────
export const CONTRACT_ADDRESSES: Record<string, { market: string; collateral: string }> = {
  localhost: {
    market: process.env.NEXT_PUBLIC_MARKET_CONTRACT || '',
    collateral: process.env.NEXT_PUBLIC_USDC_CONTRACT || '',
  },
  baseSepolia: {
    market: process.env.NEXT_PUBLIC_MARKET_CONTRACT || '',
    collateral: process.env.NEXT_PUBLIC_USDC_CONTRACT || '',
  },
  base: {
    market: process.env.NEXT_PUBLIC_MARKET_CONTRACT || '',
    collateral: process.env.NEXT_PUBLIC_USDC_CONTRACT || '',
  },
}

// ──────────────────────────────────────────────
//  Network helpers
// ──────────────────────────────────────────────
export function getNetworkName(chainId: number): string {
  switch (chainId) {
    case 31337:
    case 1337:   return 'localhost'
    case 84532:  return 'baseSepolia'
    case 8453:   return 'base'
    default:     return 'localhost'
  }
}

export const COLLATERAL_DECIMALS = 6 // USDC uses 6 decimals

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────
export interface OnChainMarket {
  id: number
  question: string
  resolveTime: number
  yesPool: bigint
  noPool: bigint
  totalVolume: bigint
  status: number        // 0=Active, 1=Resolved, 2=Cancelled
  resolution: number    // 0=None, 1=Yes, 2=No
  creator: string
  createdAt: number
}

export interface Position {
  yesAmount: bigint
  noAmount: bigint
  hasClaimed: boolean
}

export interface TradeEstimate {
  sharesOut: bigint
  fee: bigint
}

// ──────────────────────────────────────────────
//  ContractService — unified contract interface
// ──────────────────────────────────────────────
export class ContractService {
  public marketContract: ethers.Contract
  public tokenContract: ethers.Contract
  public readonly networkName: string

  constructor(private signer: ethers.JsonRpcSigner, public chainId: number) {
    this.networkName = getNetworkName(chainId)
    const addrs = CONTRACT_ADDRESSES[this.networkName]

    if (!addrs?.market || !addrs?.collateral) {
      throw new Error(`Contracts not deployed on ${this.networkName}. Set NEXT_PUBLIC_MARKET_CONTRACT and NEXT_PUBLIC_USDC_CONTRACT in .env.local`)
    }

    this.marketContract = new ethers.Contract(addrs.market, BETI_MARKET_ABI, signer)
    this.tokenContract = new ethers.Contract(addrs.collateral, ERC20_ABI, signer)
  }

  // ── Helpers ────────────────────────────────
  private toUnits(amount: number): bigint {
    return ethers.parseUnits(amount.toString(), COLLATERAL_DECIMALS)
  }

  private fromUnits(wei: bigint): number {
    return Number(ethers.formatUnits(wei, COLLATERAL_DECIMALS))
  }

  private async ensureAllowance(amount: bigint) {
    const owner = await this.signer.getAddress()
    const marketAddr = await this.marketContract.getAddress()
    const current: bigint = await this.tokenContract.allowance(owner, marketAddr)
    if (current < amount) {
      const tx = await this.tokenContract.approve(marketAddr, ethers.MaxUint256)
      await tx.wait()
    }
  }

  // ── Market Reads ───────────────────────────
  async getMarketCount(): Promise<number> {
    return Number(await this.marketContract.marketCount())
  }

  async getMarket(id: number): Promise<OnChainMarket> {
    const m = await this.marketContract.getMarket(id)
    return {
      id: Number(m.id),
      question: m.question,
      resolveTime: Number(m.resolveTime),
      yesPool: m.yesPool,
      noPool: m.noPool,
      totalVolume: m.totalVolume,
      status: Number(m.status),
      resolution: Number(m.resolution),
      creator: m.creator,
      createdAt: Number(m.createdAt),
    }
  }

  async getYesPrice(id: number): Promise<number> {
    const p = await this.marketContract.getYesPrice(id)
    return Number(p) / 1e18
  }

  async getNoPrice(id: number): Promise<number> {
    const p = await this.marketContract.getNoPrice(id)
    return Number(p) / 1e18
  }

  async getPosition(marketId: number, user?: string): Promise<Position> {
    const addr = user || await this.signer.getAddress()
    const pos = await this.marketContract.getPosition(marketId, addr)
    return {
      yesAmount: pos.yesAmount,
      noAmount: pos.noAmount,
      hasClaimed: pos.hasClaimed,
    }
  }

  // ── Token Reads ────────────────────────────
  async getTokenBalance(user?: string): Promise<number> {
    const addr = user || await this.signer.getAddress()
    const bal = await this.tokenContract.balanceOf(addr)
    return this.fromUnits(bal)
  }

  async getTokenSymbol(): Promise<string> {
    return await this.tokenContract.symbol()
  }

  // ── Trading ────────────────────────────────
  async estimateBuy(marketId: number, outcome: 'YES' | 'NO', amount: number): Promise<{ shares: number; fee: number }> {
    const outcomeEnum = outcome === 'YES' ? 1 : 2
    const amtUnits = this.toUnits(amount)
    const est = await this.marketContract.estimateBuy(marketId, outcomeEnum, amtUnits)
    return { shares: this.fromUnits(est.sharesOut), fee: this.fromUnits(est.fee) }
  }

  async estimateSell(marketId: number, outcome: 'YES' | 'NO', shares: bigint): Promise<{ collateral: number; fee: number }> {
    const outcomeEnum = outcome === 'YES' ? 1 : 2
    const est = await this.marketContract.estimateSell(marketId, outcomeEnum, shares)
    return { collateral: this.fromUnits(est.collateralOut), fee: this.fromUnits(est.fee) }
  }

  async buyYes(marketId: number, amount: number, minShares: number = 0): Promise<ethers.TransactionResponse> {
    const amtUnits = this.toUnits(amount)
    await this.ensureAllowance(amtUnits)
    const minUnits = this.toUnits(minShares)
    return await this.marketContract.buyYes(marketId, amtUnits, minUnits)
  }

  async buyNo(marketId: number, amount: number, minShares: number = 0): Promise<ethers.TransactionResponse> {
    const amtUnits = this.toUnits(amount)
    await this.ensureAllowance(amtUnits)
    const minUnits = this.toUnits(minShares)
    return await this.marketContract.buyNo(marketId, amtUnits, minUnits)
  }

  async sellYes(marketId: number, shares: bigint, minCollateral: number = 0): Promise<ethers.TransactionResponse> {
    const minUnits = this.toUnits(minCollateral)
    return await this.marketContract.sellYes(marketId, shares, minUnits)
  }

  async sellNo(marketId: number, shares: bigint, minCollateral: number = 0): Promise<ethers.TransactionResponse> {
    const minUnits = this.toUnits(minCollateral)
    return await this.marketContract.sellNo(marketId, shares, minUnits)
  }

  // ── Claims ─────────────────────────────────
  async claimWinnings(marketId: number): Promise<ethers.TransactionResponse> {
    return await this.marketContract.claimWinnings(marketId)
  }

  async claimRefund(marketId: number): Promise<ethers.TransactionResponse> {
    return await this.marketContract.claimRefund(marketId)
  }

  // ── Market Creation ────────────────────────
  async createMarket(question: string, resolveTime: number, initialLiquidity: number, resolver?: string): Promise<{ tx: ethers.TransactionResponse; marketId: number }> {
    const liqUnits = this.toUnits(initialLiquidity)
    await this.ensureAllowance(liqUnits)
    const tx = await this.marketContract.createMarket(
      question,
      resolveTime,
      liqUnits,
      resolver || ethers.ZeroAddress
    )
    const receipt = await tx.wait()
    const log = receipt?.logs?.find((l: any) => l.fragment?.name === 'MarketCreated')
    const marketId = log?.args?.[0] ? Number(log.args[0]) : 0
    return { tx, marketId }
  }

  // ── Resolution (admin) ─────────────────────
  async resolveMarket(marketId: number, outcome: 'YES' | 'NO'): Promise<ethers.TransactionResponse> {
    const outcomeEnum = outcome === 'YES' ? 1 : 2
    return await this.marketContract.resolveMarket(marketId, outcomeEnum)
  }

  async cancelMarket(marketId: number): Promise<ethers.TransactionResponse> {
    return await this.marketContract.cancelMarket(marketId)
  }

  // ── Event Listeners ────────────────────────
  onSharesPurchased(cb: (marketId: number, buyer: string, outcome: number, amount: bigint, shares: bigint) => void) {
    this.marketContract.on('SharesPurchased', (marketId, buyer, outcome, collateralIn, sharesOut) => {
      cb(Number(marketId), buyer, Number(outcome), collateralIn, sharesOut)
    })
  }

  onMarketResolved(cb: (marketId: number, resolution: number) => void) {
    this.marketContract.on('MarketResolved', (marketId, resolution) => {
      cb(Number(marketId), Number(resolution))
    })
  }

  removeAllListeners() {
    this.marketContract.removeAllListeners()
  }
}

// ──────────────────────────────────────────────
//  React hook — returns null when wallet disconnected
// ──────────────────────────────────────────────
export function useContractService(): ContractService | null {
  const { signer, chainId, isConnected } = useWallet()

  if (!isConnected || !signer || !chainId) return null

  try {
    return new ContractService(signer, chainId)
  } catch {
    return null
  }
}
