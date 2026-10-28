import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import { Tooltip } from './Tooltip'
import s from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  /** Trailing content (e.g. a keyboard hint). */
  trailing?: ReactNode
  pressed?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    trailing,
    pressed,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(s.button, s[variant], s[size], pressed && s.pressed, className)}
      aria-pressed={pressed}
      {...rest}
    >
      {icon && <span className={s.icon}>{icon}</span>}
      {children !== undefined && <span className={s.label}>{children}</span>}
      {trailing && <span className={s.trailing}>{trailing}</span>}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  shortcut?: string
  size?: Size
  pressed?: boolean
  tone?: 'default' | 'amber' | 'live'
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    shortcut,
    size = 'md',
    pressed,
    tone = 'default',
    tooltipSide,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        className={clsx(
          s.iconButton,
          s[`i_${size}`],
          pressed && s.iconPressed,
          tone !== 'default' && s[`tone_${tone}`],
          className
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  )
})
