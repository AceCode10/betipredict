'use client'

import { useState, useMemo } from 'react'
import { X, Loader2, CheckCircle, AlertCircle, Lightbulb, Eye, Zap } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface CreateMarketModalProps {
  isOpen: boolean
  onClose: () => void
  onMarketCreated: () => void
}

const QUESTION_TEMPLATES = [
  { label: 'Match Winner', template: 'Will {team} beat {opponent}?' },
  { label: 'League Winner', template: 'Will {team} win the {league} {season}?' },
  { label: 'Player Transfer', template: 'Will {player} transfer to {club} before {date}?' },
  { label: 'Goals Scored', template: 'Will there be over {number} goals in {match}?' },
  { label: 'Custom', template: '' },
]

const CATEGORIES = [
  { value: 'Sports', label: 'Sports', icon: '⚽' },
  { value: 'Politics', label: 'Politics', icon: '🏛️' },
  { value: 'Entertainment', label: 'Entertainment', icon: '🎬' },
  { value: 'Finance', label: 'Finance', icon: '📈' },
  { value: 'Tech', label: 'Tech', icon: '💻' },
  { value: 'Other', label: 'Other', icon: '🌍' },
]

export function CreateMarketModal({ isOpen, onClose, onMarketCreated }: CreateMarketModalProps) {
  const { isDarkMode } = useTheme()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [suggestionTitle, setSuggestionTitle] = useState('')
  const [suggestionDescription, setSuggestionDescription] = useState('')
  const [suggestionCategory, setSuggestionCategory] = useState('Sports')
  const [suggestionQuestion, setSuggestionQuestion] = useState('')
  const [suggestionResolution, setSuggestionResolution] = useState('')
  const [suggestionResolveDate, setSuggestionResolveDate] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  const bgColor = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'
  const inputBg = isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'
  const cardBg = isDarkMode ? 'bg-[#252840]' : 'bg-gray-100'

  // Validate question is a proper Yes/No question
  const questionValidation = useMemo(() => {
    const q = suggestionQuestion.trim()
    if (!q) return { valid: false, message: '' }
    if (q.length < 10) return { valid: false, message: 'Question too short (min 10 characters)' }
    if (!q.endsWith('?')) return { valid: false, message: 'Question must end with a question mark (?)' }
    return { valid: true, message: '' }
  }, [suggestionQuestion])

  // Auto-generate title from question if title is empty
  const effectiveTitle = suggestionTitle || suggestionQuestion

  const applyTemplate = (template: string) => {
    if (template) {
      setSuggestionQuestion(template)
    }
  }

  const resetForm = () => {
    setSuggestionTitle('')
    setSuggestionDescription('')
    setSuggestionQuestion('')
    setSuggestionResolution('')
    setSuggestionResolveDate('')
    setShowPreview(false)
    setError('')
    setSuccess('')
  }

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
          title: effectiveTitle,
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

      setSuccess('Market suggestion submitted! An admin will review it shortly.')
      resetForm()
      
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
              <strong>Tip:</strong> Create a Yes/No question that can be clearly resolved. Sports matches are auto-added — use this for custom markets.
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
            {/* Question Templates */}
            <div>
              <label className={`block text-sm font-medium ${textColor} mb-2`}>
                <Zap className="w-3.5 h-3.5 inline mr-1 text-yellow-500" />
                Quick Templates
              </label>
              <div className="flex flex-wrap gap-1.5">
                {QUESTION_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => applyTemplate(t.template)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                      isDarkMode
                        ? 'border-gray-600 text-gray-300 hover:border-yellow-500/50 hover:text-yellow-400 hover:bg-yellow-500/5'
                        : 'border-gray-300 text-gray-600 hover:border-yellow-500 hover:text-yellow-600 hover:bg-yellow-50'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Question — primary input */}
            <div>
              <label className={`block text-sm font-medium ${textColor} mb-1`}>Your Yes/No Question *</label>
              <textarea
                value={suggestionQuestion}
                onChange={(e) => setSuggestionQuestion(e.target.value)}
                placeholder="e.g., Will Arsenal win the Premier League 2025/26?"
                rows={2}
                className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm resize-none focus:outline-none focus:border-green-500`}
                required
                minLength={10}
                maxLength={300}
              />
              {suggestionQuestion && !questionValidation.valid && questionValidation.message && (
                <p className="text-xs text-red-400 mt-1">{questionValidation.message}</p>
              )}
              {suggestionQuestion && questionValidation.valid && (
                <p className="text-xs text-green-400 mt-1">Valid Yes/No question</p>
              )}
            </div>

            {/* Category */}
            <div>
              <label className={`block text-sm font-medium ${textColor} mb-2`}>Category *</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setSuggestionCategory(cat.value)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      suggestionCategory === cat.value
                        ? isDarkMode
                          ? 'border-green-500/50 bg-green-500/10 text-green-400'
                          : 'border-green-500 bg-green-50 text-green-700'
                        : isDarkMode
                          ? `border-gray-700 ${textMuted} hover:border-gray-500`
                          : `border-gray-200 text-gray-500 hover:border-gray-400`
                    }`}
                  >
                    <span>{cat.icon}</span>
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Title (optional — auto-fills from question) */}
            <div>
              <label className={`block text-sm font-medium ${textColor} mb-1`}>
                Title <span className={`text-xs ${textMuted}`}>(optional — auto-fills from question)</span>
              </label>
              <input
                type="text"
                value={suggestionTitle}
                onChange={(e) => setSuggestionTitle(e.target.value)}
                placeholder={suggestionQuestion || 'Auto-generated from your question'}
                className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm`}
                maxLength={200}
              />
            </div>

            {/* Description */}
            <div>
              <label className={`block text-sm font-medium ${textColor} mb-1`}>Description & Rules</label>
              <textarea
                value={suggestionDescription}
                onChange={(e) => setSuggestionDescription(e.target.value)}
                placeholder="Describe the resolution criteria, rules, and any important context..."
                rows={3}
                className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm resize-none`}
                maxLength={1000}
              />
            </div>

            {/* Resolution Date + Source — side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block text-sm font-medium ${textColor} mb-1`}>Resolution Date</label>
                <input
                  type="datetime-local"
                  value={suggestionResolveDate}
                  onChange={(e) => setSuggestionResolveDate(e.target.value)}
                  className={`w-full px-3 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm`}
                  min={new Date().toISOString().slice(0, 16)}
                />
              </div>
              <div>
                <label className={`block text-sm font-medium ${textColor} mb-1`}>Resolution Source</label>
                <input
                  type="text"
                  value={suggestionResolution}
                  onChange={(e) => setSuggestionResolution(e.target.value)}
                  placeholder="e.g., Premier League website"
                  className={`w-full px-3 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm`}
                  maxLength={500}
                />
              </div>
            </div>

            {/* Live Preview */}
            {suggestionQuestion && questionValidation.valid && (
              <div className={`${cardBg} rounded-lg p-4 border ${borderColor}`}>
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                  <span className={`text-xs font-semibold ${textMuted}`}>MARKET PREVIEW</span>
                </div>
                <h4 className={`text-sm font-semibold ${textColor} mb-3`}>{effectiveTitle}</h4>
                <div className="flex gap-2">
                  <div className={`flex-1 py-2.5 text-center rounded-lg text-sm font-semibold ${isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-50 text-green-600 border border-green-200'}`}>
                    Yes 50%
                  </div>
                  <div className={`flex-1 py-2.5 text-center rounded-lg text-sm font-semibold ${isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                    No 50%
                  </div>
                </div>
                {suggestionDescription && (
                  <p className={`text-xs ${textMuted} mt-3 leading-relaxed`}>{suggestionDescription.slice(0, 150)}{suggestionDescription.length > 150 ? '...' : ''}</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={creating || !questionValidation.valid}
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
