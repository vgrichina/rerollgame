// rerollgame - main game entry point
// QuickJS sandbox + canvas command executor + game loop

import { executeCommands } from './renderer.js';
import { processAudioCommands, preloadSounds, tryResumeAudio } from './audio.js';
import { initQuickJS, createSandbox } from './sandbox.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('score-display');

// Game state
let sandbox = null;
let gameWidth = 400;
let gameHeight = 400;
let score = 0;
let isGameOver = false;
let imagePool = {};

// Input state
const input = {
  up: false, down: false, left: false, right: false, a: false, b: false,
  upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
  aPressed: false, bPressed: false,
  pointerDown: false, pointerX: 0, pointerY: 0, pointerPressed: false,
};
const prevInput = {};

// Keyboard mapping
const keyMap = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  z: 'a', x: 'b', ' ': 'a',
};

document.addEventListener('keydown', (e) => {
  const btn = keyMap[e.key];
  if (btn) { input[btn] = true; e.preventDefault(); tryResumeAudio(); }
});

document.addEventListener('keyup', (e) => {
  const btn = keyMap[e.key];
  if (btn) { input[btn] = false; }
});

// Pointer/touch
canvas.addEventListener('pointerdown', (e) => {
  input.pointerDown = true;
  updatePointer(e);
  tryResumeAudio();
});
canvas.addEventListener('pointermove', (e) => { updatePointer(e); });
canvas.addEventListener('pointerup', () => { input.pointerDown = false; });

function updatePointer(e) {
  const rect = canvas.getBoundingClientRect();
  input.pointerX = (e.clientX - rect.left) * (gameWidth / rect.width);
  input.pointerY = (e.clientY - rect.top) * (gameHeight / rect.height);
}

// Sizing
function resizeCanvas() {
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;
  const scale = Math.min(maxW / gameWidth, maxH / gameHeight);
  canvas.width = gameWidth;
  canvas.height = gameHeight;
  canvas.style.width = Math.floor(gameWidth * scale) + 'px';
  canvas.style.height = Math.floor(gameHeight * scale) + 'px';
  canvas.style.marginTop = Math.floor((maxH - gameHeight * scale) / 2) + 'px';
}

// Init
async function init() {
  // Show loading state
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, gameWidth, gameHeight);
  ctx.fillStyle = '#666';
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Loading...', gameWidth / 2, gameHeight / 2);

  // Initialize QuickJS WASM
  await initQuickJS();

  const res = await fetch('/api/init');
  const data = await res.json();

  if (data.gameCode) {
    await loadGame(data.gameCode, data.metadata);
  } else {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, gameWidth, gameHeight);
    ctx.fillStyle = '#666';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No game loaded', gameWidth / 2, gameHeight / 2);
  }
}

