import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers/SessionProvider";

export const metadata: Metadata = {
  title: "BetiPredict - African Prediction Market Platform",
  description: "Trade on sports outcomes in the African prediction market platform",
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
          {children}
        </Providers>
      </body>
    </html>
  );
}
