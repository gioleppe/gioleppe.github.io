/**
 * Perceptual color system tokens (implementation_guideline.md section 5.1).
 *
 * SINGLE SOURCE OF COLOUR. Every colour the app shows is defined in this file:
 *   - THEME            the UI colours of the app's (warm light) theme: surfaces, ink, accent,
 *                      neutral marks, cautions, shadows. Edit THEME to restyle the app.
 *   - PALETTE          the data colours (win-rate diverging scale, outcome tokens) and the
 *                      guideline's dark surface tokens (kept for reference, unused by the UI).
 * main.js writes THEME into CSS custom properties on the dashboard root (themeCssVariables),
 * css/styles.css and the views only reference those variables / getThemeTokens(), and
 * tests/palette.test.js fails if a colour literal appears anywhere else.
 *
 * Pure constants and helpers: no D3, no DOM, no dependencies, so this module
 * runs unchanged in Node (tests) and in the browser (views). Views build the
 * actual D3 scales (e.g. `d3.scaleLinear().interpolate(d3.interpolateLab)`)
 * from `WIN_RATE_DOMAIN` / `winRateStops()`; this file only owns the tokens.
 */

/**
 * Semantic and quantitative palette tokens, verbatim from guideline section 5.1.
 * @type {Readonly<{
 *   bgCanvas: string, bgPanel: string, borderSubtle: string,
 *   textPrimary: string, textSecondary: string, accentFocus: string,
 *   winRateDiverging: readonly string[],
 *   serverWinner: string, serverInducedErr: string,
 *   returnerWinner: string, returnerInducedErr: string
 * }>}
 */
export const PALETTE = Object.freeze({
  // UI Surface Hierarchy (High contrast, low visual fatigue)
  bgCanvas: "#0b0f19",        // Deep slate-navy background
  bgPanel: "#111827",         // Elevated card surface
  borderSubtle: "#1e293b",    // Structural grid/panel dividers
  textPrimary: "#f8fafc",     // Crisp off-white labels
  textSecondary: "#94a3b8",   // Muted axis ticks & secondary metrics
  accentFocus: "#38bdf8",     // Preattentive selection outline (Cyan-400)

  // Diverging Win-Efficiency Scale: ColorBrewer BrBG (brown <-> warm neutral <-> teal), chosen
  // for the warm light theme. CVD-safe (the ends stay > 40 dE apart under simulated
  // deuteranopia / protanopia), lightness falls symmetrically from the neutral (L* ~91) to both
  // ends (L* ~40), and both hues stay far from the plum selection accent.
  // Domain: [0.30 (Returner Dominates), 0.50 (Parity), 0.70 (Server Dominates)]
  winRateDiverging: Object.freeze(["#8c510a", "#d8b365", "#ebe5da", "#5ab4ac", "#01665e"]),

  // Categorical Outcome Tokens (tooltip semantics; same families as the diverging scale)
  serverWinner: "#01665e",    // Deep teal
  serverInducedErr: "#5ab4ac",// Soft teal
  returnerWinner: "#8c510a",  // Deep brown
  returnerInducedErr: "#d8b365" // Soft ochre
});

/**
 * The app's theme (warm light). EDIT HERE to restyle the whole app.
 *
 * Roles (one meaning per colour, guideline 5.1 "Colour roles"):
 *   bgCanvas / bgPanel / bgControl / borderSubtle  paper surfaces and dividers
 *   textPrimary / textSecondary                    warm ink (15:1) and secondary ink (6:1 on bgPanel)
 *   accentFocus / accentSoft                       selection and interaction ONLY (plum: far from
 *                                                  both data hues, dE ~70)
 *   mark      neutral data marks (count bars, meters, 95% band): >= 3:1 on bgPanel (WCAG 1.4.11)
 *   context   de-emphasized context (resting flow bands)
 *   nodeDim   flow-chart nodes without active flow (greyed out, never a faded data colour)
 *   lowSample  fill of a box or flow with too few points to colour (greyed out, with stripes in the court)
 *   caution*  neutral cautions ("fewer than 10 points"): never orange or brown, which would read as
 *             "returner ahead" on the brown-teal scale
 *   danger*   error boxes
 *   shadow / backdrop   elevation and the modal backdrop
 * tests/palette.test.js checks contrast, CVD separation and accent distance for these values.
 */
export const THEME = Object.freeze({
  bgCanvas: "#f6f1e8",
  bgPanel: "#fffcf7",
  bgPanelGlass: "rgba(255, 252, 247, 0.95)",
  bgControl: "#f4eee4",
  borderSubtle: "#e3d9ca",
  textPrimary: "#2a241e",
  textSecondary: "#6a5f54",
  accentFocus: "#7b2d6b",
  accentSoft: "rgba(123, 45, 107, 0.12)",
  mark: "#968a7b",
  context: "#c9bdac",
  nodeDim: "#d9cfc1",
  lowSample: "#bdb2a2",
  caution: "#2a241e",
  cautionSoft: "#f4eee4",
  cautionBorder: "#968a7b",
  danger: "#a33a12",
  dangerSoft: "rgba(163, 58, 18, 0.1)",
  dangerBorder: "rgba(163, 58, 18, 0.4)",
  shadow: "0 10px 30px rgba(60, 40, 20, 0.14)",
  backdrop: "rgba(42, 36, 30, 0.45)",
});

/** Surface subset of THEME exposed through getThemeTokens("light"). */
const THEME_SURFACE = Object.freeze({ ...THEME });

