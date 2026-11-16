import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/layout/ThemeProvider";

export const metadata: Metadata = {
  title: { default: "Scraper Premium", template: "%s — Scraper Premium" },
  description: "Professional Google Maps data scraper",
};

const themeScript = `(function(){try{var t=localStorage.getItem('sp-theme')||'light';document.documentElement.className=t==='dark'?'dark':'light'}catch(e){document.documentElement.className='light'}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
