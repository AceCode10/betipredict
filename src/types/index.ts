export interface User {
  id: string
  email: string
  phone?: string
  username: string
  fullName: string
  avatar?: string
  balance: number
  isVerified: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Market {
  id: string
  title: string
  description?: string
  category: string
  subcategory?: string
  question: string
  yesPrice: number
  noPrice: number
  volume: number
  liquidity: number
  status: 'PENDING' | 'ACTIVE' | 'RESOLVED' | 'CANCELLED'
  resolveTime: Date
  resolvedAt?: Date
  winningOutcome?: 'YES' | 'NO'
  createdAt: Date
  updatedAt: Date
  creatorId: string
  creator?: User
}

export interface Order {
  id: string
  type: 'LIMIT' | 'MARKET'
  side: 'BUY' | 'SELL'
  outcome: 'YES' | 'NO'
  price: number
  amount: number
  filled: number
  remaining: number
  status: 'OPEN' | 'FILLED' | 'CANCELLED'
  createdAt: Date
  updatedAt: Date
  userId: string
  marketId: string
  user?: User
  market?: Market
}

export interface Position {
  id: string
  outcome: 'YES' | 'NO'
  size: number
  averagePrice: number
  unrealizedPnl: number
  realizedPnl: number
  isClosed: boolean
  createdAt: Date
  updatedAt: Date
  userId: string
  marketId: string
  user?: User
  market?: Market
}

export interface Transaction {
  id: string
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE' | 'WINNINGS' | 'REFUND'
  amount: number
  description: string
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  metadata?: any
  createdAt: Date
  updatedAt: Date
  userId: string
  user?: User
}

export interface MarketData {
  market: Market
  orderBook: {
    yes: { price: number; amount: number }[]
    no: { price: number; amount: number }[]
  }
  userPosition?: Position
}

export interface TradeRequest {
  marketId: string
  outcome: 'YES' | 'NO'
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET'
  amount: number
  price?: number
}

export interface MobileMoneyRequest {
  provider: 'airtel' | 'mtn'
  phoneNumber: string
  amount: number
  transactionId: string
}
