import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
}

function stroke(paths: ReactNode, width = 2.2) {
  return function Icon({ size = 22 }: IconProps) {
    return (
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths}
      </svg>
    )
  }
}

function solid(paths: ReactNode) {
  return function Icon({ size = 22 }: IconProps) {
    return (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        {paths}
      </svg>
    )
  }
}

export const SettingsIcon = stroke(
  <>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </>,
  1.8,
)

export const PlusIcon = stroke(<path d="M12 5v14M5 12h14" />, 2.4)

export const BackIcon = stroke(<path d="M15 5l-7 7 7 7" />)

export const ChevronRightIcon = stroke(<path d="M9 5l7 7-7 7" />)

export const CloseIcon = stroke(<path d="M6 6l12 12M18 6L6 18" />, 2.4)

export const ExternalIcon = stroke(<path d="M8 16L16 8M9 8h7v7" />, 2.4)

export const CheckIcon = stroke(<path d="M5 12.5l4.5 4.5L19 7.5" />, 2.4)

export const LockIcon = stroke(
  <>
    <rect x="5" y="11" width="14" height="9" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
  2,
)

export const AlertIcon = stroke(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </>,
  2,
)

export const EditIcon = stroke(<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />, 2)

export const TrashIcon = stroke(<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" />, 2)

export const PhotoIcon = stroke(
  <>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" />
  </>,
  2,
)

export const RouteIcon = stroke(
  <>
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16" />
  </>,
  2,
)

export const PinIcon = stroke(
  <>
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </>,
  2,
)

export const UploadIcon = stroke(<path d="M12 16V4M7 9l5-5 5 5M5 20h14" />, 2)

export const DownloadIcon = stroke(<path d="M12 4v12M7 11l5 5 5-5M5 20h14" />, 2)

export const ExpandIcon = stroke(<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />, 2)

export const PlayIcon = solid(<path d="M7 4.5v15l13-7.5z" />)

export const PauseIcon = solid(<path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" />)

export const PrevIcon = solid(<path d="M19 5v14l-10-7zM5 5h2.5v14H5z" />)

export const NextIcon = solid(<path d="M5 5v14l10-7zM16.5 5H19v14h-2.5z" />)
