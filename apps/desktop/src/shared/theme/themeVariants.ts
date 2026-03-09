export type ThemePreference = "system" | "light" | "dark";
export type ThemeMode = "light" | "dark";

export type ThemeVariantId =
  | "studio-dark"
  | "nordic-dark"
  | "midnight-studio"
  | "high-contrast-dark"
  | "arctic-light"
  | "minimal-light"
  | "soft-paper";

export type ThemeSemanticTokens = {
  backgroundPrimary: string;
  backgroundPanel: string;
  surfaceElevated: string;
  textPrimary: string;
  textSecondary: string;
  accentPrimary: string;
  accentSecondary: string;
  borderSubtle: string;
  borderStrong: string;
  success: string;
  warning: string;
  error: string;
  accentPrimaryRgb: string;
  accentSecondaryRgb: string;
};

export type ThemeVariantDefinition = {
  id: ThemeVariantId;
  label: string;
  mode: ThemeMode;
  description: string;
  tokens: ThemeSemanticTokens;
};

export const THEME_VARIANTS: readonly ThemeVariantDefinition[] = [
  {
    id: "studio-dark",
    label: "Studio Dark",
    mode: "dark",
    description: "Balanced contrast and clean accents for long production sessions.",
    tokens: {
      backgroundPrimary: "#0F141A",
      backgroundPanel: "#18212B",
      surfaceElevated: "#1F2A36",
      textPrimary: "#E8EEF4",
      textSecondary: "#A8B4C1",
      accentPrimary: "#5AA9FF",
      accentSecondary: "#4FC2B3",
      borderSubtle: "#2B3A4A",
      borderStrong: "#42566C",
      success: "#3CB57A",
      warning: "#D9A649",
      error: "#E16B6B",
      accentPrimaryRgb: "90 169 255",
      accentSecondaryRgb: "79 194 179"
    }
  },
  {
    id: "nordic-dark",
    label: "Nordic Dark",
    mode: "dark",
    description: "Cool low-fatigue palette inspired by northern studio interfaces.",
    tokens: {
      backgroundPrimary: "#111723",
      backgroundPanel: "#1A2432",
      surfaceElevated: "#212F40",
      textPrimary: "#E5ECF4",
      textSecondary: "#A5B3C5",
      accentPrimary: "#88C0D0",
      accentSecondary: "#81A1C1",
      borderSubtle: "#2D3C4F",
      borderStrong: "#44566B",
      success: "#5EBC86",
      warning: "#D6A357",
      error: "#D67D7D",
      accentPrimaryRgb: "136 192 208",
      accentSecondaryRgb: "129 161 193"
    }
  },
  {
    id: "midnight-studio",
    label: "Midnight Studio",
    mode: "dark",
    description: "Deep cinematic dark mode with restrained electric highlights.",
    tokens: {
      backgroundPrimary: "#0B111A",
      backgroundPanel: "#151F2C",
      surfaceElevated: "#1C2939",
      textPrimary: "#E6EEF8",
      textSecondary: "#9FB1C6",
      accentPrimary: "#6EA8FF",
      accentSecondary: "#7ED7E6",
      borderSubtle: "#27374A",
      borderStrong: "#3A4F67",
      success: "#43B67D",
      warning: "#CFA45A",
      error: "#E07272",
      accentPrimaryRgb: "110 168 255",
      accentSecondaryRgb: "126 215 230"
    }
  },
  {
    id: "high-contrast-dark",
    label: "High Contrast Dark",
    mode: "dark",
    description: "Accessibility-first dark palette with strong edge and text clarity.",
    tokens: {
      backgroundPrimary: "#090C10",
      backgroundPanel: "#111821",
      surfaceElevated: "#17212D",
      textPrimary: "#F4F8FC",
      textSecondary: "#CAD5E1",
      accentPrimary: "#4DA3FF",
      accentSecondary: "#58D1C0",
      borderSubtle: "#3A4D62",
      borderStrong: "#5A748F",
      success: "#4AC389",
      warning: "#E2B65A",
      error: "#F07D7D",
      accentPrimaryRgb: "77 163 255",
      accentSecondaryRgb: "88 209 192"
    }
  },
  {
    id: "arctic-light",
    label: "Arctic Light",
    mode: "light",
    description: "Crisp cool light palette with strong structure and subtle tinting.",
    tokens: {
      backgroundPrimary: "#F2F6FB",
      backgroundPanel: "#FFFFFF",
      surfaceElevated: "#F8FBFF",
      textPrimary: "#162230",
      textSecondary: "#5F7084",
      accentPrimary: "#2E6FB7",
      accentSecondary: "#4D8AAE",
      borderSubtle: "#D5DEE8",
      borderStrong: "#B9C8D8",
      success: "#2E9D6A",
      warning: "#AD7E1E",
      error: "#C05A4A",
      accentPrimaryRgb: "46 111 183",
      accentSecondaryRgb: "77 138 174"
    }
  },
  {
    id: "minimal-light",
    label: "Minimal Light",
    mode: "light",
    description: "Neutral modern light scheme tuned for editing without visual noise.",
    tokens: {
      backgroundPrimary: "#F5F7F9",
      backgroundPanel: "#FFFFFF",
      surfaceElevated: "#F9FBFC",
      textPrimary: "#1D2733",
      textSecondary: "#687785",
      accentPrimary: "#2F7A69",
      accentSecondary: "#3E8EAA",
      borderSubtle: "#D7DEE5",
      borderStrong: "#BCC7D2",
      success: "#2C9A67",
      warning: "#A97A22",
      error: "#B95757",
      accentPrimaryRgb: "47 122 105",
      accentSecondaryRgb: "62 142 170"
    }
  },
  {
    id: "soft-paper",
    label: "Soft Paper",
    mode: "light",
    description: "Warm low-glare light palette with print-like paper tonality.",
    tokens: {
      backgroundPrimary: "#F6F1E8",
      backgroundPanel: "#FFF9F1",
      surfaceElevated: "#FFFDF8",
      textPrimary: "#2A231A",
      textSecondary: "#776B5D",
      accentPrimary: "#8C5C2C",
      accentSecondary: "#6A7C8F",
      borderSubtle: "#DED2C2",
      borderStrong: "#C5B49E",
      success: "#3F8760",
      warning: "#A7782A",
      error: "#B55A4A",
      accentPrimaryRgb: "140 92 44",
      accentSecondaryRgb: "106 124 143"
    }
  }
] as const;

