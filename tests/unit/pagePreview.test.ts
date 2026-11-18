import { describe, expect, it } from 'vitest'
import {
  fitsThumbnail,
  isPublicHost,
  isPublicHttps,
  isSocialHost,
  previewImagesIn,
  youtubeThumbnails,
  youtubeVideoId
} from '@shared/pagePreview'

describe('isSocialHost', () => {
  it('knows the social and video sites, with their subdomains', () => {
    for (const host of [
      'instagram.com',
      'www.instagram.com',
      'tiktok.com',
      'vm.tiktok.com',
      'facebook.com',
      'm.facebook.com',
      'x.com',
      'twitter.com',
      'mobile.twitter.com',
      'reddit.com',
      'old.reddit.com',
      'vimeo.com',
      'threads.net',
      'www.threads.com',
      'linkedin.com',
      'uk.linkedin.com',
      'WWW.Instagram.com',
      'instagram.com.'
    ])
      expect(isSocialHost(host), host).toBe(true)
  })

  it('knows Pinterest in any country', () => {
    for (const host of ['pinterest.com', 'www.pinterest.co.uk', 'pinterest.de', 'au.pinterest.com'])
      expect(isSocialHost(host), host).toBe(true)
    expect(isSocialHost('pinterest.com.example.org')).toBe(false)
    expect(isSocialHost('notpinterest.com')).toBe(false)
  })

  it('is not fooled by look-alikes, and leaves ordinary sites alone', () => {
    for (const host of [
      'example.com',
      'notinstagram.com',
      'instagram.com.example.org',
      'x.com.evil.test',
      'box.com',
      'netflix.com',
      'wikipedia.org',
      'youtube.com',
      ''
    ])
      expect(isSocialHost(host), host).toBe(false)
  })
})

describe('youtubeVideoId', () => {
  it('reads the id from every kind of video address', () => {
    const id = 'dQw4w9WgXcQ'
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?feature=share&v=${id}&t=42s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/shorts/${id}?feature=share`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
      `http://www.youtube.com/watch?v=${id}`
    ])
      expect(youtubeVideoId(url), url).toBe(id)
    expect(youtubeVideoId('https://youtu.be/a-b_c-d_e-f')).toBe('a-b_c-d_e-f')
  })

  it('returns null for anything that is not one video', () => {
    for (const url of [
      undefined,
      '',
      'not a url',
      'https://www.youtube.com/',
      'https://www.youtube.com/@somechannel',
      'https://www.youtube.com/playlist?list=PL1234567890',
      'https://www.youtube.com/watch?v=tooshort',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ../../x',
      'https://youtube.com.example.org/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'ftp://youtu.be/dQw4w9WgXcQ'
    ])
      expect(youtubeVideoId(url), String(url)).toBeNull()
  })
})

describe('youtubeThumbnails', () => {
  it('lists the video’s own thumbnails, largest first', () => {
    expect(youtubeThumbnails('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual([
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    ])
  })

  it('starts with the upright one for Shorts', () => {
    expect(youtubeThumbnails('https://www.youtube.com/shorts/dQw4w9WgXcQ')[0]).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/oardefault.jpg'
    )
  })

  it('has nothing for other pages', () => {
    expect(youtubeThumbnails('https://www.youtube.com/@somechannel')).toEqual([])
    expect(youtubeThumbnails('https://vimeo.com/123456789')).toEqual([])
    expect(youtubeThumbnails(undefined)).toEqual([])
  })
})

