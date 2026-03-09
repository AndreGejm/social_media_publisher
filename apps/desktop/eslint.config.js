import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "src-tauri", "*.config.*"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "playwright/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }]
    }
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/services/tauri/**/*",
      "src/infrastructure/tauri/**/*",
      "src/**/*.test.ts",
      "src/**/*.test.tsx"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tauri-apps/api/*"],
              message:
                "Use typed adapters in services/tauri or infrastructure/tauri. Raw @tauri-apps/api imports are not allowed in feature/shared code."
            },
            {
              group: ["**/services/tauri/tauri-api", "**/services/tauri/tauri-api.ts"],
              message:
                "Import Tauri APIs through module entrypoints (services/tauri/tauriClient or domain bridge APIs), not tauri-api internals."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/features/player-transport/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/features/audio-output/hooks/*",
                "**/features/audio-output/model/*",
                "**/features/audio-output/services/*",
                "**/features/audio-output/components/*"
              ],
              message:
                "player-transport must not depend on audio-output internals. Use player-transport API contracts only."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/features/audio-output/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/features/player-transport/hooks/*",
                "**/features/player-transport/model/*",
                "**/features/player-transport/services/*",
                "**/features/player-transport/components/*"
              ],
              message:
                "audio-output may only use player-transport public contracts from features/player-transport/api."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["src/app/shell/**/*.{ts,tsx}"],
    ignores: ["src/app/shell/**/*.test.ts", "src/app/shell/**/*.test.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/features/*/hooks/*",
                "**/features/*/model/*",
                "**/features/*/services/*",
                "**/features/*/components/*"
              ],
              message:
                "app/shell must compose via feature public entrypoints only."
            }
          ]
        }
      ]
    }
  }
);
