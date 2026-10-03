import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Toshkent Drive",
  description: "Toshkent Drive — open-world browser driving game (based on Neon City Drive, MIT)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
