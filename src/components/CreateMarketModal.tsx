'use client'

import { useState } from 'react'
import { X, Loader2, CheckCircle, AlertCircle, Lightbulb } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface CreateMarketModalProps {
  isOpen: boolean
  onClose: () => void
  onMarketCreated: () => void
}

export function CreateMarketModal({ isOpen, onClose, onMarketCreated }: CreateMarketModalProps) {
  const { isDarkMode } = useTheme()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Suggestion form state
  const [suggestionTitle, setSuggestionTitle] = useState('')
  const [suggestionDescription, setSuggestionDescription] = useState('')
  const [suggestionCategory, setSuggestionCategory] = useState('Sports')
  const [suggestionQuestion, setSuggestionQuestion] = useState('')
  const [suggestionResolution, setSuggestionResolution] = useState('')
  const [suggestionResolveDate, setSuggestionResolveDate] = useState('')

  const bgColor = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'
  const inputBg = isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'

  const submitSuggestion = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: suggestionTitle,
          description: suggestionDescription,
          category: suggestionCategory,
          question: suggestionQuestion,
          resolutionSource: suggestionResolution,
          resolveDate: suggestionResolveDate || undefined,
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to submit suggestion')
      }

      setSuccess('Suggestion submitted! An admin will review it shortly.')
      setSuggestionTitle('')
      setSuggestionDescription('')
      setSuggestionQuestion('')
      setSuggestionResolution('')
      setSuggestionResolveDate('')
      
      setTimeout(() => {
        onMarketCreated()
        onClose()
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'Failed to submit suggestion')
    } finally {
      setCreating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      
      <div className={`relative ${bgColor} rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${borderColor}`}>
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-500" />
            <h2 className={`text-lg font-semibold ${textColor}`}>Suggest a Market</h2>
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg hover:bg-gray-700/50 ${textMuted}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Info Banner */}
          <div className={`mb-4 p-3 ${isDarkMode ? 'bg-blue-500/10 border-blue-500/30' : 'bg-blue-50 border-blue-200'} border rounded-lg`}>
            <p className={`text-sm ${isDarkMode ? 'text-blue-400' : 'text-blue-700'}`}>
              <strong>Note:</strong> Scheduled sports matches are automatically added as markets. Use this form to suggest custom markets (e.g., season outcomes, special events).
            </p>
          </div>

          {/* Status Messages */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-2 text-green-400">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">{success}</span>
            </div>
          )}

          {/* Suggestion Form */}
          <form onSubmit={submitSuggestion} className="space-y-4">

              <div>
                <label className={`block text-sm font-medium ${textColor} mb-1`}>Title *</label>
                <input
                  type="text"
                  value={suggestionTitle}
                  onChange={(e) => setSuggestionTitle(e.target.value)}
                  placeholder="e.g., Will Arsenal win the Premier League 2025/26?"
                  className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm`}
                  required
                  minLength={5}
                  maxLength={200}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${textColor} mb-1`}>Category *</label>
                <select
                  value={suggestionCategory}
                  onChange={(e) => setSuggestionCategory(e.target.value)}
                  className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm`}
                >
                  <option value="Sports">Sports</option>
                  <option value="Politics">Politics</option>
                  <option value="Entertainment">Entertainment</option>
                  <option value="Finance">Finance</option>
                  <option value="Tech">Tech</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium ${textColor} mb-1`}>Question *</label>
                <input
                  type="text"
                  value={suggestionQuestion}
                  onChange={(e) => setSuggestionQuestion(e.target.value)}
                  placeholder="e.g., Will Arsenal finish as Premier League champions?"
                  className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm`}
                  required
                  minLength={10}
                  maxLength={300}
                  pattern="^(Will|Do|Does|Are|Is|Can|Could|Should|Would|Has|Have|Did)\\s.+\\?$"
                  title="Question must start with words like 'Will', 'Do', 'Does', etc. and end with a question mark"
                />
                <p className={`text-xs ${textMuted} mt-1`}>
                  Must be a Yes/No question starting with words like "Will", "Do", "Does", "Are", "Is", etc.
                </p>
              </div>

              <div>
                <label className={`block text-sm font-medium ${textColor} mb-1`}>Description</label>
                <textarea
                  value={suggestionDescription}
                  onChange={(e) => setSuggestionDescription(e.target.value)}
                  placeholder="Additional context or details..."
                  rows={3}
                  className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm resize-none`}
                  maxLength={1000}
                />
              </div>

            <div>
              <label className={`block text-sm font-medium ${textColor} mb-1`}>Expected Resolution Date</label>
              <input
                type="datetime-local"
                value={suggestionResolveDate}
                onChange={(e) => setSuggestionResolveDate(e.target.value)}
                className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm`}
                min={new Date().toISOString().slice(0, 16)}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium ${textColor} mb-1`}>Resolution Source</label>
              <input
                type="text"
                value={suggestionResolution}
                onChange={(e) => setSuggestionResolution(e.target.value)}
                placeholder="e.g., Official Premier League website"
                className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm`}
                maxLength={500}
              />
              <p className={`text-xs ${textMuted} mt-1`}>
                How should this market be resolved? What's the source of truth?
              </p>
            </div>

            <button
              type="submit"
              disabled={creating || !suggestionTitle || !suggestionQuestion}
              className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit for Review'
              )}
            </button>

            <p className={`text-xs ${textMuted} text-center`}>
              Market suggestions require admin approval before going live.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
