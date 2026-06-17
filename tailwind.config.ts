import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Institutional palette — dark navy base, warm white, muted gold.
        navy: {
          DEFAULT: "#0B1B2B",
          50: "#1B3047",
          100: "#16293D",
          900: "#081420",
        },
        surface: {
          DEFAULT: "#F6F2EA", // warm white
          card: "#FBF8F2",
          sunken: "#EFEAE0",
        },
        ink: {
          DEFAULT: "#12222F",
          muted: "#5A6B78",
          faint: "#8A97A1",
        },
        gold: {
          DEFAULT: "#C2A14E", // muted gold accent
          soft: "#D8C285",
          deep: "#9C7F36",
        },
        line: "#E2DBCD",
        "line-dark": "#1C3147",
        // status accents (used sparingly)
        positive: "#3E7C5A",
        caution: "#B98427",
        negative: "#A6483D",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      letterSpacing: {
        label: "0.08em",
      },
      borderRadius: {
        DEFAULT: "4px",
        lg: "6px",
      },
    },
  },
  plugins: [],
};

export default config;
