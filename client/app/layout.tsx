import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { GoogleTagManager } from "@next/third-parties/google";
import "./globals.css";
import Header from "@/components/layout/Header";
import { ToastProvider } from "@/lib/toast/toast";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import { CampaignEventsProvider } from "@/contexts/CampaignEventsContext";
import ConditionalHeader from "@/components/layout/ConditionalHeader";
import { AuthExpiryProvider } from "@/contexts/AuthExpiryContext";
import Analytics from "@/components/analytics/Analytics";

const gtmId = process.env.NEXT_PUBLIC_GTM_ID;

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "UserGen.ai - AI-Powered Video Creation",
  description: "Create professional videos with AI avatars, voice cloning, and more",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      {gtmId ? <GoogleTagManager gtmId={gtmId} /> : null}
      <body className={`${inter.variable} app-global-gradient antialiased h-full flex flex-col`}>
        <WebSocketProvider>
          <CampaignEventsProvider>
            <ToastProvider>
              <AuthExpiryProvider>
                <Analytics />
                <ConditionalHeader />
                <main className="flex min-h-0 flex-1 flex-col">
                  {children}
                </main>
              </AuthExpiryProvider>
            </ToastProvider>
          </CampaignEventsProvider>
        </WebSocketProvider>
      </body>
    </html>
  );
}
