/**
 * Design tokens (BUILD_PROMPT 10.4): calm and dense, system font stack, WCAG AA contrast. Status is always an icon
 * plus a word plus a color. `contrast` is the WCAG 2 contrast ratio, checked by the accessibility test.
 */
export declare const colors: {
  readonly bg: '#ffffff';
  readonly surface: '#f6f8fa';
  readonly text: '#1f2328';
  readonly muted: '#59636e';
  readonly border: '#d1d9e0';
  readonly accent: '#0969da';
  readonly focus: '#0969da';
  readonly ok: '#1a7f37';
  readonly warn: '#9a6700';
  readonly bad: '#cf222e';
  readonly neutral: '#59636e';
};
export type Status = 'done' | 'problem' | 'uncertain' | 'running' | 'failed';
export declare const STATUS: Record<
  Status,
  {
    icon: string;
    word: string;
    color: keyof typeof colors;
  }
>;
export declare function contrast(a: string, b: string): number;
export declare const css: string;
//# sourceMappingURL=theme.d.ts.map
