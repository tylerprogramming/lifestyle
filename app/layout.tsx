import type { Metadata } from "next";
import { DEFAULT_THEME, THEMES } from "@/lib/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lifestyle OS",
  robots: { index: false, follow: false },
};

// Apply the saved color scheme before first paint so there is no flash.
const themeIds = JSON.stringify(THEMES.map(([id]) => id));
const themeScript = `try{var t=localStorage.getItem("ls-theme");if(${themeIds}.indexOf(t)<0)t=${JSON.stringify(DEFAULT_THEME)};document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
