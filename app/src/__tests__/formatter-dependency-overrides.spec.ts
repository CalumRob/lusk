import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRequire = createRequire(import.meta.url)
const formatterRequire = createRequire(appRequire.resolve('js-beautify'))

describe('formatter dependency overrides', () => {
  it('keeps js-beautify glob and editorconfig matching APIs working', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'lusk-formatter-contract-'))

    try {
      writeFileSync(join(fixture, '.editorconfig'), 'root = true\n\n[*.ts]\nindent_style = tab\n')
      writeFileSync(join(fixture, 'contract.ts'), 'const value = 1\n')

      const glob = formatterRequire('glob') as {
        globSync: (pattern: string, options: { cwd: string }) => string[]
        hasMagic: (pattern: string) => boolean
      }
      const editorconfig = formatterRequire('editorconfig') as {
        parseSync: (filePath: string) => { indent_style?: string }
      }

      expect(glob.hasMagic('*.ts')).toBe(true)
      expect(glob.globSync('*.ts', { cwd: fixture })).toEqual(['contract.ts'])
      expect(editorconfig.parseSync(join(fixture, 'contract.ts')).indent_style).toBe('tab')
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
