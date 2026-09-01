import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZenoEats",
  description: "QR ordering and live delivery tracking.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
