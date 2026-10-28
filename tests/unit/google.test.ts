import { describe, expect, it } from 'vitest'
import { googleImagesUrl, isGoogleThumbnail, parseGoogleLink, queryFromGoogleUrl } from '@shared/google'

describe('googleImagesUrl', () => {
  it('asks for image results with SafeSearch', () => {
    const url = new URL(googleImagesUrl('ephesus library', { safeSearch: true }))
    expect(url.origin + url.pathname).toBe('https://www.google.com/search')
    expect(url.searchParams.get('q')).toBe('ephesus library')
    expect(url.searchParams.get('udm')).toBe('2')
    expect(url.searchParams.get('safe')).toBe('active')
    expect(url.searchParams.has('tbs')).toBe(false)
  })

  it('adds the usage-rights, size and type filters', () => {
    const url = new URL(
      googleImagesUrl('map', { safeSearch: false, licensedOnly: true, size: 'large', type: 'clipart' })
    )
    expect(url.searchParams.has('safe')).toBe(false)
    expect(url.searchParams.get('tbs')).toBe('il:cl,isz:l,itp:clipart')
  })
})

describe('queryFromGoogleUrl', () => {
  it('reads the query from Google result pages in any country', () => {
    expect(queryFromGoogleUrl('https://www.google.com/search?q=sea+of+galilee&udm=2')).toBe('sea of galilee')
    expect(queryFromGoogleUrl('https://www.google.co.uk/search?q=jerusalem')).toBe('jerusalem')
  })

  it('ignores other sites and junk', () => {
    expect(queryFromGoogleUrl('https://example.com/search?q=x')).toBeNull()
    expect(queryFromGoogleUrl('https://google.com.evil.example/search?q=x')).toBeNull()
    expect(queryFromGoogleUrl('not a url')).toBeNull()
  })
})

describe('parseGoogleLink', () => {
  it('unwraps image result and redirect links', () => {
    expect(
      parseGoogleLink(
        'https://www.google.com/imgres?imgurl=https%3A%2F%2Fexample.org%2Fa.jpg&imgrefurl=https%3A%2F%2Fexample.org%2Fpage'
      )
    ).toEqual({ imageUrl: 'https://example.org/a.jpg', pageUrl: 'https://example.org/page' })
    expect(parseGoogleLink('https://www.google.com/url?q=https%3A%2F%2Fexample.org%2F')).toEqual({
      pageUrl: 'https://example.org/'
    })
  })

  it('leaves other links alone', () => {
    expect(parseGoogleLink('https://example.org/imgres?imgurl=x')).toEqual({})
    expect(parseGoogleLink(undefined)).toEqual({})
  })
})

describe('isGoogleThumbnail', () => {
  it("knows Google's own copies from the original", () => {
    expect(isGoogleThumbnail('data:image/jpeg;base64,AAAA')).toBe(true)
    expect(isGoogleThumbnail('https://encrypted-tbn0.gstatic.com/images?q=tbn:abc')).toBe(true)
    expect(isGoogleThumbnail('https://lh3.googleusercontent.com/x')).toBe(true)
    expect(isGoogleThumbnail('https://upload.wikimedia.org/a.jpg')).toBe(false)
  })
})
