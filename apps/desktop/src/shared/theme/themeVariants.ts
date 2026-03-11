export type ThemePreference = "system" | "light" | "dark";
export type ThemeMode = "light" | "dark";

export type ThemeVariantId =
  | "nordic-dark"
  | "midnight-studio"
  | "deep-ocean"
  | "space"
  | "emerald"
  | "ruby"
  | "amber"
  | "high-contrast-dark"
  | "arctic-light"
  | "soft-paper";

export type ThemeSemanticTokenName =
  | "--bg-primary"
  | "--bg-panel"
  | "--bg-surface"
  | "--text-primary"
  | "--text-muted"
  | "--border"
  | "--border-strong"
  | "--accent"
  | "--accent-hover"
  | "--accent-active"
  | "--selection"
  | "--button-bg"
  | "--button-hover"
  | "--player-bg"
  | "--accent-rgb"
  | "--accent-secondary"
  | "--accent-secondary-rgb"
  | "--bg-panel-rgb"
  | "--bg-surface-rgb"
  | "--selection-rgb"
  | "--success"
  | "--success-rgb"
  | "--warning"
  | "--error"
  | "--warning-rgb"
  | "--error-rgb"
  | "--warning-text"
  | "--error-text"
  | "--button-text"
  | "--shadow-rgb";

export type ThemeSemanticTokens = Record<ThemeSemanticTokenName, string>;

export type ThemeVariantDefinition = {
  id: ThemeVariantId;
  label: string;
  mode: ThemeMode;
  description: string;
  tokens: ThemeSemanticTokens;
};

const darkAlertTokens = {
  "--warning": "#E2B65A",
  "--warning-rgb": "226 182 90",
  "--error": "#F07D7D",
  "--error-rgb": "240 125 125",
  "--warning-text": "#FFE3B3",
  "--error-text": "#FFD9D0",
  "--button-text": "#FFFFFF",
  "--shadow-rgb": "0 0 0"
} as const;

const lightAlertTokens = {
  "--warning": "#AD7E1E",
  "--warning-rgb": "173 126 30",
  "--error": "#C05A4A",
  "--error-rgb": "192 90 74",
  "--warning-text": "#7A5611",
  "--error-text": "#8A3C26",
  "--button-text": "#FFFFFF",
  "--shadow-rgb": "0 0 0"
} as const;

function darkThemeTokens(overrides: Partial<ThemeSemanticTokens>): ThemeSemanticTokens {
  return {
    "--bg-primary": "#111723",
    "--bg-panel": "#1A2432",
    "--bg-surface": "#212F40",
    "--text-primary": "#E5ECF4",
    "--text-muted": "#A5B3C5",
    "--border": "#2D3C4F",
    "--border-strong": "#44566B",
    "--accent": "#88C0D0",
    "--accent-hover": "#97CDDC",
    "--accent-active": "#73A9B9",
    "--selection": "#2E4A62",
    "--button-bg": "#4E758E",
    "--button-hover": "#5E88A3",
    "--player-bg": "rgba(26, 36, 50, 0.95)",
    "--accent-rgb": "136 192 208",
    "--accent-secondary": "#81A1C1",
    "--accent-secondary-rgb": "129 161 193",
    "--bg-panel-rgb": "26 36 50",
    "--bg-surface-rgb": "33 47 64",
    "--selection-rgb": "46 74 98",
    "--success": "#5EBC86",
    "--success-rgb": "94 188 134",
    ...darkAlertTokens,
    ...overrides
  };
}

function lightThemeTokens(overrides: Partial<ThemeSemanticTokens>): ThemeSemanticTokens {
  return {
    "--bg-primary": "#F2F6FB",
    "--bg-panel": "#FFFFFF",
    "--bg-surface": "#F8FBFF",
    "--text-primary": "#162230",
    "--text-muted": "#5F7084",
    "--border": "#D5DEE8",
    "--border-strong": "#B9C8D8",
    "--accent": "#2E6FB7",
    "--accent-hover": "#3F80C8",
    "--accent-active": "#255C98",
    "--selection": "#DCEBFB",
    "--button-bg": "#2E6FB7",
    "--button-hover": "#3E7FC7",
    "--player-bg": "rgba(255, 255, 255, 0.95)",
    "--accent-rgb": "46 111 183",
    "--accent-secondary": "#4D8AAE",
    "--accent-secondary-rgb": "77 138 174",
    "--bg-panel-rgb": "255 255 255",
    "--bg-surface-rgb": "248 251 255",
    "--selection-rgb": "220 235 251",
    "--success": "#2E9D6A",
    "--success-rgb": "46 157 106",
    ...lightAlertTokens,
    ...overrides
  };
}

