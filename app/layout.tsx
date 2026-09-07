import type { Metadata } from "next";
import { Spectral, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * Two voices, both from the period the map covers.
 *
 * Spectral reads as newsprint — a screen serif with the slightly narrow,
 * high-contrast cut of a broadsheet, which is what the day panels are.
 * IBM Plex Mono is the instrument: dates, counts, filing labels. Everything
 * that is a measurement rather than a sentence is set in it.
 */
const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "The war, day by day",
  description:
    "An interactive reconstruction of the Second World War, one day at a time: "
    + "where the front lines were, what changed hands, and what the papers printed that morning.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spectral.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
