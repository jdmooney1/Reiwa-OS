import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ────────────────────────────────────────────────────────────────────
        // Reiwa Capital. One brand colour, one ground, three ink tones, two
        // rule weights.
        //
        // The purple is sampled from the supplied logo
        // (public/brand/reiwa-capital-logo.png): #271430 on 9,037 of 9,069
        // opaque samples. It is the only brand colour, and it is an ACCENT —
        // buttons, the active indicator, one rule — never a large dark field.
        // The previous navy/gold palette appeared nowhere in the brand and has
        // been removed entirely rather than kept as an alias, so a stale class
        // fails the build audit instead of silently rendering transparent.
        // ────────────────────────────────────────────────────────────────────
        purple: {
          DEFAULT: "#271430", // principal — 14.8:1 on ground
          70: "#5F4A68",      // hover / pressed only
          10: "#EDE8EE",      // the faintest wash; active nav row, selected cell
        },
        // Surfaces. `surface` is the page; `card` is the one step up, used
        // sparingly. Both are warm — the ground value is the cream already
        // shipping in the live OTP email, so the email and the product agree.
        surface: {
          DEFAULT: "#F3EFE7",
          card: "#FAF8F4",
          sunken: "#EAE4D9",
        },
        // Text tones. `muted` carries body copy at length and `faint` carries
        // uppercase labels only — the sizes each is used at are what keep them
        // above the contrast floor, so they are not interchangeable.
        ink: {
          DEFAULT: "#271430", // 14.8:1 on ground — the mark's own colour
          muted: "#5F585F",   //  7.0:1 on ground
          faint: "#6E666C",   //  5.3:1 on ground (label use)
        },
        // Two rule weights and nothing else. Containers do not get borders.
        line: {
          DEFAULT: "#DDD5C8",  // row separators
          strong: "#C7BCAB",   // section boundaries, table headers
        },
        // Semantic state. Reserved for genuine state — predominantly the
        // internal admin surfaces. Investor-facing pages stay neutral unless
        // the state itself is the information.
        //
        // Each clears 4.5:1 against the DARKEST surface it can sit on
        // (surface-sunken #EAE4D9), not merely against the page ground —
        // positive 5.8, caution 5.2, negative 5.8. The first caution value tried
        // here was #8A6A2F, which reads fine on the page but is 3.97 on sunken.
        positive: "#3F5D4A",
        caution: "#755925",
        negative: "#8C3F38",
      },
      fontFamily: {
        // One family across the whole system. Hierarchy is carried by size,
        // weight and space rather than by a change of voice.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      letterSpacing: {
        label: "0.12em",
        eyebrow: "0.14em",
      },
      borderRadius: {
        // 2px maximum: enough to avoid a hard corner, not enough to read as a
        // card.
        DEFAULT: "2px",
        lg: "2px",
      },
      spacing: {
        // The editorial rhythm. Section separation on investor pages starts at
        // `section` (72px); admin uses `section-tight` (48px).
        section: "4.5rem",
        "section-tight": "3rem",
      },
      maxWidth: {
        measure: "70ch",
      },
    },
  },
  plugins: [],
};

export default config;
