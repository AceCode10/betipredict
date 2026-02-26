import { generateOTP } from '@/lib/email'

const AT_API_KEY = process.env.AT_API_KEY || ''
const AT_USERNAME = process.env.AT_USERNAME || 'sandbox'
const AT_FROM = process.env.AT_WHATSAPP_FROM || ''
const AT_SMS_BASE = AT_USERNAME === 'sandbox'
  ? 'https://api.sandbox.africastalking.com'
  : 'https://api.africastalking.com'

function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-()]/g, '')
  if (p.startsWith('0')) p = '+260' + p.slice(1)
  if (!p.startsWith('+')) p = '+' + p
  return p
}

async function sendViaSMS(to: string, message: string): Promise<boolean> {
  const res = await fetch(`${AT_SMS_BASE}/version1/messaging`, {
    method: 'POST',
    headers: {
      'apiKey': AT_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      username: AT_USERNAME,
      to,
      message,
      ...(AT_FROM ? { from: AT_FROM } : {}),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error('[OTP SMS] AT API error:', res.status, text)
    return false
  }

  const data = await res.json()
  console.log('[OTP SMS] Sent:', JSON.stringify(data))
  const recipients = data?.SMSMessageData?.Recipients || []
  return recipients.some((r: any) => r.statusCode === 101 || r.status === 'Success')
}

export async function sendWhatsAppOTP(phone: string, otp: string): Promise<boolean> {
  const to = normalizePhone(phone)
  const message = `Your BetiPredict verification code is: ${otp}. It expires in 10 minutes. Do not share this code.`

  if (!AT_API_KEY) {
    console.log(`[OTP] DEV MODE — OTP for ${to}: ${otp}`)
    return true
  }

  try {
    return await sendViaSMS(to, message)
  } catch (err) {
    console.error('[OTP] Failed:', err)
    return false
  }
}

export { generateOTP, normalizePhone }
