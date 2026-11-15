// packages/core/src/ctePalette.ts

import { ThemeColorPair } from './dataTypePalette.js';

export type CteColorStyle = 'pastel' | 'muted';

export const PASTEL_CTE_PALETTE: ThemeColorPair[] = [
  { dark: '#7DCFFF', light: '#0062A3' },
  { dark: '#73DACA', light: '#0D7A5F' },
  { dark: '#FF9E64', light: '#B84B11' },
  { dark: '#BB9AF7', light: '#673AB7' },
  { dark: '#E0AF68', light: '#8F6200' },
  { dark: '#F7768E', light: '#AD1457' },
  { dark: '#2AC3DE', light: '#007C91' },
  { dark: '#9ECE6A', light: '#3E7516' },
];

export const MUTED_CTE_PALETTE: ThemeColorPair[] = [
  { dark: '#82AEE3', light: '#2B5B84' },
  { dark: '#8CC49E', light: '#2E6B47' },
  { dark: '#E0A37B', light: '#9E4B19' },
  { dark: '#B39DDB', light: '#5E3D82' },
  { dark: '#76C2C2', light: '#1F6E6E' },
  { dark: '#DE8F9C', light: '#8F3042' },
  { dark: '#CFC07E', light: '#736218' },
  { dark: '#A8C47C', light: '#47661B' },
];

export function getCtePalette(style: CteColorStyle): ThemeColorPair[] {
  return style === 'muted' ? MUTED_CTE_PALETTE : PASTEL_CTE_PALETTE;
}

export enum TypeCategoryIndex {
  Integer = 0,
  Float = 1,
  Text = 2,
  DateTime = 3,
  Boolean = 4,
  Complex = 5,
}