import type { Theme } from '@/payload/types'

export interface IndicateurThemeStyle {
  [property: `--${string}`]: string
  '--indicateur-accent': string
  '--indicateur-strong': string
  '--indicateur-soft': string
  '--indicateur-line': string
  '--indicateur-wash': string
}

export const themeStyle = (theme: Theme): IndicateurThemeStyle => ({
  '--indicateur-accent': `var(--theme-${theme})`,
  '--indicateur-strong': `var(--theme-${theme}-strong)`,
  '--indicateur-soft': `var(--theme-${theme}-soft)`,
  '--indicateur-line': `var(--theme-${theme}-line)`,
  '--indicateur-wash': `var(--theme-${theme}-wash)`,
})
