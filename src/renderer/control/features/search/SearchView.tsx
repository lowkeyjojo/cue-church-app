import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Home,
  Landmark,
  RotateCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react'
import type { SearchFilters, SearchProviderId } from '@shared/types'
import { domainOf } from '@shared/util'
import { attempt, modKey } from '../../lib/api'
import { FOCUS_SEARCH_EVENT, GOOGLE_SEARCH_EVENT } from '../../lib/commands'
import { useSettings } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Toolbar } from '../../layout/Workspace'
import { useElementSize } from '../../../stage/useElementSize'
import { IconButton } from '../../ui/Button'
import { Field, Segmented, Select, Switch, TextField } from '../../ui/Controls'
import { Popover } from '../../ui/Popover'
import { GoogleBrowser, type BrowserHandle, type BrowserState } from './GoogleBrowser'
import { ResultsGrid } from './ResultsGrid'
import s from './SearchView.module.css'

export function SearchView({ active }: { active: boolean }) {
  const search = useUI((st) => st.search)
  const setSearch = useUI((st) => st.setSearch)
  const settings = useSettings()!
  const browser = useRef<BrowserHandle>(null)
  const input = useRef<HTMLInputElement>(null)
  const [browserState, setBrowserState] = useState<BrowserState>({
    loading: false,
    canBack: false,
    canForward: false,
    url: '',
    failed: null
  })
  const [toolbarRef, toolbarSize] = useElementSize<HTMLDivElement>()
  // At laptop widths the source switcher collapses to icons (tooltips keep the names).
  const compact = toolbarSize.width > 0 && toolbarSize.width < 760
  const provider = search.provider

  useEffect(() => {
    const focus = () => {
      input.current?.focus()
      input.current?.select()
    }
    const google = (e: Event) => {
      const q = (e as CustomEvent<string>).detail
      useUI.getState().setSearch({ provider: 'google', query: q, submitted: q, pick: null })
      browser.current?.search(q)
    }
    window.addEventListener(FOCUS_SEARCH_EVENT, focus)
    window.addEventListener(GOOGLE_SEARCH_EVENT, google)
    return () => {
      window.removeEventListener(FOCUS_SEARCH_EVENT, focus)
      window.removeEventListener(GOOGLE_SEARCH_EVENT, google)
    }
  }, [])

  const submit = (query = search.query) => {
    const q = query.trim()
    if (!q) return
    setSearch({ submitted: q, query: q, pick: null })
    if (provider === 'google') browser.current?.search(q)
  }

  const setProvider = (p: SearchProviderId) => {
    setSearch({ provider: p })
    if (p === 'google' && search.query.trim() && search.query.trim() !== search.submitted)
      browser.current?.search(search.query.trim())
  }

  const setFilters = (patch: Partial<SearchFilters>) => {
    setSearch({ filters: { ...search.filters, ...patch } })
    if (provider === 'google' && search.submitted)
      requestAnimationFrame(() => browser.current?.search(search.submitted))
  }

  const onGoogle = provider === 'google'
  const site = onGoogle && browserState.url ? domainOf(browserState.url) : ''
  const offSite = onGoogle && site && !site.startsWith('google.') && !site.startsWith('127.0.0.1')

  return (
    <div className={s.view}>
      <Toolbar active={active}>
        <div className={s.toolbar} ref={toolbarRef}>
          <Segmented<SearchProviderId>
            size="sm"
            value={provider}
            onChange={setProvider}
            ariaLabel="Image source"
            options={[
              {
                value: 'google',
                label: compact ? undefined : 'Google',
                icon: <Globe />,
                tooltip: 'Google Images'
              },
              {
                value: 'wikimedia',
                label: compact ? undefined : 'Wikimedia',
                icon: <Landmark />,
                tooltip: 'Wikimedia Commons — free to use'
              },
              {
                value: 'openverse',
                label: compact ? undefined : 'Openverse',
                icon: <Sparkles />,
                tooltip: 'Openverse — Creative Commons images'
              },
              ...(settings.search.pexelsKey
                ? [
                    {
                      value: 'pexels' as const,
                      label: compact ? 'Px' : 'Pexels',
                      tooltip: 'Pexels stock photos & videos'
                    }
                  ]
                : [])
            ]}
          />
          {onGoogle && (
            <div className={s.nav}>
              <IconButton
                label="Back"
                size="sm"
                disabled={!browserState.canBack}
                onClick={() => browser.current?.back()}
              >
                <ArrowLeft />
              </IconButton>
              <IconButton
                label="Forward"
                size="sm"
                disabled={!browserState.canForward}
                onClick={() => browser.current?.forward()}
              >
                <ArrowRight />
              </IconButton>
              <IconButton label="Reload" size="sm" onClick={() => browser.current?.reload()}>
                <RotateCw className={clsx(browserState.loading && s.spin)} />
              </IconButton>
            </div>
          )}
          <form
            className={s.queryForm}
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <TextField
              ref={input}
              icon={<Search />}
              value={search.query}
              onChange={(e) => setSearch({ query: e.target.value })}
              placeholder={onGoogle ? 'Search Google Images — e.g. “Ephesus library ruins”' : 'Search images'}
              aria-label="Search images"
              data-testid="search-input"
              trailing={compact ? undefined : <kbd>{modKey} L</kbd>}
            />
          </form>
          {offSite && (
            <IconButton
              label={`Back to Google (now on ${site})`}
              size="sm"
              onClick={() => browser.current?.home()}
            >
              <Home />
            </IconButton>
          )}
          {onGoogle && browserState.url && !compact && (
            <IconButton
              label="Open this page in your browser"
              size="sm"
              onClick={() => attempt('system:openExternal', browserState.url)}
            >
              <ExternalLink />
            </IconButton>
          )}
          <FiltersButton filters={search.filters} provider={provider} onChange={setFilters} />
        </div>
      </Toolbar>
      <div className={s.body}>
        <GoogleBrowser ref={browser} visible={onGoogle} onState={setBrowserState} />
        {!onGoogle && <ResultsGrid provider={provider} query={search.submitted} filters={search.filters} />}
      </div>
    </div>
  )
}

