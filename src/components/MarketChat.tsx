'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Send, MessageCircle, Loader2 } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface ChatMsg {
  id: string
  content: string
  createdAt: string
  user: { id: string; username: string; avatar: string | null }
}

interface MarketChatProps {
  marketId: string
  isOpen: boolean
}

export function MarketChat({ marketId, isOpen }: MarketChatProps) {
  const { data: session } = useSession()
  const { isDarkMode } = useTheme()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${marketId}/chat?limit=50`)
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages || [])
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [marketId])

  useEffect(() => {
    if (!isOpen) return
    fetchMessages()
    // Poll for new messages every 5s
    pollRef.current = setInterval(fetchMessages, 5000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isOpen, fetchMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || sending || !session?.user) return

    const content = input.trim()
    setInput('')
    setSending(true)

    try {
      const res = await fetch(`/api/markets/${marketId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })

      if (res.ok) {
        const data = await res.json()
        setMessages(prev => [...prev, data.message])
      } else {
        const data = await res.json()
        setInput(content) // Restore input on failure
        console.error('Failed to send message:', data.error)
      }
    } catch {
      setInput(content)
    } finally {
      setSending(false)
    }
  }

  if (!isOpen) return null

  const bgColor = isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'
  const surfaceBg = isDarkMode ? 'bg-[#1c2030]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'
  const inputBg = isDarkMode ? 'bg-[#252840]' : 'bg-gray-100'

  return (
    <div className={`${surfaceBg} border-t ${borderColor}`}>
      <div className={`flex items-center gap-2 px-4 py-2 border-b ${borderColor}`}>
        <MessageCircle className="w-3.5 h-3.5 text-green-500" />
        <span className={`text-xs font-semibold ${textColor}`}>Chat</span>
        <span className={`text-[10px] ${textMuted}`}>({messages.length})</span>
      </div>

      {/* Messages */}
      <div className={`h-48 overflow-y-auto px-3 py-2 space-y-2 ${bgColor}`}>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className={`w-4 h-4 animate-spin ${textMuted}`} />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className={`text-xs ${textMuted}`}>No messages yet. Be the first!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = session?.user?.id === msg.user.id
            return (
              <div key={msg.id} className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold ${
                  isOwn
                    ? 'bg-green-500/20 text-green-400'
                    : isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'
                }`}>
                  {msg.user.username.charAt(0).toUpperCase()}
                </div>
                <div className={`max-w-[75%] ${isOwn ? 'text-right' : ''}`}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[10px] font-medium ${isOwn ? 'text-green-400' : textMuted}`}>
                      {msg.user.username}
                    </span>
                    <span className={`text-[9px] ${textMuted}`}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className={`inline-block px-2.5 py-1.5 rounded-lg text-xs ${
                    isOwn
                      ? 'bg-green-500/10 text-green-300 border border-green-500/20'
                      : `${inputBg} ${textColor} border ${borderColor}`
                  }`}>
                    {msg.content}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {session?.user ? (
        <div className={`flex items-center gap-2 px-3 py-2 border-t ${borderColor}`}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Type a message..."
            maxLength={500}
            className={`flex-1 px-3 py-1.5 text-xs ${inputBg} border ${borderColor} rounded-lg ${textColor} placeholder:${textMuted} focus:outline-none focus:border-green-500`}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      ) : (
        <div className={`px-3 py-2 text-center border-t ${borderColor}`}>
          <p className={`text-xs ${textMuted}`}>Sign in to chat</p>
        </div>
      )}
    </div>
  )
}
