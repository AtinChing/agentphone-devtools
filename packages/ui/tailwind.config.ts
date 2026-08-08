import type { Config } from "tailwindcss";

// Warm-neutral identity: paper surfaces and warm grays instead of Tailwind's
// blue-tinted slate, one deep terminal-green accent (text-safe at 5.4:1), and
// reserved status reds. The slate override re-inks every text-slate-* usage in
// one place.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0b0b",
        mist: "#f4f3ef",
        line: "#e1e0d9",
        fern: "#077a10",
        skyglass: "#eaf6e8",
        caution: "#9a5b04",
        danger: "#d03b3b",
        slate: {
          300: "#d5d4cc",
          400: "#a8a69e",
          500: "#898781",
          600: "#52514e",
          700: "#3f3e3a"
        },
        emerald: {
          50: "#edf7ea"
        }
      },
      boxShadow: {
        soft: "0 10px 24px rgba(31, 28, 18, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
