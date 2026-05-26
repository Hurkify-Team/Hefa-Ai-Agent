import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HEFAMAA Smart Registry Agent",
  description: "Facility data capture dashboard for HEFAMAA registry workflows.",
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
