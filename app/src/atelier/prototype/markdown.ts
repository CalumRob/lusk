/**
 * PROTOTYPE — a deliberately tiny Markdown subset rendered to Vue VNodes.
 * Paragraphs, **bold**, *italic*, `- ` and `1. ` lists, `## ` and `### ` headings.
 * No links (`[a](b)` and bare URLs stay literal text), no HTML: every piece of text goes through
 * `h()` as a text child, so it is escaped by construction. The source comes from URLs written by
 * strangers: never v-html, never an HTML string.
 */
import { defineComponent, h, type VNodeChild } from 'vue'

function closeSingle(src: string, from: number): number {
  for (let k = from; k < src.length; k++) {
    if (src[k] === '*' && src[k + 1] !== '*' && src[k - 1] !== '*' && src[k - 1] !== ' ') return k
  }
  return -1
}

export function inline(src: string): VNodeChild[] {
  const out: VNodeChild[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) out.push(buffer)
    buffer = ''
  }
  let i = 0
  while (i < src.length) {
    if (src.startsWith('**', i)) {
      const j = src.indexOf('**', i + 2)
      if (j > i + 2) {
        flush()
        out.push(h('strong', inline(src.slice(i + 2, j))))
        i = j + 2
        continue
      }
    }
    if (src[i] === '*' && src[i + 1] !== '*' && src[i + 1] !== ' ' && src[i + 1] !== undefined) {
      const j = closeSingle(src, i + 1)
      if (j > i + 1) {
        flush()
        out.push(h('em', inline(src.slice(i + 1, j))))
        i = j + 1
        continue
      }
    }
    buffer += src[i]
    i++
  }
  flush()
  return out
}

const HEADING = /^(#{2,3}) (.+)$/
const BULLET = /^- (.*)$/
const NUMBER = /^\d+\. (.*)$/

export function renderMarkdown(source: string): VNodeChild[] {
  const lines = source.replace(/\r/g, '').split('\n')
  const out: VNodeChild[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      out.push(h(heading[1]!.length === 2 ? 'h2' : 'h3', { class: heading[1]!.length === 2 ? 'at-md-h2' : 'at-md-h3' }, inline(heading[2]!.trim())))
      i++
      continue
    }
    const kind = BULLET.test(line) ? 'ul' : NUMBER.test(line) ? 'ol' : null
    if (kind) {
      const rx = kind === 'ul' ? BULLET : NUMBER
      const items: VNodeChild[] = []
      while (i < lines.length && rx.test(lines[i]!)) {
        items.push(h('li', inline(rx.exec(lines[i]!)![1]!.trim())))
        i++
      }
      out.push(h(kind, { class: 'at-md-list' }, items))
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !HEADING.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBER.test(lines[i]!)) {
      para.push(lines[i]!.trim())
      i++
    }
    out.push(h('p', inline(para.join(' '))))
  }
  return out
}

export const MarkdownProse = defineComponent({
  name: 'MarkdownProse',
  props: { source: { type: String, required: true } },
  setup: (props) => () => h('div', { class: 'cahier-prose page-subtitle at-md' }, renderMarkdown(props.source)),
})
