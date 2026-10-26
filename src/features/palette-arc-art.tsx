/**
 * Drawings of the tools that stand on the curved palette.
 * Original artwork; each is 34 × 96, standing on its bottom edge.
 * A tool from a future feature without its own drawing gets `GenericStick`.
 */
import type { ReactNode } from "react";

export const STICK_W = 34;
export const STICK_H = 96;

function Body({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-body`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="var(--hn-stick-edge)" />
        <stop offset="0.42" stopColor="var(--hn-stick-light)" />
        <stop offset="1" stopColor="var(--hn-stick-shade)" />
      </linearGradient>
    </defs>
  );
}

const outline = { stroke: "var(--hn-stick-outline)", strokeWidth: 0.6 };

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width={STICK_W} height={STICK_H} viewBox={`0 0 ${STICK_W} ${STICK_H}`} aria-hidden>
      {children}
    </svg>
  );
}

export function PenStick({ color }: { color: string }) {
  return (
    <Svg>
      <Body id="pen" />
      <rect x="9" y="30" width="16" height="70" rx="3" fill="url(#pen-body)" {...outline} />
      <path d="M9 30.5 L17 7 L25 30.5 Z" fill="url(#pen-body)" {...outline} />
      <path d="M14.4 14.6 L17 7 L19.6 14.6 Z" fill={color} />
      <rect x="9" y="41" width="16" height="3.5" fill={color} />
    </Svg>
  );
}

export function HighlighterStick({ color }: { color: string }) {
  return (
    <Svg>
      <Body id="hl" />
      <rect x="7" y="34" width="20" height="66" rx="4" fill="url(#hl-body)" {...outline} />
      <path d="M8.5 34.5 L11 22 L23 22 L25.5 34.5 Z" fill="url(#hl-body)" {...outline} />
      <path d="M11 22.5 L13 9 L23 13.5 L23 22.5 Z" fill={color} opacity="0.9" />
      <rect x="7" y="45" width="20" height="5" fill={color} opacity="0.75" />
    </Svg>
  );
}

export function PrecisionEraserStick() {
  return (
    <Svg>
      <Body id="pe" />
      <rect x="10" y="27" width="14" height="73" rx="2.5" fill="url(#pe-body)" {...outline} />
      <rect x="10" y="20" width="14" height="8" fill="var(--hn-stick-metal)" {...outline} />
      <rect x="10" y="6" width="14" height="15.5" rx="4" fill="#f3a7b5" {...outline} />
    </Svg>
  );
}

export function ObjectEraserStick() {
  return (
    <Svg>
      <Body id="oe" />
      <rect x="5" y="10" width="24" height="34" rx="6" fill="var(--hn-stick-light)" {...outline} />
      <rect x="5" y="36" width="24" height="64" rx="4" fill="#8fb0f5" {...outline} />
      <rect x="5" y="36" width="24" height="5" fill="#7697e0" />
    </Svg>
  );
}

export function LassoStick() {
  return (
    <Svg>
      <Body id="ls" />
      <rect x="10" y="30" width="14" height="70" rx="7" fill="url(#ls-body)" {...outline} />
      <ellipse cx="17" cy="16" rx="11" ry="8.5" fill="none" stroke="var(--hn-stick-ink)" strokeWidth="1.6" strokeDasharray="3 2.4" />
      <path d="M12.5 23 Q 13 28 17 30" fill="none" stroke="var(--hn-stick-ink)" strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  );
}

export function GenericStick() {
  return (
    <Svg>
      <Body id="gs" />
      <rect x="9" y="30" width="16" height="70" rx="4" fill="url(#gs-body)" {...outline} />
      <circle cx="17" cy="17" r="13" fill="var(--hn-stick-light)" {...outline} />
    </Svg>
  );
}
