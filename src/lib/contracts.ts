import { ethers } from 'ethers'
import { useWallet } from '@/components/WalletConnect'

// Contract ABIs (simplified versions for demonstration)
const BETI_PREDICT_ABI = [
  "function createMarket(string title, string description, string category, string question, uint256 resolveTime, uint256 initialYesPrice, uint256 initialNoPrice) payable returns (uint256)",
  "function placeLimitOrder(uint256 marketId, uint256 side, uint256 outcome, uint256 amount, uint256 price) external",
  "function placeMarketOrder(uint256 marketId, uint256 side, uint256 outcome, uint256 amount) external",
  "function resolveMarket(uint256 marketId, uint256 resolution) external",
  "function deposit(uint256 amount) external",
  "function withdraw(uint256 amount) external",
  "function getBalance(address user) external view returns (uint256)",
  "function getMarket(uint256 marketId) external view returns (tuple(uint256 id, string title, string description, string category, string question, uint256 resolveTime, uint256 yesPrice, uint256 noPrice, uint256 totalVolume, uint256 status, uint256 resolution, address creator, uint256 createdAt))",
  "function getOrder(uint256 orderId) external view returns (tuple(uint256 id, uint256 marketId, address trader, uint256 side, uint256 orderType, uint256 outcome, uint256 amount, uint256 price, uint256 filled, uint256 status, uint256 createdAt))",
  "function marketCreationFee() external view returns (uint256)",
  "event MarketCreated(uint256 indexed marketId, string title, string question, uint256 resolveTime, address indexed creator)",
  "event OrderPlaced(uint256 indexed orderId, uint256 indexed marketId, address indexed trader, uint256 side, uint256 outcome, uint256 amount, uint256 price)",
  "event OrderFilled(uint256 indexed orderId, uint256 indexed marketId, address indexed trader, uint256 filledAmount, uint256 fillPrice)",
  "event MarketResolved(uint256 indexed marketId, uint256 resolution, uint256 totalPayout)"
]

const MOCK_TOKEN_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
]

// Contract addresses (update these with your deployed contract addresses)
const CONTRACT_ADDRESSES = {
  localhost: {
    betiPredict: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", // BetiPredictSimple
    collateralToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" // MockToken
  },
  sepolia: {
    betiPredict: "", // Add when deployed to sepolia
    collateralToken: "" // Add when deployed to sepolia
  }
}

export interface Market {
  id: string
  title: string
  description: string
  category: string
  question: string
  resolveTime: bigint
  yesPrice: bigint
  noPrice: bigint
  totalVolume: bigint
  status: bigint
  resolution: bigint
  creator: string
  createdAt: bigint
}

export interface Order {
  id: string
  marketId: string
  trader: string
  side: bigint
  orderType: bigint
  outcome: bigint
  amount: bigint
  price: bigint
  filled: bigint
  status: bigint
  createdAt: bigint
}

export class ContractService {
  private betiPredictContract: ethers.Contract | null = null
  private tokenContract: ethers.Contract | null = null

  constructor(private signer: ethers.JsonRpcSigner, private chainId: number) {
    this.initializeContracts()
  }

  private initializeContracts() {
    try {
      const networkName = this.getNetworkName()
      const addresses = CONTRACT_ADDRESSES[networkName as keyof typeof CONTRACT_ADDRESSES]

      if (!addresses.betiPredict || !addresses.collateralToken) {
        throw new Error(`Contracts not deployed on ${networkName}`)
      }

      this.betiPredictContract = new ethers.Contract(
        addresses.betiPredict,
        BETI_PREDICT_ABI,
        this.signer
      )

      this.tokenContract = new ethers.Contract(
        addresses.collateralToken,
        MOCK_TOKEN_ABI,
        this.signer
      )
    } catch (error) {
      console.error('Error initializing contracts:', error)
      throw error
    }
  }

  private getNetworkName(): string {
    switch (this.chainId) {
      case 1337: return 'localhost'
      case 11155111: return 'sepolia'
      default: return 'localhost'
    }
  }

  // Market Functions
  async createMarket(
    title: string,
    description: string,
    category: string,
    question: string,
    resolveTime: number,
    initialYesPrice: number,
    initialNoPrice: number
  ): Promise<{ transaction: ethers.TransactionResponse; marketId: string }> {
    if (!this.betiPredictContract) throw new Error('Contract not initialized')

    const marketCreationFee = await this.betiPredictContract.marketCreationFee()
    
    const tx = await this.betiPredictContract.createMarket(
      title,
      description,
      category,
      question,
      resolveTime,
      initialYesPrice,
      initialNoPrice,
      { value: marketCreationFee }
    )

    const receipt = await tx.wait()
    
    // Parse MarketCreated event
    const marketCreatedEvent = receipt?.logs?.find((log: any) => 
      log.fragment?.name === 'MarketCreated'
    )
    
    const marketId = marketCreatedEvent?.args?.[0]?.toString() || '0'
    
    return { transaction: tx, marketId }
  }

