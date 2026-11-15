import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { extOf, mimeForExt, parseRange } from '@shared/media'
import { MEDIA_SCHEME } from '@shared/util'
import { log } from './log'
import { mainDir, mediaRoot, resourcePath } from './paths'

export const APP_SCHEME = 'cue-app'
export const APP_ORIGIN = `${APP_SCHEME}://app`

/** Must be called before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
    },
    {
      // Cue's own UI pages in production builds: a real origin instead of file://.
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true }
    }
  ])
}

/** Serves the bundled renderer (out/renderer) at cue-app://app/. */
export function handleAppProtocol(): void {
  const root = normalize(join(mainDir, '..', 'renderer'))
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'app') return new Response('Not found', { status: 404 })
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'control.html'
      const file = normalize(join(root, rel))
      if (!file.startsWith(root + sep)) return new Response('Forbidden', { status: 403 })
      return await serveFile(file, request)
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/**
 * Serves library media to every Cue window:
 *   cue-media://media/<item-id>/<file>   -> files in the media library
 *   cue-media://builtin/<path>           -> assets shipped with the app
 * Supports HTTP range requests so video seeking works.
 */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const root =
        url.hostname === 'media' ? mediaRoot() : url.hostname === 'builtin' ? resourcePath('builtin') : null
      if (!root) return new Response('Not found', { status: 404 })
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const file = normalize(join(root, rel))
      if (!file.startsWith(normalize(root) + sep)) return new Response('Forbidden', { status: 403 })
      return await serveFile(file, request)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') log.warn('cue-media error', request.url, err)
      return new Response('Not found', { status: 404, headers: corsHeaders() })
    }
  })
}

async function serveFile(file: string, request: Request): Promise<Response> {
  const info = await stat(file)
  if (!info.isFile()) return new Response('Not found', { status: 404, headers: corsHeaders() })
  const size = info.size
  const headers: Record<string, string> = {
    ...corsHeaders(),
    'Content-Type': mimeForExt(extOf(file)),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'max-age=31536000',
    'Last-Modified': info.mtime.toUTCString()
  }
  const range = parseRange(request.headers.get('range'), size)
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
  }
  const start = range ? range.start : 0
  const end = range ? range.end : size - 1
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1)
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  if (request.method === 'HEAD' || size === 0) {
    return new Response(null, { status: range ? 206 : 200, headers })
  }
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status: range ? 206 : 200, headers })
}

function corsHeaders(): Record<string, string> {
  return { 'Access-Control-Allow-Origin': '*' }
}
