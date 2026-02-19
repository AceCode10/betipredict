'use client'

import { useState, useEffect } from 'react'
import { X, Calendar, Trophy, Loader2, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface Game {
  id: number
  competition: string
  competitionCode: string
  competitionEmblem: string
  homeTeam: string
  homeTeamShort: string
  homeTeamCrest: string
  awayTeam: string
  awayTeamShort: string
  awayTeamCrest: string
  utcDate: string
  matchday: number
  status: string
}

interface Competition {
  code: string
  name: string
  country: string
}

interface CreateMarketModalProps {
  isOpen: boolean
  onClose: () => void
  onMarketCreated: () => void
}

type TabType = 'games' | 'suggest'

export function CreateMarketModal({ isOpen, onClose, onMarketCreated }: CreateMarketModalProps) {
  const { isDarkMode } = useTheme()
  const [activeTab, setActiveTab] = useState<TabType>('games')
  const [games, setGames] = useState<Game[]>([])
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [selectedCompetition, setSelectedCompetition] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Suggestion form state
  const [suggestionTitle, setSuggestionTitle] = useState('')
  const [suggestionDescription, setSuggestionDescription] = useState('')
  const [suggestionCategory, setSuggestionCategory] = useState('Sports')
  const [suggestionQuestion, setSuggestionQuestion] = useState('')
  const [suggestionResolution, setSuggestionResolution] = useState('')

  const bgColor = isDarkMode ? 'bg-[#1e2130]' : 'bg-white'
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200'
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900'
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-500'
  const inputBg = isDarkMode ? 'bg-[#131722]' : 'bg-gray-50'

  useEffect(() => {
    if (isOpen && activeTab === 'games') {
      fetchGames()
    }
  }, [isOpen, activeTab, selectedCompetition])

  const fetchGames = async () => {
    setLoading(true)
    setError('')
    try {
      const url = selectedCompetition 
        ? `/api/games?competition=${selectedCompetition}&limit=30`
        : '/api/games?limit=30'
      const res = await fetch(url)
      const data = await res.json()
      setGames(data.games || [])
      setCompetitions(data.competitions || [])
    } catch (err) {
      setError('Failed to load games. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const createMarketFromGame = async (game: Game) => {
    setCreating(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/markets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${game.homeTeam} vs ${game.awayTeam}`,
          description: `${game.competition} - Matchday ${game.matchday || 'N/A'}`,
          category: 'Sports',
          subcategory: game.competition,
          question: `Who will win: ${game.homeTeam} vs ${game.awayTeam}?`,
          resolveTime: game.utcDate,
          externalGameId: game.id,
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create market')
      }

      setSuccess('Market created successfully!')
      setTimeout(() => {
        onMarketCreated()
        onClose()
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'Failed to create market')
    } finally {
      setCreating(false)
    }
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
          title: suggestionTitle,
          description: suggestionDescription,
          category: suggestionCategory,
          question: suggestionQuestion,
          resolutionSource: suggestionResolution,
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
      
      setTimeout(() => {
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
      
      <div className={`relative ${bgColor} rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${borderColor}`}>
          <h2 className={`text-lg font-semibold ${textColor}`}>Create Market</h2>
          <button onClick={onClose} className={`p-1 rounded-lg hover:bg-gray-700/50 ${textMuted}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${borderColor}`}>
          <button
            onClick={() => setActiveTab('games')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'games'
                ? 'text-green-500 border-b-2 border-green-500'
                : `${textMuted} hover:text-white`
            }`}
          >
            <Trophy className="w-4 h-4 inline mr-2" />
            Select from Games
          </button>
          <button
            onClick={() => setActiveTab('suggest')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'suggest'
                ? 'text-green-500 border-b-2 border-green-500'
                : `${textMuted} hover:text-white`
            }`}
          >
            <Calendar className="w-4 h-4 inline mr-2" />
            Suggest a Market
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

          {activeTab === 'games' ? (
            <>
              {/* Competition Filter */}
              <div className="mb-4">
                <div className="relative">
                  <select
                    value={selectedCompetition}
                    onChange={(e) => setSelectedCompetition(e.target.value)}
                    className={`w-full px-4 py-2.5 ${inputBg} border ${borderColor} rounded-lg ${textColor} text-sm appearance-none cursor-pointer`}
                  >
                    <option value="">All Competitions</option>
                    {competitions.map(comp => (
                      <option key={comp.code} value={comp.code}>
                        {comp.name} ({comp.country})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textMuted} pointer-events-none`} />
                </div>
              </div>

              {/* Games List */}
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
                </div>
              ) : games.length === 0 ? (
                <div className={`text-center py-12 ${textMuted}`}>
                  <Trophy className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No upcoming games found.</p>
                  <p className="text-sm mt-1">Try selecting a different competition or check back later.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {games.map(game => (
                    <div
                      key={game.id}
                      className={`p-4 ${inputBg} border ${borderColor} rounded-lg hover:border-green-500/50 transition-colors`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className={`text-xs ${textMuted} mb-1`}>
                            {game.competition} {game.matchday ? `• Matchday ${game.matchday}` : ''}
                          </div>
                          <div className="flex items-center gap-3">
                            {game.homeTeamCrest && (
                              <img src={game.homeTeamCrest} alt="" className="w-6 h-6 object-contain" />
                            )}
                            <span className={`font-medium ${textColor}`}>
                              {game.homeTeamShort || game.homeTeam}
                            </span>
                            <span className={textMuted}>vs</span>
                            <span className={`font-medium ${textColor}`}>
                              {game.awayTeamShort || game.awayTeam}
                            </span>
                            {game.awayTeamCrest && (
                              <img src={game.awayTeamCrest} alt="" className="w-6 h-6 object-contain" />
                            )}
                          </div>
                          <div className={`text-xs ${textMuted} mt-1`}>
                            {new Date(game.utcDate).toLocaleDateString('en-GB', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                        <button
                          onClick={() => createMarketFromGame(game)}
                          disabled={creating}
                          className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className={`text-xs ${textMuted} mt-4 text-center`}>
                Markets created from scheduled games are approved instantly.
              </p>
            </>
          ) : (
            /* Suggestion Form */
            <form onSubmit={submitSuggestion} className="space-y-4">
              <p className={`text-sm ${textMuted} mb-4`}>
                Suggest a custom market for admin review. Provide as much detail as possible for faster approval.
              </p>

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
                />
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
                Custom market suggestions require admin approval before going live.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
