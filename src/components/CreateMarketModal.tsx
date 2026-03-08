'use client'

import { useState, useMemo } from 'react'
import { X, Loader2, CheckCircle, AlertCircle, Lightbulb, Eye, Zap } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { DEFAULT_CATEGORIES } from '@/lib/categories'

interface CreateMarketModalProps {
  isOpen: boolean
  onClose: () => void
  onMarketCreated: () => void
}

type QuestionType = 'yes-no' | 'multi-option' | 'range' | 'sentiment' | 'date' | 'versus'

const QUESTION_TEMPLATES = [
  { label: 'Yes/No', template: '', type: 'yes-no' as QuestionType, hint: 'Will something happen? Resolves Yes or No.' },
  { label: 'Match Winner', template: 'Who will win: {Team A} vs {Team B}?', type: 'yes-no' as QuestionType, hint: 'Pick the winner of a match.' },
  { label: 'Multi-Option', template: '', type: 'multi-option' as QuestionType, hint: 'Multiple options, each tradable. e.g. "Who will win the Ballon d\'Or?"' },
  { label: 'Range', template: 'What price will {asset} hit by {date}?', type: 'range' as QuestionType, hint: 'Threshold levels. e.g. "Bitcoin above $80K?"' },
  { label: 'Sentiment', template: '{topic} on {date}?', type: 'sentiment' as QuestionType, hint: 'Positive/Negative outcome. e.g. "ETF Flows on March 1?"' },
  { label: 'Date', template: 'What day will {event} happen?', type: 'date' as QuestionType, hint: 'Predict the date of an event.' },
  { label: 'Versus', template: '{Team/Player A} vs {Team/Player B}?', type: 'versus' as QuestionType, hint: 'Two-way matchup without a draw option.' },
]

const CATEGORIES = DEFAULT_CATEGORIES

