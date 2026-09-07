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
        // Text tones. Each of these carries small text (the .eyebrow label is
        // 11px), so each must clear WCAG AA's 4.5:1 against the LIGHTEST
        // surface it sits on. The hues are unchanged — only lightness — so the
        // palette reads the same; the previous values were 2.5-3.6:1, which is
        // below the threshold and genuinely hard to read on a laptop in
        // daylight.
        ink: {
          DEFAULT: "#12222F",  // 13.5:1
          muted: "#5A6B78",    //  4.6:1
          faint: "#5E6B75",    //  4.6:1 (was #8A97A1, 2.5:1)
        },
        gold: {
          DEFAULT: "#C2A14E", // muted gold accent; decorative, not body text
          soft: "#D8C285",    // on navy only — 9.9:1 there
          deep: "#6E5A26",    //  4.5:1 on its own 10% tint (badge background)
        },
        line: "#E2DBCD",
        "line-dark": "#1C3147",
        // status accents (used sparingly)
        // Each is also used as text ON its own 10% tint (the Badge component),
        // which lightens the effective background — so these clear 4.5:1
        // against that tint, not merely against the plain surface.
        positive: "#34674B", // was #3E7C5A (3.4:1 on tint)
        caution: "#795619",  // was #B98427 (2.3:1 on tint)
        negative: "#984238", // was #A6483D (4.0:1 on tint)
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
