/** Pure helpers for Cue's updates: comparing versions, the test feed, and what to tell the operator. */
import type { UpdateState } from './types'

export const RELEASES_URL = 'https://github.com/lowkeyjojo/cue-church-app/releases'
export const LATEST_RELEASE_API = 'https://api.github.com/repos/lowkeyjojo/cue-church-app/releases/latest'

interface Version {
  numbers: [number, number, number]
  pre: string[]
}

/** "v1.2.3", "1.2.3-beta.1" or "1.2.3+build" as numbers; null when it isn't a version. */
function parseVersion(value: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) return null
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : []
  }
}

/** Version without a leading "v" or build details ("v1.2.3" → "1.2.3"); null when it isn't one. */
export function cleanVersion(value: string): string | null {
  const v = parseVersion(value)
  return v ? `${v.numbers.join('.')}${v.pre.length ? `-${v.pre.join('.')}` : ''}` : null
}

/**
 * Semantic-version order: negative when `a` is older than `b`, positive when
 * newer, 0 when equal. Null when either one isn't a version.
 */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) {
    if (x.numbers[i] !== y.numbers[i]) return x.numbers[i] < y.numbers[i] ? -1 : 1
  }
  // A pre-release ("1.2.3-beta") comes before its release ("1.2.3").
  if (!x.pre.length || !y.pre.length) {
    if (x.pre.length === y.pre.length) return 0
    return x.pre.length ? -1 : 1
  }
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

/** Is `candidate` a newer version than `current`? Anything unreadable is not. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return (compareVersions(candidate, current) ?? 0) > 0
}

/**
 * The update feed tests may point Cue at (CUE_UPDATE_FEED). Only a server on
 * this computer is accepted, written as http://127.0.0.1:<port> or
 * http://localhost:<port>: nothing else can stand in for the real releases.
 * Returns the feed without a trailing slash, or null.
 */
export function localUpdateFeed(value: string | undefined): string | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:') return null
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null
  if (!url.port || url.username || url.password || url.search || url.hash) return null
  return `http://${url.hostname}:${url.port}${url.pathname.replace(/\/+$/, '')}`
}

/** The page a release is downloaded from. Anything that isn't one of Cue's own release pages is replaced. */
export function releasePage(url: unknown): string {
  return typeof url === 'string' && url.startsWith(`${RELEASES_URL}/`) ? url : `${RELEASES_URL}/latest`
}

/** A failed check in a few plain words. */
export function plainUpdateError(message: string): string {
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|ERR_CONNECTION|ERR_ADDRESS/i.test(message))
    return 'no internet connection'
  if (/ERR_TIMED_OUT|TimeoutError|timed? ?out|aborted/i.test(message)) return 'the connection timed out'
  const status = /\b(?:status|code|answered|HttpError)\D{0,3}([45]\d\d)\b/i.exec(message)
  if (status) return `the update server answered ${status[1]}`
  const first = message.split('\n')[0].trim()
  return first.length > 120 ? `${first.slice(0, 117)}…` : first || 'something went wrong'
}

/** The update state in plain words, for the settings. Empty when there is nothing to say. */
export function updateSummary(state: UpdateState): string {
  const version = state.version ?? ''
  switch (state.status) {
    case 'checking':
      return 'Checking…'
    case 'current':
      return 'Cue is up to date'
    case 'available':
      return `Cue ${version} is available`
    case 'downloading':
      return `Downloading ${version}…${state.percent ? ` ${Math.round(state.percent)}%` : ''}`
    case 'ready':
      return `Cue ${version} is ready. It installs when you close Cue.`
    case 'error':
      return `Couldn't check: ${state.message ?? 'something went wrong'}`
    default:
      return ''
  }
}
