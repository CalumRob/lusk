import { describe, expect, it, vi } from 'vitest'
import { ThemeAcquisitionCache } from '../payload/themeAcquisition'

describe('theme acquisition cache', () => {
  it('loads only requested themes and caches by territory, theme, and comparison context', async () => {
    const acquire = vi.fn(async (theme: string) => ({ theme, focal: 42 }))
    const cache = new ThemeAcquisitionCache(acquire)
    await cache.get('commune', '22001', 'programmes')
    await cache.get('commune', '22001', 'programmes')
    await cache.get('commune', '22001', 'habitat')
    await cache.get('epci', '22001', 'programmes')
    expect(acquire.mock.calls.map(([theme]) => theme)).toEqual(['programmes', 'habitat', 'programmes'])
  })

  it('merges a comparison-only response while retaining focal facts and distinguishing empty from default', async () => {
    const facts = vi.fn(async () => ({ tokens: { content_version: 'v1' }, focal: { value: 17 } }))
    const comparison = vi.fn(async (selection: readonly string[] | undefined) => ({
      tokens: { content_version: 'v1' }, selection: selection ?? 'default', values: [selection?.length ?? 99],
    }))
    const cache = new ThemeAcquisitionCache(facts, comparison)
    const initial = await cache.get('commune', '22001', 'habitat')
    const empty = await cache.select('commune', '22001', 'habitat', [])
    expect(empty.focal).toEqual(initial.focal)
    expect(empty.comparison?.selection).toEqual([])
    await cache.select('commune', '22001', 'habitat', undefined)
    expect(facts).toHaveBeenCalledTimes(1)
    expect(comparison.mock.calls.map(([selection]) => selection)).toEqual([[], undefined])
  })

  it('fails closed on token mismatch and allows retry', async () => {
    const comparison = vi.fn().mockResolvedValueOnce({ tokens: { content_version: 'stale' } })
      .mockResolvedValueOnce({ tokens: { content_version: 'v1' }, results: [] })
    const cache = new ThemeAcquisitionCache(async () => ({ tokens: { content_version: 'v1' }, focal: 1 }), comparison)
    await cache.get('commune', '22001', 'milieux')
    await expect(cache.select('commune', '22001', 'milieux', [])).rejects.toThrow(/publication/i)
    expect((await cache.select('commune', '22001', 'milieux', [])).focal.focal).toBe(1)
  })
})