describe('fitsThumbnail', () => {
  const thumb = { width: 300, height: 168 } // 16:9

  it('accepts a larger image of the same shape', () => {
    expect(fitsThumbnail({ width: 1280, height: 720 }, thumb)).toBe(true)
    expect(fitsThumbnail({ width: 1920, height: 1080 }, thumb)).toBe(true)
    expect(fitsThumbnail({ width: 300, height: 168 }, thumb)).toBe(true)
  })

  it('allows a slightly different crop, either way', () => {
    expect(fitsThumbnail({ width: 1200, height: 630 }, thumb)).toBe(true) // 1.90 against 1.79
    expect(fitsThumbnail({ width: 1280, height: 800 }, thumb)).toBe(true) // 1.60
    expect(fitsThumbnail({ width: 1080, height: 1350 }, { width: 240, height: 290 })).toBe(true)
  })

  it('rejects another shape: a letterboxed 4:3 frame, a square crop, a banner', () => {
    expect(fitsThumbnail({ width: 480, height: 360 }, thumb)).toBe(false)
    expect(fitsThumbnail({ width: 1080, height: 1080 }, thumb)).toBe(false)
    expect(fitsThumbnail({ width: 1200, height: 630 }, { width: 225, height: 225 })).toBe(false)
    expect(fitsThumbnail({ width: 1080, height: 1920 }, thumb)).toBe(false)
    expect(fitsThumbnail({ width: 1080, height: 1080 }, { width: 240, height: 300 })).toBe(false)
  })

  it('rejects anything smaller than the thumbnail', () => {
    expect(fitsThumbnail({ width: 256, height: 144 }, thumb)).toBe(false)
  })

  it('rejects YouTube’s 120×90 placeholder and anything as small, whatever the thumbnail', () => {
    expect(fitsThumbnail({ width: 120, height: 90 }, { width: 120, height: 90 })).toBe(false)
    expect(fitsThumbnail({ width: 120, height: 68 }, { width: 60, height: 34 })).toBe(false)
  })

  it('rejects sizes that are missing or nonsense', () => {
    expect(fitsThumbnail({ width: 1280, height: 720 }, { width: 0, height: 0 })).toBe(false)
    expect(fitsThumbnail({ width: 1280, height: 0 }, thumb)).toBe(false)
    expect(fitsThumbnail({ width: NaN, height: 720 }, thumb)).toBe(false)
    expect(fitsThumbnail({ width: 1280, height: 720 }, { width: -300, height: -168 })).toBe(false)
    expect(fitsThumbnail({ width: Infinity, height: Infinity }, thumb)).toBe(false)
  })
})

describe('isPublicHost', () => {
  it('accepts named hosts on the internet', () => {
    for (const host of ['example.com', 'scontent.cdninstagram.com', 'i.ytimg.com', 'xn--bcher-kva.example'])
      expect(isPublicHost(host), host).toBe(true)
  })

  it('refuses this computer, IP addresses and local-network names', () => {
    for (const host of [
      '',
      'localhost',
      'app.localhost',
      '127.0.0.1',
      '10.0.0.8',
      '192.168.1.1',
      '169.254.169.254',
      '8.8.8.8',
      '[::1]',
      '[fd00::1]',
      'printer',
      'printer.local',
      'nas.lan',
      'router.home',
      'wiki.internal',
      'db.corp',
      'gateway.home.arpa',
      'LOCALHOST.'
    ])
      expect(isPublicHost(host), host).toBe(false)
  })

  it('sees through other spellings of an IP address once it is a URL', () => {
    for (const url of [
      'https://2130706433/',
      'https://0x7f.1/',
      'https://127.1/',
      'https://[::ffff:10.0.0.1]/'
    ])
      expect(isPublicHttps(new URL(url)), url).toBe(false)
  })

  it('wants https, and no login in the address', () => {
    expect(isPublicHttps(new URL('https://example.com/a.jpg'))).toBe(true)
    expect(isPublicHttps(new URL('http://example.com/a.jpg'))).toBe(false)
    expect(isPublicHttps(new URL('https://user:pw@example.com/a.jpg'))).toBe(false)
    expect(isPublicHttps(new URL('file:///etc/passwd'))).toBe(false)
  })
})

