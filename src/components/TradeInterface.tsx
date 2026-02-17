'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { TrendingUp, TrendingDown, ArrowUpDown } from 'lucide-react'

interface TradeMarket {
  id: string
  question: string
  yesPrice: number
  noPrice: number
  [key: string]: any
}

interface TradeRequest {
  marketId: string
  outcome: 'YES' | 'NO'
  side: 'BUY' | 'SELL'
  type: 'LIMIT' | 'MARKET'
  amount: number
  price?: number
}

interface TradeInterfaceProps {
  market: TradeMarket
  onTrade: (trade: TradeRequest) => void
  userBalance: number
}

export function TradeInterface({ market, onTrade, userBalance }: TradeInterfaceProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<'YES' | 'NO'>('YES')
  const [selectedSide, setSelectedSide] = useState<'BUY' | 'SELL'>('BUY')
  const [amount, setAmount] = useState('')
  const [price, setPrice] = useState('')
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('MARKET')

  const currentPrice = selectedOutcome === 'YES' ? market.yesPrice : market.noPrice
  const maxAffordable = userBalance / currentPrice
  
  const handleSubmit = () => {
    const tradeAmount = parseFloat(amount)
    if (!tradeAmount || tradeAmount <= 0) return
    
    const trade: TradeRequest = {
      marketId: market.id,
      outcome: selectedOutcome,
      side: selectedSide,
      type: orderType,
      amount: tradeAmount,
      price: orderType === 'LIMIT' ? parseFloat(price) : undefined
    }
    
    onTrade(trade)
  }

  const calculateTotal = () => {
    const tradeAmount = parseFloat(amount) || 0
    const tradePrice = orderType === 'LIMIT' ? (parseFloat(price) || currentPrice) : currentPrice
    return tradeAmount * tradePrice
  }

  const canAfford = selectedSide === 'BUY' ? calculateTotal() <= userBalance : true

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUpDown className="w-5 h-5" />
          Trade: {market.question}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Market Status */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="font-medium text-green-600">YES</span>
            </div>
            <div className="text-2xl font-bold">{Math.round(market.yesPrice * 100)}%</div>
            <div className="text-sm text-gray-600">K{market.yesPrice.toFixed(2)}</div>
          </div>
          
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <span className="font-medium text-red-600">NO</span>
            </div>
            <div className="text-2xl font-bold">{Math.round(market.noPrice * 100)}%</div>
            <div className="text-sm text-gray-600">K{market.noPrice.toFixed(2)}</div>
          </div>
        </div>

        {/* Order Type */}
        <div className="flex gap-2">
          <Button
            variant={orderType === 'MARKET' ? 'default' : 'outline'}
            onClick={() => setOrderType('MARKET')}
            className="flex-1"
          >
            Market Order
          </Button>
          <Button
            variant={orderType === 'LIMIT' ? 'default' : 'outline'}
            onClick={() => setOrderType('LIMIT')}
            className="flex-1"
          >
            Limit Order
          </Button>
        </div>

        {/* Outcome Selection */}
        <div className="flex gap-2">
          <Button
            variant={selectedOutcome === 'YES' ? 'default' : 'outline'}
            onClick={() => setSelectedOutcome('YES')}
            className="flex-1"
          >
            YES
          </Button>
          <Button
            variant={selectedOutcome === 'NO' ? 'default' : 'outline'}
            onClick={() => setSelectedOutcome('NO')}
            className="flex-1"
          >
            NO
          </Button>
        </div>

        {/* Side Selection */}
        <div className="flex gap-2">
          <Button
            variant={selectedSide === 'BUY' ? 'default' : 'outline'}
            onClick={() => setSelectedSide('BUY')}
            className="flex-1"
          >
            BUY
          </Button>
          <Button
            variant={selectedSide === 'SELL' ? 'default' : 'outline'}
            onClick={() => setSelectedSide('SELL')}
            className="flex-1"
          >
            SELL
          </Button>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Amount (shares)
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            min="0"
            step="0.01"
          />
          {selectedSide === 'BUY' && (
            <div className="text-xs text-gray-500 mt-1">
              Max affordable: {maxAffordable.toFixed(2)} shares
            </div>
          )}
        </div>

        {/* Price Input (for limit orders) */}
        {orderType === 'LIMIT' && (
          <div>
            <label className="block text-sm font-medium mb-2">
              Price per share (K)
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={currentPrice.toFixed(2)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0.01"
              max="0.99"
              step="0.01"
            />
          </div>
        )}

        {/* Order Summary */}
        <div className="p-4 bg-gray-50 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span>Type:</span>
            <span className="font-medium">
              {selectedSide} {selectedOutcome} - {orderType}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Price:</span>
            <span className="font-medium">
              K{orderType === 'LIMIT' ? (parseFloat(price) || currentPrice).toFixed(2) : currentPrice.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Amount:</span>
            <span className="font-medium">{amount || '0'} shares</span>
          </div>
          <div className="flex justify-between text-sm font-bold border-t pt-2">
            <span>Total:</span>
            <span className={canAfford ? 'text-green-600' : 'text-red-600'}>
              K{calculateTotal().toFixed(2)}
            </span>
          </div>
        </div>

        {/* Balance Info */}
        <div className="text-sm text-gray-600">
          Available Balance: <span className="font-medium">K{userBalance.toFixed(2)}</span>
        </div>

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={!amount || parseFloat(amount) <= 0 || !canAfford}
          className="w-full"
        >
          {selectedSide === 'BUY' ? 'Buy' : 'Sell'} {selectedOutcome} Shares
        </Button>
      </CardContent>
    </Card>
  )
}
