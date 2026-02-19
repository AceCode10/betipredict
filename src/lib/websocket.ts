import { Market } from '@/types'

export class WebSocketManager {
  private ws: WebSocket | null = null
  private listeners: Map<string, ((data: any) => void)[]> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  constructor() {
    this.connect()
  }

  private connect() {
    try {
      // For development, we'll use a simple polling mechanism
      // In production, this would be a real WebSocket connection
      console.log('WebSocket connection simulated')
      this.startPolling()
    } catch (error) {
      console.error('WebSocket connection failed:', error)
      this.handleReconnect()
    }
  }

  private startPolling() {
    // Simulate real-time updates with polling
    setInterval(() => {
      this.simulateMarketUpdate()
    }, 5000) // Update every 5 seconds
  }

  private simulateMarketUpdate() {
    // Simulate small price changes
    const update = {
      type: 'PRICE_UPDATE',
      marketId: 'sample-market',
      yesPrice: Math.random() * 0.3 + 0.35, // Random between 0.35-0.65
      noPrice: Math.random() * 0.3 + 0.35,
      timestamp: new Date().toISOString()
    }

    this.emit('market_update', update)
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      setTimeout(() => {
        this.reconnectAttempts++
        console.log(`Reconnecting... Attempt ${this.reconnectAttempts}`)
        this.connect()
      }, this.reconnectDelay * this.reconnectAttempts)
    }
  }

  subscribe(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(callback)
  }

  unsubscribe(event: string, callback: (data: any) => void) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.forEach(callback => callback(data))
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// Only instantiate on client side
export const wsManager = typeof window !== 'undefined' ? new WebSocketManager() : null
