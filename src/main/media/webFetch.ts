import { net, type Session } from 'electron'
import { UserError } from '../log'

const MAX_REDIRECTS = 5

export interface GuardedFetch {
  /** Every address asked, the first one and each redirect, has to pass this before it is contacted. */
  allow: (url: URL) => boolean
  headers?: Record<string, string>
  timeoutMs: number
  maxBytes: number
  /** At `maxBytes`, stop reading and keep what arrived instead of failing. */
  truncate?: boolean
}

export interface Fetched {
  bytes: Uint8Array
  mime: string | undefined
  /** Where the answer came from, after redirects. */
  url: string
}

/**
 * GET an address Cue chose by itself (not one the operator opened), with the
 * session's cookies and user agent. Redirects are followed one at a time so
 * that none can lead somewhere `allow` refuses. (`session.fetch` can't do
 * this: with `redirect: 'manual'` it fails without saying where it was sent.)
 */
export function fetchGuarded(ses: Session, address: string, opts: GuardedFetch): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    let current: URL
    try {
      current = new URL(address)
    } catch {
      reject(new UserError("That isn't a web address"))
      return
    }
    if (!opts.allow(current)) {
      reject(new UserError(`Cue doesn't fetch from ${current.host || 'that address'}`))
      return
    }
    const request = net.request({
      url: current.href,
      session: ses,
      redirect: 'manual',
      useSessionCookies: true
    })
    let settled = false
    const fail = (message: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.abort()
      reject(new UserError(message))
    }
    const timer = setTimeout(() => fail('The website took too long to answer'), opts.timeoutMs)
    for (const [name, value] of Object.entries(opts.headers ?? {})) request.setHeader(name, value)

    let hops = 0
    request.on('redirect', (_status, _method, location) => {
      let next: URL | null = null
      try {
        next = new URL(location, current)
      } catch {
        /* refused below */
      }
      if (!next || ++hops > MAX_REDIRECTS || !opts.allow(next)) {
        fail(`The website redirects to ${next?.host || 'an address'}, where Cue doesn't follow`)
        return
      }
      current = next
      request.followRedirect()
    })
    request.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        fail(`The website refused (HTTP ${res.statusCode})`)
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      const done = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const type = res.headers['content-type']
        resolve({
          bytes: new Uint8Array(Buffer.concat(chunks)).subarray(0, opts.maxBytes),
          mime: (Array.isArray(type) ? type[0] : type) || undefined,
          url: current.href
        })
      }
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        total += chunk.length
        if (total < opts.maxBytes) return
        if (opts.truncate) {
          done()
          request.abort()
        } else if (total > opts.maxBytes) fail('This file is too large to bring in')
      })
      res.on('end', done)
      res.on('error', () => fail('The website stopped answering'))
      res.on('aborted', () => fail('The website stopped answering'))
    })
    request.on('error', (err) => fail(`Couldn't reach the website (${err.message})`))
    request.end()
  })
}
