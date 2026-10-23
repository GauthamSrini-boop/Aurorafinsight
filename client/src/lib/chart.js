/** Round an axis maximum up to a "nice" number (1, 2, 2.5, 5 × 10^n). */
export function niceMax(value) {
  if (!(value > 0)) return 100;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const f = value / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

export const ticks = (max, count = 4) => Array.from({ length: count + 1 }, (_, i) => (max * i) / count);

/** Donut segments as stroke-dasharray values on a circle of the given radius. */
export function donutSegments(items, radius) {
  const total = items.reduce((a, i) => a + i.value, 0);
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return items.filter((i) => i.value > 0).map((item) => {
    const length = total > 0 ? (item.value / total) * circumference : 0;
    const seg = { ...item, length, offset, circumference, share: total > 0 ? item.value / total : 0 };
    offset += length;
    return seg;
  });
}

/** Build a smooth-enough polyline path through points ({x,y}). */
export const linePath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
