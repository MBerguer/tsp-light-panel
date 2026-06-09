import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // FIA-inspired flag palette. Hex values picked to match the CIE 1931
        // coordinates listed in FIA 3504-2019 §4.2 reasonably closely on a
        // standard sRGB display.
        flag: {
          off: "#1f2937",
          green: "#0bd964",
          yellow: "#ffcc00",
          blue: "#0078ff",
          white: "#f8fafc",
          red: "#e8201f",
          chequered: "#111827",
          sc: "#ff7a00",
          vsc: "#ff7a00",
          driver: "#7d1f1f",
        },
        panel: {
          frame: "#0f172a",
          glow: "#0ea5e9",
        },
      },
      keyframes: {
        flash: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        pulseGlow: {
          "0%,100%": { filter: "drop-shadow(0 0 4px currentColor)" },
          "50%": { filter: "drop-shadow(0 0 12px currentColor)" },
        },
      },
      animation: {
        "flag-flash": "flash 0.8s ease-in-out infinite",
        "flag-pulse": "pulseGlow 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