const THEME_VARIANT_MAP: Record<ThemeVariantId, ThemeVariantDefinition> =
  THEME_VARIANTS.reduce(
    (accumulator, variant) => {
      accumulator[variant.id] = variant;
      return accumulator;
    },
    {} as Record<ThemeVariantId, ThemeVariantDefinition>
  );

const DEFAULT_VARIANT_BY_MODE: Record<ThemeMode, ThemeVariantId> = {
  dark: "studio-dark",
  light: "arctic-light"
};

export const DARK_THEME_VARIANTS = THEME_VARIANTS.filter(
  (variant): variant is ThemeVariantDefinition & { mode: "dark" } => variant.mode === "dark"
);

export const LIGHT_THEME_VARIANTS = THEME_VARIANTS.filter(
  (variant): variant is ThemeVariantDefinition & { mode: "light" } => variant.mode === "light"
);

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function isThemeVariantId(value: unknown): value is ThemeVariantId {
  return typeof value === "string" && value in THEME_VARIANT_MAP;
}

export function resolveThemeMode(
  preference: ThemePreference,
  prefersDarkFromSystem: boolean
): ThemeMode {
  if (preference === "system") {
    return prefersDarkFromSystem ? "dark" : "light";
  }
  return preference;
}

export function getDefaultThemeVariantForMode(mode: ThemeMode): ThemeVariantId {
  return DEFAULT_VARIANT_BY_MODE[mode];
}

export function getThemeVariantDefinition(id: ThemeVariantId): ThemeVariantDefinition {
  return THEME_VARIANT_MAP[id];
}

export function getThemeVariantMode(id: ThemeVariantId): ThemeMode {
  return THEME_VARIANT_MAP[id].mode;
}

export function getThemeVariantsForMode(mode: ThemeMode): readonly ThemeVariantDefinition[] {
  return mode === "dark" ? DARK_THEME_VARIANTS : LIGHT_THEME_VARIANTS;
}

export function resolveThemeVariantForMode(
  mode: ThemeMode,
  preferredVariantId: ThemeVariantId
): ThemeVariantDefinition {
  const preferred = THEME_VARIANT_MAP[preferredVariantId];
  if (preferred.mode === mode) {
    return preferred;
  }
  return THEME_VARIANT_MAP[getDefaultThemeVariantForMode(mode)];
}
