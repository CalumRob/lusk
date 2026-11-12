import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import * as fixture from './helpers/mobileCahierBrowserFixture'

/**
 * No-browser wiring contract for the retained mobile-overflow verifier
 * (#627 correction). The verifier mounts its synthetic browser figures
 * through the REAL helper module at runtime (`page.evaluate` imports
 * `src/__tests__/helpers/mobileCahierBrowserFixture.ts`). The accessibility
 * retirement removed three mounts from that helper (the BPE profile
 * long-y-axis figure, the legacy building-quantile ramp and the bivariate
 * grid); the script must reference only fixture members the helper actually
 * exports. This spec reads the actual script source and reflects the actual
 * helper exports — no mock, no separate registry.
 */
const script = readFileSync(join(process.cwd(), 'scripts', 'verify-mobile-cahier-overflow.mjs'), 'utf8')
const helperExports = fixture as unknown as Record<string, unknown>

/** Every `fixture.member` reference in the verifier's page.evaluate blocks. */
function referencedFixtureMembers(source: string): string[] {
  return [...source.matchAll(/fixture\.([A-Za-z0-9_]+)/g)].map((match) => match[1]!)
}

describe('verify-mobile-cahier-overflow — fixture wiring (no browser)', () => {
  it('references only fixture members the real helper exports (#627)', () => {
    const referenced = referencedFixtureMembers(script)
    expect(referenced.length).toBeGreaterThan(0)
    const dangling = referenced.filter((name) => typeof helperExports[name] !== 'function')
    expect(dangling, 'dangling fixture references would throw at verifier execution').toEqual([])
  })

  it('no longer references the retirement-removed mounts (#627)', () => {
    const referenced = referencedFixtureMembers(script)
    for (const retired of ['mountLongYAxisFigure', 'mountAccessRampRampFigure', 'mountBivariateDistributionFigure',
      'mountCahierOffreTransportsFigure']) {
      expect(referenced, `${retired} was removed from the helper with the accessibility surface`)
        .not.toContain(retired)
    }
  })

  it('keeps the retained figure checks and invariants wired', () => {
    const referenced = new Set(referencedFixtureMembers(script))
    // Retained mounts and the shared audit stay referenced and exported.
    for (const retained of ['mountPlainCahier', 'mountAccessRampLongYAxisFigure',
      'mountSandboxGroupedBarFigure', 'mountCahierMobiliteRaccordementCurve', 'auditYAxisTitleTickOverlap']) {
      expect(referenced.has(retained), `${retained} must stay referenced by the verifier`).toBe(true)
      expect(typeof helperExports[retained], `${retained} must stay exported by the helper`).toBe('function')
    }
    // The eight-viewport loop and the fail-closed API route wiring stay.
    expect(script).toContain('[320, 360, 390, 601, 760, 761, 1440, 1800]')
    expect(script).toContain('installApiRoutes')
    expect(script).toContain('makeApiHandlers')
  })
})
