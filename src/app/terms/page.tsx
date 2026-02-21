'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-[#131722]">
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-[#171924]">
        <div className="max-w-[800px] mx-auto px-4">
          <div className="flex items-center gap-4 h-14">
            <Link href="/" className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-bold text-white">Terms of Service</h1>
          </div>
        </div>
      </header>

      <main className="max-w-[800px] mx-auto px-4 py-8">
        <div className="prose prose-invert prose-sm max-w-none">
          <p className="text-gray-400 text-sm mb-6">Last updated: February 21, 2026</p>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">1. Acceptance of Terms</h2>
            <p className="text-gray-300 leading-relaxed">
              By accessing or using BetiPredict (&quot;the Platform&quot;), you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, do not use the Platform. BetiPredict is a prediction market 
              platform operated in Zambia, and all transactions are denominated in Zambian Kwacha (ZMW).
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">2. Eligibility</h2>
            <p className="text-gray-300 leading-relaxed">
              You must be at least 18 years of age to use the Platform. By creating an account, you represent 
              and warrant that you are of legal age and have the legal capacity to enter into these terms. 
              You must be a resident of Zambia or a jurisdiction where prediction markets are permitted.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">3. Account Registration</h2>
            <p className="text-gray-300 leading-relaxed">
              You must provide accurate, current, and complete information during registration. You are 
              responsible for maintaining the confidentiality of your account credentials and for all 
              activities under your account. You must notify us immediately of any unauthorized use.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">4. Trading & Markets</h2>
            <ul className="text-gray-300 space-y-2 list-disc pl-5">
              <li>Markets are binary prediction markets with YES/NO outcomes.</li>
              <li>Prices are determined by a Constant Product Market Maker (CPMM) algorithm.</li>
              <li>All trades are final once executed. There are no cancellations.</li>
              <li>Markets are resolved based on real-world outcomes from verified data sources.</li>
              <li>A 24-hour dispute window is provided after market resolution.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">5. Fees</h2>
            <ul className="text-gray-300 space-y-2 list-disc pl-5">
              <li><strong className="text-white">Trading fee:</strong> 2% on all buy and sell transactions.</li>
              <li><strong className="text-white">Withdrawal fee:</strong> 1.5% (minimum K5) on all withdrawals.</li>
              <li><strong className="text-white">Resolution fee:</strong> 1% deducted from winning payouts.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">6. Deposits & Withdrawals</h2>
            <p className="text-gray-300 leading-relaxed">
              Deposits and withdrawals are processed via mobile money (Airtel Money, MTN MoMo). 
              Processing times depend on the payment provider. The Platform is not responsible for 
              delays caused by payment providers. Minimum deposit: K10. Maximum deposit: K50,000. 
              Minimum withdrawal: K20. Maximum withdrawal: K100,000.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">7. Risk Disclosure</h2>
            <p className="text-gray-300 leading-relaxed">
              Trading on prediction markets involves financial risk. You may lose some or all of your 
              invested funds. Past performance does not guarantee future results. Only trade with funds 
              you can afford to lose. BetiPredict does not provide financial advice.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">8. Prohibited Activities</h2>
            <ul className="text-gray-300 space-y-2 list-disc pl-5">
              <li>Creating multiple accounts to exploit the platform.</li>
              <li>Using automated bots or scripts to trade without authorization.</li>
              <li>Manipulating markets through coordinated trading or wash trading.</li>
              <li>Attempting to exploit bugs or vulnerabilities in the platform.</li>
              <li>Money laundering or any illegal financial activity.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">9. Limitation of Liability</h2>
            <p className="text-gray-300 leading-relaxed">
              BetiPredict is provided &quot;as is&quot; without warranties of any kind. We are not liable for any 
              indirect, incidental, or consequential damages arising from your use of the Platform. 
              Our total liability shall not exceed the amount you have deposited on the Platform.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">10. Governing Law</h2>
            <p className="text-gray-300 leading-relaxed">
              These terms are governed by the laws of the Republic of Zambia. Any disputes shall be 
              resolved through arbitration in Lusaka, Zambia.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold text-white mb-3">11. Contact</h2>
            <p className="text-gray-300 leading-relaxed">
              For questions about these Terms, contact us at{' '}
              <a href="mailto:support@betipredict.com" className="text-green-400 hover:underline">
                support@betipredict.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
