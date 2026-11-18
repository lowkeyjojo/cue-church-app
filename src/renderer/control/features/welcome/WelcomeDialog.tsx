import { useRef, useState } from 'react'
import { Dialog as D } from 'radix-ui'
import clsx from 'clsx'
import { Globe, Moon, ScanSearch, SunMedium, Tv } from 'lucide-react'
import { attempt, modKey } from '../../lib/api'
import { useApp, useSettings } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/Controls'
import s from './Welcome.module.css'

/**
 * First run: what Cue is, connecting the screen, and the three keys that
 * matter. It is the first thing anyone sees after installing: Cue's mark, a
 * warm welcome, and three short steps.
 */
export function WelcomeDialog() {
  const close = useUI((st) => st.close)
  const settings = useSettings()!
  const displays = useApp((st) => st.displays)
  const [step, setStep] = useState(0)
  const [forward, setForward] = useState(true)
  const [name, setName] = useState(settings.output.name)
  const content = useRef<HTMLDivElement>(null)
  const finish = () => {
    void attempt('settings:update', { ui: { firstRunDone: true }, output: { name: name.trim() || 'TV' } })
    close('welcome')
  }
  const go = (to: number) => {
    setForward(to > step)
    setStep(to)
  }
  const external = displays?.displays.filter((d) => !d.hasControl) ?? []
  const steps = [
    {
      title: 'Welcome to Cue',
      lead: 'Everything you show on Sunday, from one calm screen.',
      body: (
        <ul className={s.features}>
          <li>
            <span className={clsx(s.featureIcon, s.sage)}>
              <Globe size={19} />
            </span>
            <div>
              <strong>Search the web</strong>
              <span>Click any image in Google and it lands in Preview, ready to show.</span>
            </div>
          </li>
          <li>
            <span className={clsx(s.featureIcon, s.gold)}>
              <Tv size={19} />
            </span>
            <div>
              <strong>Preview, then show</strong>
              <span>Nothing reaches the screen until you press Show.</span>
            </div>
          </li>
          <li>
            <span className={clsx(s.featureIcon, s.sand)}>
              <SunMedium size={19} />
            </span>
            <div>
              <strong>Breaks and countdowns</strong>
              <span>Quiet ambient scenes with a welcome, a clock or a countdown.</span>
            </div>
          </li>
        </ul>
      )
    },
    {
      title: 'Your audience screen',
      lead: 'The TV or projector the room looks at.',
      body: (
        <div className={s.stepBody}>
          <div className={clsx(s.statusCard, external.length > 0 && s.statusOn)}>
            <div>
              <strong>
                {external.length
                  ? `${external.length} extra display${external.length > 1 ? 's' : ''} found`
                  : 'No TV or projector connected yet'}
              </strong>
              <span>
                {external.length
                  ? `Cue will show your content fullscreen on ${external[0].label}.`
                  : 'Plug one in any time and Cue switches to it automatically. Until then, the Live monitor shows exactly what the room would see.'}
              </span>
            </div>
          </div>
          <label className={s.nameField}>
            <span>What do you call it?</span>
            <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="TV" />
            <small>Used on buttons like “Show on {name.trim() || 'TV'}”.</small>
          </label>
          {external.length > 0 && (
            <Button size="sm" icon={<ScanSearch />} onClick={() => attempt('displays:identify')}>
              Identify displays
            </Button>
          )}
        </div>
      )
    },
    {
      title: 'Three keys to remember',
      lead: 'These run a whole service.',
      body: (
        <div className={s.stepBody}>
          <div className={s.bigKeys}>
            <div>
              <kbd className={s.bigKbd}>Space</kbd>
              <span>Show what's in Preview</span>
            </div>
            <div>
              <kbd className={s.bigKbd}>→</kbd>
              <span>Next slide or page</span>
            </div>
            <div>
              <kbd className={s.bigKbd}>B</kbd>
              <span>
                <Moon size={13} /> Blackout
              </span>
            </div>
          </div>
          <p className={s.note}>
            {modKey}+K finds anything. {modKey}+V pastes an image or link straight into Preview. A sample
            service plan is ready on the left to try it all.
          </p>
        </div>
      )
    }
  ]
  const current = steps[step]
  const last = step === steps.length - 1
  return (
    <D.Root open onOpenChange={(open) => !open && finish()}>
      <D.Portal>
        <D.Overlay className={s.overlay} />
        <D.Content
          ref={content}
          className={s.welcome}
          aria-describedby={undefined}
          tabIndex={-1}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            content.current?.focus()
          }}
        >
          <div className={s.mark} aria-hidden />
          <div className={s.side}>
            {/* Keyed, so each step slides in from the side it came from. */}
            <div key={step} className={clsx(s.step, forward ? s.fromRight : s.fromLeft)}>
              <D.Title className={s.title}>{current.title}</D.Title>
              <p className={s.lead}>{current.lead}</p>
              {current.body}
            </div>
            <footer className={s.footer}>
              {step > 0 ? (
                <Button variant="ghost" onClick={() => go(step - 1)}>
                  Back
                </Button>
              ) : (
                <Button variant="ghost" onClick={finish}>
                  Skip
                </Button>
              )}
              <div className={s.dots} aria-hidden>
                {steps.map((_, i) => (
                  <span key={i} className={clsx(s.dot, i === step && s.dotOn)} />
                ))}
              </div>
              {last ? (
                <Button variant="primary" size="lg" onClick={finish}>
                  Start using Cue
                </Button>
              ) : (
                <Button variant="primary" size="lg" onClick={() => go(step + 1)}>
                  Continue
                </Button>
              )}
            </footer>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
