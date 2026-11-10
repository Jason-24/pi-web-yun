import type { Metadata, Viewport } from "next";
import { DevIndicatorPreference } from "@/components/DevIndicatorPreference";
import { PwaRegistration } from "@/components/PwaRegistration";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "katex/dist/katex.min.css";
import "./fonts.css";
import "./globals.css";
import "./settings.css";
import "./sidebar.css";
import "./workbench.css";
import "./composer-model.css";
import "./navigation-rail.css";
import "./home.css";
import "./workspace-pages.css";
import "./file-workspace.css";
import "./sidebar-menu.css";
import "./interaction.css";

export const metadata: Metadata = {
  title: "PI-YUN",
  description: "PI-YUN interface for the pi coding agent",
  applicationName: "PI-YUN",
  icons: {
    icon: [
      {
        url: "/icons/yun-mark-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/yun-mark-apple-touch.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PI-YUN",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className="notranslate" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/noto-sans-mono/noto-sans-mono-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/noto-sans-mono/noto-sans-mono-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PwaRegistration />
        {process.env.NODE_ENV === "development" && <DevIndicatorPreference />}
      </body>
    </html>
  );
}
