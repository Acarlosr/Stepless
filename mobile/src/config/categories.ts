/**
 * Stepless — taxonomia canônica de categorias de acessibilidade.
 *
 * Espelha LOCATION_CATEGORIES do web (frontend/arc-config.js) e os checkboxes
 * do dashboard.html — MESMOS ids numéricos. O array numérico é o que vai para
 * o Upstash via /api/relay; a web e o mobile leem os MESMOS dados, então os
 * ids têm que bater. Versões antigas do app enviavam slugs ('ramp',
 * 'restroom'...) — esses continuam legíveis via LEGACY_SLUG_TO_ID.
 */

import { Ionicons } from '@expo/vector-icons';

export interface LocationCategoryMeta {
  id: number;
  /** Chave i18n do rótulo (translations.ts → categories) */
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

export const LOCATION_CATEGORIES: LocationCategoryMeta[] = [
  { id: 0, labelKey: 'categories.ramp',     icon: 'easel',                      color: '#2563EB' },
  { id: 1, labelKey: 'categories.elevator', icon: 'arrow-up-circle',            color: '#B45309' },
  { id: 2, labelKey: 'categories.restroom', icon: 'water',                      color: '#0891B2' },
  { id: 3, labelKey: 'categories.parking',  icon: 'car',                        color: '#7C3AED' },
  { id: 4, labelKey: 'categories.signage',  icon: 'information-circle',         color: '#475569' },
  { id: 5, labelKey: 'categories.audio',    icon: 'volume-high',                color: '#DB2777' },
  { id: 6, labelKey: 'categories.braille',  icon: 'grid',                       color: '#0D9488' },
  { id: 7, labelKey: 'categories.other',    icon: 'ellipsis-horizontal-circle', color: '#64748B' },
  { id: 8, labelKey: 'categories.entrance', icon: 'enter',                      color: '#15803D' },
];

// Ordem no formulário: acesso físico primeiro, sensorial depois, outro no fim.
export const CATEGORY_FORM_ORDER = [0, 2, 3, 8, 1, 4, 5, 6, 7];

// Slugs enviados por versões antigas do app — mapeados para o id da web.
// 'entrance' vira 8 (Entrada Acessível); texto livre cai fora (o nome o carrega).
const LEGACY_SLUG_TO_ID: Record<string, number> = {
  ramp: 0,
  restroom: 2,
  parking: 3,
  entrance: 8,
  other: 7,
};

export function metaForId(id: number): LocationCategoryMeta | undefined {
  return LOCATION_CATEGORIES.find((c) => c.id === id);
}

/** Meta da primeira categoria resolvível; fallback Rampa (id 0). Nunca undefined. */
export function metaOrDefault(cats: number[]): LocationCategoryMeta {
  const id = cats.length ? cats[0] : 0;
  return metaForId(id) ?? LOCATION_CATEGORIES[0];
}

/**
 * Converte o array vindo do Upstash (números da web, slugs legados do app)
 * em ids canônicos 0-8, preservando a ordem de chegada.
 */
export function categoryIdsFromMeta(cats: (string | number)[] | undefined): number[] {
  if (!Array.isArray(cats)) return [];
  const ids: number[] = [];
  for (const raw of cats) {
    const id = typeof raw === 'number'
      ? raw
      : LEGACY_SLUG_TO_ID[String(raw).trim().toLowerCase()] ?? null;
    if (id !== null && id >= 0 && id <= 8 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