export const THEME_VARIANTS: readonly ThemeVariantDefinition[] = [
  {
    id: "nordic-dark",
    label: "Nordic Dark",
    mode: "dark",
    description: "Clean neutral dark interface with soft blue accents.",
    tokens: darkThemeTokens({})
  },
  {
    id: "midnight-studio",
    label: "Midnight Studio",
    mode: "dark",
    description: "Deep studio dark palette with restrained electric highlights.",
    tokens: darkThemeTokens({
      "--bg-primary": "#0B111A",
      "--bg-panel": "#151F2C",
      "--bg-surface": "#1C2939",
      "--text-primary": "#E6EEF8",
      "--text-muted": "#9FB1C6",
      "--border": "#27374A",
      "--border-strong": "#3A4F67",
      "--accent": "#6EA8FF",
      "--accent-hover": "#84B6FF",
      "--accent-active": "#5B96F2",
      "--selection": "#25466A",
      "--button-bg": "#0F585A",
      "--button-hover": "#146669",
      "--player-bg": "rgba(21, 31, 44, 0.95)",
      "--accent-rgb": "110 168 255",
      "--accent-secondary": "#7ED7E6",
      "--accent-secondary-rgb": "126 215 230",
      "--bg-panel-rgb": "21 31 44",
      "--bg-surface-rgb": "28 41 57",
      "--selection-rgb": "37 70 106",
      "--success": "#43B67D",
      "--success-rgb": "67 182 125",
      "--warning": "#CFA45A",
      "--warning-rgb": "207 164 90",
      "--error": "#E07272",
      "--error-rgb": "224 114 114"
    })
  },
  {
    id: "deep-ocean",
    label: "Deep Ocean",
    mode: "dark",
    description: "Dark teal atmosphere with bright cyan energy accents.",
    tokens: darkThemeTokens({
      "--bg-primary": "#07161B",
      "--bg-panel": "#0D2028",
      "--bg-surface": "#12303A",
      "--text-primary": "#E3F4F6",
      "--text-muted": "#8FB0B7",
      "--border": "#1C4652",
      "--border-strong": "#2A6170",
      "--accent": "#2FD3E6",
      "--accent-hover": "#49DDED",
      "--accent-active": "#1CB5C7",
      "--selection": "#104955",
      "--button-bg": "#0B7886",
      "--button-hover": "#1292A2",
      "--player-bg": "rgba(13, 32, 40, 0.95)",
      "--accent-rgb": "47 211 230",
      "--accent-secondary": "#1FA7C0",
      "--accent-secondary-rgb": "31 167 192",
      "--bg-panel-rgb": "13 32 40",
      "--bg-surface-rgb": "18 48 58",
      "--selection-rgb": "16 73 85"
    })
  },
  {
    id: "space",
    label: "Space",
    mode: "dark",
    description: "Near-black backdrop with vivid violet highlights.",
    tokens: darkThemeTokens({
      "--bg-primary": "#07080F",
      "--bg-panel": "#101325",
      "--bg-surface": "#171A31",
      "--text-primary": "#ECEAFF",
      "--text-muted": "#A6A0CE",
      "--border": "#2A2E4A",
      "--border-strong": "#3A4170",
      "--accent": "#A56CFF",
      "--accent-hover": "#B98AFF",
      "--accent-active": "#8F57E6",
      "--selection": "#32255A",
      "--button-bg": "#5E3AAE",
      "--button-hover": "#734CC6",
      "--player-bg": "rgba(16, 19, 37, 0.95)",
      "--accent-rgb": "165 108 255",
      "--accent-secondary": "#6B90FF",
      "--accent-secondary-rgb": "107 144 255",
      "--bg-panel-rgb": "16 19 37",
      "--bg-surface-rgb": "23 26 49",
      "--selection-rgb": "50 37 90"
    })
  },
  {
    id: "emerald",
    label: "Emerald",
    mode: "dark",
    description: "Charcoal dark with rich emerald accents and mint selection cues.",
    tokens: darkThemeTokens({
      "--bg-primary": "#0F1313",
      "--bg-panel": "#171F1E",
      "--bg-surface": "#1E2928",
      "--text-primary": "#E8F3EF",
      "--text-muted": "#A2BBB3",
      "--border": "#2B403B",
      "--border-strong": "#3A5A52",
      "--accent": "#1FCF84",
      "--accent-hover": "#3BDB97",
      "--accent-active": "#19B274",
      "--selection": "#23493A",
      "--button-bg": "#0F7A50",
      "--button-hover": "#139566",
      "--player-bg": "rgba(23, 31, 30, 0.95)",
      "--accent-rgb": "31 207 132",
      "--accent-secondary": "#7CE7C0",
      "--accent-secondary-rgb": "124 231 192",
      "--bg-panel-rgb": "23 31 30",
      "--bg-surface-rgb": "30 41 40",
      "--selection-rgb": "35 73 58"
    })
  },
  {
    id: "ruby",
    label: "Ruby",
    mode: "dark",
    description: "Dark slate with ruby-red accents and rose selection highlights.",
    tokens: darkThemeTokens({
      "--bg-primary": "#151012",
      "--bg-panel": "#21171B",
      "--bg-surface": "#2A1D23",
      "--text-primary": "#F4E9EC",
      "--text-muted": "#BFA6AF",
      "--border": "#4A2E39",
      "--border-strong": "#63414F",
      "--accent": "#D84A67",
      "--accent-hover": "#E0647E",
      "--accent-active": "#BE3E59",
      "--selection": "#5C2534",
      "--button-bg": "#8B2A40",
      "--button-hover": "#A8344E",
      "--player-bg": "rgba(33, 23, 27, 0.95)",
      "--accent-rgb": "216 74 103",
      "--accent-secondary": "#E58A9F",
      "--accent-secondary-rgb": "229 138 159",
      "--bg-panel-rgb": "33 23 27",
      "--bg-surface-rgb": "42 29 35",
      "--selection-rgb": "92 37 52"
    })
  },
  {
    id: "amber",
    label: "Amber",
    mode: "dark",
    description: "Dark brown-black foundation with warm amber highlights.",
    tokens: darkThemeTokens({
      "--bg-primary": "#16120C",
      "--bg-panel": "#211A10",
      "--bg-surface": "#2C2214",
      "--text-primary": "#F7EDDA",
      "--text-muted": "#C8B79A",
      "--border": "#4A3923",
      "--border-strong": "#6A512E",
      "--accent": "#E3A323",
      "--accent-hover": "#EDB646",
      "--accent-active": "#C88C18",
      "--selection": "#5A431B",
      "--button-bg": "#8A5B0C",
      "--button-hover": "#A86F10",
      "--player-bg": "rgba(33, 26, 16, 0.95)",
      "--accent-rgb": "227 163 35",
      "--accent-secondary": "#E7C066",
      "--accent-secondary-rgb": "231 192 102",
      "--bg-panel-rgb": "33 26 16",
      "--bg-surface-rgb": "44 34 20",
      "--selection-rgb": "90 67 27"
    })
  },
  {
    id: "high-contrast-dark",
    label: "High Contrast Dark",
    mode: "dark",
    description: "Accessibility-first dark palette with maximum readability and edge contrast.",
    tokens: darkThemeTokens({
      "--bg-primary": "#090C10",
      "--bg-panel": "#111821",
      "--bg-surface": "#17212D",
      "--text-primary": "#F4F8FC",
      "--text-muted": "#CAD5E1",
      "--border": "#3A4D62",
      "--border-strong": "#5A748F",
      "--accent": "#4DA3FF",
      "--accent-hover": "#66B1FF",
      "--accent-active": "#3A8EE8",
      "--selection": "#2B4B70",
      "--button-bg": "#0F585A",
      "--button-hover": "#146669",
      "--player-bg": "rgba(17, 24, 33, 0.95)",
      "--accent-rgb": "77 163 255",
      "--accent-secondary": "#58D1C0",
      "--accent-secondary-rgb": "88 209 192",
      "--bg-panel-rgb": "17 24 33",
      "--bg-surface-rgb": "23 33 45",
      "--selection-rgb": "43 75 112",
      "--success": "#4AC389",
      "--success-rgb": "74 195 137",
      "--warning": "#E2B65A",
      "--warning-rgb": "226 182 90",
      "--error": "#F07D7D",
      "--error-rgb": "240 125 125",
      "--warning-text": "#FFE3B3",
      "--error-text": "#FFD9D0"
    })
  },
  {
    id: "arctic-light",
    label: "Arctic Light",
    mode: "light",
    description: "Neutral cool light palette with crisp structural contrast.",
    tokens: lightThemeTokens({})
  },
  {
    id: "soft-paper",
    label: "Soft Paper",
    mode: "light",
    description: "Warm off-white paper tone with low-glare contrast for long reads.",
    tokens: lightThemeTokens({
      "--bg-primary": "#F6F1E8",
      "--bg-panel": "#FFF9F1",
      "--bg-surface": "#FFFDF8",
      "--text-primary": "#2A231A",
      "--text-muted": "#776B5D",
      "--border": "#DED2C2",
      "--border-strong": "#C5B49E",
      "--accent": "#8C5C2C",
      "--accent-hover": "#9B6B3B",
      "--accent-active": "#754A20",
      "--selection": "#EFE2D2",
      "--button-bg": "#8C5C2C",
      "--button-hover": "#A06A35",
      "--player-bg": "rgba(255, 249, 241, 0.95)",
      "--accent-rgb": "140 92 44",
      "--accent-secondary": "#6A7C8F",
      "--accent-secondary-rgb": "106 124 143",
      "--bg-panel-rgb": "255 249 241",
      "--bg-surface-rgb": "255 253 248",
      "--selection-rgb": "239 226 210",
      "--success": "#3F8760",
      "--success-rgb": "63 135 96",
      "--warning": "#A7782A",
      "--warning-rgb": "167 120 42",
      "--error": "#B55A4A",
      "--error-rgb": "181 90 74",
      "--warning-text": "#7A5411",
      "--error-text": "#8A3C26"
    })
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
  dark: "nordic-dark",
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

