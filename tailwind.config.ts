import type { Config } from "tailwindcss";

// ============================================================================
// Reiwa Capital brand tokens.
// ----------------------------------------------------------------------------
// Two brand colours carry the interface: deep plum and warm cream. Plum is the
// emphasis colour — there is no accent hue. The only other colours in the system
// are the four desaturated functional signals below, and they are reserved for
// verdicts (Pursue / Watch / Pass), red flags and status. Nothing decorative is
// ever coloured.
// ============================================================================

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ---- Brand ---------------------------------------------------------
        plum: {
          DEFAULT: "#271430", // deep plum — dark surfaces, emphasis, primary action
          50: "#3D2449",      // hover on plum surfaces
          100: "#32203D",
          900: "#1A0D21",     // deepest, for headers over plum
        },
        surface: {
          DEFAULT: "#FCFAF1", // warm cream — the page
          card: "#FFFDF8",    // a shade lighter than the page
          sunken: "#F4F0E5",  // a shade darker, for wells and table headers
        },

        // ---- Text ----------------------------------------------------------
        // Body text is plum, not black. The two brand greys carry secondary and
        // decorative text. `faint` is deliberately low-contrast: use it for
        // placeholders, disabled states and decoration, never for information
        // the reader needs. Labels and secondary copy use `muted`.
        ink: {
          DEFAULT: "#271430",
          muted: "#918790",
          faint: "#BCB5B7",
        },

        // ---- Rules -----------------------------------------------------------
        line: "#E4DFD6",         // hairline on cream
        "line-strong": "#BCB5B7", // brand grey, for dividers that must read
        "line-dark": "#3D2449",  // hairline on plum

        // ---- Functional signals (desaturated, restricted use) --------------
        // Verdicts and red flags only. `positive` / `caution` / `negative` are
        // aliases of the same three values so the interface never carries a
        // second signal palette.
        verdict: {
          pursue: "#4F6B57",
          watch: "#8A7A45",
          pass: "#7C7176",
        },
        flag: "#8C4A42",
        positive: "#4F6B57",
        caution: "#8A7A45",
        negative: "#8C4A42",
      },
      fontFamily: {
        // DM Sans throughout. Display weight and tracking, not a second family,
        // create the editorial hierarchy.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      letterSpacing: {
        label: "0.08em",
        display: "-0.015em",
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
