/**
 * Generate `count` vibrant, evenly-spaced colors. Ported from the original
 * SciPaWiz `rainbow()` (HSV→RGB, Adam Cole, 2011) and cleaned up.
 */
export function rainbow(count: number, step: number): string {
  if (count <= 0) return '#888888';
  const h = step / count;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = 1;
      g = f;
      b = 0;
      break;
    case 1:
      r = q;
      g = 1;
      b = 0;
      break;
    case 2:
      r = 0;
      g = 1;
      b = f;
      break;
    case 3:
      r = 0;
      g = q;
      b = 1;
      break;
    case 4:
      r = f;
      g = 0;
      b = 1;
      break;
    case 5:
      r = 1;
      g = 0;
      b = q;
      break;
  }
  const hex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** A distinct color for each of `count` items (no hue wraparound collision). */
export function palette(count: number): string[] {
  return Array.from({ length: count }, (_, i) => rainbow(count, i));
}