// Load and run a game
async function loadGame(code, metadata) {
  // Clean up previous sandbox
  if (sandbox) {
    sandbox.dispose();
    sandbox = null;
  }

  isGameOver = false;
  score = 0;
  scoreDisplay.textContent = '';

  if (metadata) {
    gameWidth = metadata.width || 400;
    gameHeight = metadata.height || 400;
  }
  resizeCanvas();

  try {
    sandbox = createSandbox();
    const { metadata: gameMeta, resources: gameResources } = sandbox.loadGame(code);

    if (gameMeta.width) gameWidth = gameMeta.width;
    if (gameMeta.height) gameHeight = gameMeta.height;
    resizeCanvas();

    // Preload images from resources
    if (gameResources.images) {
      imagePool = await loadImages(gameResources.images);
    }

    // Preload sounds from resources
    if (gameResources.sounds) {
      await preloadSounds(gameResources.sounds);
    }

    // Start game loop
    let lastTime = performance.now();
    function loop(now) {
      if (isGameOver) return;

      const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
      lastTime = now;

      // Compute pressed states
      for (const key of ['up', 'down', 'left', 'right', 'a', 'b']) {
        input[key + 'Pressed'] = input[key] && !prevInput[key];
      }
      input.pointerPressed = input.pointerDown && !prevInput.pointerDown;

      // Call game update via sandbox
      const commands = sandbox.callUpdate(dt, input);

      // Save prev input
      Object.assign(prevInput, input);
      input.pointerPressed = false;
      for (const key of ['up', 'down', 'left', 'right', 'a', 'b']) {
        input[key + 'Pressed'] = false;
      }

      // Process commands
      if (Array.isArray(commands)) {
        const drawCmds = [];
        const audioCmds = [];

        for (const cmd of commands) {
          if (!cmd || !cmd.op) continue;
          if (cmd.op === 'score') {
            score = cmd.value;
            scoreDisplay.textContent = 'SCORE: ' + score;
          } else if (cmd.op === 'gameOver') {
            isGameOver = true;
            scoreDisplay.textContent = 'GAME OVER - SCORE: ' + score;
          } else if (cmd.op === 'tone' || cmd.op === 'noise' || cmd.op === 'sample' || cmd.op === 'stop' || cmd.op === 'stopAll' || cmd.op === 'volume') {
            audioCmds.push(cmd);
          } else {
            drawCmds.push(cmd);
          }
        }

        executeCommands(ctx, drawCmds, imagePool);
        processAudioCommands(audioCmds);
      }

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  } catch (err) {
    console.error('Game load error:', err);
    ctx.fillStyle = '#200';
    ctx.fillRect(0, 0, gameWidth, gameHeight);
    ctx.fillStyle = '#f44';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Error: ' + err.message, gameWidth / 2, gameHeight / 2);
  }
}

// Load image resources into ImageBitmap pool
async function loadImages(images) {
  const pool = {};
  for (const [id, res] of Object.entries(images)) {
    try {
      if (res.type === 'pixels') {
        pool[id] = await loadPixelImage(id, res);
      } else if (res.type === 'hex') {
        pool[id] = await loadHexImage(id, res);
      } else if (res.type === 'procedural') {
        pool[id] = await loadProceduralImage(id, res);
      } else if (res.type === 'generate') {
        pool[id] = await loadGeneratedImage(id, res);
      }
    } catch (err) {
      console.warn(`Failed to load image "${id}":`, err);
    }
  }
  return pool;
}

function loadPixelImage(id, res) {
  const offscreen = new OffscreenCanvas(res.w, res.h);
  const offCtx = offscreen.getContext('2d');
  const imageData = offCtx.createImageData(res.w, res.h);
  for (let i = 0; i < res.data.length; i++) {
    const color = res.data[i];
    if (!color) continue; // transparent
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    imageData.data[i * 4] = r;
    imageData.data[i * 4 + 1] = g;
    imageData.data[i * 4 + 2] = b;
    imageData.data[i * 4 + 3] = 255;
  }
  offCtx.putImageData(imageData, 0, 0);
  return createImageBitmap(offscreen);
}

function loadHexImage(id, res) {
  const offscreen = new OffscreenCanvas(res.w, res.h);
  const offCtx = offscreen.getContext('2d');
  const imageData = offCtx.createImageData(res.w, res.h);
  const palette = res.palette.map((c) => {
    const hex = c.replace('#', '');
    return [parseInt(hex.substring(0, 2), 16), parseInt(hex.substring(2, 4), 16), parseInt(hex.substring(4, 6), 16)];
  });
  for (let y = 0; y < res.rows.length; y++) {
    for (let x = 0; x < res.rows[y].length; x++) {
      const idx = parseInt(res.rows[y][x], 16);
      if (idx === 0) continue; // 0 = transparent
      const [r, g, b] = palette[idx] || [0, 0, 0];
      const pi = (y * res.w + x) * 4;
      imageData.data[pi] = r;
      imageData.data[pi + 1] = g;
      imageData.data[pi + 2] = b;
      imageData.data[pi + 3] = 255;
    }
  }
  offCtx.putImageData(imageData, 0, 0);
  return createImageBitmap(offscreen);
}

function loadProceduralImage(id, res) {
  const offscreen = new OffscreenCanvas(res.w, res.h);
  const offCtx = offscreen.getContext('2d');
  executeCommands(offCtx, res.draw, {});
  return createImageBitmap(offscreen);
}

async function loadGeneratedImage(id, res) {
  const resp = await fetch('/api/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: res.prompt, w: res.w || 64, h: res.h || 64 }),
  });
  if (!resp.ok) {
    throw new Error(`Image generation failed for "${id}": ${resp.status}`);
  }
  const data = await resp.json();
  // data.image is base64 PNG
  const blob = await fetch(`data:image/png;base64,${data.image}`).then((r) => r.blob());
  return createImageBitmap(blob);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
init();