function FiltersButton({
  filters,
  provider,
  onChange
}: {
  filters: SearchFilters
  provider: SearchProviderId
  onChange: (f: Partial<SearchFilters>) => void
}) {
  const settings = useSettings()!
  const open = useUI((st) => st.open)
  const active = filters.licensedOnly || filters.size === 'large' || (filters.type && filters.type !== 'any')
  return (
    <Popover
      align="end"
      width={290}
      trigger={
        <IconButton label="Search filters" size="sm" pressed={!!active} tone="amber">
          <SlidersHorizontal />
        </IconButton>
      }
    >
      <div className={s.filters}>
        {provider === 'google' && (
          <>
            <Field label="Creative Commons only" hint="Images labelled for reuse" inline>
              <Switch
                checked={!!filters.licensedOnly}
                onChange={(licensedOnly) => onChange({ licensedOnly })}
              />
            </Field>
            <Field label="Large images only" hint="Sharper on big screens" inline>
              <Switch
                checked={filters.size === 'large'}
                onChange={(on) => onChange({ size: on ? 'large' : 'any' })}
              />
            </Field>
            <Field label="Type" inline>
              <Select
                value={filters.type ?? 'any'}
                onChange={(e) => onChange({ type: e.target.value as SearchFilters['type'] })}
                className={s.typeSelect}
              >
                <option value="any">Any</option>
                <option value="photo">Photos</option>
                <option value="clipart">Clip art</option>
                <option value="lineart">Line drawings</option>
                <option value="animated">GIFs</option>
              </Select>
            </Field>
            <div className={s.safe}>
              <ShieldCheck size={14} />
              SafeSearch is {settings.search.safeSearch ? 'on' : 'off'}.
              <button onClick={() => open('settings', 'search')}>Change</button>
            </div>
          </>
        )}
        {provider === 'pexels' && (
          <Field label="Show" inline>
            <Segmented<'image' | 'video'>
              size="sm"
              value={filters.media ?? 'image'}
              onChange={(media) => onChange({ media })}
              options={[
                { value: 'image', label: 'Photos' },
                { value: 'video', label: 'Videos' }
              ]}
            />
          </Field>
        )}
        {(provider === 'wikimedia' || provider === 'openverse') && (
          <div className={s.safe}>
            Results are openly licensed. Credits can be shown on screen (Settings → Output).
          </div>
        )}
      </div>
    </Popover>
  )
}
