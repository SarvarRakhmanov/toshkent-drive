import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Toshkent Drive",
  description: "Toshkent Drive — open-world browser driving game (based on Neon City Drive, MIT)",
};

// phones: no page zoom (pinch/double-tap would zoom the HUD instead of driving),
// draw under the notch (HUD pads itself with env(safe-area-inset-*))
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#050814",
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
