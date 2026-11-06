import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { THEMES_CONSTRUITS } from '../../methodes/indicateurs'
import type { ThemeConstruit } from '../../methodes/indicateurs'

/** Producer-owned contracts read directly from the shipped theme metadata. */
export const PRODUCER_THEME_METADATA = Object.fromEntries(THEMES_CONSTRUITS.map((theme) => [theme,
  JSON.parse(readFileSync(resolve(process.cwd(), '../pipeline/inst/extdata/theme-metadata',
    `theme_${theme}.json`), 'utf8')),
])) as Record<ThemeConstruit, Record<string, any>>
