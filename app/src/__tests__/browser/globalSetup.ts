/**
 * Vitest globalSetup of the `browser` project (npm run test:browser).
 *
 * Starts the native PDF harness ONCE per run: one child Node process
 * (helpers/cahierPdfNativeServer.mjs) that holds one headless Chromium and one
 * in-memory Vite bundle of the production composer seam. Spec files never
 * launch a browser or a build: they reach this child through a loopback HTTP
 * bridge whose URL is provided as `nativePdfBridge`.
 *
 * Nothing here runs in `npm test` (the `unit` project has no globalSetup).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

const here = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(here, '../helpers/cahierPdfNativeServer.mjs')
const REPO_ROOT = path.resolve(here, '../../../..')

interface Pending {
  resolve: (line: string) => void
  reject: (reason: Error) => void
}

async function startChild(): Promise<{ child: ChildProcess; send: (payload: object) => Promise<string> }> {
  const child = spawn(process.execPath, [SERVER], { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const pending = new Map<number, Pending>()
  let seq = 0
  let stderr = ''
  let buffer = ''
  let ready!: () => void
  let failed!: (error: Error) => void
  const started = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject })

  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (chunk) => { stderr += chunk; process.stderr.write(String(chunk)) })
  child.stdout!.setEncoding('utf8')
  child.stdout!.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      if (line === 'ready') { ready(); continue }
      const bar = line.indexOf('|')
      const id = Number(line.slice(0, bar))
      const waiter = pending.get(id)
      if (!waiter) continue
      pending.delete(id)
      waiter.resolve(line.slice(bar + 1))
    }
  })
  child.on('exit', (code) => {
    const error = new Error(`native PDF server exited (${code}): ${stderr.slice(-2000)}`)
    failed(error)
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  })
  const timer = setTimeout(() => failed(new Error(`native PDF server did not start: ${stderr.slice(-2000)}`)), 120_000)
  try { await started } finally { clearTimeout(timer) }

  return {
    child,
    send: (payload) => new Promise<string>((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      child.stdin!.write(JSON.stringify({ ...payload, id }) + '\n')
    }),
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { child, send } = await startChild()
  const bridge: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      send(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        .then((body) => { response.setHeader('content-type', 'application/json'); response.end(body) })
        .catch((error: Error) => {
          response.statusCode = 500
          response.end(JSON.stringify({ error: { name: error.name, message: error.message } }))
        })
    })
  })
  await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', resolve))
  const { port } = bridge.address() as AddressInfo
  project.provide('nativePdfBridge', `http://127.0.0.1:${port}/`)

  return async () => {
    await new Promise<void>((resolve) => bridge.close(() => resolve()))
    child.stdin!.end()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve() }, 10_000)
      child.on('exit', () => { clearTimeout(timer); resolve() })
    })
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    nativePdfBridge: string
  }
}
