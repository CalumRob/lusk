// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from 'vite'
import { build } from 'vite'
import { copierPayloadEnBuild } from '../../scripts/copy-payload-build'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function temporaryRoot() {
  const parent = path.join(os.tmpdir(), 'lusk-build-test')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(path.join(parent, 'test-'))
  dirs.push(root)
  return root
}

async function runBuild(root: string, payload: string, outDir: string) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'info',
    plugins: [copierPayloadEnBuild(payload)],
    build: { outDir, emptyOutDir: false },
  })
}

describe('build payload copy', () => {
  it.each(['relative', 'absolute'])('copies payload into the resolved %s build output', async (kind) => {
    const root = temporaryRoot()
    const source = path.join(root, 'public', 'data')
    const outDir = kind === 'relative' ? 'release/relative' : path.join(root, 'absolute-output')
    const output = path.resolve(root, outDir)
    mkdirSync(source, { recursive: true })
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><script type="module" src="/entry.js"></script></html>')
    writeFileSync(path.join(root, 'entry.js'), 'document.body.textContent = "built"')
    writeFileSync(path.join(source, 'payload.json'), '{"ok":true}')
    await runBuild(root, source, outDir)
    expect(readFileSync(path.join(output, 'data', 'payload.json'), 'utf8')).toBe('{"ok":true}')
  })

  it('Vite excludes the copy plugin from serve/test config and retains it for production build', async () => {
    const configFile = path.resolve('vite.config.ts')
    for (const command of ['serve', 'build'] as const) {
      const config = await resolveConfig({ configFile }, command)
      const copier = config.plugins.find(({ name }) => name === 'copier-payload-build')
      expect(Boolean(copier)).toBe(command === 'build')
    }
  })

  it('warns and leaves output alone when payload is missing', async () => {
    const root = temporaryRoot()
    const output = path.join(root, 'out')
    mkdirSync(output)
    writeFileSync(path.join(output, 'preserve.txt'), 'keep')
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><html></html>')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runBuild(root, path.join(root, 'missing'), 'out')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('payload introuvable'))
    expect(readFileSync(path.join(output, 'preserve.txt'), 'utf8')).toBe('keep')
    expect(readdirSync(output)).not.toContain('data')
  })
})
