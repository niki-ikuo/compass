/** VS Code–style outline icons for the menu bar toolbar */

const iconProps = {
  width: '18',
  height: '18',
  viewBox: '0 0 16 16',
  fill: 'none',
  'aria-hidden': true as const
}

export function SettingsIcon() {
  return (
    <svg {...iconProps}><path
        d="M8 2.2l.85 1.75 1.95-.5.55 1.85 1.85.55-.5 1.95L13.8 8l-1.75.85.5 1.95-1.85.55-.55 1.85-1.95-.5L8 13.8l-.85-1.75-1.95.5-.55-1.85-1.85-.55.5-1.95L2.2 8l1.75-.85-.5-1.95 1.85-.55.55-1.85 1.95.5L8 2.2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function ExplorerIcon() {
  return (
    <svg {...iconProps}><path
        d="M2.5 2.5h4.2L8.2 4h5.3v9.5H2.5V2.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 7h5M5.5 9.5h3.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ChatIcon() {
  return (
    <svg {...iconProps}><path
        d="M2.5 3h11v6.5H8.5L6 13V9.5H2.5V3z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M5 6.5h6M5 8.5h4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg {...iconProps}><circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10.2 10.2L13.5 13.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function TerminalIcon() {
  return (
    <svg {...iconProps}><rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M4.5 6.5L6.5 8 4.5 9.5M7.5 9.5H11"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 新規ファイル（ドキュメント + プラス） */
export function NewFileIcon() {
  return (
    <svg {...iconProps}><path
        d="M3.5 1.5h5.5L11.5 4.5V12.5H3.5V1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M9 1.5v3h2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 10.5h3M12 9v3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 新規フォルダ（フォルダ + プラス） */
export function NewFolderIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M1.5 4h4.5L7.5 5.5H14.5V13H1.5V4z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M10 9.5h3M11.5 8v3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** すべて展開 — 下向き矢印 + リスト（下へ開く） */
export function ExpandAllIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M3.5 2.5L6 5L8.5 2.5M2 7.5h8M2 10h8M2 12.5h8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** すべて折りたたむ — リスト + 上向き矢印（上へ閉じる） */
export function CollapseAllIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M2 3.5h8M2 6h8M2 8.5h8M3.5 13.5L6 11L8.5 13.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function RefreshIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M12.5 4.5A5.5 5.5 0 1 0 13.8 9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M13.5 2.5v2.5h-2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M8 3.5v9M3.5 8h9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M3 4.5h10M5.5 4.5V3.5h5v1M6 4.5v7.5M10 4.5v7.5M4 4.5l.5 8h7l.5-8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M4.5 4.5l7 7M11.5 4.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ListIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** チャット履歴一覧 — 巻き戻し矢印付き時計 */
export function ChatHistoryIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M2.5 8A5.5 5.5 0 1 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M2 2.5v3h3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 5.5V8l1.8 1.2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ChevronRightIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M6 3.5l4.5 4.5L6 12.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ChevronDownIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M3.5 6L8 10.5L12.5 6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ArrowLeftIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M9.5 3.5L5 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ArrowRightIcon() {
  return (
    <svg {...iconProps}>
      <path
        d="M6.5 3.5L11 8l-4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function StopIcon() {
  return (
    <svg {...iconProps}>
      <rect
        x="4.5"
        y="4.5"
        width="7"
        height="7"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}
