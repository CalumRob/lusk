// @vitest-environment node
// #903 — permanent retirement of the committed apercu.json artifact (both
// tracked copies: public/data/apercu.json and app/dist/data/apercu.json).
// This spec is the deletion contract: the JSON must be gone from BOTH trees
// (the build copies public → dist, so a source-only deletion would be
// recreated by the next build), a normal build copy must not recreate it
// while still copying the retained payloads — including the canonical
// apercu.parquet — and no app source may read the committed JSON from disk
// anymore. The R-side producer contract (in-memory `apercu` table +
// apercu.parquet, written only when non-empty, #116) is untouched:
// pipeline/R/publish.R keeps its apercu.parquet write and has no apercu.json
// write path. The synthetic stale-response coverage in payload-loader.spec.ts
// (an old deployment may still serve the name) stays, without requiring any
// committed relic.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

describe('artefact apercu.json retiré des deux arbres suivis (#903)', () => {
  it('ne laisse aucune trace sur le disque ni dans l’index git', () => {
    expect(existsSync(path.join(repoRoot, 'public', 'data', 'apercu.json'))).toBe(false)
    expect(existsSync(path.join(appRoot, 'dist', 'data', 'apercu.json'))).toBe(false)
    expect(gitLsFiles('public/data/apercu.json', 'app/dist/data/apercu.json')).toEqual([])
  })

  it('une copie build normale depuis public/data ne recrée pas apercu.json, et recopie le parquet canonique + les entrées actives', async () => {
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
    // l'artefact JSON retiré n'est PAS recopié (la source public/ ne le porte plus)
    expect(existsSync(path.join(copied, 'apercu.json'))).toBe(false)
    // les entrées actives restent copiées — dont le parquet canonique protégé
    expect(existsSync(path.join(copied, 'apercu.parquet'))).toBe(true)
    expect(existsSync(path.join(copied, 'territoires.json'))).toBe(true)
    expect(existsSync(path.join(copied, 'theme_mobilite.json'))).toBe(true)
    expect(existsSync(path.join(copied, 'vintages.json'))).toBe(true)
    expect(existsSync(path.join(copied, 'run-report.json'))).toBe(true)
  })
})

describe('contrat producteur R intact (#903) : parquet canonique conservé, aucun chemin d’écriture JSON', () => {
  it('publish.R écrit apercu.parquet sous la règle non-vide et n’a aucun chemin vers apercu.json', () => {
    const publish = readFileSync(path.join(repoRoot, 'pipeline', 'R', 'publish.R'), 'utf8')
    expect(publish).toMatch(/file\.path\(cible, "apercu\.parquet"\)/)
    expect(publish).not.toMatch(/file\.path\([^)]*"apercu\.json"\)/)
  })
})

describe('aucun lecteur d’artefact commité dans les sources app (#903)', () => {
  it('ne lit jamais le apercu.json commité depuis le disque', () => {
    const sources = spawnSync(
      'git',
      ['grep', '-l', 'apercu\\.json', '--', 'app/src', 'app/scripts', 'app/vite.config.ts'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    // Remaining mentions are no-request assertions and history comments only:
    // nothing may read the committed file from the retired path.
    const mentions = sources.stdout.split('\n').filter(Boolean)
      // This spec is the deletion contract itself: it names the retired paths.
      .filter((file) => file !== 'app/src/__tests__/apercu-artifact-retired.spec.ts')
    expect(mentions.length).toBeGreaterThan(0) // the retirement stays documented
    for (const file of mentions) {
      const content = readFileSync(path.join(repoRoot, file), 'utf8')
      expect(/readFile(Sync)?\([^)]*apercu\.json/s.test(content), file).toBe(false)
      expect(content.includes('public/data/apercu.json'), file).toBe(false)
    }
  })

  it('conserve la couverture « relique périmée servie, jamais demandée » de payload-loader.spec.ts (#894/#903)', () => {
    const loaderSpec = readFileSync(
      path.join(appRoot, 'src', '__tests__', 'payload-loader.spec.ts'), 'utf8',
    )
    expect(loaderSpec).toMatch(/'apercu\.json':/)
    expect(loaderSpec).toMatch(/not\.toContain\('data\/apercu\.json'\)/)
  })
})
