export type ThemeKey = 'programmes' | 'demographie' | 'habitat' | 'economie' | 'milieux' | 'mobilite'

export interface ThemeResponse {
  tokens: Record<string, unknown>
  [key: string]: unknown
}

export interface AcquiredTheme<T extends ThemeResponse = ThemeResponse> {
  focal: T
  comparison?: ThemeResponse
}

type Key = { type: string; id: string; theme: ThemeKey }

/** Lazy per-theme cache. A comparison is independently acquired and can never replace focal facts. */
export class ThemeAcquisitionCache<T extends ThemeResponse = ThemeResponse> {
  private readonly entries = new Map<string, AcquiredTheme<T>>()
  private readonly generations = new Map<string, number>()

  constructor(
    private readonly acquireFacts: (theme: ThemeKey, key?: Key) => Promise<T>,
    private readonly acquireComparison?: (selection: readonly string[] | undefined, theme: ThemeKey, key?: Key) => Promise<ThemeResponse>,
  ) {}

  private key({ type, id, theme }: Key): string { return JSON.stringify([type, id, theme]) }

  async get(type: string, id: string, theme: ThemeKey): Promise<AcquiredTheme<T>> {
    const key = { type, id, theme }
    const cacheKey = this.key(key)
    const cached = this.entries.get(cacheKey)
    if (cached) return cached
    const generation = this.generations.get(cacheKey) ?? 0
    const focal = await this.acquireFacts(theme, key)
    if (generation !== (this.generations.get(cacheKey) ?? 0)) throw new Error('Stale theme acquisition response')
    const result = { focal }
    this.entries.set(cacheKey, result)
    return result
  }

  async select(type: string, id: string, theme: ThemeKey, selection: readonly string[] | undefined): Promise<AcquiredTheme<T>> {
    const key = { type, id, theme }
    const cacheKey = this.key(key)
    const focal = await this.get(type, id, theme)
    if (!this.acquireComparison) return focal
    const generation = (this.generations.get(cacheKey) ?? 0) + 1
    this.generations.set(cacheKey, generation)
    const comparison = await this.acquireComparison(selection, theme, key)
    if (generation !== this.generations.get(cacheKey)) throw new Error('Stale theme comparison response')
    if (JSON.stringify(comparison.tokens) !== JSON.stringify(focal.focal.tokens)) {
      throw new Error('Theme publication tokens do not match; retry comparison')
    }
    const result = { focal: focal.focal, comparison }
    this.entries.set(cacheKey, result)
    return result
  }

  invalidate(type: string, id: string, theme?: ThemeKey): void {
    for (const key of [...this.entries.keys()]) {
      const identity = JSON.parse(key) as [string, string, ThemeKey]
      if (identity[0] === type && identity[1] === id && (!theme || identity[2] === theme)) this.entries.delete(key)
    }
    const themes: ThemeKey[] = theme ? [theme] : ['programmes', 'demographie', 'habitat', 'economie', 'milieux', 'mobilite']
    for (const selectedTheme of themes) {
      const key = this.key({ type, id, theme: selectedTheme })
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
    }
  }
}

export function themeAcquisitionEnabled(env: Record<string, unknown>): boolean {
  return env.VITE_THEME_ACQUISITION_API === '1'
}
