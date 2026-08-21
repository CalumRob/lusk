import { describe, expect, it } from 'vitest'
import { themeStyle } from '../indicateurs/themeTokens'

describe('identité colorée de la page indicateur', () => {
  it.each(['demographie', 'mobilite', 'habitat', 'economie', 'milieux'] as const)('mappe %s vers ses tokens canoniques', (theme) => {
    const style = themeStyle(theme)
    expect(style['--indicateur-accent']).toBe(`var(--theme-${theme})`)
    expect(style['--indicateur-strong']).toBe(`var(--theme-${theme}-strong)`)
    expect(style['--indicateur-wash']).toBe(`var(--theme-${theme}-wash)`)
  })
})
