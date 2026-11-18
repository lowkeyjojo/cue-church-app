// A stand-in for Google Images that reproduces the behaviours Cue relies on:
// inline data: thumbnails in a grid, and a preview panel that first shows the
// thumbnail and then swaps in the original image (with a source link). For
// some results, as for most social and video sites on the real Google, the
// preview never leaves the thumbnail; their source pages stand in for those
// sites and publish a preview image of their own (og:image).
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
  /**
   * When the preview swaps its thumbnail for the original: by itself after a
   * moment (the default), never, or when the test calls `showOriginal()` in the page.
   */
  swap?: 'never' | 'asked'
  /** The source page is under /social/ (the folder tests tell Cue to treat as a social site), not /page/. */
  social?: boolean
  /** The source page's preview image (og:image). */
  og?: { w: number; h: number }
  /** The source page answers with a redirect to a page outside /social/. */
  redirects?: boolean
}

/** Every thumbnail's size. */
export const THUMB = { w: 120, h: 80 }

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
  },
  {
    id: 5,
    title: 'Sunrise service (reel)',
    colors: [
      [230, 140, 60],
      [60, 30, 90]
    ],
    w: 1600,
    h: 1067,
    swap: 'never',
    social: true,
    og: { w: 1200, h: 800 }
  },
  {
    id: 6,
    title: 'Baptism day (post)',
    colors: [
      [70, 150, 200],
      [20, 40, 80]
    ],
    w: 1600,
    h: 1067,
    swap: 'never',
    social: true,
    // A share banner: not the shape of the picture.
    og: { w: 1200, h: 630 }
  },
  {
    id: 7,
    title: 'Parish hall (blog)',
    colors: [
      [150, 150, 90],
      [50, 60, 30]
    ],
    w: 1600,
    h: 1067,
    swap: 'never',
    og: { w: 1200, h: 800 }
  },
  {
    id: 8,
    title: 'Youth camp (moved)',
    colors: [
      [200, 80, 80],
      [60, 20, 40]
    ],
    w: 1600,
    h: 1067,
    swap: 'never',
    social: true,
    redirects: true,
    og: { w: 1200, h: 800 }
  },
  {
    id: 9,
    title: 'Choir on the steps (video)',
    colors: [
      [90, 60, 160],
      [20, 20, 50]
    ],
    w: 1500,
    h: 1000,
    swap: 'asked',
    social: true,
    og: { w: 900, h: 600 }
  },
  {
    id: 10,
    title: 'Harvest table (slow site)',
    colors: [
      [190, 170, 60],
      [70, 50, 20]
    ],
    w: 1350,
    h: 900,
    swap: 'asked'
  }
]

/** Where a result's source page is, on the server at `base`. */
export const pagePath = (r: MockResult) => `/${r.social ? 'social' : 'page'}/${r.id}`

export interface MockGoogle {
  base: string
  searchUrl: string
  requests: { path: string; query: string; referer: string; agent: string }[]
  close(): Promise<void>
}

export async function startMockGoogle(): Promise<MockGoogle> {
  const thumbs = new Map(
    RESULTS.map((r) => [
      r.id,
      `data:image/png;base64,${gradientPng(THUMB.w, THUMB.h, ...r.colors).toString('base64')}`
    ])
  )
  const originals = new Map(RESULTS.map((r) => [r.id, gradientPng(r.w, r.h, ...r.colors)]))
  const requests: MockGoogle['requests'] = []
  let base = ''
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    requests.push({
      path: url.pathname,
      query: url.search,
      referer: req.headers.referer ?? '',
      agent: req.headers['user-agent'] ?? ''
    })
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
    const page = /^\/(page|social|elsewhere)\/(\d+)$/.exec(url.pathname)
    if (page) {
      const r = RESULTS.find((x) => x.id === Number(page[2]))
      if (r?.redirects && page[1] === 'social') {
        res.writeHead(302, { Location: `/elsewhere/${r.id}` })
        res.end()
        return
      }
      // Written the way real pages vary: either attribute first, either quote, relative, with an entity.
      const meta = !r?.og
        ? ''
        : r.id % 2
          ? `<meta content='/og/${r.id}.png?size=l&amp;v=2' property='og:image'>`
          : `<meta property="og:image" content="${base}/og/${r.id}.png">`
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><html><head><title>Source page</title>${meta}</head><h1>Source page</h1></html>`
      )
      return
    }
    const og = /^\/og\/(\d+)\.png$/.exec(url.pathname)
    if (og) {
      const r = RESULTS.find((x) => x.id === Number(og[1]))
      if (!r?.og) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
      res.end(gradientPng(r.og.w, r.og.h, ...r.colors))
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
      `<div class="tile" data-id="${r.id}" data-swap="${r.swap ?? 'soon'}" data-page="${base}${pagePath(r)}" role="button" tabindex="0"><img src="${thumbs.get(r.id)}" alt="${escapeHtml(r.title)}"><div class="cap">${escapeHtml(r.title)}</div></div>`
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
let pending=null
// For results whose original arrives when the test says so.
window.showOriginal=()=>{ if(pending){ document.getElementById('big').src=pending; pending=null } }
document.querySelectorAll('.tile').forEach(t=>t.addEventListener('click',()=>{
  const id=t.dataset.id, img=t.querySelector('img')
  const panel=document.getElementById('panel'), big=document.getElementById('big')
  panel.style.display='block'
  big.src=img.src
  big.alt=img.alt
  document.getElementById('t').textContent=img.alt
  document.getElementById('visit').href=t.dataset.page
  const original=base+'/originals/'+id+'.png'
  pending=t.dataset.swap==='asked'?original:null
  // Like Google: swap in the original once it has loaded. For social and video sites it never does.
  if(t.dataset.swap==='soon') setTimeout(()=>{ big.src=original }, 350)
}))
</script></body></html>`
}
