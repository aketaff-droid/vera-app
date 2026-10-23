// Vera's look (docs/DECISIONS.md, section K): one quiet surface in the spirit of Apple, light or dark, and an
// accent colour chosen as on macOS. Colours are CSS variables on <html>; shapes and motion live in style.css.
import type {Accent, Appearance} from './api';

export interface Surface {
  bg: string; side: string; ink: string; muted: string; faint: string; line: string; field: string; card: string;
  glass: string; selBg: string; shadow: string; warn: string; on: string;
}

export const surfaces: Record<'light' | 'dark', Surface> = {
  light: {
    bg: '#FFFFFF', side: 'rgba(242,242,247,.82)', ink: '#1D1D1F', muted: '#6E6E73', faint: '#AEAEB2', line: 'rgba(0,0,0,.08)',
    field: 'rgba(118,118,128,.12)', card: '#F5F5F7', glass: 'rgba(255,255,255,.72)', selBg: 'rgba(0,0,0,.06)',
    shadow: 'rgba(0,0,0,.18)', warn: '#C4321E', on: '#248A3D',
  },
  dark: {
    bg: '#1C1C1E', side: 'rgba(36,36,38,.78)', ink: '#F5F5F7', muted: '#A1A1A6', faint: '#636366', line: 'rgba(255,255,255,.09)',
    field: 'rgba(118,118,128,.24)', card: '#2C2C2E', glass: 'rgba(44,44,46,.72)', selBg: 'rgba(255,255,255,.08)',
    shadow: 'rgba(0,0,0,.55)', warn: '#FF6B5A', on: '#30D158',
  },
};

/** macOS accent colours, a shade deeper where white text needs it (4.5:1): the fill, the text on that fill, and the accent as text on the window's ground. */
export interface Tone {fill: string; onFill: string; text: string}
export const accents: Record<Accent, {name: string; light: Tone; dark: Tone}> = {
  blue: {name: 'Bleu', light: {fill: '#0071E3', onFill: '#FFFFFF', text: '#0066CC'}, dark: {fill: '#0975E3', onFill: '#FFFFFF', text: '#4DA3FF'}},
  purple: {name: 'Violet', light: {fill: '#8E44C9', onFill: '#FFFFFF', text: '#8A3FC4'}, dark: {fill: '#A64ED3', onFill: '#FFFFFF', text: '#D08CF7'}},
  pink: {name: 'Rose', light: {fill: '#D6336C', onFill: '#FFFFFF', text: '#C2255C'}, dark: {fill: '#DE3053', onFill: '#FFFFFF', text: '#FF6F8B'}},
  red: {name: 'Rouge', light: {fill: '#D93025', onFill: '#FFFFFF', text: '#C5221F'}, dark: {fill: '#D93B31', onFill: '#FFFFFF', text: '#FF7A70'}},
  orange: {name: 'Orange', light: {fill: '#CC4E0B', onFill: '#FFFFFF', text: '#B8480A'}, dark: {fill: '#FF9F0A', onFill: '#1C1C1E', text: '#FFB340'}},
  yellow: {name: 'Jaune', light: {fill: '#F5C400', onFill: '#1D1D1F', text: '#8A6A00'}, dark: {fill: '#FFD60A', onFill: '#1C1C1E', text: '#FFD60A'}},
  green: {name: 'Vert', light: {fill: '#23873C', onFill: '#FFFFFF', text: '#1E7A35'}, dark: {fill: '#30D158', onFill: '#1C1C1E', text: '#4BD970'}},
  graphite: {name: 'Graphite', light: {fill: '#6E6E73', onFill: '#FFFFFF', text: '#5E5E63'}, dark: {fill: '#98989D', onFill: '#1C1C1E', text: '#B5B5BA'}},
};
export const accentOrder: Accent[] = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite'];

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
export const effective = (appearance: Appearance): 'light' | 'dark' => appearance === 'auto' ? (systemDark() ? 'dark' : 'light') : appearance;

export function applyTheme(accent: Accent, appearance: Appearance) {
  const mode = effective(appearance);
  const root = document.documentElement;
  root.className = `md-${mode}`;
  root.style.colorScheme = mode;
  const tone = (accents[accent] ?? accents.orange)[mode];
  const vars: Record<string, string> = {...surfaces[mode], accent: tone.fill, onAccent: tone.onFill, accentText: tone.text};
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(`--${key}`, value);
}

/// Calls back when Windows switches between light and dark (only matters in Auto).
export function onSystemAppearance(callback: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const query = matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

/** A backdrop made of a book's own colours (Apple Music's way), darkened enough for white text. */
export function tintBackdrop(tint: string[]): string {
  const vivid = vivify(tint[0] ?? '#5E5CE6', 1.5, .42), deep = vivify(tint[1] ?? '#1C1C1E', 1.3, .16);
  return `radial-gradient(120% 90% at 15% 20%, ${vivid} 0%, transparent 60%), radial-gradient(90% 100% at 90% 90%, ${deep} 0%, transparent 70%), linear-gradient(135deg, ${vivid}, ${deep})`;
}

/** Cover colours are often dull (old paintings, scans): lift their saturation and set their lightness, keeping the hue. */
function vivify(hex: string, boost: number, lightness: number): string {
  const [r = 0, g = 0, b = 0] = (hex.match(/[a-f\d]{2}/gi) ?? []).map(v => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return `hsl(${Math.round(h * 60)} ${Math.round(Math.min(s * boost, .85) * 100)}% ${Math.round(Math.min(l, lightness) * 100)}%)`;
}

/** The reader's backgrounds, as in Apple Books: page, text and quiet text. */
export const readerThemes = {
  blanc: {name: 'Blanc', bg: '#FFFFFF', ink: '#1D1D1F', muted: '#6E6E73', line: 'rgba(0,0,0,.08)', panel: '#F2F2F4', dark: false},
  papier: {name: 'Papier', bg: '#F6EFE1', ink: '#3A2E21', muted: '#6E5B45', line: 'rgba(80,60,30,.14)', panel: '#ECE2CF', dark: false},
  calme: {name: 'Calme', bg: '#3D3C3A', ink: '#ECE7DD', muted: '#BDB6A9', line: 'rgba(255,255,255,.12)', panel: '#4A4946', dark: true},
  nuit: {name: 'Nuit', bg: '#000000', ink: '#CFCFCF', muted: '#9A9A9A', line: 'rgba(255,255,255,.14)', panel: '#1C1C1E', dark: true},
} as const;
