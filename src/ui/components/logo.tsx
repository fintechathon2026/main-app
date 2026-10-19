// Reins logo (docs/brand on feat/brand-logo): the Taut R symbol and the monoline wordmark,
// copied from the masters as filled outlines so they need no font.

const SYMBOL =
  "M40,40 L40,216 A16 16 0 0 0 72,216 L72,40 A16 16 0 0 0 40,40 Z M56,56 L120,56 A16 16 0 0 0 120,24 L56,24 A16 16 0 0 0 56,56 Z M56,152 L120,152 A16 16 0 0 0 120,120 L56,120 A16 16 0 0 0 56,152 Z M120,152 A64 64 0 0 0 120,24 L120,56 A32 32 0 0 1 120,120 Z M136,40 A16 16 0 1 0 104,40 A16 16 0 1 0 136,40 Z M136,136 A16 16 0 1 0 104,136 A16 16 0 1 0 136,136 Z M90.14,144 L127.09,208 A16 16 0 0 0 154.81,192 L117.86,128 A16 16 0 0 0 90.14,144 Z M140.95,216 L200,216 A16 16 0 0 0 200,184 L140.95,184 A16 16 0 0 0 140.95,216 Z";

const WORDMARK =
  "M38,176 L38,124 A8 8 0 0 0 22,124 L22,176 A8 8 0 0 0 38,176 Z M58,88 A36 36 0 0 0 22,124 L38,124 A20 20 0 0 1 58,104 Z M38,124 A8 8 0 1 0 22,124 A8 8 0 1 0 38,124 Z M66,96 A8 8 0 1 0 50,96 A8 8 0 1 0 66,96 Z M58,104 L74,104 A8 8 0 0 0 74,88 L58,88 A8 8 0 0 0 58,104 Z M98,144 L178,144 A8 8 0 0 0 178,128 L98,128 A8 8 0 0 0 98,144 Z M186,136 A48 48 0 1 0 171.94,169.94 L160.63,158.63 A32 32 0 1 1 170,136 Z M174.28,164.28 A8 8 0 1 0 158.28,164.28 A8 8 0 1 0 174.28,164.28 Z M186,136 A8 8 0 1 0 170,136 A8 8 0 1 0 186,136 Z M206,96 L206,176 A8 8 0 0 0 222,176 L222,96 A8 8 0 0 0 206,96 Z M224,66 A10 10 0 1 0 204,66 A10 10 0 1 0 224,66 Z M242,96 L242,176 A8 8 0 0 0 258,176 L258,96 A8 8 0 0 0 242,96 Z M322,128 A40 40 0 0 0 242,128 L258,128 A24 24 0 0 1 306,128 Z M258,128 A8 8 0 1 0 242,128 A8 8 0 1 0 258,128 Z M322,128 A8 8 0 1 0 306,128 A8 8 0 1 0 322,128 Z M306,128 L306,176 A8 8 0 0 0 322,176 L322,128 A8 8 0 0 0 306,128 Z M392.25,102 A28 28 0 1 0 368,144 L368,128 A12 12 0 1 1 378.39,110 Z M376,136 A8 8 0 1 0 360,136 A8 8 0 1 0 376,136 Z M393.32,106 A8 8 0 1 0 377.32,106 A8 8 0 1 0 393.32,106 Z M343.75,170 A28 28 0 1 0 368,128 L368,144 A12 12 0 1 1 357.61,162 Z M376,136 A8 8 0 1 0 360,136 A8 8 0 1 0 376,136 Z M358.68,166 A8 8 0 1 0 342.68,166 A8 8 0 1 0 358.68,166 Z";

export function LogoSymbol({ className, color = "currentColor" }: { className?: string; color?: string }) {
  return (
    <svg viewBox="32 16 192 224" className={className} aria-hidden="true">
      <path fill={color} d={SYMBOL} />
    </svg>
  );
}

/** Symbol + wordmark. `symbolColor` lets the R go lime on dark surfaces. */
export function Logo({ className, symbolColor = "currentColor" }: { className?: string; symbolColor?: string }) {
  return (
    <span className={`inline-flex items-end gap-2 ${className ?? ""}`} role="img" aria-label="Reins">
      <LogoSymbol className="h-[1.15em] w-auto" color={symbolColor} />
      <svg viewBox="14 52 388 132" className="h-[0.8em] w-auto" aria-hidden="true">
        <path fill="currentColor" d={WORDMARK} />
      </svg>
    </span>
  );
}
