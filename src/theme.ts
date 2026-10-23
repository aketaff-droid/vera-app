// Vera's look: themes for the window (docs/DECISIONS.md, section P), each light or dark, with its own accent colour
// (« maison ») or one of the macOS accents. Colours and faces are CSS variables on <html>; the theme's class there
// (th-<id>) carries its shapes in style.css. The reader keeps its own backgrounds and faces (section L).
import type {Accent, Appearance, ThemeId} from './api';

export interface Surface {
  bg: string; side: string; ink: string; muted: string; faint: string; line: string; field: string; card: string;
  glass: string; selBg: string; shadow: string; warn: string; on: string;
}

/** An accent: the fill, the text on that fill, and the accent as text on the window's ground (4.5:1 each). */
export interface Tone {fill: string; onFill: string; text: string}

export interface Theme {
  name: string;
  note: string;
  surfaces: Record<'light' | 'dark', Surface>;
  /** The theme's own accent, « maison ». */
  accent: Record<'light' | 'dark', Tone>;
  /** Font stacks for titles and for the interface. */
  display: string;
  ui: string;
}

const SEGOE = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
const SEGOE_DISPLAY = "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif";

export const themes: Record<ThemeId, Theme> = {
  vera: {
    name: 'Vera', note: 'Épuré, dans l’esprit d’Apple', display: SEGOE_DISPLAY, ui: SEGOE,
    surfaces: {
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
    },
    accent: {light: {fill: '#CC4E0B', onFill: '#FFFFFF', text: '#B8480A'}, dark: {fill: '#FF9F0A', onFill: '#1C1C1E', text: '#FFB340'}},
  },
  papier: {
    name: 'Papier', note: 'Papier crème, encre brune, titres à empattements', display: "'Literata Variable', Georgia, serif", ui: SEGOE,
    surfaces: {
      light: {
        bg: '#F8F2E7', side: 'rgba(239,230,212,.88)', ink: '#2E261D', muted: '#6A5B48', faint: '#A8987F', line: 'rgba(90,64,30,.13)',
        field: 'rgba(120,92,52,.12)', card: '#EFE6D5', glass: 'rgba(248,242,231,.8)', selBg: 'rgba(90,64,30,.08)',
        shadow: 'rgba(70,46,18,.22)', warn: '#AE2D1D', on: '#2E7A36',
      },
      dark: {
        bg: '#1F1B16', side: 'rgba(42,36,29,.86)', ink: '#EFE6D5', muted: '#B9AC97', faint: '#6F6555', line: 'rgba(239,230,213,.10)',
        field: 'rgba(239,230,213,.10)', card: '#2A251F', glass: 'rgba(42,37,31,.78)', selBg: 'rgba(239,230,213,.08)',
        shadow: 'rgba(0,0,0,.55)', warn: '#FF8A78', on: '#86C98A',
      },
    },
    accent: {light: {fill: '#9C3A1C', onFill: '#FFFFFF', text: '#923519'}, dark: {fill: '#E08A62', onFill: '#1F1B16', text: '#E8956E'}},
  },
  citadelle: {
    name: 'Citadelle', note: 'Pierre, vélin et or, lettres capitales', display: "'Cinzel Variable', Georgia, serif", ui: SEGOE,
    surfaces: {
      light: {
        bg: '#F4EDDC', side: 'rgba(233,222,197,.92)', ink: '#2A2116', muted: '#685838', faint: '#A39170', line: 'rgba(122,92,30,.20)',
        field: 'rgba(122,92,30,.11)', card: '#EBE1C8', glass: 'rgba(244,237,220,.82)', selBg: 'rgba(122,92,30,.10)',
        shadow: 'rgba(60,40,10,.25)', warn: '#A82A1A', on: '#3F7A2E',
      },
      dark: {
        bg: '#15130F', side: 'rgba(27,24,19,.92)', ink: '#EFE6D2', muted: '#B5A88D', faint: '#776C58', line: 'rgba(201,164,92,.20)',
        field: 'rgba(201,164,92,.10)', card: '#201C16', glass: 'rgba(27,24,19,.82)', selBg: 'rgba(201,164,92,.12)',
        shadow: 'rgba(0,0,0,.6)', warn: '#FF8A78', on: '#9BCB86',
      },
    },
    accent: {light: {fill: '#7E5F17', onFill: '#FFFFFF', text: '#755814'}, dark: {fill: '#C9A45C', onFill: '#15130F', text: '#D4B26C'}},
  },
  encre: {
    name: 'Encre', note: 'Noir et blanc de magazine, angles droits, un seul rouge', display: "'Instrument Serif', Georgia, serif", ui: SEGOE,
    surfaces: {
      light: {
        bg: '#FFFFFF', side: '#FFFFFF', ink: '#0B0B0B', muted: '#585858', faint: '#A6A6A6', line: 'rgba(0,0,0,.14)',
        field: 'rgba(0,0,0,.06)', card: '#F3F3F3', glass: 'rgba(255,255,255,.9)', selBg: 'rgba(0,0,0,.06)',
        shadow: 'rgba(0,0,0,.2)', warn: '#C0261A', on: '#1F7A33',
      },
      dark: {
        bg: '#0B0B0B', side: '#0B0B0B', ink: '#F2F2F2', muted: '#A8A8A8', faint: '#5C5C5C', line: 'rgba(255,255,255,.16)',
        field: 'rgba(255,255,255,.08)', card: '#171717', glass: 'rgba(11,11,11,.9)', selBg: 'rgba(255,255,255,.08)',
        shadow: 'rgba(0,0,0,.6)', warn: '#FF6B5A', on: '#5FD07A',
      },
    },
    accent: {light: {fill: '#C8321A', onFill: '#FFFFFF', text: '#BF2F18'}, dark: {fill: '#FF5A3C', onFill: '#0B0B0B', text: '#FF6E52'}},
  },
  reflet: {
    name: 'Reflet', note: 'La fenêtre prend les couleurs du livre en cours', display: SEGOE_DISPLAY, ui: SEGOE,
    surfaces: {
      light: {
        bg: '#FBFAF9', side: 'rgba(255,255,255,.55)', ink: '#1C1B1A', muted: '#68645F', faint: '#ADA8A1', line: 'rgba(0,0,0,.08)',
        field: 'rgba(0,0,0,.06)', card: 'rgba(255,255,255,.7)', glass: 'rgba(255,255,255,.62)', selBg: 'rgba(0,0,0,.06)',
        shadow: 'rgba(0,0,0,.2)', warn: '#C4321E', on: '#248A3D',
      },
      dark: {
        bg: '#121110', side: 'rgba(24,23,22,.5)', ink: '#F4F2EF', muted: '#ABA6A0', faint: '#67635E', line: 'rgba(255,255,255,.09)',
        field: 'rgba(255,255,255,.08)', card: 'rgba(255,255,255,.06)', glass: 'rgba(30,29,28,.6)', selBg: 'rgba(255,255,255,.08)',
        shadow: 'rgba(0,0,0,.6)', warn: '#FF6B5A', on: '#30D158',
      },
    },
    accent: {light: {fill: '#2F6690', onFill: '#FFFFFF', text: '#2A5E85'}, dark: {fill: '#7DB9E8', onFill: '#121110', text: '#86C0EC'}},
  },
};
export const themeOrder: ThemeId[] = ['vera', 'papier', 'citadelle', 'encre', 'reflet'];

