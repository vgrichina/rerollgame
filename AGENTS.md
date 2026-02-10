# rerollgame - AI Game Generator for Reddit

## Tech Stack

- **Frontend**: Vanilla JS, HTML5 Canvas, Vite
- **Backend**: Node.js v22, Hono
- **Sandbox**: QuickJS (WASM) for safe game execution
- **AI**: Gemini + OpenAI (ChatGPT) for game generation
- **Platform**: Reddit Devvit web app

## Layout & Architecture

- `/src/server`: **Backend Code**. Runs in Devvit serverless environment.
  - `index.js`: Main server entry point (Hono app) with all API routes
  - `gemini.js`: Gemini API client (game gen + image gen)
  - `openai.js`: OpenAI API client (game gen via ChatGPT)
  - `routes/menu.js`: Menu action handlers
  - `routes/triggers.js`: App install trigger
  - `core/post.js`: Reddit post creation
  - Access `redis`, `reddit`, `context`, `settings` via `@devvit/web/server`

- `/src/client`: **Frontend Code**. Executed inside iFrame on reddit.com
  - Entrypoints:
    - `splash.html` + `splash-main.js`: Inline view - create/generate/reroll/play
    - `game.html` + `main.js`: Expanded view - QuickJS sandbox + canvas game loop
  - `sandbox.js`: QuickJS WASM wrapper (create, load, callUpdate, dispose)
  - `renderer.js`: Canvas2D command executor
  - `audio.js`: Web Audio API synth + samples

- `/src/shared`: **Shared Code**
  - `game-prompt.js`: LLM prompt templates + response parser
  - `game-schema.js`: Game code validation
  - `test-games/bouncer.js`: Example breakout game

## Game Architecture

Games are JS files with three global functions:
- `metadata()` → {title, description, controls, width, height}
- `resources()` → {images:{}, sounds:{}}
- `update(dt, input)` → command array [{op:"clear",...}, {op:"rect",...}, ...]

Games run in QuickJS sandbox (16MB heap, 50ms timeout per frame).
Host renders draw commands on Canvas2D, processes audio commands via Web Audio.

## API Endpoints

- `GET /api/init`: Load post game data
- `POST /api/game/generate`: AI game generation (body: {description, model})
- `POST /api/game/edit`: AI game editing (body: {description, model})
- `GET /api/game/test?name=bouncer`: Load test game
- `POST /api/image/generate`: AI image generation (body: {prompt, w, h})

## Commands

- `npm run build`: Build client + server via Vite
- `npm run dev`: Devvit playtest
- `npm run deploy`: Build and upload to Reddit
- `npm run launch`: Deploy and publish

## Rules

- Use `navigateTo()` instead of `window.location`
- Use `showToast()` or `showForm()` instead of `window.alert()`
- Do NOT use blocks or `@devvit/public-api` (Devvit web only)
- All JS, no TypeScript
- Never use `git add -A` or `git add .`
- Add menu item endpoints to `devvit.json` when creating them

Docs: https://developers.reddit.com/docs/llms.txt.
