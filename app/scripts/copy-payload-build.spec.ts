import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from 'vite'
import { copierPayloadEnBuild } from './copy-payload-build'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function temporaryRoot() {
  const parent = 'E:/Temp/opencode/619-build-hygiene-20261026'
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(path.join(parent, 'test-'))
  dirs.push(root)
  return root
}

async function closeBuild(plugin: ReturnType<typeof copierPayloadEnBuild>, root: string, outDir: string) {
  plugin.configResolved?.({ root, command: 'build', build: { outDir } } as never)
  await plugin.closeBundle?.call({} as never)
}

describe('build payload copy', () => {
  it.each(['relative', 'absolute'])('copies payload into the resolved %s build output', async (kind) => {
    const root = temporaryRoot()
    const source = path.join(root, 'public', 'data')
    const outDir = kind === 'relative' ? 'release/relative' : path.join(root, 'absolute-output')
    const output = path.resolve(root, outDir)
    mkdirSync(source, { recursive: true })
    mkdirSync(path.dirname(output), { recursive: true })
    writeFileSync(path.join(source, 'payload.json'), '{"ok":true}')
    const plugin = copierPayloadEnBuild(source)
    expect(plugin.apply).toBe('build')
    await closeBuild(plugin, root, outDir)
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await closeBuild(copierPayloadEnBuild(path.join(root, 'missing')), root, 'out')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('payload introuvable'))
    expect(readdirSync(output)).toEqual([])
    warn.mockRestore()
  })
})
