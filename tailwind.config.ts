import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#e8590c", dark: "#c2410c", light: "#fb923c" },
      },
    },
  },
  plugins: [],
};
export default config;
