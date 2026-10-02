// sidepanel/icons.js — Set ikon SVG internal (stroke 1.8, 24 grid, tanpa emoji).
// Dipakai nav, tombol, dan empty-state. CSP aman (inline string, bukan remote).

const WRAP = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const P = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V6M17 20v-9"/>',
  spark: '<path d="M12 3l1.9 5.4L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.6z"/><path d="M18.5 15.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.6 2.6M9.5 2.5h5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3.5H6.5A2.5 2.5 0 0 0 4 6z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  layers: '<path d="M12 3l9 4.8-9 4.8-9-4.8z"/><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5"/>',
  file: '<path d="M13.5 2.5H6a1.5 1.5 0 0 0-1.5 1.5v16A1.5 1.5 0 0 0 6 21.5h12a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M13.5 2.5V8H19.5"/>',
  cpu: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2L17 7M7 17l-1.8 1.8"/>',
  flame: '<path d="M12 21.5c3.9 0 6.8-2.6 6.8-6.3 0-2.9-1.9-5.3-3.4-6.8-.9-.9-2-2.3-2.2-4.4-2.9 1.9-4.7 4.2-5.2 6.6-.9.9-2.3 2.4-2.3 4.6 0 3.7 2.4 6.3 6.3 6.3z"/><path d="M12 21.5c-1.9 0-3.3-1.3-3.3-3 0-1.4 1-2.4 1.9-3.2.5 1 1.2 1.7 2.4 2.1-.3-1.5.1-3.2 1.2-4.6 1 1.3 2.1 2.6 2.1 4.4 0 2.4-1.9 4.3-4.3 4.3z"/>',
  check: '<path d="M4.5 12.5l5 5L19.5 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  download: '<path d="M12 3.5V15m0 0l-4.2-4.2M12 15l4.2-4.2"/><path d="M4.5 19.5h15"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 5.7 7M4 12.5a8 8 0 0 0 14.3 4.5"/><path d="M5.5 3.5v4h-4M18.5 20.5v-4h4"/>',
  send: '<path d="M21.5 2.5L11 13M21.5 2.5L15 21.5l-4-8.5-8.5-4z"/>',
  camera: '<path d="M4 7.5h3l2-2.5h6l2 2.5h3A1.5 1.5 0 0 1 21.5 9v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V9A1.5 1.5 0 0 1 4 7.5z"/><circle cx="12" cy="13.5" r="3.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7"/>',
  play: '<path d="M7.5 5l12 7-12 7z"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5L11 13M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  trophy: '<path d="M8 4.5h8V10a4 4 0 0 1-8 0zM8 5.5H4.5A.5.5 0 0 0 4 6c0 2.6 2 4.2 4.7 4.4M16 5.5h3.5a.5.5 0 0 1 .5.5c0 2.6-2 4.2-4.7 4.4M12 14v3.5M8.5 21h7M9.5 17.5h5"/>',
  text: '<path d="M5 6.5h14M12 6.5V20M9.5 20h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  pen: '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M14.5 6l3 3"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>',
  crop: '<path d="M6.5 2.5v17h17M2.5 6.5h17v17"/>',
  bolt: '<path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
};

export function icon(name, size = 15) {
  return `<span class="ic" style="width:${size}px;height:${size}px">${WRAP(P[name] || P.grid)}</span>`;
}

export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="#E8ECEE"/><path d="M10 11.5h12M16 11.5v9" stroke="#090B0D" stroke-width="2.6" stroke-linecap="round"/></svg>`;
