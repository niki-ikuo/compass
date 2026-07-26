const EXTENSION_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  txt: 'plaintext',
  vb: 'vb',
  vbs: 'vb',
  bas: 'vb',
  frm: 'vb',
  cls: 'vb',
  csv: 'csv',
  tsv: 'tsv',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  sh: 'shell',
  bash: 'shell',
  bat: 'bat',
  cmd: 'bat',
  ps1: 'powershell',
  rb: 'ruby',
  php: 'php',
  r: 'r',
  toml: 'toml'
}

export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_MAP[ext] ?? 'plaintext'
}

export function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

export function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'md' || ext === 'markdown'
}
