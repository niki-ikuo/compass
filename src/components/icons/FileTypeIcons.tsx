import type { ReactElement } from 'react'

const SIZE = 16

/** Soft tint of a hex color for icon fills (works on light/dark themes). */
function tint(hex: string, alpha = 0.18): string {
  const n = hex.replace('#', '')
  const r = Number.parseInt(n.slice(0, 2), 16)
  const g = Number.parseInt(n.slice(2, 4), 16)
  const b = Number.parseInt(n.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function FolderIcon({ open }: { open?: boolean }): ReactElement {
  const color = '#dcb67a'
  if (open) {
    return (
      <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M1.5 4.5h4.2L7 6h7.5v7.5H1.5V4.5z"
          fill={tint(color, 0.22)}
          stroke={color}
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M1.5 7.5h13L13.2 13.5H2.8L1.5 7.5z"
          fill={tint(color, 0.35)}
          stroke={color}
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 3.5h4.2L7 5h7.5v8.5H1.5V3.5z"
        fill={tint(color, 0.22)}
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DocIcon({
  color,
  label
}: {
  color: string
  label?: string
}): ReactElement {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 1.5h6L12.5 4.5v10h-9v-13z"
        fill={tint(color)}
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 1.5v3h3"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {label ? (
        <text
          x="8"
          y="12"
          textAnchor="middle"
          fill={color}
          fontSize="5.5"
          fontWeight="700"
          fontFamily="Segoe UI, system-ui, sans-serif"
        >
          {label}
        </text>
      ) : null}
    </svg>
  )
}

function ImageIcon(): ReactElement {
  const color = '#c679dd'
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="2"
        y="2.5"
        width="12"
        height="11"
        rx="1"
        fill={tint(color)}
        stroke={color}
        strokeWidth="1.2"
      />
      <circle cx="5.5" cy="6" r="1.2" fill={color} />
      <path
        d="M2.5 11.5l3.2-3.2 2.3 2.3 2.2-2.8 3.3 3.7"
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ConfigIcon(): ReactElement {
  const color = '#6d8086'
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.2" stroke={color} strokeWidth="1.2" fill={tint(color)} />
      <path
        d="M8 2.2l.7 1.5 1.6-.4.45 1.55 1.55.45-.4 1.6L13.8 8l-1.4.7.4 1.6-1.55.45-.45 1.55-1.6-.4L8 13.8l-.7-1.5-1.6.4-.45-1.55-1.55-.45.4-1.6L2.2 8l1.4-.7-.4-1.6 1.55-.45.45-1.55 1.6.4L8 2.2z"
        stroke={color}
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function GitIcon(): ReactElement {
  const color = '#f05033'
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8.9 2.1l5 5c.5.5.5 1.3 0 1.8l-5 5c-.5.5-1.3.5-1.8 0l-5-5c-.5-.5-.5-1.3 0-1.8l5-5c.5-.5 1.3-.5 1.8 0z"
        fill={tint(color)}
        stroke={color}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="6.2" cy="9.8" r="1.1" fill={color} />
      <circle cx="9.8" cy="6.2" r="1.1" fill={color} />
      <circle cx="9.8" cy="9.8" r="1.1" fill={color} />
      <path
        d="M6.2 9.8h3.6M9.8 6.2v3.6"
        stroke={color}
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LockIcon(): ReactElement {
  const color = '#c8c8c8'
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="3.5"
        y="7"
        width="9"
        height="6.5"
        rx="1"
        fill={tint(color)}
        stroke={color}
        strokeWidth="1.2"
      />
      <path
        d="M5.5 7V5.2a2.5 2.5 0 015 0V7"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DatabaseIcon(): ReactElement {
  const color = '#e2c08d'
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" fill="none" aria-hidden>
      <ellipse cx="8" cy="4" rx="5" ry="2" fill={tint(color)} stroke={color} strokeWidth="1.2" />
      <path
        d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4"
        stroke={color}
        strokeWidth="1.2"
      />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" stroke={color} strokeWidth="1.2" />
    </svg>
  )
}

const COLORS = {
  typescript: '#3178c6',
  javascript: '#f0db4f',
  python: '#3572a5',
  json: '#cbcb41',
  markdown: '#519aba',
  html: '#e34c26',
  css: '#563d7c',
  scss: '#c6538c',
  yaml: '#cb171e',
  xml: '#e37933',
  sql: '#e2c08d',
  rust: '#dea584',
  go: '#00add8',
  java: '#b07219',
  csharp: '#178600',
  cpp: '#f34b7d',
  c: '#555555',
  shell: '#89e051',
  powershell: '#012456',
  docker: '#2496ed',
  react: '#61dafb',
  vue: '#41b883',
  svelte: '#ff3e00',
  toml: '#9c4221',
  text: '#a0a0a0',
  default: '#89a4b8'
} as const

type IconKind = 'image' | 'config' | 'git' | 'lock' | 'database'

interface IconSpec {
  kind?: IconKind
  color?: string
  label?: string
}

const EXT_MAP: Record<string, IconSpec> = {
  ts: { color: COLORS.typescript, label: 'TS' },
  mts: { color: COLORS.typescript, label: 'TS' },
  cts: { color: COLORS.typescript, label: 'TS' },
  tsx: { color: COLORS.react, label: 'TS' },
  js: { color: COLORS.javascript, label: 'JS' },
  mjs: { color: COLORS.javascript, label: 'JS' },
  cjs: { color: COLORS.javascript, label: 'JS' },
  jsx: { color: COLORS.react, label: 'JS' },
  py: { color: COLORS.python, label: 'PY' },
  pyw: { color: COLORS.python, label: 'PY' },
  json: { color: COLORS.json, label: '{}' },
  jsonc: { color: COLORS.json, label: '{}' },
  md: { color: COLORS.markdown, label: 'MD' },
  mdx: { color: COLORS.markdown, label: 'MD' },
  markdown: { color: COLORS.markdown, label: 'MD' },
  html: { color: COLORS.html, label: 'H' },
  htm: { color: COLORS.html, label: 'H' },
  css: { color: COLORS.css, label: '#' },
  scss: { color: COLORS.scss, label: 'S' },
  sass: { color: COLORS.scss, label: 'S' },
  less: { color: COLORS.css, label: 'L' },
  yaml: { color: COLORS.yaml, label: 'Y' },
  yml: { color: COLORS.yaml, label: 'Y' },
  xml: { color: COLORS.xml, label: 'X' },
  svg: { kind: 'image' },
  png: { kind: 'image' },
  jpg: { kind: 'image' },
  jpeg: { kind: 'image' },
  gif: { kind: 'image' },
  webp: { kind: 'image' },
  ico: { kind: 'image' },
  bmp: { kind: 'image' },
  sql: { kind: 'database' },
  db: { kind: 'database' },
  sqlite: { kind: 'database' },
  rs: { color: COLORS.rust, label: 'RS' },
  go: { color: COLORS.go, label: 'GO' },
  java: { color: COLORS.java, label: 'J' },
  kt: { color: COLORS.java, label: 'KT' },
  cs: { color: COLORS.csharp, label: 'C#' },
  cpp: { color: COLORS.cpp, label: 'C+' },
  cxx: { color: COLORS.cpp, label: 'C+' },
  cc: { color: COLORS.cpp, label: 'C+' },
  c: { color: COLORS.c, label: 'C' },
  h: { color: COLORS.c, label: 'H' },
  hpp: { color: COLORS.cpp, label: 'H' },
  sh: { color: COLORS.shell, label: '$' },
  bash: { color: COLORS.shell, label: '$' },
  zsh: { color: COLORS.shell, label: '$' },
  bat: { color: COLORS.shell, label: 'BT' },
  cmd: { color: COLORS.shell, label: 'BT' },
  ps1: { color: COLORS.powershell, label: 'PS' },
  vue: { color: COLORS.vue, label: 'V' },
  svelte: { color: COLORS.svelte, label: 'S' },
  toml: { color: COLORS.toml, label: 'T' },
  ini: { kind: 'config' },
  conf: { kind: 'config' },
  cfg: { kind: 'config' },
  env: { kind: 'config' },
  txt: { color: COLORS.text },
  log: { color: COLORS.text },
  csv: { color: COLORS.json, label: ',' },
  lock: { kind: 'lock' }
}

const NAME_MAP: Record<string, IconSpec> = {
  dockerfile: { color: COLORS.docker, label: 'D' },
  'docker-compose.yml': { color: COLORS.docker, label: 'D' },
  'docker-compose.yaml': { color: COLORS.docker, label: 'D' },
  makefile: { color: COLORS.shell, label: 'M' },
  gnumakefile: { color: COLORS.shell, label: 'M' },
  '.gitignore': { kind: 'git' },
  '.gitattributes': { kind: 'git' },
  '.gitmodules': { kind: 'git' },
  '.dockerignore': { color: COLORS.docker, label: 'D' },
  'package.json': { color: COLORS.json, label: '{}' },
  'package-lock.json': { kind: 'lock' },
  'yarn.lock': { kind: 'lock' },
  'pnpm-lock.yaml': { kind: 'lock' },
  'tsconfig.json': { color: COLORS.typescript, label: 'TS' },
  'jsconfig.json': { color: COLORS.javascript, label: 'JS' },
  'cargo.toml': { color: COLORS.rust, label: 'RS' },
  'cargo.lock': { kind: 'lock' },
  'go.mod': { color: COLORS.go, label: 'GO' },
  'go.sum': { kind: 'lock' },
  'composer.json': { color: COLORS.json, label: '{}' },
  'composer.lock': { kind: 'lock' },
  license: { color: COLORS.text },
  'license.md': { color: COLORS.text },
  'license.txt': { color: COLORS.text },
  '.env': { kind: 'config' },
  '.env.local': { kind: 'config' },
  '.env.development': { kind: 'config' },
  '.env.production': { kind: 'config' },
  '.eslintrc': { kind: 'config' },
  '.eslintrc.js': { kind: 'config' },
  '.eslintrc.cjs': { kind: 'config' },
  '.eslintrc.json': { kind: 'config' },
  '.prettierrc': { kind: 'config' },
  '.prettierrc.js': { kind: 'config' },
  '.prettierrc.json': { kind: 'config' },
  '.editorconfig': { kind: 'config' }
}

function resolveSpec(fileName: string): IconSpec {
  const lower = fileName.toLowerCase()
  if (NAME_MAP[lower]) return NAME_MAP[lower]

  // .env.* variants
  if (lower.startsWith('.env.')) return { kind: 'config' }

  const dot = lower.lastIndexOf('.')
  if (dot > 0) {
    const ext = lower.slice(dot + 1)
    if (EXT_MAP[ext]) return EXT_MAP[ext]
  }

  // extensionless env / rc files
  if (lower.startsWith('.') && lower.includes('rc')) return { kind: 'config' }

  return { color: COLORS.default }
}

function renderSpec(spec: IconSpec): ReactElement {
  switch (spec.kind) {
    case 'image':
      return <ImageIcon />
    case 'config':
      return <ConfigIcon />
    case 'git':
      return <GitIcon />
    case 'lock':
      return <LockIcon />
    case 'database':
      return <DatabaseIcon />
    default:
      return <DocIcon color={spec.color ?? COLORS.default} label={spec.label} />
  }
}

export function FileTreeNodeIcon({
  name,
  isDirectory = false,
  isExpanded = false
}: {
  name: string
  isDirectory?: boolean
  isExpanded?: boolean
}): ReactElement {
  if (isDirectory) {
    return <FolderIcon open={isExpanded} />
  }
  return renderSpec(resolveSpec(name))
}
