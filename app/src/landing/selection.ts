/**
 * The landing's "Sélection aléatoire" (layouts.md §1 — EXEMPLES): pick a few
 * territoires from the reference table as the example cards. Pure function,
 * tested in isolation (__tests__/landing-selection.spec.ts).
 *
 * `alea` is injected so tests lock the contract with a fixed RNG — the app
 * passes Math.random. The selection is drawn without replacement: the same
 * territoire never appears twice in the examples.
 */

/**
 * Pick up to `nombre` distinct territoires from the reference table, in
 * random order. When the table has fewer entries, everything is returned
 * (the examples never invent a territory). The injected `alea` (a PRNG in
 * [0,1)) makes the draw deterministic in tests and stable under a fixed seed.
 */
export function selectionAleatoire<T>(
  elements: readonly T[],
  nombre: number,
  alea: () => number = Math.random,
): T[] {
  const restants = [...elements]
  const selection: T[] = []

  while (selection.length < nombre && restants.length > 0) {
    const index = Math.floor(alea() * restants.length)
    selection.push(restants.splice(index, 1)[0])
  }

  return selection
}
