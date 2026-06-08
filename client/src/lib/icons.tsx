// Lucide-style stroke icons. Single component, path map — keeps the bundle tiny
// and the whole app on one consistent 24×24 / stroke-1.75 grid (no emoji).
import type { SVGProps } from 'react';

const PATHS: Record<string, string> = {
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  compass: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.2 5.8-2.1 5.3-5.3 2.1 2.1-5.3 5.3-2.1Z',
  columns: 'M4 4h4v16H4V4Zm6 0h4v10h-4V4Zm6 0h4v16h-4V4Z',
  calendar: 'M7 2v3m10-3v3M3.5 8.5h17M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.5 3.5a8.5 8.5 0 0 0-.14-1.5l2-1.55-2-3.46-2.36.95a8.5 8.5 0 0 0-2.6-1.5L15 2h-4l-.4 2.49a8.5 8.5 0 0 0-2.6 1.5L5.64 5 3.64 8.5l2 1.55a8.6 8.6 0 0 0 0 3l-2 1.55 2 3.46 2.36-.95a8.5 8.5 0 0 0 2.6 1.5L11 22h4l.4-2.49a8.5 8.5 0 0 0 2.6-1.5l2.36.95 2-3.46-2-1.55c.09-.49.14-1 .14-1.5Z',
  logout: 'M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3m7-4 4-4m0 0-4-4m4 4H10',
  plus: 'M12 5v14m-7-7h14',
  check: 'M5 12.5 10 17l9-10',
  x: 'M6 6l12 12M18 6 6 18',
  mapPin: 'M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  map: 'm9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.3-4.3',
  trendingUp: 'm3 17 6-6 4 4 8-8m0 0h-5m5 0v5',
  building: 'M3 21h18M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16m0-11h3a1 1 0 0 1 1 1v10M8 7h2M8 11h2M8 15h2',
  arrowUp: 'M12 19V5m-7 7 7-7 7 7',
  arrowDown: 'M12 5v14m7-7-7 7-7-7',
  chevronRight: 'm9 6 6 6-6 6',
  sparkles: 'M12 3l1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3Zm6 9 .9 2.3 2.3.9-2.3.7-.9 2.4-.9-2.4-2.3-.7 2.3-.9.9-2.3Z',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L19 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  users: 'M16 19a4 4 0 0 0-8 0M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 8a3.5 3.5 0 0 0-3-3.5M5 19a3.5 3.5 0 0 1 3-3.5',
  pencil: 'M16.5 4.5l3 3M4 20l1-4L16 5l3 3L8 19l-4 1Z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  box: 'M21 8 12 3 3 8m18 0-9 5m9-5v8l-9 5m0-8L3 8m9 5v8M3 8v8l9 5',
  wallet: 'M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4M3 7h16a2 2 0 0 1 2 2v2h-5a2 2 0 0 0 0 4h5m-5-2h.01',
  route: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-6V8a3 3 0 0 1 3-3h6m0 0-2.5-2.5M15 5l-2.5 2.5M18 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  car: 'M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm10 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm-8 0H5a1 1 0 0 1-1-1v-3.3a3 3 0 0 1 .3-1.3l1.4-2.8A2 2 0 0 1 7.5 7.5h7.6a2 2 0 0 1 1.8 1.1l1.4 2.8c.2.4.3.8.3 1.3V16a1 1 0 0 1-1 1h-2M9 17h6M4 12h16',
  fuel: 'M3 22h12M5 22V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v17M4 11h10m1-2 3 3v6a1.5 1.5 0 0 0 3 0V8l-3-3',
  trash: 'M4 7h16M9 7V4h6v3m-7 0v13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7M10 11v6M14 11v6',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
