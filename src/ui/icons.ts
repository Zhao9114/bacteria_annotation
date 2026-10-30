// Small inline SVG icon set (lucide-style 24x24 strokes). Usage: `${icon('plus')}`.

const PATHS = {
  logo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>',
  pointer: '<path d="M4 4l7 17 2.5-7.5L21 11z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  points: '<circle cx="5" cy="17" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="19" cy="15" r="2"/><path d="M6.5 15.5 10.6 7.7M13.6 7.4l4 6"/>',
  pencil: '<path d="M3 21c3-1 4-4 7-5s5 1 8-2"/><path d="M15 4l5 5-9 9-5 1 1-5z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  cloud: '<path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.5 11 4 4 0 0 1 17.5 19z"/>',
  hardDrive: '<rect x="2" y="13" width="20" height="8" rx="2"/><path d="M5 13 7.5 4h9L19 13M6 17h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
}