/** macOS accent colours, a shade deeper where white text needs it. On a theme, the text tone is checked against its
 *  ground by tests/check-interface.mjs. */
export const accents: Record<Exclude<Accent, 'maison'>, {name: string; light: Tone; dark: Tone}> = {
  blue: {name: 'Bleu', light: {fill: '#0071E3', onFill: '#FFFFFF', text: '#0062C4'}, dark: {fill: '#0975E3', onFill: '#FFFFFF', text: '#4DA3FF'}},
  purple: {name: 'Violet', light: {fill: '#8E44C9', onFill: '#FFFFFF', text: '#8139B9'}, dark: {fill: '#A64ED3', onFill: '#FFFFFF', text: '#D08CF7'}},
  pink: {name: 'Rose', light: {fill: '#D6336C', onFill: '#FFFFFF', text: '#B52253'}, dark: {fill: '#DE3053', onFill: '#FFFFFF', text: '#FF6F8B'}},
  red: {name: 'Rouge', light: {fill: '#D93025', onFill: '#FFFFFF', text: '#B71F1C'}, dark: {fill: '#D93B31', onFill: '#FFFFFF', text: '#FF7A70'}},
  orange: {name: 'Orange', light: {fill: '#CC4E0B', onFill: '#FFFFFF', text: '#A84208'}, dark: {fill: '#FF9F0A', onFill: '#1C1C1E', text: '#FFB340'}},
  yellow: {name: 'Jaune', light: {fill: '#F5C400', onFill: '#1D1D1F', text: '#7A5D00'}, dark: {fill: '#FFD60A', onFill: '#1C1C1E', text: '#FFD60A'}},
  green: {name: 'Vert', light: {fill: '#23873C', onFill: '#FFFFFF', text: '#1B6E30'}, dark: {fill: '#30D158', onFill: '#1C1C1E', text: '#4BD970'}},
  graphite: {name: 'Graphite', light: {fill: '#6E6E73', onFill: '#FFFFFF', text: '#555559'}, dark: {fill: '#98989D', onFill: '#1C1C1E', text: '#B5B5BA'}},
};
export const accentOrder: Accent[] = ['maison', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite'];

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
export const effective = (appearance: Appearance): 'light' | 'dark' => appearance === 'auto' ? (systemDark() ? 'dark' : 'light') : appearance;

export const themeOf = (id: ThemeId | undefined): Theme => themes[id ?? 'vera'] ?? themes.vera;
/** The accent as drawn: the theme's own for « maison ». */
export function tone(theme: ThemeId, accent: Accent, mode: 'light' | 'dark'): Tone {
  return accent === 'maison' ? themeOf(theme).accent[mode] : (accents[accent] ?? accents.orange)[mode];
}
export const accentName = (accent: Accent, theme: ThemeId) => accent === 'maison' ? `Celle du thème ${themeOf(theme).name}` : accents[accent]?.name ?? '';

export function applyTheme(theme: ThemeId, accent: Accent, appearance: Appearance) {
  const mode = effective(appearance);
  const t = themeOf(theme);
  const root = document.documentElement;
  root.className = `md-${mode} th-${theme in themes ? theme : 'vera'}`;
  root.style.colorScheme = mode;
  const a = tone(theme, accent, mode);
  const vars: Record<string, string> = {...t.surfaces[mode], accent: a.fill, onAccent: a.onFill, accentText: a.text, display: t.display, ui: t.ui};
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
