import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('preserves EditorConfig path escaping and dotfile matches', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'lusk-editorconfig-path-'))

    try {
      const specialPath = join(fixture, 'literal [brackets] !(group) {value}#')
      mkdirSync(specialPath)
      writeFileSync(join(specialPath, '.editorconfig'), 'root = true\n[*.ts]\nindent_style = tab\n')
      const editorconfig = formatterRequire('editorconfig') as {
        parse: (filePath: string) => Promise<Record<string, unknown>>
        parseSync: (filePath: string) => Record<string, unknown>
      }

      for (const name of ['sample.ts', '.hidden.ts']) {
        const filePath = join(specialPath, name)
        writeFileSync(filePath, '')
        const expected = { indent_style: 'tab', indent_size: 'tab' }
        expect(editorconfig.parseSync(filePath)).toEqual(expected)
        await expect(editorconfig.parse(filePath)).resolves.toEqual(expected)
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('preserves nested precedence, root boundaries, brace patterns, and extglob policy', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'lusk-editorconfig-sections-'))

    try {
      const editorconfig = formatterRequire('editorconfig') as {
        parse: (filePath: string) => Promise<Record<string, unknown>>
        parseSync: (filePath: string) => Record<string, unknown>
      }
      const nested = join(fixture, 'nested')
      const child = join(nested, 'child')
      mkdirSync(child, { recursive: true })
      writeFileSync(join(nested, '.editorconfig'), 'root = true\n[*.ts]\nindent_size = 2\ninsert_final_newline = true\n')
      writeFileSync(join(child, '.editorconfig'), '[*.ts]\nindent_size = 4\nend_of_line = unset\n')
      const nestedFile = join(child, 'file.ts')
      writeFileSync(nestedFile, '')
      const nestedExpected = {
        indent_size: 4,
        insert_final_newline: true,
        end_of_line: 'unset',
        tab_width: 4,
      }
      expect(editorconfig.parseSync(nestedFile)).toEqual(nestedExpected)
      await expect(editorconfig.parse(nestedFile)).resolves.toEqual(nestedExpected)

      const rooted = join(nested, 'rooted')
      mkdirSync(rooted)
      writeFileSync(join(rooted, '.editorconfig'), 'root = true\n[*.ts]\nindent_size = 8\n')
      const rootedFile = join(rooted, 'only.ts')
      writeFileSync(rootedFile, '')
      const rootedExpected = { indent_size: 8, tab_width: 8 }
      expect(editorconfig.parseSync(rootedFile)).toEqual(rootedExpected)
      await expect(editorconfig.parse(rootedFile)).resolves.toEqual(rootedExpected)

      const brace = join(fixture, 'brace')
      const source = join(brace, 'src')
      mkdirSync(source, { recursive: true })
      writeFileSync(
        join(brace, '.editorconfig'),
        'root = true\n[**/{src,test}/[ab].ts]\nindent_size = 5\n[**/!(ignored).ts]\ntab_width = 7\n',
      )
      for (const name of ['a.ts', 'b.ts']) {
        const filePath = join(source, name)
        writeFileSync(filePath, '')
        const expected = { indent_size: 5, tab_width: 5 }
        expect(editorconfig.parseSync(filePath)).toEqual(expected)
        await expect(editorconfig.parse(filePath)).resolves.toEqual(expected)
      }
      for (const name of ['c.ts', '.a.ts', 'ignored.ts']) {
        const filePath = join(source, name)
        writeFileSync(filePath, '')
        expect(editorconfig.parseSync(filePath)).toEqual({})
        await expect(editorconfig.parse(filePath)).resolves.toEqual({})
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
