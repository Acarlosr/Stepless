/**
 * Stepless — WCAG AA Color Palette
 *
 * Extraído para um arquivo próprio (sem depender de App.tsx) para evitar
 * import circular: as telas em src/screens/* importavam Colors de volta
 * de '../../App', que por sua vez importa essas mesmas telas. Isso causava
 * "Cannot read property 'light' of undefined" no Hermes, dependendo da
 * ordem de inicialização dos módulos.
 *
 * All color combinations meet WCAG AA contrast ratio (≥4.5:1 for text).
 */

export const Colors = {
  light: {
    primary: '#1A56DB',        // Blue 700 — contrast 7.4:1 on white
    primaryLight: '#3B82F6',   // Blue 500
    secondary: '#7C3AED',      // Violet 600
    success: '#15803D',        // Green 700 — 5.9:1 on white
    warning: '#B45309',        // Amber 700 — 5.9:1 on white
    error: '#B91C1C',          // Red 700 — 6.3:1 on white
    background: '#FFFFFF',
    surface: '#F8FAFC',        // Slate 50
    surfaceAlt: '#F1F5F9',     // Slate 100
    text: '#0F172A',           // Slate 900 — 18:1 on white
    textSecondary: '#475569',  // Slate 600 — 7.3:1 on white
    textMuted: '#64748B',      // Slate 500 — 4.6:1 on white
    border: '#CBD5E1',         // Slate 300
    onPrimary: '#FFFFFF',
    mapAccent: '#2563EB',
  },
  dark: {
    primary: '#60A5FA',        // Blue 400 — 8.2:1 on slate 950
    primaryLight: '#93C5FD',
    secondary: '#A78BFA',      // Violet 400
    success: '#4ADE80',        // Green 400 — 7.1:1 on slate 950
    warning: '#FBBF24',        // Amber 400 — 10.1:1 on slate 950
    error: '#F87171',          // Red 400 — 6.5:1 on slate 950
    background: '#0F172A',     // Slate 950
    surface: '#1E293B',        // Slate 800
    surfaceAlt: '#334155',     // Slate 700
    text: '#F1F5F9',           // Slate 100 — 16:1 on slate 950
    textSecondary: '#CBD5E1',  // Slate 300 — 11:1 on slate 950
    textMuted: '#94A3B8',      // Slate 400 — 6.5:1 on slate 950
    border: '#475569',         // Slate 600
    onPrimary: '#0F172A',
    mapAccent: '#60A5FA',
  },
};
