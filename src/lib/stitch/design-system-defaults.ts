/**
 * Default design tokens and brand config helpers for Stitch integration.
 */

import type { DesignTokens } from "./types";

export interface BrandConfig {
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  accentColor: string;
}

/**
 * Sensible defaults — neutral palette that works for most audit previews.
 */
export const DEFAULT_DESIGN_TOKENS: DesignTokens = {
  colors: {
    primary: "#2563eb",
    secondary: "#64748b",
    accent: "#8b5cf6",
    background: "#ffffff",
    surface: "#f8fafc",
    text: "#0f172a",
    textMuted: "#64748b",
    border: "#e2e8f0",
    error: "#ef4444",
    success: "#22c55e",
    warning: "#f59e0b",
  },
  fonts: {
    heading: "Inter, system-ui, sans-serif",
    body: "Inter, system-ui, sans-serif",
    mono: "Geist Mono, monospace",
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    "2xl": 48,
  },
};

/**
 * Transform a simple brand config into full DesignTokens,
 * using defaults for anything not specified.
 */
export function fromBrandConfig(config: BrandConfig): DesignTokens {
  return {
    colors: {
      ...DEFAULT_DESIGN_TOKENS.colors,
      primary: config.primaryColor || DEFAULT_DESIGN_TOKENS.colors.primary,
      secondary: config.secondaryColor || DEFAULT_DESIGN_TOKENS.colors.secondary,
      accent: config.accentColor || DEFAULT_DESIGN_TOKENS.colors.accent,
    },
    fonts: {
      ...DEFAULT_DESIGN_TOKENS.fonts,
      heading: config.fontFamily || DEFAULT_DESIGN_TOKENS.fonts.heading,
      body: config.fontFamily || DEFAULT_DESIGN_TOKENS.fonts.body,
    },
    spacing: { ...DEFAULT_DESIGN_TOKENS.spacing },
  };
}
