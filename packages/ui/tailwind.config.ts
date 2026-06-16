import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        mist: "#f5f7fb",
        line: "#d9e0ea",
        fern: "#1f7a5c",
        skyglass: "#e8f2ff",
        caution: "#b45309",
        danger: "#b42318"
      },
      boxShadow: {
        soft: "0 12px 30px rgba(15, 23, 42, 0.07)"
      }
    }
  },
  plugins: []
};

export default config;
