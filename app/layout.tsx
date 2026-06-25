import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { DashboardProvider } from "@/components/DashboardContext";
import Shell from "@/components/Shell";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tally — time tracking for client billables",
  description:
    "Automatic, low-effort time tracking for consultant billables, built on ActivityWatch.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <DashboardProvider>
          <Shell>{children}</Shell>
        </DashboardProvider>
      </body>
    </html>
  );
}