export function CreateMarketModal({ isOpen, onClose, onMarketCreated }: CreateMarketModalProps) {
  const { isDarkMode } = useTheme()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [suggestionTitle, setSuggestionTitle] = useState('')
  const [suggestionDescription, setSuggestionDescription] = useState('')
  const [suggestionCategory, setSuggestionCategory] = useState('Football')
  const [suggestionQuestion, setSuggestionQuestion] = useState('')
  const [suggestionResolution, setSuggestionResolution] = useState('')
  const [suggestionResolveDate, setSuggestionResolveDate] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [questionType, setQuestionType] = useState<QuestionType>('yes-no')
  const [multiOptions, setMultiOptions] = useState<string[]>(['', ''])

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
    setQuestionType('yes-no')
    setMultiOptions(['', ''])
    setError('')
    setSuccess('')
  }

  const submitSuggestion = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError('')
    setSuccess('')

    try {
      const cleanOptions = questionType !== 'yes-no' ? multiOptions.filter(o => o.trim()) : undefined

      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: effectiveTitle,
          description: suggestionDescription || undefined,
          category: suggestionCategory,
          question: suggestionQuestion,
          questionType,
          options: cleanOptions,
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
            {/* Question Type Selector */}
            <div>
              <label className={`block text-sm font-medium ${textColor} mb-2`}>
                Market Type
              </label>
              <div className="flex flex-wrap gap-1.5">
                {QUESTION_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => {
                      setQuestionType(t.type)
                      if (t.template) applyTemplate(t.template)
                    }}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      (questionType === t.type && t.label === (questionType === 'multi-option' ? 'Multi-Option' : 'Yes/No')) ||
                      (suggestionQuestion === t.template && t.template)
                        ? isDarkMode
                          ? 'border-green-500/50 bg-green-500/10 text-green-400'
                          : 'border-green-500 bg-green-50 text-green-700'
                        : isDarkMode
                          ? 'border-gray-600 text-gray-300 hover:border-green-500/50 hover:text-green-400'
                          : 'border-gray-300 text-gray-600 hover:border-green-500 hover:text-green-600'
                    }`}
                    title={t.hint}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {questionType !== 'yes-no' && (
                <p className={`text-xs ${textMuted} mt-1.5`}>
                  {questionType === 'multi-option' ? 'Each option will be independently tradable with its own price.' :
                   questionType === 'range' ? 'Add price/threshold levels as options (e.g. "↑80,000", "↑75,000").' :
                   questionType === 'sentiment' ? 'Add sentiment options (e.g. "Positive", "Negative").' :
                   questionType === 'date' ? 'Add date options (e.g. "March 1", "March 2", "March 3").' :
                   questionType === 'versus' ? 'Add the two competitors as options.' :
                   'Each option will be independently tradable.'}
                </p>
              )}
            </div>

            {/* Question — primary input */}
            <div>
              <label className={`block text-sm font-medium ${textColor} mb-1`}>
                {questionType === 'yes-no' ? 'Your Yes/No Question *' : 'Your Question *'}
              </label>
              <textarea
                value={suggestionQuestion}
                onChange={(e) => setSuggestionQuestion(e.target.value)}
                placeholder={questionType === 'multi-option'
                  ? 'e.g., Who will win the 2025/26 Ballon d\'Or?'
                  : 'e.g., Will Arsenal win the Premier League 2025/26?'
                }
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
                <p className="text-xs text-green-400 mt-1">Valid question</p>
              )}
            </div>

            {/* Multi-Option inputs (shown for all non-yes-no types) */}
            {questionType !== 'yes-no' && (
              <div>
                <label className={`block text-sm font-medium ${textColor} mb-2`}>Options (min 2, max 10)</label>
                <div className="space-y-2">
                  {multiOptions.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${textMuted} w-5 text-center`}>{i + 1}</span>
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => {
                          const updated = [...multiOptions]
                          updated[i] = e.target.value
                          setMultiOptions(updated)
                        }}
                        placeholder={`Option ${i + 1}`}
                        className={`flex-1 px-3 py-2 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm`}
                        maxLength={100}
                      />
                      {multiOptions.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setMultiOptions(multiOptions.filter((_, j) => j !== i))}
                          className="text-red-400 hover:text-red-300 text-xs p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {multiOptions.length < 10 && (
                  <button
                    type="button"
                    onClick={() => setMultiOptions([...multiOptions, ''])}
                    className={`mt-2 text-xs font-medium ${isDarkMode ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-700'}`}
                  >
                    + Add Option
                  </button>
                )}
              </div>
            )}

            {/* Category */}
            <div>
              <label className={`block text-sm font-medium ${textColor} mb-2`}>Category *</label>
              <div className="grid grid-cols-4 gap-1.5">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setSuggestionCategory(cat.value)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
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
                    <span className="truncate">{cat.label}</span>
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
                {questionType === 'range' ? (
                  /* Polymarket-style: each threshold as a row with Yes/No boxes */
                  <div className="space-y-2">
                    {multiOptions.filter(o => o.trim()).map((opt, i) => (
                      <div key={i} className={`flex items-center gap-2 py-2 px-3 rounded-lg border ${isDarkMode ? 'border-gray-700 bg-[#131722]' : 'border-gray-200 bg-gray-50'}`}>
                        <span className={`flex-1 text-sm font-medium ${textColor} truncate`}>↑ {opt}</span>
                        <div className="flex gap-1.5">
                          <span className={`px-3 py-1 rounded-md text-xs font-semibold ${isDarkMode ? 'bg-green-500/15 text-green-400 border border-green-500/25' : 'bg-green-50 text-green-600 border border-green-200'}`}>Yes</span>
                          <span className={`px-3 py-1 rounded-md text-xs font-semibold ${isDarkMode ? 'bg-red-500/15 text-red-400 border border-red-500/25' : 'bg-red-50 text-red-600 border border-red-200'}`}>No</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : questionType !== 'yes-no' ? (
                  <div className="space-y-1.5">
                    {multiOptions.filter(o => o.trim()).map((opt, i) => {
                      const optStyle = questionType === 'sentiment'
                        ? (i === 0 ? (isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-50 text-green-600 border border-green-200')
                          : (isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-50 text-red-600 border border-red-200'))
                        : (isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-50 text-green-600 border border-green-200')
                      return (
                        <div key={i} className={`flex items-center justify-between py-2 px-3 rounded-lg text-sm font-medium ${optStyle}`}>
                          <span className="truncate">{opt}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className={`flex-1 py-2.5 text-center rounded-lg text-sm font-semibold ${isDarkMode ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-green-50 text-green-600 border border-green-200'}`}>
                      Yes
                    </div>
                    <div className={`flex-1 py-2.5 text-center rounded-lg text-sm font-semibold ${isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                      No
                    </div>
                  </div>
                )}
                <p className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} mt-2 italic`}>Odds will be set by the market maker after approval.</p>
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
