/**
 * Platform categories — single source of truth.
 * Market Makers can add/remove categories via the /api/market-maker endpoint.
 * 
 * Default categories: Football, Entertainment, Social, Politics, Finance, Other
 */

export interface Category {
  value: string
  label: string
  icon: string
}

// Default platform categories
export const DEFAULT_CATEGORIES: Category[] = [
  { value: 'Football', label: 'Football', icon: '⚽' },
  { value: 'Entertainment', label: 'Entertainment', icon: '🎬' },
  { value: 'Social', label: 'Social', icon: '💬' },
  { value: 'Politics', label: 'Politics', icon: '🏛️' },
  { value: 'Finance', label: 'Finance', icon: '📈' },
  { value: 'Other', label: 'Other', icon: '🌍' },
]

// Football sub-league filters for the main page nav
export const FOOTBALL_LEAGUES = [
  { value: 'premier-league', label: 'Premier League' },
  { value: 'la-liga', label: 'La Liga' },
  { value: 'bundesliga', label: 'Bundesliga' },
  { value: 'serie-a', label: 'Serie A' },
  { value: 'ligue-1', label: 'Ligue 1' },
  { value: 'champions-league', label: 'Champions League' },
]

// Build the full nav categories list for the main page
export function getNavCategories(customCategories?: Category[]): { value: string; label: string; icon: string }[] {
  const cats = customCategories || DEFAULT_CATEGORIES
  const nav: { value: string; label: string; icon: string }[] = [
    { value: 'all', label: 'All', icon: '' },
  ]

  for (const cat of cats) {
    nav.push(cat)
    // If Football, add sub-league filters after it
    if (cat.value === 'Football') {
      for (const league of FOOTBALL_LEAGUES) {
        nav.push({ value: league.value, label: league.label, icon: '' })
      }
    }
  }

  return nav
}