  async getMarket(marketId: string): Promise<Market> {
    if (!this.betiPredictContract) throw new Error('Contract not initialized')

    const market = await this.betiPredictContract.getMarket(marketId)
    return {
      id: marketId,
      title: market.title,
      description: market.description,
      category: market.category,
      question: market.question,
      resolveTime: market.resolveTime,
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      totalVolume: market.totalVolume,
      status: market.status,
      resolution: market.resolution,
      creator: market.creator,
      createdAt: market.createdAt
    }
  }

  // Trading Functions
  async placeLimitOrder(
    marketId: string,
    side: number, // 0 = Buy, 1 = Sell
    outcome: number, // 0 = Yes, 1 = No
    amount: string,
    price: number
  ): Promise<ethers.TransactionResponse> {
    if (!this.betiPredictContract) throw new Error('Contract not initialized')

    const amountWei = ethers.parseEther(amount)
    const priceScaled = Math.round(price * 1e6) // Scale to 1e6 as per contract

    return await this.betiPredictContract.placeLimitOrder(
      marketId,
      side,
      outcome,
      amountWei,
      priceScaled
    )
  }

  async placeMarketOrder(
    marketId: string,
    side: number,
    outcome: number,
    amount: string
  ): Promise<ethers.TransactionResponse> {
    if (!this.betiPredictContract) throw new Error('Contract not initialized')

    const amountWei = ethers.parseEther(amount)

    return await this.betiPredictContract.placeMarketOrder(
      marketId,
      side,
      outcome,
      amountWei
    )
  }

  // Balance Functions
  async getBalance(): Promise<string> {
    if (!this.betiPredictContract) throw new Error('Contract not initialized')
    
    const address = await this.signer.getAddress()
    const balance = await this.betiPredictContract.getBalance(address)
    
    return ethers.formatEther(balance)
  }

  async getTokenBalance(): Promise<string> {
    if (!this.tokenContract) throw new Error('Contract not initialized')
    
    const address = await this.signer.getAddress()
    const balance = await this.tokenContract.balanceOf(address)
    
    return ethers.formatEther(balance)
  }

  async deposit(amount: string): Promise<ethers.TransactionResponse> {
    if (!this.betiPredictContract) throw new Error('Contract not initialized')

    const amountWei = ethers.parseEther(amount)
    
    // First approve token spending
    const approveTx = await this.tokenContract!.approve(
      await this.betiPredictContract.getAddress(),
      amountWei
    )
    await approveTx.wait()

    // Then deposit
    return await this.betiPredictContract.deposit(amountWei)
  }

  async withdraw(amount: string): Promise<ethers.TransactionResponse> {
    if (!this.betiPredictContract) throw new Error('Contract not initialized')

    const amountWei = ethers.parseEther(amount)
    return await this.betiPredictContract.withdraw(amountWei)
  }

  // Market Resolution
  async resolveMarket(marketId: string, resolution: number): Promise<ethers.TransactionResponse> {
    if (!this.betiPredictContract) throw new Error('Contract not initialized')

    return await this.betiPredictContract.resolveMarket(marketId, resolution)
  }

  // Event Listeners
  onMarketCreated(callback: (marketId: string, title: string, creator: string) => void) {
    if (!this.betiPredictContract) return

    this.betiPredictContract.on('MarketCreated', (marketId, title, question, resolveTime, creator) => {
      callback(marketId.toString(), title, creator)
    })
  }

  onOrderPlaced(callback: (orderId: string, marketId: string, trader: string, amount: string, price: string) => void) {
    if (!this.betiPredictContract) return

    this.betiPredictContract.on('OrderPlaced', (orderId, marketId, trader, side, outcome, amount, price) => {
      callback(orderId.toString(), marketId.toString(), trader, ethers.formatEther(amount), (Number(price) / 1e6).toString())
    })
  }

  onOrderFilled(callback: (orderId: string, marketId: string, trader: string, filledAmount: string, fillPrice: string) => void) {
    if (!this.betiPredictContract) return

    this.betiPredictContract.on('OrderFilled', (orderId, marketId, trader, filledAmount, fillPrice) => {
      callback(orderId.toString(), marketId.toString(), trader, ethers.formatEther(filledAmount), (Number(fillPrice) / 1e6).toString())
    })
  }

  onMarketResolved(callback: (marketId: string, resolution: number, totalPayout: string) => void) {
    if (!this.betiPredictContract) return

    this.betiPredictContract.on('MarketResolved', (marketId, resolution, totalPayout) => {
      callback(marketId.toString(), Number(resolution), ethers.formatEther(totalPayout))
    })
  }

  // Cleanup
  removeAllListeners() {
    if (this.betiPredictContract) {
      this.betiPredictContract.removeAllListeners()
    }
  }
}

// Hook for using contract service — returns null when wallet is not connected
export function useContractService(): ContractService | null {
  const { signer, chainId, isConnected } = useWallet()
  
  if (!isConnected || !signer || !chainId) {
    return null
  }

  try {
    return new ContractService(signer, chainId)
  } catch {
    return null
  }
}