/**
 * Surface tokens per theme. Dark values are the section 5.1 tokens; light is
 * the counterpart. Data colors (diverging scale, outcome tokens) are identical
 * in both themes.
 * @type {Readonly<Record<"dark"|"light", Readonly<Record<string, string>>>>}
 */
const SURFACE_TOKENS = Object.freeze({
  dark: Object.freeze({
    bgCanvas: PALETTE.bgCanvas,
    bgPanel: PALETTE.bgPanel,
    borderSubtle: PALETTE.borderSubtle,
    textPrimary: PALETTE.textPrimary,
    textSecondary: PALETTE.textSecondary,
    accentFocus: PALETTE.accentFocus
  }),
  // The app's theme: see THEME below.
  light: THEME_SURFACE,
});

/**
 * Domain of the diverging win-efficiency scale:
 * [0.30 (Returner Dominates), 0.50 (Parity), 0.70 (Server Dominates)].
 * @type {readonly number[]}
 */
// Symmetric around 50% so equal distances from even get equally strong colours (a 35/75 domain
// made 65% look as strong as 42%).
export const WIN_RATE_DOMAIN = Object.freeze([0.30, 0.50, 0.70]);

/**
 * Categorical outcome tokens for the View 3 diverging stacked bars, keyed by
 * the outcome field names used in `viewModels.rally.buckets`.
 * @type {Readonly<{serverWinner: string, serverInducedErr: string, returnerWinner: string, returnerInducedErr: string}>}
 */
export const OUTCOME_COLORS = Object.freeze({
  serverWinner: PALETTE.serverWinner,
  serverInducedErr: PALETTE.serverInducedErr,
  returnerWinner: PALETTE.returnerWinner,
  returnerInducedErr: PALETTE.returnerInducedErr
});

/**
 * Returns the full token set for a theme: the theme's surface tokens merged
 * with the theme-independent data tokens.
 * @param {"dark"|"light"} [theme="dark"] Unknown values fall back to "dark".
 * @returns {{
 *   bgCanvas: string, bgPanel: string, borderSubtle: string,
 *   textPrimary: string, textSecondary: string, accentFocus: string,
 *   winRateDiverging: readonly string[],
 *   serverWinner: string, serverInducedErr: string,
 *   returnerWinner: string, returnerInducedErr: string
 * }} A fresh plain object (safe for the caller to mutate).
 */
export function getThemeTokens(theme = "dark") {
  const surface = SURFACE_TOKENS[theme] || SURFACE_TOKENS.dark;
  return {
    ...surface,
    winRateDiverging: PALETTE.winRateDiverging,
    serverWinner: PALETTE.serverWinner,
    serverInducedErr: PALETTE.serverInducedErr,
    returnerWinner: PALETTE.returnerWinner,
    returnerInducedErr: PALETTE.returnerInducedErr
  };
}

/**
 * Five evenly spaced stops over `WIN_RATE_DOMAIN`, pairing each
 * `PALETTE.winRateDiverging` color with its win-rate value:
 * 0.30, 0.40, 0.50, 0.60, 0.70 (midpoints between the domain pivots).
 * Intended as the domain/range of a piecewise Lab-interpolated scale built by
 * the views.
 * @returns {Array<{value: number, color: string}>} Fresh array of 5 stops, ascending by value.
 */
export function winRateStops() {
  const [lo, mid, hi] = WIN_RATE_DOMAIN;
  const values = [lo, (lo + mid) / 2, mid, (mid + hi) / 2, hi];
  return values.map((value, i) => ({ value, color: PALETTE.winRateDiverging[i] }));
}

/**
 * CSS custom properties for the dashboard root, derived from a token set (THEME by default).
 * main.js applies them with style.setProperty; css/styles.css only uses var(--tva-*).
 * Includes the select chevron as an SVG data URI coloured with textSecondary.
 * @param {Readonly<Record<string, string>>} [t=THEME]
 * @returns {Record<string, string>} property name -> value
 */
export function themeCssVariables(t = THEME) {
  const chevron = `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='${t.textSecondary}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
  return {
    "--tva-bg-canvas": t.bgCanvas,
    "--tva-bg-panel": t.bgPanel,
    "--tva-bg-panel-glass": t.bgPanelGlass,
    "--tva-bg-control": t.bgControl,
    "--tva-border": t.borderSubtle,
    "--tva-text": t.textPrimary,
    "--tva-text-2": t.textSecondary,
    "--tva-accent": t.accentFocus,
    "--tva-accent-soft": t.accentSoft,
    "--tva-mark": t.mark,
    "--tva-context": t.context,
    "--tva-warning": t.caution,
    "--tva-warning-soft": t.cautionSoft,
    "--tva-warning-border": t.cautionBorder,
    "--tva-danger": t.danger,
    "--tva-danger-soft": t.dangerSoft,
    "--tva-danger-border": t.dangerBorder,
    "--tva-shadow": t.shadow,
    "--tva-backdrop": t.backdrop,
    "--tva-chevron": `url("data:image/svg+xml,${encodeURIComponent(chevron)}")`,
  };
}

/**
 * Apply the theme's CSS custom properties to an element (the dashboard root, or the error host).
 * @param {{ style: { setProperty(name: string, value: string): void } }} el
 * @param {Readonly<Record<string, string>>} [t=THEME]
 */
export function applyTheme(el, t = THEME) {
  for (const [name, value] of Object.entries(themeCssVariables(t))) el.style.setProperty(name, value);
}
