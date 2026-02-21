/**
 * Audit Logging System
 * 
 * Records admin actions and financial operations for compliance and debugging.
 * All audit entries are immutable (append-only).
 */

import { prisma } from './prisma'

export type AuditAction =
  | 'MARKET_CREATED'
  | 'MARKET_RESOLVED'
  | 'MARKET_FINALIZED'
  | 'MARKET_CANCELLED'
  | 'DISPUTE_FILED'
  | 'DISPUTE_UPHELD'
  | 'DISPUTE_REJECTED'
  | 'DEPOSIT_INITIATED'
  | 'DEPOSIT_COMPLETED'
  | 'DEPOSIT_FAILED'
  | 'WITHDRAWAL_INITIATED'
  | 'WITHDRAWAL_COMPLETED'
  | 'WITHDRAWAL_FAILED'
  | 'WITHDRAWAL_REFUNDED'
  | 'TRADE_EXECUTED'
  | 'USER_SIGNUP'
  | 'USER_LOGIN'
  | 'USER_BANNED'
  | 'ADMIN_ACTION'
  | 'CRON_RESOLUTION'
  | 'CRON_FINALIZATION'
  | 'CRON_RECONCILIATION'

export type AuditCategory = 'MARKET' | 'PAYMENT' | 'USER' | 'SYSTEM' | 'TRADE'

interface AuditLogEntry {
  action: AuditAction
  category: AuditCategory
  details: Record<string, any>
  actorId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Write an audit log entry. Fire-and-forget — errors are logged but don't block.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        category: entry.category,
        details: JSON.stringify(entry.details),
        actorId: entry.actorId || null,
        ipAddress: entry.ipAddress || null,
        userAgent: entry.userAgent || null,
      }
    })
  } catch (error) {
    // Never let audit logging break the main flow
    console.error('[Audit] Failed to write audit log:', error, entry)
  }
}

/**
 * Extract IP and user agent from a NextRequest for audit logging.
 */
export function extractRequestMeta(headers: Headers): { ipAddress: string; userAgent: string } {
  const ipAddress = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headers.get('x-real-ip')
    || 'unknown'
  const userAgent = headers.get('user-agent') || 'unknown'
  return { ipAddress, userAgent }
}
