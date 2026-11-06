import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["src/components/kokonutui/**", "src/components/ui/dither-field.tsx"],
    rules: {
      // Keep the official canvas/DOM animation engines intact; their imperative refs are central to the upstream effects.
      "react-hooks/refs": "off",
      // The official reduced-motion and visibility fallbacks synchronously set state when external state changes.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".cache/**", ".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
