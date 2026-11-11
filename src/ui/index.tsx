import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import s from './ui.module.css'

export * from './icons'
export * from './format'

function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ')
}

export interface ScreenProps {
  children: ReactNode
  bottom?: ReactNode
  bleed?: boolean
  className?: string
}

export function Screen({ children, bottom, bleed = false, className }: ScreenProps) {
  return (
    <div className={s.screen}>
      <main className={cx(s.content, bleed && s.bleed, className)}>{children}</main>
      {bottom && <div className={s.bottom}>{bottom}</div>}
    </div>
  )
}

export interface ButtonProps {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'dark'
  icon?: ReactNode
  iconEnd?: ReactNode
  block?: boolean
  href?: string
  target?: string
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
}

export function Button({
  children,
  variant = 'primary',
  icon,
  iconEnd,
  block = false,
  href,
  target,
  onClick,
  type = 'button',
  disabled = false,
}: ButtonProps) {
  const className = cx(s.button, s[variant], block && s.block)
  const body = (
    <>
      {icon}
      <span>{children}</span>
      {iconEnd}
    </>
  )

  if (href !== undefined) {
    return (
      <a className={className} href={href} target={target} rel={target ? 'noopener noreferrer' : undefined} onClick={onClick}>
        {body}
      </a>
    )
  }

  return (
    <button className={className} type={type} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  )
}

export interface IconButtonProps {
  label: string
  children: ReactNode
  variant?: 'paper' | 'moss' | 'dark'
  size?: 44 | 48 | 64
  href?: string
  onClick?: () => void
  disabled?: boolean
}

export function IconButton({ label, children, variant = 'paper', size = 44, href, onClick, disabled = false }: IconButtonProps) {
  const className = cx(s.iconButton, s[`icon-${variant}`])
  const style = { width: size, height: size }

  if (href !== undefined) {
    return (
      <a className={className} style={style} href={href} aria-label={label} onClick={onClick}>
        {children}
      </a>
    )
  }

  return (
    <button className={className} style={style} type="button" aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

export interface CardProps {
  children: ReactNode
  tone?: 'paper' | 'moss' | 'sun'
  radius?: 'sm' | 'md' | 'lg'
  elevated?: boolean
  href?: string
  className?: string
}

export function Card({ children, tone = 'paper', radius = 'md', elevated = false, href, className }: CardProps) {
  const classes = cx(s.card, s[`tone-${tone}`], s[`radius-${radius}`], elevated && s.elevated, href !== undefined && s.cardLink, className)

  if (href !== undefined) {
    return (
      <a className={classes} href={href}>
        {children}
      </a>
    )
  }

  return <div className={classes}>{children}</div>
}

export interface ChipProps {
  children: ReactNode
  tone?: 'moss' | 'sun' | 'paper'
}

export function Chip({ children, tone = 'moss' }: ChipProps) {
  return <span className={cx(s.chip, s[`tone-${tone}`])}>{children}</span>
}

export interface StatTileProps {
  label: string
  value: string
  unit?: string
}

export function StatTile({ label, value, unit }: StatTileProps) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>
        {value}
        {unit && <span className={s.statUnit}> {unit}</span>}
      </span>
    </div>
  )
}

export interface PolaroidProps {
  alt: string
  src?: string
  caption?: ReactNode
  meta?: ReactNode
  tilt?: number
  size?: 'sm' | 'md'
  children?: ReactNode
}

export function Polaroid({ alt, src, caption, meta, tilt = 0, size = 'md', children }: PolaroidProps) {
  return (
    <figure className={cx(s.polaroid, s[`polaroid-${size}`])} style={{ rotate: `${tilt}deg` }}>
      <div className={s.photo}>{src ? <img src={src} alt={alt} loading="lazy" decoding="async" /> : children}</div>
      {(caption || meta) && (
        <figcaption>
          {caption && <span className={s.caption}>{caption}</span>}
          {meta && <span className={s.meta}>{meta}</span>}
        </figcaption>
      )}
    </figure>
  )
}

export interface RidgeProps {
  variant?: 'header' | 'banner'
}

export function Ridge({ variant = 'header' }: RidgeProps) {
  if (variant === 'banner') {
    return (
      <svg aria-hidden="true" className={s.ridgeBanner} viewBox="0 0 342 150" preserveAspectRatio="xMidYMid slice">
        <rect width="342" height="150" fill="var(--color-sky)" />
        <circle cx="268" cy="48" r="24" fill="var(--color-sun)" />
        <path d="M0 104 L56 70 L96 94 L150 50 L204 96 L250 74 L342 112 L342 150 L0 150 Z" fill="var(--color-ridge-mid)" />
        <path d="M0 128 Q110 100 200 124 T342 122 L342 150 L0 150 Z" fill="var(--color-ridge-near)" />
        <path
          d="M40 136 C80 118 96 110 118 96 S140 66 150 50"
          fill="none"
          stroke="var(--color-white)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray="1 10"
        />
        <path d="M150 50 L150 28 L168 34 L150 40" fill="var(--color-accent)" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" className={s.ridgeHeader} viewBox="0 0 390 230" preserveAspectRatio="xMidYMax slice">
      <rect width="390" height="230" fill="var(--color-sky)" />
      <circle cx="304" cy="74" r="34" fill="var(--color-sun)" />
      <path d="M0 150 L60 112 L104 138 L170 84 L226 132 L282 100 L340 136 L390 110 L390 230 L0 230 Z" fill="var(--color-ridge-far)" />
      <path d="M0 186 L52 158 L110 180 L188 136 L250 176 L318 150 L390 182 L390 230 L0 230 Z" fill="var(--color-ridge-mid)" />
      <path d="M0 214 Q100 190 200 208 T390 200 L390 230 L0 230 Z" fill="var(--color-bg)" />
    </svg>
  )
}

export interface SectionTitleProps {
  children: ReactNode
  as?: 'h2' | 'h3'
}

export function SectionTitle({ children, as: Tag = 'h2' }: SectionTitleProps) {
  return <Tag className={s.sectionTitle}>{children}</Tag>
}

interface FieldChrome {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  error?: ReactNode
}

export type TextFieldProps = FieldChrome & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>

export function TextField({ label, value, onChange, hint, error, ...rest }: TextFieldProps) {
  const id = useId()

  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      <input
        {...rest}
        id={id}
        className={s.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-note` : undefined}
      />
      {(hint || error) && (
        <div id={`${id}-note`} className={error ? s.error : s.hint}>
          {error ?? hint}
        </div>
      )}
    </div>
  )
}

export type TextAreaProps = FieldChrome & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'className'>

export function TextArea({ label, value, onChange, hint, error, ...rest }: TextAreaProps) {
  const id = useId()

  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
      </label>
      <textarea
        {...rest}
        id={id}
        className={cx(s.input, s.textarea)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-note` : undefined}
      />
      {(hint || error) && (
        <div id={`${id}-note`} className={error ? s.error : s.hint}>
          {error ?? hint}
        </div>
      )}
    </div>
  )
}
