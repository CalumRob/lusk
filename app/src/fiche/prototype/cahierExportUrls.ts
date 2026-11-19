/**
 * Public URL owner for Cahier exports. The composer never derives public-facing
 * strings from `location` (which may be a test/preview host) or from a capture:
 * a PDF generated anywhere links to the canonical public site. Callers may pass
 * an explicit `urlAccueil`/`urlPublique` (the harness does) as a test-only
 * override; that never changes the production default.
 */
export const CAHIER_EXPORT_PUBLIC_URL = 'https://lusk.calumrobertson.fr/'
