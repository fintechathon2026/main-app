# Reins: Logo Guidelines

## 1. The logo
- **Idea:** the R's leg is pulled taut into a rein. You hold the line; the agent does the work.
- **Construction:** one stroke weight (32 on a 256 grid), one bowl radius (48 centre-line), leg at exactly 60°, round caps throughout. Wordmark is custom monoline lowercase (stroke 16, x-height 80), drawn as outlines, no font needed.
- **Versions:** horizontal lockup (primary) · stacked · symbol · wordmark · app icon · favicon.

| File | Use |
|---|---|
| `reins-horizontal.svg` | Primary, on light backgrounds |
| `reins-horizontal-reversed.svg` | On ink or dark backgrounds (lime symbol, paper wordmark, thinned symbol) |
| `reins-horizontal-on-ink.svg` | Same, with the ink background baked in |
| `reins-stacked.svg` | Square-ish spaces (splash, social cards) |
| `reins-symbol.svg` | Symbol, 48 px and up |
| `reins-symbol-small.svg` | Symbol, 32 px and below (heavier cut, bigger counter) |
| `reins-symbol-reversed.svg` | Lime symbol for dark backgrounds (stroke thinned 32 → 30 to offset irradiation) |
| `reins-wordmark.svg` | Wordmark only, when the symbol is already on screen |
| `reins-favicon.svg` | Browser tab: lime R on ink tile, works in light and dark browser chrome |
| `exports/symbol/` | Black, white, lime, square and app-icon SVG + PNG |
| `exports/horizontal/`, `exports/stacked/` | Black and white SVG + PNG |
| `board.html`, `board.png` | Presentation board with mockups |

Web icons live in the app, not here: `app/favicon.ico`, `app/icon.svg`, `app/apple-icon.png`, and the PWA icons in `public/` referenced by `app/manifest.ts`.

Rebuild the masters with `python3 build.py` from this folder (no dependencies). Exports, icons and the board were made with the `logo-design` skill scripts.

## 2. Clear space
Keep a clear zone of **1 × stem width** around every version (the stem is 1/8 of the symbol's height). The zone scales with the logo.

## 3. Minimum size
| Version | Screen | Print |
|---|---|---|
| Horizontal | 96 px wide | 25 mm wide |
| Stacked | 64 px wide | 18 mm wide |
| Symbol | 16 px (use `reins-symbol-small.svg` or favicon at 32 px and below) | 6 mm |

## 4. Colour
| Name | HEX | RGB | CMYK (approx.) | Role |
|---|---|---|---|---|
| Ink | `#16161B` | 22 22 27 | 0 0 0 90 | Primary logo colour, dark backgrounds |
| Lime | `#EBFE06` | 235 254 6 | 10 0 100 0 | Symbol on ink only |
| Paper | `#F5F5F2` | 245 245 242 | 0 0 1 4 | Wordmark on ink |

Pantone match not verified: lime is outside most CMYK gamuts, so proof it on press before print.

**Approved pairs** (WCAG contrast):
- Ink on white / paper: 18.0:1
- Lime on ink: 16.1:1
- Paper on ink: 16.5:1
- **Never lime on white or light backgrounds: 1.12:1, invisible.**

One-colour: all black or all white versions in `horizontal/`, `stacked/`, `symbol/`.

## 5. Typography
- The logo uses no font. UI type stays as decided in `architecture.md` §0.5: Plus Jakarta Sans (UI), Geist Mono (numbers). Both are open licence (OFL).

## 6. Don'ts
Don't stretch, rotate or skew. Don't recolour outside the palette. Don't put lime on white. Don't shorten or remove the foot of the R (it's the idea). Don't rescale the symbol and wordmark separately inside a lockup. Don't add shadows, outlines, gradients or glows. Don't type "reins" in a font as a substitute for the wordmark.

## 7. Handover notes
- **Outlines:** strokes were expanded into filled outlines as overlapping same-direction sub-paths (nonzero union). It renders identically on screen and in print. Vinyl cutting or embroidery needs a true merge: run *Outline Stroke + Unite* in a vector editor (Inkscape was not available here).
- **Tests run:** SVG audit 98-100/100 on all masters; 16/32/64 px renders checked; lime-on-ink app icon, maskable icon and favicon checked visually; contrast computed.
- **Open:** trademark search on name and mark (not done); Pantone proof; the CMYK values above are approximate.
