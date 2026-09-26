export function upper(text: string): string {
  return text.toUpperCase();
}

export function padLeft(text: string, width: number): string {
  return text.padStart(width, ' ');
}
