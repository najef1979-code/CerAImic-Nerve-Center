# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.4.1] — 2026-02-27

### Added
- Update-available badge in status bar with server-side version check (PR #31)
- Cron UX rework: "When done" framing, auto-detected channels, context-aware placeholders (PR #32)
- WS proxy and SSE connections tagged with unique IDs for structured logging
- WS keepalive pings (30s) prevent silent connection drops during idle
- Connection close logs include duration and message counts
- Installer detects port conflicts before writing config (closes #38)

### Fixed
- Gateway token removed as login password, login-only scrypt hash (PR #33)
- Login rate limit tightened to 5 req/min (PR #33)
- Server refuses to start network-exposed without auth (PR #33)
- WS proxy path/port validation prevents proxying to arbitrary hosts (PR #33)
- TTS fallback now works for non-Latin scripts (PR #33)
- WS proxy challenge-nonce timing race causing failed device identity injection
- Config mutations via typed updateConfig() instead of unsafe direct writes
- ChatContext render loops from unmemoized hook return values
- AudioContext singleton prevents competing audio contexts during voice input
- STT sync race where recognition started before audio context was ready
- Gateway reconnect no longer killed by stale keepalive state
- Installer traps for cleanup, build rollback on failure
- Cron delivery-only failures show warning instead of error (PR #32)

### Changed
- ChatContext split into 4 composable hooks (useChatMessages, useChatStreaming, useChatRecovery, useChatTTS)
- Normalized config references across .env.example, README, and CONFIGURATION.md

---

## [1.4.0] — 2026-02-26

### Added
- **`nerve update` command** — git-based updater with automatic rollback. Supports `--dry-run`, `--version`, `--rollback`, `--no-restart`, and `--verbose` flags. See [docs/UPDATING.md](docs/UPDATING.md).
- Memory filenames are no longer restricted to `YYYY-MM-DD.md` format — any safe filename is accepted (PR #29).

### Fixed
- `git checkout` during updates now uses `--force` to handle dirty working trees.
- `/api/version` endpoint is now public (required for updater health checks with auth enabled).

---

## [1.3.0] — 2026-02-18

### Added
- Multilingual voice control across 12 languages: `en`, `zh`, `hi`, `es`, `fr`, `ar`, `bn`, `pt`, `ru`, `ja`, `de`, `tr`.
- Language and phrase APIs for runtime voice configuration:
  - `GET/PUT /api/language`
  - `GET /api/language/support`
  - `GET/PUT /api/transcribe/config`
  - `GET /api/voice-phrases`
  - `GET /api/voice-phrases/status`
  - `GET/PUT /api/voice-phrases/:lang`
- Event-driven realtime chat streaming pipeline (PR #16): direct WebSocket-driven chat updates, reduced transcript polling, and recovery-aware rendering.
- Mutex-protected env writer (`server/lib/env-file.ts`) to serialize `.env` updates.

### Changed
- Voice language is now explicit (auto-detect removed from UI flow).
- Default/fallback language behavior is English (`en`) for missing/invalid values.
- Primary env key is now `NERVE_LANGUAGE` (legacy `LANGUAGE` remains a read fallback).
- Wake phrase behavior is single-primary-phrase per language (custom phrase takes precedence).
- Settings categories are now `Connection`, `Audio`, and `Appearance`.
- Voice phrase overrides now persist as runtime state at `~/.nerve/voice-phrases.json` (configurable via `NERVE_VOICE_PHRASES_PATH`).
- Local STT default model is now multilingual `tiny`.
- Chat rendering now prefers event-first WebSocket updates instead of periodic full-history polling (PR #16).
- Setup/config flow now uses one bundled consent prompt for OpenClaw gateway config patches, including `gateway.tools.allow` updates for cron management (PR #15).
- UI is now fully responsive across desktop, tablet, and mobile with adaptive small-screen navigation and controls (PR #24).

### Fixed
- Unicode-safe stop/cancel matching for non-Latin scripts (removed brittle `\b` behavior).
- Reduced Latin stop-phrase false positives inside larger words.
- Wake phrase edits now apply immediately in-session (no page refresh required).
- Edge TTS SSML locale now derives from selected voice locale (not hardcoded `en-US`).
- Improved 4xx/5xx separation for language/transcribe config update failures.
- Improved voice-phrase modal reliability (load/save error handling and request-abort race handling).
- Accessibility: icon-only remove-phrase controls now include accessible labels.
- `ws-proxy` now enriches `PATH` before `openclaw` CLI calls, fixing restricted RPC methods under nvm/systemd environments (PR #12).
- Session and memory row actions are now reliably accessible on touch devices (no hover-only dependency) (PR #24).

### Documentation
- Updated API, architecture, configuration, troubleshooting, installer notes, and README to match multilingual voice behavior and runtime config.
- Removed internal planning notes from public docs.
