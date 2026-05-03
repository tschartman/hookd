// ─── Global Session Artist Store ─────────────────────────────────────────────
// Tracks artist names seen across ALL feeds in the current app session.
// Module-level (not Zustand) — no reactive subscriptions needed, just a
// shared mutable Set that every feed reads and writes.
//
// Usage:
//   isArtistSeenGlobally(name)          — before serving an artist
//   markArtistsSeenGlobally(names)      — after deciding to show an artist
//   resetGlobalSession()                — on app cold-start / logout

const _seenArtists = new Set<string>();

export function isArtistSeenGlobally(name: string): boolean {
  return _seenArtists.has(name.toLowerCase().trim());
}

export function markArtistsSeenGlobally(names: string[]): void {
  for (const n of names) {
    const key = n.toLowerCase().trim();
    if (key) _seenArtists.add(key);
  }
}

export function resetGlobalSession(): void {
  _seenArtists.clear();
}
