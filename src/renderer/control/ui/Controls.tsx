import { Slider as RS, Switch as RSw } from 'radix-ui'
import clsx from 'clsx'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react'
import { Tooltip } from './Tooltip'
import s from './Controls.module.css'

export interface SegmentOption<T extends string> {
  value: T
  label?: ReactNode
  icon?: ReactNode
  tooltip?: string
  shortcut?: string
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  ariaLabel
}: {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}) {
  return (
    <div className={clsx(s.segmented, s[`seg_${size}`], className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <Tooltip key={o.value} label={o.tooltip} shortcut={o.shortcut}>
          <button
            type="button"
            role="radio"
            aria-checked={value === o.value}
            // A visible label is the name; icon-only segments are named by their tooltip.
            aria-label={typeof o.label === 'string' ? undefined : (o.tooltip ?? o.value)}
            aria-description={typeof o.label === 'string' ? o.tooltip : undefined}
            className={clsx(s.segment, value === o.value && s.segmentOn)}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label !== undefined && <span>{o.label}</span>}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  className,
  ariaLabel,
  disabled
}: {
  value: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
  ariaLabel?: string
  disabled?: boolean
}) {
  return (
    <RS.Root
      className={clsx(s.slider, className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onChange(v[0])}
      onValueCommit={(v) => onCommit?.(v[0])}
    >
      <RS.Track className={s.track}>
        <RS.Range className={s.range} />
      </RS.Track>
      <RS.Thumb className={s.thumb} aria-label={ariaLabel} />
    </RS.Root>
  )
}

export function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled,
  'aria-describedby': describedBy
}: {
  checked: boolean
  onChange: (v: boolean) => void
  ariaLabel?: string
  disabled?: boolean
  'aria-describedby'?: string
}) {
  return (
    <RSw.Root
      className={s.switch}
      checked={checked}
      onCheckedChange={onChange}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      disabled={disabled}
    >
      <RSw.Thumb className={s.switchThumb} />
    </RSw.Root>
  )
}

export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; trailing?: ReactNode }
>(function TextField({ className, icon, trailing, ...rest }, ref) {
  if (!icon && !trailing)
    return <input ref={ref} className={clsx(s.input, className)} spellCheck={false} {...rest} />
  return (
    <div className={clsx(s.inputWrap, className)}>
      {icon && <span className={s.inputIcon}>{icon}</span>}
      <input ref={ref} className={clsx(s.input, s.inputBare)} spellCheck={false} {...rest} />
      {trailing && <span className={s.inputTrailing}>{trailing}</span>}
    </div>
  )
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={clsx(s.input, s.textarea, className)} {...rest} />
  }
)

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={clsx(s.selectWrap, className)}>
      <select className={clsx(s.input, s.select)} {...rest}>
        {children}
      </select>
      <ChevronDown className={s.selectChevron} size={14} />
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  inline,
  className
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  inline?: boolean
  className?: string
}) {
  // The label names the control; the hint describes it (rather than lengthening its name).
  const hintId = useId()
  const control =
    hint && isValidElement<{ 'aria-describedby'?: string }>(children)
      ? cloneElement(children, { 'aria-describedby': hintId })
      : children
  return (
    <label className={clsx(s.field, inline && s.fieldInline, className)}>
      <span className={s.fieldText}>
        <span className={s.fieldLabel}>{label}</span>
        {hint && (
          <span className={s.fieldHint} id={hintId} aria-hidden>
            {hint}
          </span>
        )}
      </span>
      <span className={s.fieldControl}>{control}</span>
    </label>
  )
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <LoaderCircle className={clsx(s.spinner, className)} size={size} />
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  compact
}: {
  icon?: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={clsx(s.empty, compact && s.emptyCompact)}>
      {icon && <div className={s.emptyIcon}>{icon}</div>}
      <div className={s.emptyTitle}>{title}</div>
      {children && <div className={s.emptyText}>{children}</div>}
      {action && <div className={s.emptyAction}>{action}</div>}
    </div>
  )
}

export function SectionLabel({
  children,
  right,
  className
}: {
  children: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx(s.section, className)}>
      <span>{children}</span>
      {right && <span className={s.sectionRight}>{right}</span>}
    </div>
  )
}
