/**
 * League Display Name Mapping — Single source of truth
 * 
 * Maps full competition names (from football-data.org API) to
 * short display names used on BetiPredict market cards.
 */

// Map competition full names → display names
export const LEAGUE_DISPLAY_NAMES: Record<string, string> = {
  // Primary mappings (from football-data.org)
  'Premier League': 'EPL',
  'Serie A': 'Serie A',
  'Ligue 1': 'Ligue 1',
  'Primera Division': 'La Liga',
  'La Liga': 'La Liga',
  'Bundesliga': 'Bundesliga',
  'UEFA Champions League': 'UCL',
  'Champions League': 'UCL',

  // Additional competition names that may appear
  'European Championship': 'EURO',
  'FIFA World Cup': 'World Cup',
  'World Cup': 'World Cup',
}

// Map competition codes (PL, SA, etc.) → display names
export const LEAGUE_CODE_DISPLAY_NAMES: Record<string, string> = {
  'PL': 'EPL',
  'SA': 'Serie A',
  'FL1': 'Ligue 1',
  'PD': 'La Liga',
  'BL1': 'Bundesliga',
  'CL': 'UCL',
  'EC': 'EURO',
  'WC': 'World Cup',
}

/**
 * Get the display name for a league.
 * Checks full name first, then code, falls back to original.
 */
export function getLeagueDisplayName(leagueNameOrCode: string): string {
  if (!leagueNameOrCode) return ''
  
  // Check full name match
  if (LEAGUE_DISPLAY_NAMES[leagueNameOrCode]) {
    return LEAGUE_DISPLAY_NAMES[leagueNameOrCode]
  }
  
  // Check code match
  if (LEAGUE_CODE_DISPLAY_NAMES[leagueNameOrCode]) {
    return LEAGUE_CODE_DISPLAY_NAMES[leagueNameOrCode]
  }
  
  // Case-insensitive search
  const lower = leagueNameOrCode.toLowerCase()
  for (const [key, value] of Object.entries(LEAGUE_DISPLAY_NAMES)) {
    if (key.toLowerCase() === lower) return value
  }
  
  // Return original if no mapping found
  return leagueNameOrCode
}
