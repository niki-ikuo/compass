# Security audit (static)

**English** | [日本語](ja/SECURITY_AUDIT.md)

Static code review of the Compass Electron app (main / preload / renderer).  
Date: 2026-08-07 · Updated: 2026-08-07 (mitigations + follow-up hardening)

## Threat model

Compass is a local desktop app. User-driven filesystem access is expected. The primary risk evaluated here is **privilege escalation after renderer compromise** (e.g. XSS → privileged IPC).

## Summary (after mitigations)

| Severity | Original | Status |
|----------|----------|--------|
| Critical | 1 | Mitigated |
| High | 4 | Mitigated |
| Medium | 10 | Mitigated |
| Low | 2 | Mitigated |
| Info | 1 | Documented |

## Mitigations applied

| ID | Finding | Mitigation |
|----|---------|------------|
| C1 | FS IPC no workspace boundary | Active workspace path guard on `fs:*` IPC (`path-guard.ts`); set via `workspace:setLast` |
| H1 | Desk IPC arbitrary read | `runDeskShipCheck` / `copyOutboxPayload` require workspace + outbox path |
| H2 | Agent exec network without approval | `curl` / `wget` / `nc` / `ssh` / `python -c` / `node -e` etc. → `needs_approval` |
| H3 | Approval IPC no auth | Pending approvals bound to `webContents.id`; resolve checks sender |
| H4 | Markdown XSS | `SafeMarkdown` (React tokens, HTML dropped) for Preview / Help / HelpAsk |
| M1 | `sandbox: false` | `sandbox: true` in BrowserWindow |
| M2 | webview surface | No `allowpopups`; address bar blocks `file:`/`data:`; `will-navigate` filter |
| M3 | shell openPath any path | Assert active workspace path |
| M4 | symlink escape | `assertInsideWorkspace` uses `realpath` |
| M5 | API keys in renderer | `getPublicSettings()` redacts keys; empty save keeps existing |
| M6 | Base64 when no safeStorage | `apiKeyStorageInsecure` warning in Settings |
| M7 | SSRF via apiBaseUrl | `assertSafeApiBaseUrl` blocks private/metadata hosts (localhost allowed) |
| M8 | External chat context | Allowlist via `registerExternalContextPaths` (drop / pickFiles) |
| M9 | autoApply bypass | Sensitive paths (`.env`, keys, …) never auto-apply |
| M10 | Agent read secrets | `executeReadFile` blocks sensitive paths |
| L1 | Terminal owner check | Deferred (same renderer trust boundary; XSS mitigated) |
| L2 | Dev CSP missing | CSP applied in dev (relaxed) and prod (stricter `connect-src`) |

## Follow-up hardening (re-review)

| Issue | Fix |
|-------|-----|
| External allowlist TOCTOU | Register/check by `realpath` only; require existing file + size cap |
| Client-supplied `workspaceRoot` | `bindActiveWorkspaceRoot` on apply/preview/search/desk/git/index/chat/… |
| SSRF gaps in Agent / Help Ask | Shared `resolveSafeChatCompletionsUrl` |
| Sensitive files in chat context | Skip `.env` / keys in `resolveChatContext` |
| Help relative links broken | `SafeMarkdown allowRelativeDocLinks` |
| Stale active workspace after open failure | `setLast(null)` in catch / restore failure |
| LAN Ollama UX | `allowLanApiBaseUrl` opt-in; metadata always blocked |
| Outbox symlink escape | `isPathUnderDir` with realpath |
| Exec cwd / powershell gaps | realpath cwd; blanket powershell/pwsh approval |

## Remaining notes

- Integrated terminal remains a full shell by design (Info).
- L1 (terminal PTY owner binding) is lower priority after XSS + FS guards.
- Dependency CVE scanning (`npm audit`) is still out of scope for this document.
