"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * `attribute="data-theme"` matches app/globals.css's
 * `:root[data-theme="dark"]` override (SYSTEM-DESIGN-NEXTJS.md §17.2:
 * dark and light are both first-class, manual choice wins over the OS
 * default).
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="system" enableSystem {...props}>
      {children}
    </NextThemesProvider>
  );
}
