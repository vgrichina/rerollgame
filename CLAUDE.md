# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — Build client + server via Vite
- `npm run dev` — Devvit playtest (live development on Reddit)
- `npm run deploy` — Build and upload to Reddit
- `npm run launch` — Deploy and publish for review
- `npm run testbed` — Build and run local testbed server (no Reddit needed)
- `npm run testbed:watch` — Watch mode testbed (auto-reloads server changes)

## Architecture

This is a Reddit Devvit web app that lets users generate AI-powered Canvas2D games via a slot-machine UI, then publish them as Reddit posts. No TypeScript, no React — all vanilla JS.

### Three Entrypoints (configured in devvit.json)

1. **Splash** (`splash.html` + `splash-main.js`) — Inline post view. Shows game title with PLAY button, or CREATE button if no game exists.
2. **Game** (`game.html` + `main.js`) — Expanded view. Loads game code into QuickJS WASM sandbox, runs game loop at ~60fps, renders draw commands on Canvas2D.
3. **Creator** (`creator.html` + `creator-main.js`) — Expanded view. Slot-machine UI for choosing genre/theme/mechanic/twist, triggers AI generation, shows live preview, manages drafts.

### Command-Driven Rendering

Games don't touch the DOM. They run in an isolated QuickJS sandbox and return an array of draw/audio commands each frame:
- Game sandbox (`sandbox.js`) → calls `update(dt, input)` → returns command array
- Host renderer (`renderer.js`) → executes Canvas2D draw commands
- Host audio (`audio.js`) → executes Web Audio synthesis commands

### Game Contract

Every game must export three global functions:
- `metadata()` → `{title, description, controls, width, height}`
- `resources()` → `{images:{}, sounds:{}}`
- `update(dt, input)` → `[{op:"clear",...}, {op:"rect",...}, ...]`

QuickJS sandbox limits: 16MB heap, 50ms timeout per frame, no DOM/fetch/eval.

### Server (Hono on Devvit)

`src/server/index.js` — All API routes in one Hono app. Access `redis`, `reddit`, `context`, `settings` via `@devvit/web/server`.

**Async job pattern (OpenAI generation):**
1. Client POSTs `/api/game/generate` → creates job in Redis
2. Client polls `GET /api/jobs/:jobId` → lazy-starts the OpenAI request on first poll
3. Server polls OpenAI until completion (5min timeout), validates game code, stores result

**Image generation pipeline:** Gemini generates sprite → CIEDE2000 chromakey background removal → nearest-neighbor resize → upload to Reddit CDN → two-tier Redis cache.

### Shared Code

`src/shared/game-prompt.js` — LLM prompt templates and response parsing. `game-schema.js` — game code validation. Changes here affect both generation and validation.

## Rules

- Use `navigateTo()` instead of `window.location`
- Use `showToast()` or `showForm()` instead of `window.alert()`
- Do NOT use blocks or `@devvit/public-api` — this is a Devvit web-only app
- All JS, no TypeScript
- Never use `git add -A` or `git add .` — add specific files
- When adding menu item endpoints, also add them to `devvit.json`
- Node >= 22.2.0 required
