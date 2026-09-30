import type { Config } from "tailwindcss";

// AgentPhone-native dark skin: near-black canvas, dark rounded cards with
// hairline borders, green brand accents (light-green text, forest-green
// buttons), purple for fork/lineage to match their webhook accent. The
// palette-scale overrides (slate/emerald/red/indigo/amber) re-tint every
// existing wash and text utility for dark surfaces without touching JSX.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0d0d0c", // page + toolbar canvas
        frame: "#161615", // dashboard content frame (their inset surface)
        panel: "#1c1c1a", // card surface
        raised: "#232321", // nested card / tile icon wells
        // Messaging bubbles, matched to Apple's and WhatsApp's dark palettes.
        imessage: "#1f8fff",
        smsgreen: "#34c759",
        whatsapp: "#25d366",
        bubble: "#2c2c2e",
        // Their dashboard badge tints (webhook routing explainer).
        badgeblue: "#7aa2ff",
        badgepurple: "#c084fc",
        bright: "#f0efe9", // primary text
        mist: "#242422", // washes / hover fills
        line: "#2d2d2a", // hairline borders
        fern: "#5abc6e", // brand green text/marks (7.3:1 on panel)
        cta: "#3d7c46", // forest-green primary buttons (white text)
        skyglass: "#152a1a", // tinted green card (their Credits style)
        caution: "#d9a13c",
        danger: "#e05252",
        slate: {
          300: "#4a4945",
          400: "#8a8981",
          500: "#9c9b93",
          600: "#b6b5ac",
          700: "#cfcec5"
        },
        emerald: {
          50: "#16301d",
          300: "#7ed492"
        },
        red: {
          50: "#331a1a"
        },
        indigo: {
          50: "#221f33",
          200: "#453e66",
          400: "#a78bfa",
          600: "#b3a1f7",
          700: "#c4b6f9"
        },
        amber: {
          50: "#2b2310",
          200: "#5a4a1a",
          300: "#e8c06a"
        }
      },
      boxShadow: {
        soft: "0 14px 34px rgba(0, 0, 0, 0.45)"
      },
      keyframes: {
        typing: {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.35" },
          "30%": { transform: "translateY(-3px)", opacity: "1" }
        },
        pop: {
          "0%": { transform: "scale(0.92)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" }
        }
      },
      animation: {
        typing: "typing 1.2s infinite ease-in-out",
        pop: "pop 160ms ease-out"
      }
    }
  },
  plugins: []
};

export default config;
