import {
  ClerkProvider,
  SignedIn,
  SignedOut,
} from '@clerk/nextjs'
import { Analytics } from "@vercel/analytics/react"
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner"
import { isMockAuthEnabledClient } from "@/lib/mock-auth";
import "./globals.css";
import SignedInPage from './signed-in-page';
import SignedOutPage from './signed-out-page';

export const metadata: Metadata = {
  title: "MotoGPT",
  description: "Track your motorcycle maintenance with AI-powered insights",
};

function AppBody({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedOut>
        <SignedOutPage />
      </SignedOut>
      <SignedIn>
        <SignedInPage>
          {children}
        </SignedInPage>
        <Toaster />
      </SignedIn>
      <Analytics />
    </>
  );
}

// in mock mode, skip ClerkProvider entirely so no Clerk keys/session are required
function MockAppBody({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedInPage>
        {children}
      </SignedInPage>
      <Toaster />
      <Analytics />
    </>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (isMockAuthEnabledClient()) {
    return (
      <html lang="en">
        <body>
          <MockAppBody>{children}</MockAppBody>
        </body>
      </html>
    );
  }

  return (
    <ClerkProvider dynamic>
      <html lang="en">
        <body>
          <AppBody>{children}</AppBody>
        </body>
      </html>
    </ClerkProvider>
  )
}