describe('previewImagesIn', () => {
  const page = 'https://www.instagram.com/p/abc123/'

  it('reads og:image', () => {
    const html = `<html><head><title>x</title>
      <meta property="og:image" content="https://cdn.example.com/a.jpg"></head></html>`
    expect(previewImagesIn(html, page)).toEqual(['https://cdn.example.com/a.jpg'])
  })

  it('copes with any attribute order, quoting, case and spacing', () => {
    const cases = [
      `<meta content="https://cdn.example.com/a.jpg" property="og:image">`,
      `<meta property='og:image' content='https://cdn.example.com/a.jpg' />`,
      `<META PROPERTY="OG:IMAGE" CONTENT="https://cdn.example.com/a.jpg">`,
      `<meta property=og:image content=https://cdn.example.com/a.jpg>`,
      `<meta\n  data-rh="true"\n  property = "og:image"\n  content = "https://cdn.example.com/a.jpg"\n/>`,
      `<meta name="twitter:image" content="https://cdn.example.com/a.jpg">`,
      `<meta itemprop="image" property="og:image" content=" https://cdn.example.com/a.jpg ">`
    ]
    for (const html of cases)
      expect(previewImagesIn(html, page), html).toEqual(['https://cdn.example.com/a.jpg'])
  })

  it('decodes entities in the address', () => {
    const html = `<meta property="og:image" content="https://cdn.example.com/a.jpg?w=1080&amp;h=1350&#38;sig=a&#x26;b=1">`
    expect(previewImagesIn(html, page)).toEqual(['https://cdn.example.com/a.jpg?w=1080&h=1350&sig=a&b=1'])
  })

  it('resolves relative addresses against the page', () => {
    expect(previewImagesIn(`<meta property="og:image" content="/media/a.jpg">`, page)).toEqual([
      'https://www.instagram.com/media/a.jpg'
    ])
    expect(previewImagesIn(`<meta property="og:image" content="//cdn.example.com/a.jpg">`, page)).toEqual([
      'https://cdn.example.com/a.jpg'
    ])
    expect(previewImagesIn(`<meta property="og:image" content="a.jpg">`, page)).toEqual([
      'https://www.instagram.com/p/abc123/a.jpg'
    ])
  })

  it('puts the secure address first, then og:image, then the Twitter card, without repeats', () => {
    const html = `
      <meta name="twitter:image" content="https://cdn.example.com/card.jpg">
      <meta property="og:image" content="https://cdn.example.com/first.jpg">
      <meta property="og:image" content="https://cdn.example.com/second.jpg">
      <meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg">
      <meta property="og:image:url" content="https://cdn.example.com/first.jpg">`
    expect(previewImagesIn(html, page)).toEqual([
      'https://cdn.example.com/secure.jpg',
      'https://cdn.example.com/first.jpg',
      'https://cdn.example.com/second.jpg',
      'https://cdn.example.com/card.jpg'
    ])
  })

  it('keeps only https addresses on public hosts', () => {
    const html = `
      <meta property="og:image" content="http://cdn.example.com/plain.jpg">
      <meta property="og:image" content="https://127.0.0.1/a.jpg">
      <meta property="og:image" content="https://router.local/a.jpg">
      <meta property="og:image" content="file:///etc/passwd">
      <meta property="og:image" content="data:image/png;base64,AAAA">
      <meta property="og:image" content="javascript:alert(1)">
      <meta property="og:image" content="https://">
      <meta property="og:image" content="">
      <meta property="og:image">
      <meta property="og:image" content="https://cdn.example.com/ok.jpg">`
    expect(previewImagesIn(html, page)).toEqual(['https://cdn.example.com/ok.jpg'])
  })

  it('lets the caller decide which addresses count', () => {
    const html = `<meta property="og:image" content="/og/5.png">`
    const local = (url: URL) => url.origin === 'http://127.0.0.1:4000'
    expect(previewImagesIn(html, 'http://127.0.0.1:4000/social/5', local)).toEqual([
      'http://127.0.0.1:4000/og/5.png'
    ])
    expect(previewImagesIn(html, 'http://127.0.0.1:4000/social/5')).toEqual([])
  })

  it('ignores other tags and other properties', () => {
    const html = `
      <metadata property="og:image" content="https://cdn.example.com/no1.jpg"></metadata>
      <meta property="og:image:width" content="1080">
      <meta property="og:video" content="https://cdn.example.com/no2.mp4">
      <meta property="og:title" content="og:image https://cdn.example.com/no3.jpg">
      <link rel="image_src" href="https://cdn.example.com/no4.jpg">
      <p>&lt;meta property="og:image" content="https://cdn.example.com/no5.jpg"&gt;</p>`
    expect(previewImagesIn(html, page)).toEqual([])
  })

  it('survives a page with no tags, a cut-off tag or an unclosed quote', () => {
    expect(previewImagesIn('', page)).toEqual([])
    expect(previewImagesIn('<html><body>Log in to continue</body></html>', page)).toEqual([])
    expect(previewImagesIn('<meta property="og:image" content="https://cdn.example.com/cut', page)).toEqual(
      []
    )
    expect(previewImagesIn('<meta property="og:image" content="https://cdn.example.com/cu', page)).toEqual([])
    expect(previewImagesIn('<meta property=og:image content=https://cdn.example.com/cut', page)).toEqual([])
    expect(previewImagesIn('<meta', page)).toEqual([])
    const unclosed = `<meta property="og:image" content="${'x'.repeat(20000)}`
    expect(previewImagesIn(unclosed.repeat(50), page)).toEqual([])
  })

  it('reads a tag that sits after a great deal of other markup quickly', () => {
    const html = `<head>${'<meta name="x" content="y">'.repeat(20000)}<meta property="og:image" content="https://cdn.example.com/a.jpg">`
    const started = performance.now()
    expect(previewImagesIn(html, page)).toEqual(['https://cdn.example.com/a.jpg'])
    expect(performance.now() - started).toBeLessThan(2000)
  })
})
