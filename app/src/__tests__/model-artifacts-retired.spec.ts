// @vitest-environment node
// #900 — permanent retirement of the committed read-model artifacts
// (`modeles-lecture/**`) and their artifact-only tooling. This spec is the
// deletion contract: the tracked trees must be gone from BOTH `public/data`
// and `app/dist/data` (the build copies public → dist, so a source-only
// deletion would be recreated by the next build), the artifact-only modules,
// CLI/parity helpers and package script must be gone, and the shared
// comparison types must live in the fiche layer — not in a deleted module.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { build } from 'vite'

import { copierPayloadEnBuild } from '../../scripts/copy-payload-build'

const appRoot = process.cwd()
const repoRoot = path.resolve(appRoot, '..')
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function gitLsFiles(...patterns: string[]): string[] {
  const result = spawnSync('git', ['ls-files', '--', ...patterns], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  expect(result.status).toBe(0)
  return result.stdout.split('\n').filter(Boolean)
}

describe('artefacts modeles-lecture retirés des deux arbres suivis (#900)', () => {
  it('ne laisse aucune trace sur le disque ni dans l’index git', () => {
    expect(existsSync(path.join(repoRoot, 'public', 'data', 'modeles-lecture'))).toBe(false)
    expect(existsSync(path.join(appRoot, 'dist', 'data', 'modeles-lecture'))).toBe(false)
    expect(gitLsFiles('public/data/modeles-lecture', 'app/dist/data/modeles-lecture')).toEqual([])
  })

  it('une copie build normale depuis public/data ne recrée pas modeles-lecture', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'lusk-retirement-'))
    dirs.push(root)
    const output = path.join(root, 'out')
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><html></html>')
    await build({
      configFile: false,
      root,
      publicDir: false,
      logLevel: 'silent',
      plugins: [copierPayloadEnBuild(path.join(repoRoot, 'public', 'data'))],
      build: { outDir: 'out', emptyOutDir: false },
    })
    const copied = path.join(output, 'data')
    expect(existsSync(copied)).toBe(true)
    expect(existsSync(path.join(copied, 'modeles-lecture'))).toBe(false)
    // The retained payloads (reference, theme metadata, clocks) are still copied.
    expect(existsSync(path.join(copied, 'territoires.json'))).toBe(true)
    expect(existsSync(path.join(copied, 'theme_mobilite.json'))).toBe(true)
    expect(existsSync(path.join(copied, 'vintages.json'))).toBe(true)
  })
})

describe('outillage artefact-only retiré (#900)', () => {
  it('supprime les modules, scripts CLI/parité et la commande package dédiés aux artefacts', () => {
    for (const rel of [
      'src/payload/territoryReadModel.ts',
      'src/payload/indicatorReadModel.ts',
      'scripts/validate-territory-model.mjs',
      'scripts/territory-model-dev.ts',
    ]) {
      expect(existsSync(path.join(appRoot, rel)), `${rel} doit être supprimé`).toBe(false)
    }
    expect(gitLsFiles(
      'app/src/payload/territoryReadModel.ts',
      'app/src/payload/indicatorReadModel.ts',
      'app/scripts/validate-territory-model.mjs',
      'app/scripts/territory-model-dev.ts',
    )).toEqual([])
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect('validate:territory-model' in pkg.scripts).toBe(false)
    expect('generate:territory-model' in pkg.scripts).toBe(false)
  })

  it('ne sert plus de cache header dédié à /data/modeles-lecture/ dans vercel.json', () => {
    const vercel = readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8')
    expect(vercel).not.toContain('modeles-lecture')
  })

  it('ne garde aucun lecteur d’artefact commité dans les sources app', () => {
    const sources = spawnSync(
      'git',
      ['grep', '-l', 'modeles-lecture', '--', 'app/src', 'app/scripts', 'app/vite.config.ts'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    // Only no-request assertions may keep the string (route specs, reference
    // comments); no spec or script may READ a committed file from the tree.
    const allowed = sources.stdout.split('\n').filter(Boolean)
    for (const file of allowed) {
      const content = readFileSync(path.join(repoRoot, file), 'utf8')
      expect(content.includes("readFileSync") && content.includes('modeles-lecture'), file).toBe(false)
      expect(content.includes('ssrLoadModule(\'/src/payload/territoryReadModel.ts\')'), file).toBe(false)
    }
  })
})

describe('types de comparaison partagés conservés dans la couche fiche (#900)', () => {
  it('définit les types de comparaison dans comparisonContext, sans module artefact', () => {
    const source = readFileSync(path.join(appRoot, 'src', 'fiche', 'comparisonContext.ts'), 'utf8')
    expect(source).not.toContain('territoryReadModel')
    expect(source).toMatch(/export type TerritoryComparisonMode\b/)
    expect(source).toMatch(/export interface TerritoryComparisonFact\b/)
    expect(source).toMatch(/export interface TerritoryComparisonContext\b/)
  })
})
