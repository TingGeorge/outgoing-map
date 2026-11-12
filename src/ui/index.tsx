import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon, WarningIcon } from './icons'
import { getToasts, subscribeToasts, type ToastTone } from './toast'
import s from './ui.module.css'

export * from './icons'
export * from './format'
export { toast, type ToastTone } from './toast'

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
  inline?: boolean
  icon?: ReactNode
  iconEnd?: ReactNode
  block?: boolean
  href?: string
  target?: string
  onClick?: (event: MouseEvent<HTMLElement>) => void
  type?: 'button' | 'submit'
  disabled?: boolean
}

export function Button({
  children,
  variant = 'primary',
  inline = false,
  icon,
  iconEnd,
  block = false,
  href,
  target,
  onClick,
  type = 'button',
  disabled = false,
}: ButtonProps) {
  const className = cx(s.button, s[variant], inline && s.inline, block && s.block)
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

interface ModalProps {
  open: boolean
  onClose: () => void
  kind: 'dialog' | 'sheet'
  labelledBy?: string
  label?: string
  children: ReactNode
}

let keyboardUser = false

if (typeof window !== 'undefined') {
  addEventListener('keydown', () => (keyboardUser = true), true)
  addEventListener('pointerdown', () => (keyboardUser = false), true)
}

function Modal({ open, onClose, kind, labelledBy, label, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedOnBackdrop = useRef(false)
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      opener.current = document.activeElement as HTMLElement | null
      dialog.showModal()

      const focused = document.activeElement
      if (!keyboardUser && !(focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) dialog.focus()
    }
    if (!open && dialog.open) {
      dialog.close()
      opener.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = before
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={cx(s.modal, s[kind])}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOnBackdrop.current) onClose()
      }}
    >
      {open && children}
    </dialog>
  )
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children?: ReactNode
  actions?: ReactNode
}

export function Dialog({ open, onClose, title, children, actions }: DialogProps) {
  const titleId = useId()

  return (
    <Modal open={open} onClose={onClose} kind="dialog" labelledBy={titleId}>
      <div className={s.dialogBody}>
        <h2 id={titleId} className={s.dialogTitle}>
          {title}
        </h2>
        {children && <div className={s.dialogText}>{children}</div>}
        {actions && <div className={s.dialogActions}>{actions}</div>}
      </div>
    </Modal>
  )
}

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const icon = busy ? <span className={s.ring} aria-hidden="true" /> : danger ? <WarningIcon size={20} /> : undefined

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'primary' : 'dark'} icon={icon} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <span className={s.confirmMessage}>
        {danger && (
          <span className={s.confirmIcon}>
            <WarningIcon size={22} />
          </span>
        )}
        <span>{message}</span>
      </span>
    </Dialog>
  )
}

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const titleId = useId()

  return (
    <Modal open={open} onClose={onClose} kind="sheet" labelledBy={title ? titleId : undefined} label="選項">
      <div className={s.sheetBody}>
        <div className={s.sheetHead}>
          {title && (
            <h2 id={titleId} className={s.sheetTitle}>
              {title}
            </h2>
          )}
          <span className={s.sheetClose}>
            <IconButton label="關閉" variant="moss" onClick={onClose}>
              <CloseIcon size={20} />
            </IconButton>
          </span>
        </div>
        <div className={s.sheetScroll}>{children}</div>
      </div>
    </Modal>
  )
}

export interface ActionRowProps {
  icon?: ReactNode
  label: string
  hint?: string
  danger?: boolean
  onClick?: () => void
  href?: string
  disabled?: boolean
}

export function ActionRow({ icon, label, hint, danger = false, onClick, href, disabled = false }: ActionRowProps) {
  const className = cx(s.actionRow, danger && s.rowDanger)
  const body = (
    <>
      {icon && <span className={s.rowIcon}>{icon}</span>}
      <span className={s.rowText}>
        <span className={s.rowLabel}>
          {label}
          {danger && <WarningIcon size={18} />}
        </span>
        {hint && <span className={s.rowHint}>{hint}</span>}
      </span>
    </>
  )

  if (href !== undefined && !disabled) {
    return (
      <a className={className} href={href} onClick={onClick}>
        {body}
      </a>
    )
  }

  return (
    <button className={className} type="button" onClick={onClick} disabled={disabled}>
      {body}
    </button>
  )
}

const toneIcon = { info: InfoIcon, success: CheckIcon, warning: WarningIcon, error: AlertIcon }

export interface NoticeProps {
  tone: ToastTone
  title?: string
  children: ReactNode
  action?: ReactNode
  onDismiss?: () => void
}

export function Notice({ tone, title, children, action, onDismiss }: NoticeProps) {
  const Icon = toneIcon[tone]

  return (
    <div className={cx(s.notice, s[`notice-${tone}`])} role={tone === 'error' ? 'alert' : 'status'}>
      <span className={s.noticeIcon}>
        <Icon size={22} />
      </span>
      <div className={s.noticeBody}>
        {title && <strong className={s.noticeTitle}>{title}</strong>}
        <div>{children}</div>
        {action && <div className={s.noticeAction}>{action}</div>}
      </div>
      {onDismiss && (
        <span
          className={s.noticeDismiss}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton label="關閉提醒" variant="moss" onClick={onDismiss}>
            <CloseIcon size={20} />
          </IconButton>
        </span>
      )}
    </div>
  )
}

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const layer = ref.current
    if (!layer?.showPopover || items.length === 0) return

    if (layer.matches(':popover-open')) layer.hidePopover()
    layer.showPopover()
  }, [items])

  return (
    <div ref={ref} popover="manual" className={s.toaster} aria-live="polite">
      {items.map((t) => {
        const Icon = toneIcon[t.tone]

        return (
          <div key={t.id} className={s.toast}>
            <span className={s[`toastIcon-${t.tone}`]}>
              <Icon size={20} />
            </span>
            <span>{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className={s.spinner} role="status">
      <span className={s.ring} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  )
}

export interface ProgressBarProps {
  value: number
  max: number
  label: string
}

export function ProgressBar({ value, max, label }: ProgressBarProps) {
  const fraction = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0

  return (
    <div className={s.progressWrap}>
      <span className={s.progressLabel}>{label}</span>
      <div className={s.progress} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className={s.progressFill} style={{ transform: `translateX(${(fraction - 1) * 100}%)` }} />
      </div>
    </div>
  )
}

export interface EmptyStateProps {
  art?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}

export function EmptyState({ art, title, children, action }: EmptyStateProps) {
  return (
    <div className={s.empty}>
      {art && <div className={s.emptyArt}>{art}</div>}
      <h2 className={s.emptyTitle}>{title}</h2>
      {children && <p className={s.emptyText}>{children}</p>}
      {action}
    </div>
  )
}

export interface FilePickerProps {
  accept?: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  children: ReactNode
  variant?: ButtonProps['variant']
  inline?: boolean
  icon?: ReactNode
  block?: boolean
  disabled?: boolean
}

export function FilePicker({ accept, multiple, onFiles, children, variant, inline, icon, block, disabled }: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <Button variant={variant} inline={inline} icon={icon} block={block} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </>
  )
}
