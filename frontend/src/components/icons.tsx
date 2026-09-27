type P = { size?: number };

export const Logo = ({ size = 30 }: P) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 3 3.5 13.2V28a1 1 0 0 0 1 1h23a1 1 0 0 0 1-1V13.2L16 3Z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />
    <path d="M16 12.5c2.6 3 4.4 5.2 4.4 7.9a4.4 4.4 0 0 1-8.8 0c0-1.6.7-2.9 1.8-4.2.2 1.3.9 2.1 1.8 2.3-.5-2.4.1-4.1.8-6Z" fill="currentColor" />
  </svg>
);

export const Flame = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.5c2.9 3.3 5 5.8 5 8.8a5 5 0 0 1-10 0c0-1.8.8-3.3 2-4.7.3 1.5 1 2.4 2 2.6-.6-2.7.1-4.6 1-6.7Z" fill="currentColor" />
  </svg>
);

export const Send = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Thumb = ({ size = 16, down = false }: P & { down?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" style={down ? { transform: "rotate(180deg)" } : undefined}>
    <path d="M6 9v8H3V9h3Zm0 0 3.5-6c1.4 0 2.3 1 2 2.4L11 8h4.6a1.6 1.6 0 0 1 1.6 1.9l-1.2 6A1.6 1.6 0 0 1 14.4 17H6"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

export const Chevron = ({ size = 14 }: P) => (
  <svg className="chev" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Shield = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.5 2.5 3.5v4c0 3.4 2.3 6 5.5 7 3.2-1 5.5-3.6 5.5-7v-4L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);
