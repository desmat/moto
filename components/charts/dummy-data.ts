// Deterministic pseudo-random generator for the dashboard's placeholder chart data --
// seeded (rather than Math.random()) so the charts render the same values on every
// mount/re-render and tests see stable output. Replace with real report data when the
// reporting machinery gets built out.
export function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;

  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
