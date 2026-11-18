/**
 * Real-browser execution of the shared native Vue -> DOM-paint composer.
 *
 * happy-dom has no layout, so a browser's resolved boxes cannot exist there.
 * This helper drives one child Node process (cahierPdfNativeServer.mjs) that
 * keeps one headless Chromium and one in-memory Vite bundle of the production
 * seam. There is no second PDF template and no hand-built figure painter: the
 * Vue section layout is the only figure input. The synthetic 2x2 PNG used for
 * captured map geometry is TEST-ONLY, never a published map or an approval
 * artifact.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { CahierExportRequest } from '../../fiche/prototype/cahierExportCapture'
import type { CahierPdfArtifact } from '../../fiche/prototype/cahierPdfExportController'
import type { OptionsCompositionCahierPdf } from '../../fiche/prototype/cahierPdfComposer'

// Vitest rewrites import.meta.url to a /@fs/ URL; strip both that prefix and
// the leading slash before handing the path to Node's filesystem APIs.
const fromUrl = (url: string) => new URL(url, import.meta.url).pathname.replace(/^\/(?:@fs\/)?(?=[A-Za-z]:)/, '')
const SERVER = path.join(fromUrl('.'), 'cahierPdfNativeServer.mjs')
const CWD = path.resolve(fromUrl('../../../'), '..')

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

let child: ChildProcess | null = null
let starting: Promise<ChildProcess> | null = null
let seq = 0
const pending = new Map<number, Pending>()

class NativeComposerError extends Error {
  readonly code?: string
  readonly reason?: string
  readonly name: string
  constructor(shape: { name?: string; code?: string; reason?: string; message?: string; cause?: string }) {
    super(`${shape.message ?? 'native composer failure'}${shape.cause ? ` (cause: ${shape.cause})` : ''}`)
    this.name = shape.name ?? 'Error'
    this.code = shape.code ?? shape.reason
    this.reason = shape.reason
  }
}

async function start(): Promise<ChildProcess> {
  const nodeExecutable = process.execPath.replace(/^"|"$/g, '')
  const childProcess = spawn(nodeExecutable, [SERVER], { cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  childProcess.on('error', (error) => process.stderr.write(`[native-runtime] spawn error: ${error.message}\n`))
  let buffer = ''
  childProcess.stdout!.setEncoding('utf8')
  childProcess.stdout!.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line === 'ready') continue
      if (!line) continue
      const id = Number(line.slice(0, line.indexOf('|')))
      const body = line.slice(line.indexOf('|') + 1)
      const waiter = pending.get(id)
      if (!waiter) continue
      pending.delete(id)
      const result = JSON.parse(body) as { bytes?: number[]; fileName?: string; error?: { name?: string; code?: string; reason?: string; message?: string; cause?: string } }
      if (result.error) waiter.reject(new NativeComposerError(result.error))
      else waiter.resolve(result)
    }
  })
  let stderr = ''
  childProcess.stderr!.setEncoding('utf8')
  childProcess.stderr!.on('data', (chunk) => { stderr += chunk; process.stderr.write(String(chunk)) })
  childProcess.on('exit', (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`native PDF server exited (${code}): ${stderr.slice(-2000)}`))
    pending.clear()
    child = null
    starting = null
  })
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer | string) => {
      if (String(chunk).includes('ready')) {
        childProcess.stdout!.off('data', onData)
        resolve()
      }
    }
    childProcess.stdout!.on('data', onData)
    const timer = setTimeout(() => reject(new Error(`native PDF server did not start: ${stderr.slice(-2000)}`)), 120000)
    childProcess.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`native PDF server exited during startup (${code}): ${stderr.slice(-2000)}`))
    })
  })
  return childProcess
}

/** Render generated PDF bytes to a PNG via the same browser (visual inspection). */
export async function rendrePngNatif(bytes: Uint8Array, scale = 1.7, pageNumber = 1): Promise<Buffer> {
  starting ??= start()
  child ??= await starting
  const id = ++seq
  const png = await new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve: (value) => {
      const result = value as { png?: string }
      if (result.png) resolve(result.png)
      else reject(new Error('No PNG returned'))
    }, reject })
    child!.stdin!.write(JSON.stringify({ id, kind: 'render', bytes: Array.from(bytes), scale, pageNumber }) + '\n')
  })
  return Buffer.from(png, 'base64')
}

/** Generate a real PDF through the native path, returning the artifact bytes. */
export async function composerCahierPdfNativedansNavigateur(
  request: CahierExportRequest,
  options: Pick<OptionsCompositionCahierPdf, 'signal' | 'urlAccueil' | 'urlPublique'>,
): Promise<CahierPdfArtifact> {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  starting ??= start()
  child ??= await starting
  const id = ++seq
  const result = await new Promise<{ bytes?: number[]; fileName?: string }>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    child!.stdin!.write(JSON.stringify({
      id,
      request: JSON.parse(JSON.stringify(request)),
      options: { urlAccueil: options.urlAccueil ?? null, urlPublique: options.urlPublique ?? null },
    }) + '\n')
  })
  if (!result.bytes?.length) throw new Error('Empty native PDF')
  return { blob: new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' }),
    fileName: result.fileName ?? 'native-section.pdf' }
}
