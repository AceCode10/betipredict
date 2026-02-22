'use client'

import { useState, useCallback, useEffect } from 'react'
import { useWallet } from '@/components/WalletConnect'
import { ContractService, COLLATERAL_DECIMALS } from '@/lib/contracts'
import { ethers } from 'ethers'

interface TradeResult {
  success: boolean
  txHash?: string
  error?: string
  shares?: number
  collateral?: number
}

interface OnChainState {
  isOnChain: boolean
  tokenBalance: number
  tokenSymbol: string
  contractService: ContractService | null
  loading: boolean
}

export function useOnChainTrade() {
  const { signer, chainId, isConnected } = useWallet()
  const [state, setState] = useState<OnChainState>({
    isOnChain: false,
    tokenBalance: 0,
    tokenSymbol: 'USDC',
    contractService: null,
    loading: false,
  })

  // Initialize contract service when wallet connects
  useEffect(() => {
    if (!isConnected || !signer || !chainId) {
      setState(prev => ({ ...prev, isOnChain: false, contractService: null, tokenBalance: 0 }))
      return
    }

    try {
      const cs = new ContractService(signer, chainId)
      setState(prev => ({ ...prev, isOnChain: true, contractService: cs }))

      // Load token balance and symbol
      Promise.all([cs.getTokenBalance(), cs.getTokenSymbol()])
        .then(([bal, sym]) => {
          setState(prev => ({ ...prev, tokenBalance: bal, tokenSymbol: sym }))
        })
        .catch(() => {
          // Contract not deployed or network mismatch — fall back to centralized
          setState(prev => ({ ...prev, isOnChain: false, contractService: null }))
        })
    } catch {
      setState(prev => ({ ...prev, isOnChain: false, contractService: null }))
    }
  }, [isConnected, signer, chainId])

  // Refresh on-chain balance
  const refreshBalance = useCallback(async () => {
    if (!state.contractService) return
    try {
      const bal = await state.contractService.getTokenBalance()
      setState(prev => ({ ...prev, tokenBalance: bal }))
    } catch { /* ignore */ }
  }, [state.contractService])

  // Buy shares on-chain
  const buyOnChain = useCallback(async (
    onChainMarketId: number,
    outcome: 'YES' | 'NO',
    amount: number
  ): Promise<TradeResult> => {
    if (!state.contractService) return { success: false, error: 'Wallet not connected' }

    setState(prev => ({ ...prev, loading: true }))
    try {
      const tx = outcome === 'YES'
        ? await state.contractService.buyYes(onChainMarketId, amount)
        : await state.contractService.buyNo(onChainMarketId, amount)

      const receipt = await tx.wait()
      await refreshBalance()

      return { success: true, txHash: receipt?.hash || tx.hash }
    } catch (err: any) {
      const msg = err?.reason || err?.message || 'Transaction failed'
      return { success: false, error: msg }
    } finally {
      setState(prev => ({ ...prev, loading: false }))
    }
  }, [state.contractService, refreshBalance])

  // Sell shares on-chain
  const sellOnChain = useCallback(async (
    onChainMarketId: number,
    outcome: 'YES' | 'NO',
    shares: bigint
  ): Promise<TradeResult> => {
    if (!state.contractService) return { success: false, error: 'Wallet not connected' }

    setState(prev => ({ ...prev, loading: true }))
    try {
      const tx = outcome === 'YES'
        ? await state.contractService.sellYes(onChainMarketId, shares)
        : await state.contractService.sellNo(onChainMarketId, shares)

      const receipt = await tx.wait()
      await refreshBalance()

      return { success: true, txHash: receipt?.hash || tx.hash }
    } catch (err: any) {
      const msg = err?.reason || err?.message || 'Transaction failed'
      return { success: false, error: msg }
    } finally {
      setState(prev => ({ ...prev, loading: false }))
    }
  }, [state.contractService, refreshBalance])

  // Claim winnings on-chain
  const claimOnChain = useCallback(async (onChainMarketId: number): Promise<TradeResult> => {
    if (!state.contractService) return { success: false, error: 'Wallet not connected' }

    setState(prev => ({ ...prev, loading: true }))
    try {
      const tx = await state.contractService.claimWinnings(onChainMarketId)
      const receipt = await tx.wait()
      await refreshBalance()

      return { success: true, txHash: receipt?.hash || tx.hash }
    } catch (err: any) {
      const msg = err?.reason || err?.message || 'Claim failed'
      return { success: false, error: msg }
    } finally {
      setState(prev => ({ ...prev, loading: false }))
    }
  }, [state.contractService, refreshBalance])

  // Get on-chain position for a market
  const getPosition = useCallback(async (onChainMarketId: number) => {
    if (!state.contractService) return null
    try {
      return await state.contractService.getPosition(onChainMarketId)
    } catch {
      return null
    }
  }, [state.contractService])

  // Get on-chain prices for a market
  const getPrices = useCallback(async (onChainMarketId: number) => {
    if (!state.contractService) return null
    try {
      const [yes, no] = await Promise.all([
        state.contractService.getYesPrice(onChainMarketId),
        state.contractService.getNoPrice(onChainMarketId),
      ])
      return { yesPrice: yes, noPrice: no }
    } catch {
      return null
    }
  }, [state.contractService])

  // Estimate buy
  const estimateBuy = useCallback(async (
    onChainMarketId: number,
    outcome: 'YES' | 'NO',
    amount: number
  ) => {
    if (!state.contractService) return null
    try {
      return await state.contractService.estimateBuy(onChainMarketId, outcome, amount)
    } catch {
      return null
    }
  }, [state.contractService])

  return {
    ...state,
    buyOnChain,
    sellOnChain,
    claimOnChain,
    getPosition,
    getPrices,
    estimateBuy,
    refreshBalance,
  }
}
