import type { Metadata } from "next";
import "./globals.css";
import { DashboardProvider } from "@/components/DashboardContext";
import Shell from "@/components/Shell";

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
    <html lang="en">
      <body>
        <DashboardProvider>
          <Shell>{children}</Shell>
        </DashboardProvider>
      </body>
    </html>
  );
}
