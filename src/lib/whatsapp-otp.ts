// Twilio Verify API for SMS OTP verification
// Uses REST API directly (no SDK dependency)

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || ''
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || ''
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || ''

const TWILIO_BASE = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}`

function twilioAuth(): string {
  return 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
}

export function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-()]/g, '')
  if (p.startsWith('0')) p = '+260' + p.slice(1)
  if (!p.startsWith('+')) p = '+' + p
  return p
}

/**
 * Send OTP via Twilio Verify (SMS channel)
 * Twilio manages code generation, delivery, and expiry automatically.
 */
export async function sendOTP(phone: string): Promise<boolean> {
  const to = normalizePhone(phone)

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    console.log(`[OTP] DEV MODE — would send OTP to ${to}`)
    return true
  }

  try {
    const res = await fetch(`${TWILIO_BASE}/Verifications`, {
      method: 'POST',
      headers: {
        'Authorization': twilioAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, Channel: 'sms' }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[OTP] Twilio send error:', res.status, text)
      return false
    }

    const data = await res.json()
    console.log('[OTP] Verification sent:', data.sid, data.status)
    return data.status === 'pending'
  } catch (err) {
    console.error('[OTP] Failed to send:', err)
    return false
  }
}

/**
 * Verify OTP code via Twilio Verify
 * Returns true if the code is valid and approved.
 */
export async function verifyOTP(phone: string, code: string): Promise<boolean> {
  const to = normalizePhone(phone)

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    // DEV MODE: accept any 6-digit code
    console.log(`[OTP] DEV MODE — verifying code ${code} for ${to}`)
    return code.length === 6
  }

  try {
    const res = await fetch(`${TWILIO_BASE}/VerificationCheck`, {
      method: 'POST',
      headers: {
        'Authorization': twilioAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, Code: code }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[OTP] Twilio verify error:', res.status, text)
      return false
    }

    const data = await res.json()
    console.log('[OTP] Verification check:', data.status)
    return data.status === 'approved'
  } catch (err) {
    console.error('[OTP] Failed to verify:', err)
    return false
  }
}
