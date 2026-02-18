'use client'

import { useState } from 'react'
import { X, Plus, Calendar, Trophy, Users } from 'lucide-react'

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
    yesPrice: 0.5,
    noPrice: 0.5,
    liquidity: 1000000, // K1M default liquidity
    resolutionSource: '',
    rules: ''
  })

  const [isCreating, setIsCreating] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)

    try {
      const newMarket = {
        id: Date.now().toString(),
        ...formData,
        resolveTime: new Date(formData.matchDate).toISOString(),
        volume: 0,
        status: 'ACTIVE',
        trend: 'up',
        change: '+0%',
        image: `/images/${formData.category}.jpg`,
        subtitle: formData.category.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        league: formData.category.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        createdAt: new Date().toISOString()
      }

      await new Promise(resolve => setTimeout(resolve, 2000)) // Simulate API call
      onCreateMarket(newMarket)
      onClose()
      
      // Reset form
      setFormData({
        title: '',
        description: '',
        category: 'premier-league',
        homeTeam: '',
        awayTeam: '',
        matchDate: '',
        question: '',
        yesPrice: 0.5,
        noPrice: 0.5,
        liquidity: 1000000,
        resolutionSource: '',
        rules: ''
      })
    } finally {
      setIsCreating(false)
    }
  }

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    
    // Auto-update question when teams change
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

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              Create Sports Market
            </h2>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Basic Info */}
          <div className="space-y-3">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Basic Information
            </h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                League/Category *
              </label>
              <select
                value={formData.category}
                onChange={(e) => updateFormData('category', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Home Team *
                </label>
                <input
                  type="text"
                  value={formData.homeTeam}
                  onChange={(e) => updateFormData('homeTeam', e.target.value)}
                  placeholder="e.g., Manchester United"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Away Team *
                </label>
                <input
                  type="text"
                  value={formData.awayTeam}
                  onChange={(e) => updateFormData('awayTeam', e.target.value)}
                  placeholder="e.g., Liverpool"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Match Date & Time *
              </label>
              <input
                type="datetime-local"
                value={formData.matchDate}
                onChange={(e) => updateFormData('matchDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => updateFormData('description', e.target.value)}
                placeholder="e.g., Old Trafford, Manchester"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Market Question */}
          <div className="space-y-3">
            <h3 className="font-medium text-gray-900">Market Details</h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Market Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => updateFormData('title', e.target.value)}
                placeholder="Will [Home Team] beat [Away Team]?"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Question/Match *
              </label>
              <input
                type="text"
                value={formData.question}
                onChange={(e) => updateFormData('question', e.target.value)}
                placeholder="[Home Team] vs [Away Team]"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* Initial Pricing */}
          <div className="space-y-3">
            <h3 className="font-medium text-gray-900">Initial Pricing</h3>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Initial YES Price
                </label>
                <input
                  type="number"
                  value={formData.yesPrice}
                  onChange={(e) => {
                    const yesPrice = parseFloat(e.target.value)
                    updateFormData('yesPrice', yesPrice)
                    updateFormData('noPrice', 1 - yesPrice)
                  }}
                  min="0.01"
                  max="0.99"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Initial NO Price
                </label>
                <input
                  type="number"
                  value={formData.noPrice}
                  onChange={(e) => {
                    const noPrice = parseFloat(e.target.value)
                    updateFormData('noPrice', noPrice)
                    updateFormData('yesPrice', 1 - noPrice)
                  }}
                  min="0.01"
                  max="0.99"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Initial Liquidity (K)
              </label>
              <input
                type="number"
                value={formData.liquidity}
                onChange={(e) => updateFormData('liquidity', parseFloat(e.target.value))}
                min="100000"
                step="100000"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Minimum K100,000 liquidity required
              </p>
            </div>
          </div>

          {/* Resolution Rules */}
          <div className="space-y-3">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Resolution Rules
            </h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Resolution Source *
              </label>
              <input
                type="text"
                value={formData.resolutionSource}
                onChange={(e) => updateFormData('resolutionSource', e.target.value)}
                placeholder="e.g., ESPN, BBC Sport, FIFA official"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Additional Rules
              </label>
              <textarea
                value={formData.rules}
                onChange={(e) => updateFormData('rules', e.target.value)}
                placeholder="e.g., 90 minutes only, extra time not included, etc."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="space-y-3 pt-4 border-t border-gray-200">
            <button
              type="submit"
              disabled={isCreating}
              className="w-full py-3 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? 'Creating Market...' : 'Create Market'}
            </button>
            
            <p className="text-xs text-gray-500 text-center">
              By creating this market, you agree to provide accurate resolution information.
              Markets may be disputed if resolution rules are not followed.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
