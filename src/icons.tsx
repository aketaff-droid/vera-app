import logoSmall from './assets/vera.svg';
import logoLarge from './assets/vera-grand.svg';
// Line icons drawn for Vera in the spirit of SF Symbols (no icon font, no emoji). Decorative: hidden from screen readers.
import type {ReactNode} from 'react';

const Svg = ({size = 16, view = '0 0 20 20', stroke = 1.6, children}: {size?: number; view?: string; stroke?: number; children: ReactNode}) =>
  <svg width={size} height={size} viewBox={view} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

/** Vera's app icon: an open book on the accent colour. */
/** Vera's logo: the elf drawn in thick and thin strokes. Its small optical size (sturdier hairlines) below 48 px. */
export const AppIcon = ({size = 26}: {size?: number}) =>
  <img className="app-icon" src={size >= 48 ? logoLarge : logoSmall} width={size} height={size} alt="" aria-hidden="true"/>;
export const Books = () => <Svg><path d="M3.5 3.5h3v13h-3zM8 3.5h3v13H8z"/><path d="M12.6 4.4l2.9-.8 3 12.5-2.9.8z"/></Svg>;
export const Stack = () => <Svg><rect x="3" y="7" width="14" height="10" rx="2"/><path d="M5 4.5h10M7 2h6"/></Svg>;
export const Person = () => <Svg><circle cx="10" cy="7" r="3.2"/><path d="M3.8 17c.8-3.2 3.3-5 6.2-5s5.4 1.8 6.2 5"/></Svg>;
export const SortIcon = () => <Svg><path d="M6 4v12M3 13l3 3 3-3M14 16V4M11 7l3-3 3 3"/></Svg>;
export const FolderSmall = () => <Svg><path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.5l1.6 1.6H16A1.5 1.5 0 0 1 17.5 7v7.5A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z"/></Svg>;
export const Search = () => <Svg size={14} view="0 0 16 16"><circle cx="7" cy="7" r="5.2"/><path d="M11 11l3.5 3.5"/></Svg>;
export const Gear = () => <Svg><circle cx="10" cy="10" r="2.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></Svg>;
export const Kobo = ({size = 16}: {size?: number}) =>
  <svg width={size} height={size * 1.375} viewBox="0 0 16 22" aria-hidden="true"><rect x="1" y="1" width="14" height="20" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5"/><rect x="3.5" y="3.5" width="9" height="13" rx="1" fill="currentColor" opacity=".3"/></svg>;
export const Eject = () => <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2l5 6H2z" fill="currentColor"/><rect x="2" y="10" width="10" height="2" rx="1" fill="currentColor"/></svg>;
export const Check = () => <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
export const Close = ({size = 11}: {size?: number}) => <Svg size={size} view="0 0 10 10" stroke={1.5}><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></Svg>;
export const Sun = () => <Svg><circle cx="10" cy="10" r="3.4"/><path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"/></Svg>;
export const Moon = () => <Svg><path d="M16.5 12.6A7 7 0 0 1 7.4 3.5a7 7 0 1 0 9.1 9.1z"/></Svg>;
export const Auto = () => <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.3" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M10 2.7a7.3 7.3 0 0 1 0 14.6z" fill="currentColor"/></svg>;
export const Folder = () => <Svg size={26} view="0 0 24 24" stroke={1.5}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2h8.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></Svg>;
export const Warn = () => <Svg size={20} view="0 0 24 24"><path d="M12 3.5l9 16h-18z"/><path d="M12 10v4.5M12 17.2v.3" strokeWidth="1.9"/></Svg>;
export const Caption = {
  minimize: () => <Svg size={10} view="0 0 10 10" stroke={1}><path d="M0 5h10"/></Svg>,
  maximize: () => <Svg size={10} view="0 0 10 10" stroke={1}><rect x=".5" y=".5" width="9" height="9"/></Svg>,
  restore: () => <Svg size={10} view="0 0 10 10" stroke={1}><rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5v-2h7v7h-2"/></Svg>,
  close: () => <Svg size={10} view="0 0 10 10" stroke={1}><path d="M0 0l10 10M10 0L0 10"/></Svg>,
};
