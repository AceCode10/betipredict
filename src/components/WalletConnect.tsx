'use client'

import { useState, useEffect, createContext, useContext, ReactNode } from 'react'
import { ethers } from 'ethers'
import detectEthereumProvider from '@metamask/detect-provider'

interface WalletContextType {
  account: string | null
  provider: ethers.BrowserProvider | null
  signer: ethers.JsonRpcSigner | null
  chainId: number | null
  isConnected: boolean
  isConnecting: boolean
  connectWallet: () => Promise<void>
  disconnectWallet: () => void
  switchChain: (chainId: string) => Promise<void>
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider')
  }
  return context
}

interface WalletProviderProps {
  children: ReactNode
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [account, setAccount] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  const SUPPORTED_NETWORKS = {
    localhost: {
      chainId: '0x7A69', // 31337
      chainName: 'Hardhat Local',
      rpcUrls: ['http://127.0.0.1:8545'],
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    },
    sepolia: {
      chainId: '0xaa36a7', // 11155111
      chainName: 'Sepolia Testnet',
      rpcUrls: ['https://sepolia.infura.io/v3/'],
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    },
    baseSepolia: {
      chainId: '0x14A34', // 84532
      chainName: 'Base Sepolia',
      rpcUrls: ['https://sepolia.base.org'],
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      blockExplorerUrls: ['https://sepolia.basescan.org'],
    },
    base: {
      chainId: '0x2105', // 8453
      chainName: 'Base',
      rpcUrls: ['https://mainnet.base.org'],
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      blockExplorerUrls: ['https://basescan.org'],
    },
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    checkConnection()
    const cleanup = setupEventListeners()
    return cleanup
  }, [])

  const checkConnection = async () => {
    if (typeof window === 'undefined' || !window.ethereum) return
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' })
      if (accounts.length > 0) {
        await connectWallet()
      }
    } catch (error) {
      console.error('Error checking connection:', error)
    }
  }

  const setupEventListeners = () => {
    if (typeof window === 'undefined' || !window.ethereum) return () => {}
    const onAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) { disconnectWallet() } else { setAccount(accounts[0]) }
    }
    const onChainChanged = () => { window.location.reload() }
    const onDisconnect = () => { disconnectWallet() }
    window.ethereum.on('accountsChanged', onAccountsChanged)
    window.ethereum.on('chainChanged', onChainChanged)
    window.ethereum.on('disconnect', onDisconnect)
    return () => {
      window.ethereum?.removeListener('accountsChanged', onAccountsChanged)
      window.ethereum?.removeListener('chainChanged', onChainChanged)
      window.ethereum?.removeListener('disconnect', onDisconnect)
    }
  }

  const connectWallet = async () => {
    if (isConnecting) return
    if (typeof window === 'undefined' || !window.ethereum) {
      alert('Please install MetaMask to connect your wallet.')
      return
    }

    setIsConnecting(true)
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found')
      }

      const web3Provider = new ethers.BrowserProvider(window.ethereum)
      const web3Signer = await web3Provider.getSigner()
      const network = await web3Provider.getNetwork()

      setProvider(web3Provider)
      setSigner(web3Signer)
      setAccount(accounts[0])
      setChainId(Number(network.chainId))
      setIsConnected(true)
    } catch (error: any) {
      console.error('Error connecting wallet:', error)
      if (error?.code !== 4001) { // 4001 = user rejected
        alert(error?.message || 'Failed to connect wallet')
      }
    } finally {
      setIsConnecting(false)
    }
  }

  const disconnectWallet = () => {
    setAccount(null)
    setProvider(null)
    setSigner(null)
    setChainId(null)
    setIsConnected(false)
  }

  const switchChain = async (targetChainId: string) => {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('MetaMask not installed')
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainId }],
      })
    } catch (switchError: any) {
      // This error code indicates that the chain has not been added to MetaMask
      if (switchError.code === 4902) {
        const networkConfig = Object.values(SUPPORTED_NETWORKS).find(
          config => config.chainId === targetChainId
        )

        if (networkConfig) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [networkConfig],
            })
          } catch (addError) {
            console.error('Error adding network:', addError)
            throw addError
          }
        }
      } else {
        console.error('Error switching chain:', switchError)
        throw switchError
      }
    }
  }

  const value: WalletContextType = {
    account,
    provider,
    signer,
    chainId,
    isConnected,
    isConnecting,
    connectWallet,
    disconnectWallet,
    switchChain,
  }

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

// Wallet Connection Button Component
export function WalletConnectButton() {
  const { 
    isConnected, 
    account, 
    connectWallet, 
    disconnectWallet, 
    isConnecting,
    chainId 
  } = useWallet()

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const getNetworkName = (chainId: number) => {
    switch (chainId) {
      case 1337:
      case 31337: return 'Localhost'
      case 11155111: return 'Sepolia'
      case 84532: return 'Base Sepolia'
      case 8453: return 'Base'
      default: return `Chain ${chainId}`
    }
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-2">
        <div className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
          {getNetworkName(chainId!)}
        </div>
        <div className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
          {formatAddress(account!)}
        </div>
        <button
          onClick={disconnectWallet}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={connectWallet}
      disabled={isConnecting}
      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors font-medium"
    >
      {isConnecting ? 'Connecting...' : 'Connect Wallet'}
    </button>
  )
}
