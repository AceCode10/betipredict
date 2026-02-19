'use client'

import { useState } from 'react'
import { X, Calendar, Trophy, Users } from 'lucide-react'

interface MarketCreationProps {
  isOpen: boolean
  onClose: () => void
  onCreateMarket: (market: any) => void
}

export function MarketCreation({ isOpen, onClose, onCreateMarket }: MarketCreationProps) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'premier-league',
    homeTeam: '',
    awayTeam: '',
    matchDate: '',
    question: '',
    resolutionSource: '',
    rules: ''
  })

  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title || !formData.question || !formData.matchDate) {
      setError('Please fill in all required fields')
      return
    }
    if (new Date(formData.matchDate) <= new Date()) {
      setError('Match date must be in the future')
      return
    }

    setIsCreating(true)
    setError('')

    try {
      await onCreateMarket({
        title: formData.title,
        description: formData.description || `${formData.homeTeam} vs ${formData.awayTeam}`,
        category: formData.category,
        question: formData.question,
        resolveTime: new Date(formData.matchDate).toISOString(),
      })
      
      // Reset form on success
      setFormData({
        title: '', description: '', category: 'premier-league',
        homeTeam: '', awayTeam: '', matchDate: '',
        question: '', resolutionSource: '', rules: ''
      })
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create market')
    } finally {
      setIsCreating(false)
    }
  }

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setError('')
    
    // Auto-update question and title when teams change
    if (field === 'homeTeam' || field === 'awayTeam') {
      const newFormData = { ...formData, [field]: value }
      if (newFormData.homeTeam && newFormData.awayTeam) {
        setFormData(prev => ({ 
          ...prev, 
          [field]: value,
          question: `${newFormData.homeTeam} vs ${newFormData.awayTeam}`,
          title: `Will ${newFormData.homeTeam} beat ${newFormData.awayTeam}?`
        }))
      }
    }
  }

  if (!isOpen) return null

  const inputClass = "w-full px-3 py-2 bg-[#232637] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
  const labelClass = "block text-sm font-medium text-gray-400 mb-1"

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-[#1c2030] shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-[#1c2030] border-b border-gray-700 p-4 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              Create Sports Market
            </h2>
            <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Basic Info */}
          <div className="space-y-3">
            <h3 className="font-medium text-gray-300 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Match Information
            </h3>
            
            <div>
              <label className={labelClass}>League/Category *</label>
              <select
                value={formData.category}
                onChange={(e) => updateFormData('category', e.target.value)}
                className={inputClass}
                required
              >
                <option value="premier-league">Premier League</option>
                <option value="la-liga">La Liga</option>
                <option value="bundesliga">Bundesliga</option>
                <option value="serie-a">Serie A</option>
                <option value="ligue-1">Ligue 1</option>
                <option value="zambia-super-league">Zambia Super League</option>
                <option value="champions-league">Champions League</option>
                <option value="other-sports">Other Sports</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Home Team *</label>
                <input
                  type="text"
                  value={formData.homeTeam}
                  onChange={(e) => updateFormData('homeTeam', e.target.value)}
                  placeholder="e.g., Man United"
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className={labelClass}>Away Team *</label>
                <input
                  type="text"
                  value={formData.awayTeam}
                  onChange={(e) => updateFormData('awayTeam', e.target.value)}
                  placeholder="e.g., Liverpool"
                  className={inputClass}
                  required
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Match Date & Time *</label>
              <input
                type="datetime-local"
                value={formData.matchDate}
                onChange={(e) => updateFormData('matchDate', e.target.value)}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Venue / Description</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => updateFormData('description', e.target.value)}
                placeholder="e.g., Old Trafford, Manchester"
                className={inputClass}
              />
            </div>
          </div>

          {/* Market Details */}
          <div className="space-y-3">
            <h3 className="font-medium text-gray-300">Market Details</h3>
            
            <div>
              <label className={labelClass}>Market Title *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => updateFormData('title', e.target.value)}
                placeholder="Will [Home Team] beat [Away Team]?"
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Question/Match *</label>
              <input
                type="text"
                value={formData.question}
                onChange={(e) => updateFormData('question', e.target.value)}
                placeholder="[Home Team] vs [Away Team]"
                className={inputClass}
                required
              />
            </div>
          </div>

          {/* Resolution Rules */}
          <div className="space-y-3">
            <h3 className="font-medium text-gray-300 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Resolution Rules
            </h3>
            
            <div>
              <label className={labelClass}>Resolution Source</label>
              <input
                type="text"
                value={formData.resolutionSource}
                onChange={(e) => updateFormData('resolutionSource', e.target.value)}
                placeholder="e.g., ESPN, BBC Sport"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Additional Rules</label>
              <textarea
                value={formData.rules}
                onChange={(e) => updateFormData('rules', e.target.value)}
                placeholder="e.g., 90 minutes only, extra time not included"
                rows={2}
                className={inputClass}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Submit */}
          <div className="space-y-3 pt-4 border-t border-gray-700">
            <button
              type="submit"
              disabled={isCreating}
              className="w-full py-3 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? 'Creating Market...' : 'Create Market'}
            </button>
            
            <p className="text-[10px] text-gray-600 text-center">
              By creating this market, you agree to provide accurate resolution information.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
