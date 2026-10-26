import { cpSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

export function copierPayloadEnBuild(racinePayload: string): Plugin {
  let sortie: string
  return {
    name: 'copier-payload-build',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      sortie = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const cibleData = path.resolve(sortie, 'data')
      if (!existsSync(racinePayload)) {
        console.warn(`[copier-payload-build] payload introuvable — rien à copier dans ${cibleData}`)
        return
      }
      cpSync(racinePayload, cibleData, { recursive: true })
      console.log(`[copier-payload-build] payload copié dans ${cibleData}`)
    },
  }
}
