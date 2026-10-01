import type { Config } from "tailwindcss";

// Tokens lifted from the AgentPhone console's own stylesheet (its `.app-dashboard`
// scope): a #151515 page, a #1a1a1a content frame, translucent #262626 cards,
// #26b65a green, Alte Haas Grotesk headings over Inter. The legacy names below
// them (ink, panel, fern, cta, slate-*, …) keep the Inspector and iMessage
// internals rendering; new dashboard code uses the console tokens.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── AgentPhone console ──
        background: "#151515",
        frame: "#1a1a1a",
        card: {
          DEFAULT: "rgba(38, 38, 38, 0.8)",
          hover: "#0f0f0f",
          content: "rgba(255, 255, 255, 0.04)"
        },
        surface: {
          DEFAULT: "#1c1c1c",
          border: "#2a2a2a"
        },
        input: "rgba(255, 255, 255, 0.08)",
        primary: {
          DEFAULT: "#26b65a",
          foreground: "#ffffff",
          "foreground-strong": "#082412"
        },
        foreground: "#ffffff",
        text: {
          DEFAULT: "#e8e8e8",
          secondary: "#888888",
          dim: "#555555",
          subtle: "#a1a1aa"
        },
        // ── Legacy (Inspector + iMessage internals) ──
        ink: "#151515",
        panel: "#202020",
        raised: "#262626",
        bright: "#f0efe9",
        mist: "#242424",
        line: "#2a2a2a",
        fern: "#26b65a",
        cta: "#26b65a",
        skyglass: "rgba(38, 182, 90, 0.1)",
        caution: "#d9a13c",
        danger: "#e05252",
        imessage: "#1f8fff",
        smsgreen: "#34c759",
        whatsapp: "#25d366",
        bubble: "#2c2c2e",
        badgeblue: "#60a5fa",
        badgepurple: "#c084fc",
        slate: {
          300: "#4a4945",
          400: "#8a8981",
          500: "#888888",
          600: "#a1a1aa",
          700: "#cfcec5"
        },
        emerald: {
          50: "#16301d",
          300: "#7ed492",
          400: "#34d399"
        },
        red: {
          50: "#331a1a",
          400: "#f87171",
          500: "#ef4444"
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
          300: "#e8c06a",
          400: "#fbbf24"
        }
      },
      fontFamily: {
        heading: ['"Alte Haas Grotesk"', "Inter", "-apple-system", "system-ui", "sans-serif"],
        sans: ["Inter", "-apple-system", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"SF Mono"', "Menlo", "monospace"]
      },
      boxShadow: {
        soft: "0 14px 34px rgba(0, 0, 0, 0.45)",
        card: "0 0 0 1px rgba(255, 255, 255, 0.03)",
        modal: "0 24px 60px rgba(0, 0, 0, 0.5)"
      },
      keyframes: {
        typing: {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.35" },
          "30%": { transform: "translateY(-3px)", opacity: "1" }
        },
        pop: {
          "0%": { transform: "scale(0.92)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" }
        },
        "enter-stagger": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "none" }
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
