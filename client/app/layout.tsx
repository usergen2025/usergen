import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/layout/Header";
import { ToastProvider } from "@/lib/toast/toast";
import { WebSocketProvider } from "@/contexts/WebSocketContext";

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
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <WebSocketProvider>
          <ToastProvider>
            <Header />
            <main className="min-h-screen">
              {children}
            </main>
          </ToastProvider>
        </WebSocketProvider>
      </body>
    </html>
  );
}
