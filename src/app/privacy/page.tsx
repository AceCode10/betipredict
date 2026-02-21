'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#131722]">
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-[#171924]">
        <div className="max-w-[800px] mx-auto px-4">
          <div className="flex items-center gap-4 h-14">
            <Link href="/" className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-bold text-white">Privacy Policy</h1>
          </div>
        </div>
      </header>

      <main className="max-w-[800px] mx-auto px-4 py-8">
        <div className="prose prose-invert prose-sm max-w-none">
          <p className="text-gray-400 text-sm mb-6">Last updated: February 21, 2026</p>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">1. Information We Collect</h2>
            <ul className="text-gray-300 space-y-2 list-disc pl-5">
              <li><strong className="text-white">Account information:</strong> Email address, username, full name, and hashed password.</li>
              <li><strong className="text-white">Financial information:</strong> Mobile money phone number (partially masked), transaction history, and account balance.</li>
              <li><strong className="text-white">Trading data:</strong> Orders, positions, market interactions, and chat messages.</li>
              <li><strong className="text-white">Technical data:</strong> IP address, browser type, device information, and access logs.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">2. How We Use Your Information</h2>
            <ul className="text-gray-300 space-y-2 list-disc pl-5">
              <li>To provide and maintain the prediction market platform.</li>
              <li>To process deposits, withdrawals, and trades.</li>
              <li>To verify your identity and prevent fraud.</li>
              <li>To send transaction confirmations and important account notifications.</li>
              <li>To improve the platform and user experience.</li>
              <li>To comply with legal and regulatory requirements.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">3. Data Security</h2>
            <p className="text-gray-300 leading-relaxed">
              We implement industry-standard security measures to protect your data, including:
              encrypted passwords (bcrypt), HTTPS encryption, rate limiting, CSRF protection,
              Content Security Policy headers, and audit logging. However, no method of electronic
              transmission is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">4. Data Sharing</h2>
            <p className="text-gray-300 leading-relaxed">
              We do not sell your personal data. We may share limited information with:
            </p>
            <ul className="text-gray-300 space-y-2 list-disc pl-5 mt-2">
              <li><strong className="text-white">Payment providers:</strong> Airtel Money and MTN MoMo for processing transactions.</li>
              <li><strong className="text-white">Law enforcement:</strong> When required by law or to prevent fraud.</li>
              <li><strong className="text-white">Public market data:</strong> Anonymized trading activity is visible on market pages (usernames are partially masked).</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">5. Data Retention</h2>
            <p className="text-gray-300 leading-relaxed">
              We retain your account data for as long as your account is active. Transaction records
              are retained for a minimum of 7 years for regulatory compliance. You may request
              account deletion by contacting support, subject to regulatory retention requirements.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">6. Your Rights</h2>
            <ul className="text-gray-300 space-y-2 list-disc pl-5">
              <li>Access your personal data through your account page.</li>
              <li>Export your transaction history in CSV format.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your account (subject to regulatory requirements).</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">7. Cookies</h2>
            <p className="text-gray-300 leading-relaxed">
              We use essential cookies for authentication (session tokens) and user preferences
              (theme settings). We do not use third-party tracking cookies or advertising cookies.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">8. Contact</h2>
            <p className="text-gray-300 leading-relaxed">
              For privacy-related inquiries, contact us at{' '}
              <a href="mailto:privacy@betipredict.com" className="text-green-400 hover:underline">
                privacy@betipredict.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
