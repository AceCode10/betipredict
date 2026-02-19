import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers/SessionProvider";
import { ThemeProvider } from "@/contexts/ThemeContext";

export const metadata: Metadata = {
  title: "BetiPredict — Sports Prediction Market",
  description: "Trade on sports outcomes with Zambian Kwacha. Bet on football matches, predict results, and win big on Africa's prediction market platform.",
  keywords: ["prediction market", "sports betting", "Zambia", "football", "Kwacha", "BetiPredict"],
  openGraph: {
    title: "BetiPredict — Sports Prediction Market",
    description: "Trade on sports outcomes with Zambian Kwacha. Africa's prediction market platform.",
    siteName: "BetiPredict",
    type: "website",
    locale: "en_ZM",
  },
  twitter: {
    card: "summary_large_image",
    title: "BetiPredict — Sports Prediction Market",
    description: "Trade on sports outcomes with Zambian Kwacha.",
  },
  robots: { index: true, follow: true },
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
