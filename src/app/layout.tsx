import type { Metadata, Viewport } from "next";
import "./globals.css";
import "@/lib/env-check";
import { Providers } from "@/components/providers/SessionProvider";
import { ThemeProvider } from "@/contexts/ThemeContext";

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://betipredict.com'

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "BetiPredict — Sports Prediction Market",
    template: "%s | BetiPredict",
  },
  description: "Trade on sports outcomes with Zambian Kwacha. Predict football match results and win big on Africa's first prediction market platform powered by a Central Limit Order Book.",
  keywords: ["prediction market", "sports trading", "Zambia", "football", "Kwacha", "BetiPredict", "CLOB", "order book", "Premier League", "La Liga", "Champions League", "trade", "predict"],
  authors: [{ name: "BetiPredict" }],
  creator: "BetiPredict",
  publisher: "BetiPredict",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
  openGraph: {
    title: "BetiPredict — Sports Prediction Market",
    description: "Trade on sports outcomes with Zambian Kwacha. Africa's prediction market platform with real-time order book pricing.",
    siteName: "BetiPredict",
    type: "website",
    locale: "en_ZM",
    url: baseUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "BetiPredict — Sports Prediction Market",
    description: "Trade on sports outcomes with Zambian Kwacha. Real-time order book pricing.",
    creator: "@betipredict",
  },
  robots: { index: true, follow: true },
  alternates: { canonical: baseUrl },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#131722",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Lenco Payment Widget — loaded based on environment */}
        {process.env.NEXT_PUBLIC_LENCO_ENVIRONMENT === 'sandbox' ? (
          <script src="https://pay.sandbox.lenco.co/js/v1/inline.js" async />
        ) : (
          <script src="https://pay.lenco.co/js/v1/inline.js" async />
        )}
      </head>
      <body className="antialiased">
        <Providers>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
