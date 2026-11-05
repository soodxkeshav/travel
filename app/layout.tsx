import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wander1K — your next hour, elsewhere",
  description:
    "An AI local guide that turns 1–4 spare hours into a real walk through lesser-known mapped places near you. The stories are AI; the places are real.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
