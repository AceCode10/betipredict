/**
 * Shared admin authentication helper.
 * Normalizes email comparison (case-insensitive) across all admin routes.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

/**
 * Check if the current session belongs to an admin user.
 * Returns the session if admin, null otherwise.
 */
export async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  if (!ADMIN_EMAILS.includes(session.user.email.toLowerCase())) return null
  return session
}

/**
 * Check if an email is an admin email.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return ADMIN_EMAILS.includes(email.toLowerCase())
}
