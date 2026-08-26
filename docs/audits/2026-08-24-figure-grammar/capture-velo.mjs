#!/usr/bin/env node
/** One-off targeted capture: the vélo-salience commune (Guipavas 29093) — #194 plot check. */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'evidence')
const URL = 'http://localhost:5173/territoire/commune/29093?theme=mobilite'

const COLLECT = `(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } }
  const texte = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null
  const lec = document.querySelector('.sous-groupe-lecture')
  return {
    prose: texte(lec?.querySelector('.lecture-texte')),
    contexte: texte(lec?.querySelector('.lecture-contexte')),
    colonne: box(lec?.querySelector('.lecture-figure')),
    canvas: box(lec?.querySelector('canvas')),
  }
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9224', '--user-data-dir=' + join(OUT, '.chrome-velo'), '--window-size=1440,2400', '--disable-gpu', '--no-first-run', 'about:blank'], { stdio: 'ignore' })

const wait = async () => {
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    try {
      const res = await fetch('http://127.0.0.1:9224/json/list')
      const targets = await res.json()
      if (targets.length) return targets.find((t) => t.type === 'page')
    } catch {}
  }
  throw new Error('chrome did not start')
}

try {
  const page = await wait()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((res) => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })) })
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 2400, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: URL })
  await sleep(4000)
  const ev = await send('Runtime.evaluate', { expression: COLLECT, returnByValue: true })
  writeFileSync(join(OUT, 'commune-guipavas-velo.json'), JSON.stringify(ev.result.value, null, 2))
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(join(OUT, 'commune-guipavas-velo.png'), Buffer.from(shot.data, 'base64'))
  console.log('OK', JSON.stringify(ev.result.value))
} finally {
  chrome.kill()
}
