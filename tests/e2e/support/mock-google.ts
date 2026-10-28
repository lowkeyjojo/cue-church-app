// A stand-in for Google Images that reproduces the behaviours Cue relies on:
// inline data: thumbnails in a grid, and a preview panel that first shows the
// thumbnail and then swaps in the original image (with a source link).
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gradientPng, type Rgb } from './png'

export interface MockResult {
  id: number
  title: string
  colors: [Rgb, Rgb]
  w: number
  h: number
  /** The original needs the source page as Referer (typical hotlink protection). */
  referer?: boolean
  /** The original is never served directly; only the copy already shown in the page works. */
  blocked?: boolean
}

export const RESULTS: MockResult[] = [
  {
    id: 1,
    title: 'Library of Celsus, Ephesus',
    colors: [
      [160, 110, 60],
      [60, 40, 30]
    ],
    w: 1600,
    h: 1000
  },
  {
    id: 2,
    title: 'Map of the seven churches',
    colors: [
      [40, 90, 140],
      [180, 160, 110]
    ],
    w: 1800,
    h: 1200
  },
  {
    id: 3,
    title: 'Theatre at Ephesus',
    colors: [
      [120, 60, 90],
      [30, 20, 40]
    ],
    w: 1400,
    h: 933,
    referer: true
  },
  {
    id: 4,
    title: 'Harbour road (protected)',
    colors: [
      [30, 120, 90],
      [10, 30, 30]
    ],
    w: 1200,
    h: 800,
    blocked: true
  }
]

export interface MockGoogle {
  base: string
  searchUrl: string
  requests: { path: string; query: string; referer: string }[]
  close(): Promise<void>
}

export async function startMockGoogle(): Promise<MockGoogle> {
  const thumbs = new Map(
    RESULTS.map((r) => [
      r.id,
      `data:image/png;base64,${gradientPng(120, 80, ...r.colors).toString('base64')}`
    ])
  )
  const originals = new Map(RESULTS.map((r) => [r.id, gradientPng(r.w, r.h, ...r.colors)]))
  const requests: MockGoogle['requests'] = []
  let base = ''
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    requests.push({ path: url.pathname, query: url.search, referer: req.headers.referer ?? '' })
    if (url.pathname === '/search') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(resultsPage(url.searchParams.get('q') ?? '', thumbs, base))
      return
    }
    const original = /^\/originals\/(\d+)\.png$/.exec(url.pathname)
    if (original) {
      const r = RESULTS.find((x) => x.id === Number(original[1]))
      // The page's own <img> loads are always allowed (that's what the operator sees).
      const fromPage = req.headers['sec-fetch-dest'] === 'image'
      const refererOk = String(req.headers.referer ?? '').includes('/page/')
      let allowed = !!r
      if (r?.blocked) allowed = fromPage
      else if (r?.referer) allowed = fromPage || refererOk
      if (!r || !allowed) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Forbidden')
        return
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
      res.end(originals.get(r.id))
      return
    }
    if (url.pathname.startsWith('/page/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h1>Source page</h1>')
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    base,
    searchUrl: `${base}/search`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function resultsPage(q: string, thumbs: Map<number, string>, base: string): string {
  const tiles = RESULTS.map(
    (r) =>
      `<div class="tile" data-id="${r.id}" role="button" tabindex="0"><img src="${thumbs.get(r.id)}" alt="${escapeHtml(r.title)}"><div class="cap">${escapeHtml(r.title)}</div></div>`
  ).join('')
  return `<!doctype html><html><head><title>${escapeHtml(q)} - Google Search</title><style>
body{margin:0;font-family:Arial,sans-serif;background:#fff}
header{height:60px;border-bottom:1px solid #ddd;display:flex;align-items:center;padding:0 20px;font-size:20px}
main{display:flex}
.grid{flex:1;display:flex;flex-wrap:wrap;gap:10px;padding:16px;align-content:flex-start}
.tile{width:180px;cursor:pointer}.tile img{width:180px;height:120px;object-fit:cover;border-radius:8px;display:block}
.cap{font-size:12px;color:#444;margin-top:4px}
#panel{width:520px;border-left:1px solid #ddd;padding:20px;display:none}
#panel img{width:480px;height:320px;object-fit:contain;background:#f4f4f4}
</style></head><body><header>${escapeHtml(q)}</header><main><div class="grid">${tiles}</div>
<aside id="panel"><img id="big" alt=""><h3 id="t"></h3><a id="visit" href="#">Visit</a></aside></main>
<script>
const base=${JSON.stringify(base)}
document.querySelectorAll('.tile').forEach(t=>t.addEventListener('click',()=>{
  const id=t.dataset.id, img=t.querySelector('img')
  const panel=document.getElementById('panel'), big=document.getElementById('big')
  panel.style.display='block'
  big.src=img.src
  big.alt=img.alt
  document.getElementById('t').textContent=img.alt
  document.getElementById('visit').href=base+'/page/'+id
  // Like Google: swap in the original once it has loaded.
  setTimeout(()=>{ big.src=base+'/originals/'+id+'.png' }, 350)
}))
</script></body></html>`
}
