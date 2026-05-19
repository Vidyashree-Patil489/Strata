/**
 * The Strata wordmark / monogram.
 *
 * Visual concept: four horizontal lines = "strata" (geological layers),
 * with one accent line for the layer Strata measures. Editorial — no
 * gradients, no glow, just shape.
 *
 * Use `size` for square dimensions. Tone determines fill on a dark vs
 * light surface: pass `tone="invert"` when the mark sits on a dark
 * background (the dark square becomes light, lines flip).
 */
export function StrataMark({
  size = 28,
  tone = "default",
  className = "",
}: {
  size?: number;
  tone?: "default" | "invert";
  className?: string;
}) {
  const bg = tone === "invert" ? "#fafaf9" : "#0a0a0a";
  const fg = tone === "invert" ? "#0a0a0a" : "#fafaf9";
  const accent = "#4f46e5";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="6" fill={bg} />
      <rect x="7" y="9"  width="18" height="2" rx="0.5" fill={fg} />
      <rect x="7" y="14" width="14" height="2" rx="0.5" fill={fg} />
      <rect x="7" y="19" width="18" height="2" rx="0.5" fill={accent} />
      <rect x="7" y="24" width="10" height="2" rx="0.5" fill={fg} />
    </svg>
  );
}

/**
 * Strata wordmark — small mark + the word "Strata" in a tight typographic
 * lockup. Used in headers and login.
 */
export function StrataWordmark({ size = 28 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <StrataMark size={size} />
      <span
        className="font-semibold text-foreground"
        style={{ fontSize: size * 0.62, letterSpacing: "-0.02em" }}
      >
        Strata
      </span>
    </div>
  );
}
