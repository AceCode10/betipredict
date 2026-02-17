'use client'

import { SessionProvider } from "next-auth/react";
import { WalletProvider } from "@/components/WalletConnect";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <WalletProvider>
        {children}
      </WalletProvider>
    </SessionProvider>
  );
}
