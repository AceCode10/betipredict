'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Heart, MessageCircle, Loader2, ChevronDown, MoreHorizontal, AlertTriangle } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface CommentUser {
  id: string
  username: string
  avatar: string | null
}

interface Comment {
  id: string
  content: string
  parentId: string | null
  createdAt: string
  user: CommentUser
  likeCount: number
  replyCount: number
  isLiked: boolean
  replies: Comment[]
}

interface MarketChatProps {
  marketId: string
  isOpen: boolean
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = Math.floor((now - date) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function UserAvatar({ user, size = 'md' }: { user: CommentUser; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs'
  const colors = [
    'bg-blue-500/20 text-blue-400',
    'bg-purple-500/20 text-purple-400',
    'bg-green-500/20 text-green-400',
    'bg-orange-500/20 text-orange-400',
    'bg-pink-500/20 text-pink-400',
    'bg-cyan-500/20 text-cyan-400',
  ]
  const colorIdx = user.username.charCodeAt(0) % colors.length

  if (user.avatar) {
    return <img src={user.avatar} alt={user.username} className={`${dim} rounded-full object-cover`} />
  }
  return (
    <div className={`${dim} rounded-full flex items-center justify-center font-bold ${colors[colorIdx]}`}>
      {user.username.charAt(0).toUpperCase()}
    </div>
  )
}

function CommentItem({
  comment,
  marketId,
  onLike,
  onReply,
  depth = 0,
  isDarkMode,
}: {
  comment: Comment
  marketId: string
  onLike: (id: string) => void
  onReply: (parentId: string, username: string) => void
  depth?: number
  isDarkMode: boolean
}) {
  const [showReplies, setShowReplies] = useState(depth === 0 && comment.replies.length > 0)
  const borderColor = isDarkMode ? 'border-gray-700/50' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-gray-200' : 'text-gray-800'
  const textMuted = isDarkMode ? 'text-gray-500' : 'text-gray-400'
  const hoverBg = isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'

  return (
    <div className={`${depth > 0 ? `ml-10 pl-3 border-l-2 ${borderColor}` : ''}`}>
      <div className={`flex gap-3 py-3 ${depth === 0 ? `border-b ${borderColor}` : ''}`}>
        <UserAvatar user={comment.user} size={depth > 0 ? 'sm' : 'md'} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-semibold ${textColor} truncate`}>
              {comment.user.username}
            </span>
            <span className={`text-xs ${textMuted}`}>
              {timeAgo(comment.createdAt)}
            </span>
          </div>
          <p className={`text-sm ${textColor} leading-relaxed whitespace-pre-wrap break-words`}>
            {comment.content}
          </p>
          <div className="flex items-center gap-4 mt-2">
            <button
              onClick={() => onLike(comment.id)}
              className={`flex items-center gap-1 text-xs transition-colors ${
                comment.isLiked
                  ? 'text-red-400 hover:text-red-300'
                  : `${textMuted} hover:text-red-400`
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${comment.isLiked ? 'fill-current' : ''}`} />
              {comment.likeCount > 0 && <span>{comment.likeCount}</span>}
            </button>
            {depth === 0 && (
              <button
                onClick={() => onReply(comment.id, comment.user.username)}
                className={`flex items-center gap-1 text-xs ${textMuted} hover:text-blue-400 transition-colors`}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Reply
              </button>
            )}
            {comment.replyCount > 0 && depth === 0 && !showReplies && (
              <button
                onClick={() => setShowReplies(true)}
                className={`flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors`}
              >
                <ChevronDown className="w-3 h-3" />
                {comment.replyCount} {comment.replyCount === 1 ? 'Reply' : 'Replies'}
              </button>
            )}
          </div>
        </div>
      </div>
      {showReplies && comment.replies.length > 0 && (
        <div>
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              marketId={marketId}
              onLike={onLike}
              onReply={onReply}
              depth={depth + 1}
              isDarkMode={isDarkMode}
            />
          ))}
          {comment.replyCount > comment.replies.length && (
            <div className="ml-10 pl-3 py-2">
              <span className={`text-xs text-blue-400`}>
                {comment.replyCount - comment.replies.length} more {comment.replyCount - comment.replies.length === 1 ? 'reply' : 'replies'}...
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function MarketChat({ marketId, isOpen }: MarketChatProps) {
  const { data: session } = useSession()
  const { isDarkMode } = useTheme()
  const [comments, setComments] = useState<Comment[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${marketId}/chat?limit=30&sort=${sort}`)
      if (res.ok) {
        const data = await res.json()
        setComments(data.comments || [])
        setTotalCount(data.totalCount || 0)
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [marketId, sort])

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    fetchComments()
    pollRef.current = setInterval(fetchComments, 8000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isOpen, fetchComments])

  const postComment = async () => {
    if (!input.trim() || sending || !session?.user) return

    const content = input.trim()
    setInput('')
    setSending(true)

    try {
      const res = await fetch(`/api/markets/${marketId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          parentId: replyTo?.id || null,
        }),
      })

      if (res.ok) {
        setReplyTo(null)
        await fetchComments()
      } else {
        const data = await res.json()
        setInput(content)
        console.error('Failed to post comment:', data.error)
      }
    } catch {
      setInput(content)
    } finally {
      setSending(false)
    }
  }

  const toggleLike = async (messageId: string) => {
    if (!session?.user) return
    try {
      const res = await fetch(`/api/markets/${marketId}/chat`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      })
      if (res.ok) {
        const { liked } = await res.json()
        // Optimistic update
        setComments(prev => prev.map(c => {
          if (c.id === messageId) {
            return { ...c, isLiked: liked, likeCount: liked ? c.likeCount + 1 : c.likeCount - 1 }
          }
          return {
            ...c,
            replies: c.replies.map(r =>
              r.id === messageId
                ? { ...r, isLiked: liked, likeCount: liked ? r.likeCount + 1 : r.likeCount - 1 }
                : r
            ),
          }
        }))
      }
    } catch {
      // Silently fail
    }
  }

  const handleReply = (parentId: string, username: string) => {
    setReplyTo({ id: parentId, username })
    setInput(`@${username} `)
    inputRef.current?.focus()
  }

  if (!isOpen) return null

  const bgColor = isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'
  const surfaceBg = isDarkMode ? 'bg-[#1c2030]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-700/50' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-500' : 'text-gray-400'
  const inputBg = isDarkMode ? 'bg-[#0d1117]' : 'bg-gray-100'
  const activePill = isDarkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-900'
  const inactivePill = isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'

  return (
    <div className={`${surfaceBg} border-t ${borderColor}`}>
      {/* Comment Input — top like Polymarket */}
      <div className={`px-5 pt-4 pb-3`}>
        {session?.user ? (
          <div>
            {replyTo && (
              <div className={`flex items-center gap-2 mb-2 text-xs ${textMuted}`}>
                <span>Replying to <strong className="text-blue-400">@{replyTo.username}</strong></span>
                <button onClick={() => { setReplyTo(null); setInput('') }} className="text-red-400 hover:text-red-300">
                  Cancel
                </button>
              </div>
            )}
            <div className={`flex items-center gap-3 ${inputBg} border ${borderColor} rounded-lg px-4 py-2.5`}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && postComment()}
                placeholder="Add a comment..."
                maxLength={500}
                className={`flex-1 bg-transparent text-sm ${textColor} placeholder:${textMuted} focus:outline-none`}
              />
              <button
                onClick={postComment}
                disabled={!input.trim() || sending}
                className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                  input.trim()
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : isDarkMode ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Post'}
              </button>
            </div>
          </div>
        ) : (
          <div className={`text-center py-2`}>
            <p className={`text-sm ${textMuted}`}>Sign in to comment</p>
          </div>
        )}
      </div>

      {/* Sort Controls */}
      <div className={`flex items-center gap-3 px-5 pb-3`}>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSort('newest')}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${sort === 'newest' ? activePill : inactivePill}`}
          >
            Newest
          </button>
          <button
            onClick={() => setSort('oldest')}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${sort === 'oldest' ? activePill : inactivePill}`}
          >
            Oldest
          </button>
        </div>
        {totalCount > 0 && (
          <span className={`text-xs ${textMuted} ml-auto`}>
            {totalCount} {totalCount === 1 ? 'comment' : 'comments'}
          </span>
        )}
        {loading && <Loader2 className={`w-3 h-3 animate-spin ${textMuted} ml-auto`} />}
      </div>

      {/* Beware notice */}
      <div className={`mx-5 mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${isDarkMode ? 'bg-yellow-500/5 text-yellow-500/70 border border-yellow-500/10' : 'bg-yellow-50 text-yellow-600 border border-yellow-200'}`}>
        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
        Beware of external links.
      </div>

      {/* Comments List */}
      <div className={`px-5 pb-4 max-h-[400px] overflow-y-auto`}>
        {loading && comments.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className={`w-5 h-5 animate-spin ${textMuted}`} />
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <MessageCircle className={`w-8 h-8 ${textMuted} mb-2 opacity-40`} />
            <p className={`text-sm ${textMuted}`}>No comments yet. Be the first!</p>
          </div>
        ) : (
          comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              marketId={marketId}
              onLike={toggleLike}
              onReply={handleReply}
              isDarkMode={isDarkMode}
            />
          ))
        )}
      </div>
    </div>
  )
}
