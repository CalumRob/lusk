/**
 * Vitest seam: the `@/fiche/prototype/cahierPdfComposer` alias resolves here so
 * every spec that generates a Cahier PDF exercises the same production path as
 * the app — `composerCahierPdf` -> native Vue mount -> DOM paint. Everything
 * else (grammar, tables, fonts, generator factory) is re-exported unchanged.
 */
export * from '../../fiche/prototype/cahierPdfComposer'
export { composerCahierPdfNativedansNavigateur as composerCahierPdf } from './cahierPdfNativeRuntime'
