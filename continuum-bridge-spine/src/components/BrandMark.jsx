import { useId } from "react";

/**
 * Continuum's mark, drawn for small sizes: the infinity loop (blue into
 * orange) with the bridge and its star above, as in public/logo-symbol.png,
 * simplified so it stays crisp at header size on any background.
 */
export default function BrandMark({ size = 26, title }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="brand-mark" width={size * (48 / 30)} height={size} viewBox="0 0 48 30" role={title ? "img" : undefined} aria-hidden={title ? undefined : "true"} aria-label={title}>
      <defs>
        <linearGradient id={`${id}-loop`} x1="2" y1="0" x2="46" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1d4ed8" />
          <stop offset="0.32" stopColor="#38bdf8" />
          <stop offset="0.55" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#ea580c" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor="#fde68a" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* The loop: one ribbon, crossing at the middle */}
      <path
        d="M24 19 C 19 13, 14.5 10.5, 10 10.5 C 5.6 10.5, 2.8 14, 2.8 19 C 2.8 24, 5.6 27.4, 10 27.4 C 14.5 27.4, 19 25, 24 19 C 29 13, 33.5 10.5, 38 10.5 C 42.4 10.5, 45.2 14, 45.2 19 C 45.2 24, 42.4 27.4, 38 27.4 C 33.5 27.4, 29 25, 24 19 Z"
        fill="none"
        stroke={`url(#${id}-loop)`}
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
      {/* The bridge above it, and its star */}
      <path d="M15.5 9 Q 24 3.6 32.5 9" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M19.5 6.6 V 9 M24 5.1 V 8.2 M28.5 6.6 V 9" stroke="#f59e0b" strokeWidth="0.9" strokeLinecap="round" />
      <circle cx="24" cy="2.6" r="2.6" fill={`url(#${id}-glow)`} />
      <path d="M24 0.4 L 24.5 2.1 L 26.2 2.6 L 24.5 3.1 L 24 4.8 L 23.5 3.1 L 21.8 2.6 L 23.5 2.1 Z" fill="#fde68a" />
    </svg>
  );
}
