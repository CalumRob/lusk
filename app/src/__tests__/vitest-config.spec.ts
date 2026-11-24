import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import viteConfigSource from '../../vitest.config.ts?raw'

const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

describe('Vitest configuration', () => {
  it('keeps one happy-dom project with the framework default exclusions', () => {
    expect(viteConfigSource).not.toMatch(/\bprojects\s*:/)
    expect(viteConfigSource).toContain("environment: 'happy-dom'")
    expect(viteConfigSource).toContain("include: ['src/**/*.spec.ts']")
    expect(viteConfigSource).toContain("exclude: [...configDefaults.exclude, '**/*.browser.spec.ts']")
    expect(viteConfigSource).toContain("setupFiles: ['src/__tests__/setup.ts']")
    expect(viteConfigSource).toContain('css: { include: [/tokens\\.css/] }')
  })

  it('makes npm test the only automated Vitest suite and exposes the browser acceptance script', () => {
    expect(packageJson.scripts.test).toBe('vitest run')
    expect(packageJson.scripts).not.toHaveProperty('test:browser')
    expect(packageJson.scripts['verify:cahier-pdf-browser']).toBe('node scripts/verify-cahier-pdf-browser.mjs')
  })
})
