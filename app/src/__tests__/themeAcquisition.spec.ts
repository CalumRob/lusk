import { describe, expect, it, vi } from 'vitest'
import { acquireThemeComparison, acquireThemeFacts, ThemeAcquisitionCache, themeAcquisitionEnabled } from '../payload/themeAcquisition'
import type { ThemeSelectionMember } from '../payload/themeAcquisition'

describe('theme acquisition cache', () => {
  it('defaults the migrated path ON — the incumbent path is the explicit opt-out', () => {
    // Le chemin migré est le DÉFAUT du produit ; l'incumbent statique ne
    // survit que comme opt-out explicite (VITE_THEME_ACQUISITION_API='0').
    expect(themeAcquisitionEnabled({})).toBe(true)
    expect(themeAcquisitionEnabled({ VITE_THEME_ACQUISITION_API: '1' })).toBe(true)
    expect(themeAcquisitionEnabled({ VITE_THEME_ACQUISITION_API: '0' })).toBe(false)
  })
  it('posts typed selections and preserves omitted versus explicitly empty selection', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ theme_id: 'habitat', complete_theme: false }) }))
    vi.stubGlobal('fetch', fetcher)
    try {
      await acquireThemeFacts('commune', '22001', 'habitat')
      await acquireThemeComparison('commune', '22001', 'habitat', [])
      await acquireThemeComparison('commune', '22001', 'habitat', [
        { territory_type: 'epci', territory_id: '200000001' },
        { territory_type: 'commune', territory_id: '22001' },
      ])
      expect(fetcher.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([
        ['/api/territories/commune/22001/themes/habitat/facts', { theme_id: 'habitat' }],
        ['/api/territories/commune/22001/themes/habitat/comparison', { theme_id: 'habitat', selection: [] }],
        ['/api/territories/commune/22001/themes/habitat/comparison', { theme_id: 'habitat', selection: [
          { territory_type: 'epci', territory_id: '200000001' }, { territory_type: 'commune', territory_id: '22001' },
        ] }],
      ])
    } finally { vi.unstubAllGlobals() }
  })
  it('loads only requested themes and caches by territory, theme, and comparison context', async () => {
    const acquire = vi.fn(async (theme: string) => ({ theme, focal: 42, tokens: {} }))
    const cache = new ThemeAcquisitionCache(acquire)
    await cache.get('commune', '22001', 'programmes')
    await cache.get('commune', '22001', 'programmes')
    await cache.get('commune', '22001', 'habitat')
    await cache.get('epci', '22001', 'programmes')
    expect(acquire.mock.calls.map(([theme]) => theme)).toEqual(['programmes', 'habitat', 'programmes'])
  })

  it('merges a comparison-only response while retaining focal facts and distinguishing empty from default', async () => {
    const facts = vi.fn(async () => ({ content_version: 'v1', reference_content_version: 'r1', focal: { value: 17 } }))
    const comparison = vi.fn(async (selection: readonly ThemeSelectionMember[] | undefined) => ({
      content_version: 'v1', reference_content_version: 'r1', selection: selection ?? 'default', values: [selection?.length ?? 99],
    }))
    const cache = new ThemeAcquisitionCache(facts, comparison)
    const initial = await cache.get('commune', '22001', 'habitat')
    const empty = await cache.select('commune', '22001', 'habitat', [])
    expect(empty.focal).toEqual(initial.focal)
    expect(empty.comparisons.get('[]')?.selection).toEqual([])
    await cache.select('commune', '22001', 'habitat', undefined)
    await cache.select('commune', '22001', 'habitat', [])
    expect(facts).toHaveBeenCalledTimes(1)
    expect(comparison.mock.calls.map(([selection]) => selection)).toEqual([[], undefined])
  })

  it('fails closed on token mismatch and allows retry', async () => {
    const comparison = vi.fn().mockResolvedValueOnce({ reference_content_version: 'stale', content_version: 'v1' })
      .mockResolvedValueOnce({ reference_content_version: 'r1', content_version: 'v1', results: [] })
    const cache = new ThemeAcquisitionCache(async () => ({ reference_content_version: 'r1', content_version: 'v1', focal: 1 }), comparison)
    await cache.get('commune', '22001', 'milieux')
    await expect(cache.select('commune', '22001', 'milieux', [])).rejects.toThrow(/publication/i)
    expect((await cache.select('commune', '22001', 'milieux', [])).focal.focal).toBe(1)
  })
})
