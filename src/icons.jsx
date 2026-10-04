// One icon style for the whole app: 24px grid, 1.75px round strokes, drawn in
// the current text colour. Icons are decorative; the control that holds one
// carries the accessible name (visible text or aria-label).
const PATHS = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  library: 'M4 4h4v16H4z M8 4h4v16H8z M13.6 7.2l3.5-1 3.3 12.6-3.5 1z',
  save: 'M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1z M8 3v5h7V3 M8 21v-7h8v7',
  pdf: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M12 11v6 M9.5 14.5L12 17l2.5-2.5',
  print: 'M7 9V4h10v5 M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2 M7 14h10v6H7z',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3',
  move: 'M5 3l14 7-6.2 2-2 6.2z',
  text: 'M5 7V4h14v3 M12 4v16 M9 20h6',
  eraser: 'M20 20H10 M4.6 16.4l-1-1a2 2 0 0 1 0-2.8l9-9a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L12 20H8.2z M8.5 8.5l7 7',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  paste: 'M9 3h6v4H9z M9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3',
  duplicate: 'M9 9h11v11H9z M5 15H4V4h11v1 M14.5 12v5 M12 14.5h5',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4 M11 8v6 M8 11h6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4 M8 11h6',
  fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  chevronDown: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12 M18 6L6 18',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  arrowUp: 'M12 19V5 M6 11l6-6 6 6',
  arrowDown: 'M12 5v14 M6 13l6 6 6-6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  sections: 'M4 5h16v5H4z M4 14h16v5H4z',
  page: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  panel: 'M4 4h16v16H4z M15 4v16',
  twoPages: 'M3 5h8v14H3z M13 5h8v14h-8z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3 M9 21h6',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  check: 'M5 12l5 5 9-10',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3 M16 4h3a1 1 0 0 1 1 1v3 M20 16v3a1 1 0 0 1-1 1h-3 M8 20H5a1 1 0 0 1-1-1v-3 M4 12h16',
};
// A row of three dots is drawn as filled circles rather than strokes.
const DOTS = [5, 12, 19];

export function Icon({ name, size = 16 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === 'more'
        ? DOTS.map((x) => <circle key={x} cx={x} cy="12" r="1.4" fill="currentColor" stroke="none" />)
        : <path d={PATHS[name]} />}
    </svg>
  );
}

// The app mark: a sheet with one line pulled out of place.
export function Logo({ size = 22 }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="#2456d6" />
      <rect x="6" y="5" width="20" height="22" rx="2.5" fill="#fff" />
      <rect x="9" y="9" width="5" height="2" rx="1" fill="#2456d6" />
      <rect x="9" y="12.5" width="14" height="2" rx="1" fill="#a9b4c6" />
      <rect x="12" y="17" width="5" height="2" rx="1" fill="#e08a00" />
      <rect x="12" y="20.5" width="11" height="2" rx="1" fill="#e08a00" />
    </svg>
  );
}
