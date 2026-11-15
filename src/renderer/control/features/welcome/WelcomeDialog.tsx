import { useState } from 'react'
import clsx from 'clsx'
import { Globe, Keyboard, MonitorSpeaker, Moon, ScanSearch, Sparkles, Tv } from 'lucide-react'
import { attempt, modKey } from '../../lib/api'
import { useApp, useSettings } from '../../lib/store'
import { useUI } from '../../lib/ui'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { TextField } from '../../ui/Controls'
import s from './Welcome.module.css'

/** First-run walkthrough: what Cue is, connecting the screen, and the three keys that matter. */
export function WelcomeDialog() {
  const close = useUI((st) => st.close)
  const settings = useSettings()!
  const displays = useApp((st) => st.displays)
  const [step, setStep] = useState(0)
  const [name, setName] = useState(settings.output.name)
  const finish = () => {
    void attempt('settings:update', { ui: { firstRunDone: true }, output: { name: name.trim() || 'TV' } })
    close('welcome')
  }
  const external = displays?.displays.filter((d) => !d.hasControl) ?? []
  const steps = [
    {
      title: 'Welcome to Cue',
      body: (
        <div className={s.hero}>
          <div className={s.heroGlow} />
          <p className={s.lead}>Find visuals privately. Show them to the room intentionally.</p>
          <div className={s.features}>
            <div>
              <Globe size={18} />
              <strong>Search the web</strong>
              <span>Click any image in Google — it lands in Preview, ready to show.</span>
            </div>
            <div>
              <Tv size={18} />
              <strong>Preview, then show</strong>
              <span>Nothing reaches the screen until you press Show.</span>
            </div>
            <div>
              <Sparkles size={18} />
              <strong>Breaks & countdowns</strong>
              <span>Gentle ambient scenes with a welcome, clock or countdown.</span>
            </div>
          </div>
        </div>
      )
    },
    {
      title: 'Your audience screen',
      body: (
        <div className={s.stepBody}>
          <div className={s.statusCard}>
            <MonitorSpeaker size={20} />
            <div>
              <strong>
                {external.length
                  ? `${external.length} extra display${external.length > 1 ? 's' : ''} found`
                  : 'No TV or projector connected yet'}
              </strong>
              <span>
                {external.length
                  ? `Cue will show your content fullscreen on ${external[0].label}.`
                  : 'Plug one in any time — Cue switches to it automatically. Until then, the Live monitor shows exactly what the room would see.'}
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
            <Keyboard size={13} /> {modKey}+K finds anything. {modKey}+V pastes an image or link straight into
            Preview. A sample service plan is ready on the left to try it all.
          </p>
        </div>
      )
    }
  ]
  const current = steps[step]
  return (
    <Dialog
      open
      onClose={finish}
      width={600}
      initialFocus={false}
      title={current.title}
      footer={
        <>
          <div className={s.dots}>
            {steps.map((_, i) => (
              <span key={i} className={clsx(s.dot, i === step && s.dotOn)} />
            ))}
          </div>
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < steps.length - 1 ? (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" onClick={finish}>
              Start using Cue
            </Button>
          )}
        </>
      }
    >
      {current.body}
    </Dialog>
  )
}
