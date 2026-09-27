import type { ReactElement } from "react";
// Illustrated "listing photos" drawn in SVG, so the demo ships with no external images.
type Props = { scene: string; hue: number; label?: string };

const hsl = (h: number, s: number, l: number) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;

export function ListingArt({ scene, hue, label }: Props) {
  const id = `g-${scene}-${hue}`;
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label={label ?? `${scene} illustration`}
      style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hsl(hue + 190, 60, 82)} />
          <stop offset="1" stopColor={hsl(hue + 20, 75, 88)} />
        </linearGradient>
      </defs>
      <rect width="400" height="300" fill={`url(#${id}-sky)`} />
      <circle cx="318" cy="70" r="30" fill={hsl(hue + 30, 90, 70)} opacity=".9" />
      {SCENES[scene]?.(hue) ?? SCENES.city(hue)}
    </svg>
  );
}

const windows = (x: number, y: number, cols: number, rows: number, w: number, h: number, gx: number, gy: number, fill: string) =>
  Array.from({ length: cols * rows }, (_, i) => (
    <rect key={i} x={x + (i % cols) * (w + gx)} y={y + Math.floor(i / cols) * (h + gy)} width={w} height={h} rx="2" fill={fill} />
  ));

const SCENES: Record<string, (h: number) => ReactElement> = {
  city: (h) => (
    <g>
      <rect y="250" width="400" height="50" fill={hsl(h + 10, 25, 62)} />
      {[0, 1, 2, 3, 4].map((i) => {
        const x = 20 + i * 74, top = 120 + ((i * 37) % 50), c = hsl(h + i * 42, 55, 66);
        return (
          <g key={i}>
            <rect x={x} y={top} width="70" height={250 - top} fill={c} />
            <path d={`M${x - 4} ${top} L${x + 35} ${top - 22} L${x + 74} ${top} Z`} fill={hsl(12, 60, 48)} />
            {windows(x + 10, top + 16, 3, Math.floor((230 - top) / 30), 12, 16, 8, 14, hsl(h + 200, 30, 94))}
          </g>
        );
      })}
      <rect x="0" y="246" width="400" height="6" fill={hsl(h, 15, 45)} />
    </g>
  ),
  cabin: (h) => (
    <g>
      <path d="M-20 230 L90 110 L200 230 Z" fill={hsl(h + 60, 20, 58)} />
      <path d="M120 230 L260 90 L420 230 Z" fill={hsl(h + 70, 18, 50)} />
      <path d="M232 118 L260 90 L288 118 L275 112 L260 120 L245 112 Z" fill="#fff" opacity=".85" />
      <rect y="228" width="400" height="72" fill={hsl(h, 35, 42)} />
      {[30, 60, 330, 362].map((x, i) => (
        <path key={i} d={`M${x} ${250 - i % 2 * 10} l18 -60 l18 60 Z`} fill={hsl(h + 10, 45, 28)} />
      ))}
      <path d="M140 250 L200 160 L260 250 Z" fill={hsl(20, 45, 40)} />
      <path d="M156 250 L200 184 L244 250 Z" fill={hsl(28, 55, 56)} />
      <rect x="188" y="214" width="24" height="36" rx="3" fill={hsl(20, 40, 30)} />
      <rect x="170" y="206" width="12" height="12" rx="2" fill={hsl(45, 95, 72)} />
      <rect x="218" y="206" width="12" height="12" rx="2" fill={hsl(45, 95, 72)} />
    </g>
  ),
  loft: (h) => (
    <g>
      <rect y="255" width="400" height="45" fill={hsl(h + 20, 20, 60)} />
      <rect x="40" y="70" width="170" height="185" fill={hsl(h, 30, 78)} />
      {windows(52, 84, 3, 4, 42, 30, 12, 12, hsl(h + 180, 25, 40))}
      <rect x="220" y="120" width="140" height="135" fill={hsl(h + 30, 45, 60)} />
      {windows(232, 134, 3, 3, 32, 24, 10, 12, hsl(h + 200, 35, 90))}
      {[70, 120, 170, 250, 300].map((x, i) => (
        <g key={i}>
          <rect x={x} y="232" width="16" height="16" rx="3" fill={hsl(20, 45, 45)} />
          <circle cx={x + 8} cy="226" r="11" fill={hsl(130, 40, 38)} />
        </g>
      ))}
    </g>
  ),
  flat: (h) => (
    <g>
      <rect y="258" width="400" height="42" fill={hsl(h, 10, 60)} />
      <rect x="90" y="60" width="220" height="198" fill={hsl(10, 45, 45)} />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={i} x1="90" x2="310" y1={78 + i * 17} y2={78 + i * 17} stroke={hsl(10, 35, 38)} strokeWidth="1.5" />
      ))}
      <rect x="84" y="52" width="232" height="12" fill={hsl(h, 15, 30)} />
      {windows(110, 82, 3, 3, 44, 40, 24, 22, hsl(h + 180, 30, 85))}
      <rect x="182" y="212" width="36" height="46" rx="3" fill={hsl(h, 40, 30)} />
      <circle cx="60" cy="238" r="26" fill={hsl(120, 35, 40)} />
      <rect x="56" y="238" width="8" height="22" fill={hsl(25, 40, 30)} />
    </g>
  ),
  townhouse: (h) => (
    <g>
      <rect y="250" width="400" height="50" fill={hsl(h, 20, 70)} />
      <circle cx="330" cy="170" r="54" fill={hsl(8, 75, 55)} />
      <circle cx="300" cy="190" r="36" fill={hsl(18, 80, 60)} />
      <rect x="322" y="200" width="10" height="52" fill={hsl(20, 40, 25)} />
      <path d="M40 150 Q150 120 260 150 L250 162 L50 162 Z" fill={hsl(210, 15, 25)} />
      <rect x="60" y="162" width="180" height="88" fill={hsl(35, 45, 62)} />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={68 + i * 14} y="176" width="8" height="60" fill={hsl(25, 40, 38)} />
      ))}
      <rect x="140" y="196" width="22" height="30" rx="4" fill={hsl(8, 70, 55)} />
    </g>
  ),
  cottage: (h) => (
    <g>
      <rect y="232" width="400" height="68" fill={hsl(h, 40, 52)} />
      <path d="M110 170 L190 110 L270 170 Z" fill={hsl(h + 200, 25, 38)} />
      <rect x="126" y="168" width="128" height="80" fill={hsl(45, 60, 88)} />
      <rect x="178" y="198" width="26" height="50" rx="3" fill={hsl(h + 190, 45, 45)} />
      <rect x="140" y="184" width="24" height="22" rx="2" fill={hsl(200, 50, 80)} />
      <rect x="218" y="184" width="24" height="22" rx="2" fill={hsl(200, 50, 80)} />
      {Array.from({ length: 22 }, (_, i) => (
        <rect key={i} x={i * 19} y="244" width="6" height="30" rx="2" fill="#fff" opacity=".9" />
      ))}
      <rect x="0" y="252" width="400" height="4" fill="#fff" opacity=".9" />
      {[40, 70, 300, 340, 370].map((x, i) => (
        <circle key={i} cx={x} cy={282} r="7" fill={hsl(i * 70 + 330, 70, 62)} />
      ))}
    </g>
  ),
};
