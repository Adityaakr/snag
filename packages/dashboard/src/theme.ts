/**
 * Design tokens (BUILD_PROMPT 10.4): calm and dense, system font stack, WCAG AA contrast. Status is always an icon
 * plus a word plus a color. `contrast` is the WCAG 2 contrast ratio, checked by the accessibility test.
 */
export const colors = {
  bg: '#ffffff',
  surface: '#f6f8fa',
  text: '#1f2328',
  muted: '#59636e',
  border: '#d1d9e0',
  accent: '#0969da',
  focus: '#0969da',
  ok: '#1a7f37',
  warn: '#9a6700',
  bad: '#cf222e',
  neutral: '#59636e',
} as const;

export type Status = 'done' | 'problem' | 'uncertain' | 'running' | 'failed';

export const STATUS: Record<Status, { icon: string; word: string; color: keyof typeof colors }> = {
  done: { icon: '✓', word: 'Done', color: 'ok' },
  problem: { icon: '!', word: 'Needs work', color: 'bad' },
  uncertain: { icon: '?', word: 'Uncertain', color: 'warn' },
  running: { icon: '…', word: 'Running', color: 'neutral' },
  failed: { icon: '×', word: 'Failed', color: 'bad' },
};

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const css = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: ${colors.text}; background: ${colors.bg}; }
a { color: ${colors.accent}; }
:focus-visible { outline: 3px solid ${colors.focus}; outline-offset: 2px; }
header { display: flex; gap: 1rem; align-items: center; padding: .5rem 1rem; border-bottom: 1px solid ${colors.border}; background: ${colors.surface}; }
header nav { display: flex; gap: .75rem; flex-wrap: wrap; }
header nav a[aria-current="page"] { font-weight: 600; text-decoration: none; color: ${colors.text}; }
main { padding: 1rem; max-width: 1280px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid ${colors.border}; vertical-align: top; }
th { color: ${colors.muted}; font-weight: 600; }
.muted { color: ${colors.muted}; }
.num { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.filters { display: flex; gap: .75rem; flex-wrap: wrap; align-items: end; margin-bottom: 1rem; }
label { display: flex; flex-direction: column; gap: .2rem; font-size: 12px; color: ${colors.muted}; }
input, select, button { font: inherit; padding: .3rem .5rem; border: 1px solid ${colors.border}; border-radius: 6px; background: ${colors.bg}; color: ${colors.text}; }
button { cursor: pointer; }
.status { display: inline-flex; gap: .3rem; align-items: center; font-weight: 600; }
.card { border: 1px solid ${colors.border}; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
pre { background: ${colors.surface}; padding: .75rem; overflow: auto; }
@media (max-width: 900px) { main { padding: .5rem; } }
`;
