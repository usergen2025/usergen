import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/layout/Header";
import { ToastProvider } from "@/lib/toast/toast";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import ConditionalHeader from "@/components/layout/ConditionalHeader";
import { AuthExpiryProvider } from "@/contexts/AuthExpiryContext";

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
      <body className={`${inter.variable} antialiased h-full flex flex-col`}>
        <WebSocketProvider>
          <ToastProvider>
            <AuthExpiryProvider>
              <ConditionalHeader />
              <main className="flex-1 min-h-0">
                {children}
              </main>
            </AuthExpiryProvider>
          </ToastProvider>
        </WebSocketProvider>
      </body>
    </html>
  );
}
