import { navigateTo } from '@devvit/web/client';
import { executeCommands } from './renderer.js';
import { processAudioCommands, preloadSounds, tryResumeAudio } from './audio.js';
import { initQuickJS, createSandbox } from './sandbox.js';
import demoGameCode from '../shared/test-games/roofrunner.js?raw';

const root = document.getElementById('root');

// Slot machine components
const GENRES = [
  { name: 'platformer', examples: 'jump between platforms, climb to the top, side-scrolling adventure' },
  { name: 'shooter', examples: 'space invaders, twin-stick, bullet hell, turret defense' },
  { name: 'puzzle', examples: 'match-3, sliding tiles, sokoban, tetris-like, breakout, connect paths' },
  { name: 'arcade', examples: 'snake, pong, asteroids, frogger, whack-a-mole' },
  { name: 'racing', examples: 'top-down racer, obstacle dodge, endless runner, time trial' },
  { name: 'survival', examples: 'enemy waves, gather resources, tower defense, shrinking safe zone' },
  { name: 'action', examples: 'arena combat, boss rush, beat-em-up, roguelike rooms' },
];

const SLOTS = {
  genre: GENRES.map(g => g.name),
  theme: ['space', 'underwater', 'medieval', 'cyberpunk', 'jungle', 'ice world', 'desert', 'haunted house', 'candy land', 'volcanic', 'pirate', 'ninja', 'robot factory', 'dream world', 'tiny bugs'],
  mechanic: ['powerups', 'gravity flip', 'combo chains', 'teleport', 'shrink and grow', 'bouncing', 'magnet pull', 'dash', 'deflect', 'phase through walls'],
  twist: ['everything speeds up over time', 'one-hit kills both ways', 'collect coins to survive', 'everything bounces', 'shrinking arena', 'random portals appear', 'controls reverse periodically', 'you can only see near the player', 'screen wraps around', 'you grow bigger every time you score', 'you can\'t stop moving', 'gravity shifts periodically'],
  mood: ['frantic', 'chill', 'creepy', 'silly', 'competitive', 'zen'],
};

const SLOT_LABELS = { genre: 'Genre', theme: 'Theme', mechanic: 'Mechanic', twist: 'Twist', mood: 'Mood' };
const SLOT_KEYS = Object.keys(SLOTS);

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Current slot values
let slotValues = {};
function rollAll() { SLOT_KEYS.forEach(k => { slotValues[k] = pickRandom(SLOTS[k]); }); }
function rollOne(key) { slotValues[key] = pickRandom(SLOTS[key]); }
function buildDescription() {
  const genre = GENRES.find(g => g.name === slotValues.genre);
  const examples = genre ? ` (e.g. ${genre.examples})` : '';
  return `a ${slotValues.mood} ${slotValues.genre} game${examples} set in ${slotValues.theme} with ${slotValues.mechanic} where ${slotValues.twist}`;
}

// State
let state = 'roll'; // roll | drafts-list | generating | preview | playing | editing
let prevState = null;
let isTumbling = false;
let drafts = [];
let currentDraft = null;
let currentJobId = null;
let currentDraftId = null;
let currentVersionIndex = 0;
let pollTimer = null;
let progressValue = 0;
let pollErrors = 0;
let debugLog = []; // [{time, msg}]
let debugExpanded = false;
let pollCount = 0;
let lastPollData = null;
let generationStartTime = 0;

// Preview player state
let previewSandbox = null;
let previewAnimFrame = null;
let previewImagePool = {};

// Debug inspection panel state
let debugPanelOpen = false;
let debugActiveTab = 'code';
let debugGameCode = null;
let debugResources = null;
let debugMetadata = null;
let debugExpandedImage = null;
let debugFrameStats = null;
let debugConsoleLog = [];
let debugGameStartTime = 0;

// Initialize slots
rollAll();

async function init() {
  loadDrafts(); // load in background, don't block
  render();
}

async function loadDrafts() {
  try {
    const res = await fetch('/api/drafts');
    const data = await res.json();
    drafts = data.drafts || [];
  } catch (err) {
    drafts = [];
  }
}

// --- Transition helper (R4) ---
function transitionTo(renderFn) {
  root.style.opacity = '0';
  setTimeout(() => {
    renderFn();
    root.style.opacity = '1';
  }, 150);
}

function render() {
  // Stop preview game loop when leaving playing state
  if (state !== 'playing') stopPreviewGame();

  const stateChanged = prevState !== null && prevState !== state;
  prevState = state;

  const doRender = () => {
    switch (state) {
      case 'roll': renderRoll(); break;
      case 'drafts-list': renderDraftsList(); break;
      case 'generating': renderGenerating(); break;
      case 'preview': renderPreview(); break;
      case 'playing': renderPlaying(); break;
      case 'editing': renderEditing(); break;
    }
  };

  if (stateChanged) {
    transitionTo(doRender);
  } else {
    doRender();
  }
}

// --- Slot tumble animation (R5) ---
function tumbleSlot(slotEl, key, finalValue, delay) {
  const NUM_FILLERS = 5;
  const textEl = slotEl.querySelector('.slot-text');
  const rerollIcon = slotEl.querySelector('.slot-reroll');
  if (!textEl) return;

  const fillers = [];
  for (let i = 0; i < NUM_FILLERS; i++) {
    fillers.push(pickRandom(SLOTS[key]));
  }

  const containerHeight = slotEl.offsetHeight;

  // Prepare container
  slotEl.style.position = 'relative';
  slotEl.style.overflow = 'hidden';
  slotEl.style.height = containerHeight + 'px';

  // Hide original content
  if (rerollIcon) rerollIcon.style.opacity = '0';
  textEl.style.opacity = '0';

  // Build reel
  const items = [...fillers, finalValue];
  const reel = document.createElement('div');
  reel.style.cssText = `position:absolute; top:0; left:0; width:100%; padding:0 16px;`;

  items.forEach(val => {
    const item = document.createElement('div');
    item.style.cssText = `height:${containerHeight}px; display:flex; align-items:center; font-size:15px; color:var(--text-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`;
    item.textContent = val;
    reel.appendChild(item);
  });

  slotEl.appendChild(reel);

  const cleanup = () => {
    if (!reel.parentNode) return;
    reel.remove();
    textEl.textContent = finalValue;
    textEl.style.opacity = '';
    if (rerollIcon) rerollIcon.style.opacity = '';
    slotEl.style.position = '';
    slotEl.style.overflow = '';
    slotEl.style.height = '';
  };

  setTimeout(() => {
    const targetY = -(items.length - 1) * containerHeight;
    reel.style.transition = 'transform 0.6s cubic-bezier(0.2, 0.8, 0.3, 1)';
    reel.style.transform = `translateY(${targetY}px)`;
    reel.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 800); // fallback
  }, delay);
}

// --- Drafts List ---
function getDraftGenre(d) {
  // Try to extract genre from description
  const desc = d.description || '';
  const match = desc.match(/^a (\w[\w\s-]*?) game/i);
  return match ? match[1] : null;
}

function renderDraftsList() {
  const draftItems = drafts.map(d => {
    const genre = getDraftGenre(d);
    const statusDot = d.status === 'generating'
      ? '<span style="width:8px; height:8px; border-radius:50%; background:#f90; display:inline-block; animation:pulse 1.5s ease-in-out infinite;"></span>'
      : d.status === 'published'
        ? `<span style="width:8px; height:8px; border-radius:50%; background:var(--accent-green); display:inline-block;"></span>`
        : `<span style="width:8px; height:8px; border-radius:50%; background:var(--border-light); display:inline-block;"></span>`;
    const statusText = d.status === 'generating' ? 'generating' : d.status === 'published' ? 'published' : 'draft';
    const borderColor = d.status === 'generating' ? '#f90' : d.status === 'published' ? 'var(--accent-green)' : 'var(--border)';
    return `
      <div class="draft-item" data-id="${d.id}" style="display:flex; align-items:center; gap:12px; padding:12px 14px; background:var(--surface-1); border-radius:10px; cursor:pointer; border:1px solid var(--border); border-left:3px solid ${borderColor}; transition:background 0.15s;">
        <div style="width:44px; height:44px; background:var(--surface-2); border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:inset 0 1px 4px rgba(0,0,0,0.4);">
          <span style="font-size:18px; color:var(--text-3);">${genre ? '&#127918;' : '&#9776;'}</span>
        </div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:600; color:var(--text-1); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(d.title || 'Untitled')}</div>
          <div style="display:flex; align-items:center; gap:6px; margin-top:3px;">
            ${genre ? `<span style="font-size:10px; color:var(--text-2); background:var(--surface-2); border:1px solid var(--border); border-radius:4px; padding:1px 6px;">${escapeHtml(genre)}</span>` : ''}
            <span style="display:flex; align-items:center; gap:4px; font-size:10px; color:var(--text-3);">${statusDot} ${statusText}</span>
          </div>
        </div>
        <button class="delete-draft" data-id="${d.id}" style="background:none; border:none; color:var(--border-light); font-size:14px; cursor:pointer; padding:6px; flex-shrink:0; transition:color 0.15s;">&times;</button>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; height:100vh; padding:16px; gap:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h1 style="font-size:18px; font-weight:bold; color:var(--text-1);">My Games</h1>
        <button id="new-game-btn" style="background:var(--primary); color:var(--text-1); border:none; border-radius:10px; padding:8px 16px; font-size:13px; font-weight:bold; cursor:pointer; transition:transform 0.1s;">+ New</button>
      </div>
      <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
        ${drafts.length > 0 ? draftItems : '<p style="color:var(--text-3); text-align:center; margin-top:40px; font-size:14px;">No games yet</p>'}
      </div>
    </div>
    <style>
      .draft-item:hover { background: var(--surface-2) !important; }
      .delete-draft:hover { color: var(--error) !important; }
      #new-game-btn:active { transform: scale(0.96); }
      @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
    </style>
  `;

  document.getElementById('new-game-btn').addEventListener('click', () => {
    currentDraft = null;
    currentDraftId = null;
    currentVersionIndex = 0;
    rollAll();
    state = 'roll';
    render();
  });

  // Draft click handlers
  root.querySelectorAll('.draft-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('.delete-draft')) return;
      const draftId = el.dataset.id;
      await resumeDraft(draftId);
    });
  });

  // Delete handlers
  root.querySelectorAll('.delete-draft').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const draftId = btn.dataset.id;
      await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
      await loadDrafts();
      render();
    });
  });
}

async function resumeDraft(draftId) {
  const res = await fetch(`/api/drafts/${draftId}`);
  const data = await res.json();
  if (!data.draft) return;

  currentDraft = data.draft;
  currentDraftId = draftId;
  currentVersionIndex = data.draft.currentIndex || 0;

  if (data.draft.status === 'generating' && data.draft.jobId) {
    currentJobId = data.draft.jobId;
    pollCount = 0;
    lastPollData = null;
    debugLog = [];
    generationStartTime = Date.now();
    addDebugLog(`Resumed generating job: ${data.draft.jobId}`);
    state = 'generating';
    render();
    startPolling();
  } else if (data.draft.versions && data.draft.versions.length > 0) {
    state = 'preview';
    render();
  } else {
    rollAll();
    state = 'roll';
    render();
  }
}

// --- Roll (slot machine) ---
function renderRoll() {
  const slotRows = SLOT_KEYS.map(key => `
    <div style="width:100%; max-width:360px;">
      <div style="color:var(--text-3); font-size:10px; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px; padding-left:2px;">${SLOT_LABELS[key]}</div>
      <div class="slot-value" data-key="${key}" style="background:var(--surface-1); border:1px solid var(--border); border-radius:10px; padding:12px 16px; color:var(--text-1); font-size:15px; cursor:pointer; user-select:none; box-shadow:inset 0 2px 8px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04); display:flex; justify-content:space-between; align-items:center; transition:background 0.15s, border-color 0.15s;">
        <span class="slot-text">${escapeHtml(slotValues[key])}</span>
        <span class="slot-reroll" style="color:var(--text-3); font-size:13px;">&#8635;</span>
      </div>
    </div>
  `).join('');

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:12px; padding:20px;">
      <h1 class="logo-mark" style="font-size:20px; color:var(--primary);">rerollgame</h1>
      <div style="display:flex; flex-direction:column; gap:10px; width:100%; align-items:center;">
        ${slotRows}
      </div>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button id="roll-all-btn" style="background:var(--surface-2); color:var(--primary); border:1px solid var(--primary); border-radius:20px; padding:11px 28px; font-size:14px; font-weight:bold; cursor:pointer; transition:transform 0.1s;">
          ROLL
        </button>
        <button id="generate-btn" style="background:var(--primary); color:var(--text-1); border:none; border-radius:20px; padding:11px 28px; font-size:14px; font-weight:bold; cursor:pointer; transition:transform 0.1s;">
          GENERATE
        </button>
      </div>
      <div style="display:flex; gap:16px; align-items:center;">
        <button id="drafts-btn" style="background:transparent; color:var(--text-2); border:none; font-size:13px; cursor:pointer; text-decoration:underline;">
          My drafts${drafts.length > 0 ? ` (${drafts.length})` : ''}
        </button>
        <button id="demo-btn" style="background:transparent; color:var(--text-3); border:none; font-size:13px; cursor:pointer; text-decoration:underline;">
          Demo
        </button>
      </div>
    </div>
    <style>
      .slot-value:hover { background: var(--surface-2) !important; border-color: var(--border-light) !important; }
      .slot-value:active { transform: scale(0.98); }
      #roll-all-btn:active, #generate-btn:active { transform: scale(0.96); }
    </style>
  `;

  // Tap individual slot to re-roll with tumble
  root.querySelectorAll('.slot-value').forEach(el => {
    el.addEventListener('click', () => {
      if (isTumbling) return;
      isTumbling = true;
      const key = el.dataset.key;
      rollOne(key);
      tumbleSlot(el, key, slotValues[key], 0);
      setTimeout(() => { isTumbling = false; }, 700);
    });
  });

  // Roll all with staggered tumble animation
  document.getElementById('roll-all-btn').addEventListener('click', () => {
    if (isTumbling) return;
    isTumbling = true;
    rollAll();
    const slots = root.querySelectorAll('.slot-value');
    slots.forEach((el, i) => {
      tumbleSlot(el, el.dataset.key, slotValues[el.dataset.key], i * 100);
    });
    setTimeout(() => { isTumbling = false; }, (slots.length - 1) * 100 + 700);
  });

  // Generate from current slots
  document.getElementById('generate-btn').addEventListener('click', () => {
    startGeneration(buildDescription());
  });

  document.getElementById('drafts-btn').addEventListener('click', async () => {
    await loadDrafts();
    state = 'drafts-list';
    render();
  });

  document.getElementById('demo-btn').addEventListener('click', () => {
    currentDraft = {
      title: 'Roof Runner (Demo)',
      versions: [{ gameCode: demoGameCode, metadata: { title: 'Roof Runner' }, description: 'Demo game' }],
    };
    currentDraftId = null;
    currentVersionIndex = 0;
    state = 'playing';
    render();
  });
}

async function startGeneration(description) {
  state = 'generating';
  progressValue = 0;
  pollErrors = 0;
  pollCount = 0;
  lastPollData = null;
  debugLog = [];
  generationStartTime = Date.now();
  addDebugLog(`Starting generation: ${description.slice(0, 80)}`);
  render();

  try {
    const res = await fetch('/api/game/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const data = await res.json();

    if (data.error) {
      addDebugLog(`Generate error: ${data.error}`);
      showError(data.error);
      return;
    }

    currentJobId = data.jobId;
    currentDraftId = data.draftId;
    addDebugLog(`Job created: ${data.jobId}`);
    startPolling();
  } catch (err) {
    addDebugLog(`Generate fetch error: ${err.message}`);
    showError(err.message);
  }
}

async function startEdit(description) {
  const versions = currentDraft?.versions || [];
  const currentVersion = versions[currentVersionIndex];
  if (!currentVersion?.gameCode) {
    showError('No game code to edit');
    return;
  }

  state = 'generating';
  progressValue = 0;
  pollErrors = 0;
  pollCount = 0;
  lastPollData = null;
  debugLog = [];
  generationStartTime = Date.now();
  addDebugLog(`Starting edit: ${description.slice(0, 80)}`);
  render();

  try {
    const res = await fetch('/api/game/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        draftId: currentDraftId,
        previousCode: currentVersion.gameCode,
      }),
    });
    const data = await res.json();

    if (data.error) {
      addDebugLog(`Edit error: ${data.error}`);
      showError(data.error);
      return;
    }

    currentJobId = data.jobId;
    addDebugLog(`Edit job created: ${data.jobId}`);
    startPolling();
  } catch (err) {
    addDebugLog(`Edit fetch error: ${err.message}`);
    showError(err.message);
  }
}

// --- Generating (polling) ---
function getGenerationSteps() {
  return [
    { label: `Setting up ${slotValues.genre || 'game'} engine`, threshold: 10 },
    { label: `Building ${slotValues.theme || 'world'} theme`, threshold: 25 },
    { label: `Adding ${slotValues.mechanic || 'mechanics'}`, threshold: 45 },
    { label: `Wiring ${slotValues.twist || 'twist'} logic`, threshold: 65 },
    { label: `Tuning ${slotValues.mood || ''} mood`, threshold: 80 },
    { label: 'Polishing & testing', threshold: 90 },
  ];
}

function renderGenerating() {
  const elapsed = generationStartTime ? Math.round((Date.now() - generationStartTime) / 1000) : 0;
  const steps = getGenerationSteps();
  const debugLines = debugLog.slice(-20).map(l => `<div style="color:var(--text-2); font-size:10px; font-family:monospace; white-space:pre-wrap;">[${l.time}] ${escapeHtml(l.msg)}</div>`).join('');

  const stepsHtml = steps.map((step, i) => {
    const done = progressValue >= step.threshold;
    const active = !done && (i === 0 || progressValue >= steps[i - 1].threshold);
    const icon = done ? '<span style="color:var(--accent-green);">&#10003;</span>' : active ? '<span class="gen-spinner">&#9697;</span>' : '<span style="color:var(--border-light);">&#9675;</span>';
    const color = done ? 'var(--accent-green)' : active ? 'var(--text-1)' : 'var(--text-3)';
    return `<div style="display:flex; align-items:center; gap:10px; padding:6px 0; color:${color}; font-size:13px; transition:color 0.3s;">${icon} ${escapeHtml(step.label)}</div>`;
  }).join('');

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; padding:20px;">
      <h1 style="font-size:20px; color:var(--primary);">Building your game</h1>
      <div style="width:80%; max-width:300px;">
        <div id="gen-steps">${stepsHtml}</div>
      </div>
      <div style="width:80%; max-width:300px; height:6px; background:var(--surface-3); border-radius:3px; overflow:hidden; margin-top:4px;">
        <div id="progress-bar" style="height:100%; background:linear-gradient(90deg, var(--primary), #ff6a33); border-radius:3px; transition:width 0.5s; width:${progressValue}%;"></div>
      </div>
      <p id="progress-text" style="color:var(--text-3); font-size:11px;">${progressValue}%</p>
      <div style="display:flex; gap:12px; align-items:center;">
        <button id="cancel-btn" style="background:transparent; color:var(--text-2); border:1px solid var(--border-light); border-radius:16px; padding:6px 16px; font-size:12px; cursor:pointer;">Cancel</button>
        <button id="debug-toggle" style="background:transparent; color:var(--text-3); border:none; font-size:11px; cursor:pointer; text-decoration:underline;">
          ${debugExpanded ? 'Hide' : 'Show'} Debug
        </button>
      </div>
      <div style="width:100%; max-width:400px;">
        <div id="debug-panel" style="display:${debugExpanded ? 'block' : 'none'}; margin-top:8px; padding:10px; background:var(--surface-1); border:1px solid var(--border); border-radius:8px; max-height:300px; overflow-y:auto;">
          <div style="font-size:11px; color:var(--primary); font-weight:600; margin-bottom:6px;">Job Debug</div>
          <div style="font-size:10px; color:var(--text-2); font-family:monospace; margin-bottom:8px;">
            jobId: ${currentJobId || 'n/a'}<br>
            polls: ${pollCount} | errors: ${pollErrors}<br>
            elapsed: ${elapsed}s<br>
            lastStatus: ${lastPollData ? (lastPollData.status || 'unknown') : 'n/a'}<br>
            openaiId: ${lastPollData?.debug?.openaiResponseId || 'n/a'}<br>
            openaiStatus: ${lastPollData?.debug?.openaiStatus || 'n/a'}<br>
            serverElapsed: ${lastPollData?.debug?.elapsed ? Math.round(lastPollData.debug.elapsed / 1000) + 's' : 'n/a'}
          </div>
          <div style="font-size:11px; color:var(--primary); font-weight:600; margin-bottom:4px;">Log</div>
          ${debugLines || '<div style="color:var(--text-3); font-size:10px;">No events yet</div>'}
          <div style="margin-top:8px; border-top:1px solid var(--border); padding-top:8px;">
            <div style="font-size:11px; color:var(--primary); font-weight:600; margin-bottom:4px;">Lookup Job by ID</div>
            <div style="display:flex; gap:4px;">
              <input id="debug-job-input" type="text" placeholder="paste job ID" style="flex:1; background:var(--surface-2); border:1px solid var(--border-light); border-radius:4px; padding:4px 6px; color:var(--text-1); font-size:10px; font-family:monospace;">
              <button id="debug-lookup-btn" style="background:var(--surface-3); color:var(--text-1); border:none; border-radius:4px; padding:4px 8px; font-size:10px; cursor:pointer;">Lookup</button>
            </div>
            <pre id="debug-lookup-result" style="color:var(--text-2); font-size:10px; font-family:monospace; white-space:pre-wrap; margin-top:4px; max-height:150px; overflow-y:auto;"></pre>
          </div>
        </div>
      </div>
    </div>
    <style>
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .gen-spinner { display:inline-block; animation: spin 1s linear infinite; color: var(--primary); }
    </style>
  `;

  document.getElementById('cancel-btn').addEventListener('click', () => {
    stopPolling();
    addDebugLog('Cancelled by user');
    state = 'roll';
    render();
  });

  document.getElementById('debug-toggle').addEventListener('click', () => {
    debugExpanded = !debugExpanded;
    const panel = document.getElementById('debug-panel');
    const toggle = document.getElementById('debug-toggle');
    if (panel) panel.style.display = debugExpanded ? 'block' : 'none';
    if (toggle) toggle.textContent = `${debugExpanded ? 'Hide' : 'Show'} Debug`;
  });

  document.getElementById('debug-lookup-btn')?.addEventListener('click', async () => {
    const id = document.getElementById('debug-job-input')?.value?.trim();
    const resultEl = document.getElementById('debug-lookup-result');
    if (!id || !resultEl) return;
    resultEl.textContent = 'Loading...';
    try {
      const res = await fetch(`/api/jobs/${id}/debug`);
      const data = await res.json();
      resultEl.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
      resultEl.textContent = `Error: ${err.message}`;
    }
  });
}

function addDebugLog(msg) {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  debugLog.push({ time, msg });
  if (debugLog.length > 50) debugLog.shift();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollJob, 3000);
  pollJob(); // immediate first poll
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollJob() {
  if (!currentJobId) return;
  pollCount++;

  try {
    const res = await fetch(`/api/jobs/${currentJobId}`);
    const data = await res.json();
    lastPollData = data;

    if (data.status === 'completed') {
      pollErrors = 0;
      addDebugLog(`Completed! (poll #${pollCount})`);
      stopPolling();
      await onGenerationComplete(data.gameDefinition);
      return;
    }

    if (data.status === 'failed') {
      pollErrors = 0;
      addDebugLog(`Failed: ${data.error}`);
      stopPolling();
      showError(data.error || 'Generation failed');
      return;
    }

    if (data.status === 'polling') {
      pollErrors = 0;
      const openaiStatus = data.debug?.openaiStatus || '?';
      const serverElapsed = data.debug?.elapsed ? Math.round(data.debug.elapsed / 1000) : '?';
      addDebugLog(`Poll #${pollCount}: openai=${openaiStatus}, progress=${data.progress}%, server=${serverElapsed}s`);

      if (data.progress != null) {
        progressValue = data.progress;
      }
      // Update UI in-place without full re-render
      const bar = document.getElementById('progress-bar');
      const text = document.getElementById('progress-text');
      if (bar) bar.style.width = `${progressValue}%`;
      if (text) text.textContent = `${progressValue}%`;
      // Update checklist steps
      const stepsEl = document.getElementById('gen-steps');
      if (stepsEl) {
        const steps = getGenerationSteps();
        stepsEl.innerHTML = steps.map((step, i) => {
          const done = progressValue >= step.threshold;
          const active = !done && (i === 0 || progressValue >= steps[i - 1].threshold);
          const icon = done ? '<span style="color:var(--accent-green);">&#10003;</span>' : active ? '<span class="gen-spinner">&#9697;</span>' : '<span style="color:var(--border-light);">&#9675;</span>';
          const color = done ? 'var(--accent-green)' : active ? 'var(--text-1)' : 'var(--text-3)';
          return `<div style="display:flex; align-items:center; gap:10px; padding:6px 0; color:${color}; font-size:13px; transition:color 0.3s;">${icon} ${escapeHtml(step.label)}</div>`;
        }).join('');
      }
      return;
    }

    // No recognized status field — treat as error
    pollErrors++;
    addDebugLog(`Unexpected response (${pollErrors}/5): ${JSON.stringify(data).slice(0, 100)}`);
    console.warn(`pollJob: unexpected response (${pollErrors}/5):`, data);
    if (pollErrors >= 5) {
      stopPolling();
      showError(data.error || 'Generation failed after multiple errors');
    }
  } catch (err) {
    pollErrors++;
    addDebugLog(`Network error (${pollErrors}/5): ${err.message}`);
    console.warn(`pollJob: network error (${pollErrors}/5):`, err.message);
    if (pollErrors >= 5) {
      stopPolling();
      showError('Lost connection to server');
    }
  }
}

async function onGenerationComplete(gameDefinition) {
  // Load the draft to get current versions
  if (currentDraftId) {
    const res = await fetch(`/api/drafts/${currentDraftId}`);
    const data = await res.json();
    if (data.draft) {
      currentDraft = data.draft;

      // Add the new version
      const versions = [...(currentDraft.versions || [])];
      versions.push({
        gameCode: gameDefinition.gameCode,
        description: gameDefinition.description || currentDraft.description,
        metadata: gameDefinition.metadata || {},
        savedAt: Date.now(),
      });

      currentVersionIndex = versions.length - 1;

      // Save back to draft
      await fetch(`/api/drafts/${currentDraftId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: gameDefinition.metadata?.title || currentDraft.title,
          status: 'draft',
          currentIndex: currentVersionIndex,
          versions,
        }),
      });

      // Reload draft
      const res2 = await fetch(`/api/drafts/${currentDraftId}`);
      const data2 = await res2.json();
      if (data2.draft) currentDraft = data2.draft;
    }
  }

  state = 'preview';
  render();
}

// --- Preview ---
async function renderPreview() {
  const versions = currentDraft?.versions || [];
  const version = versions[currentVersionIndex];
  if (!version) {
    rollAll();
    state = 'roll';
    render();
    return;
  }

  const title = version.metadata?.title || currentDraft?.title || 'Untitled Game';
  const versionCount = versions.length;
  const versionLabel = versionCount > 1 ? `v${currentVersionIndex + 1}/${versionCount}` : '';

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; height:100vh; padding:16px; gap:10px;">
      <div style="display:flex; align-items:center; justify-content:space-between; width:100%; max-width:360px;">
        <h2 style="font-size:16px; font-weight:600; color:var(--text-1); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(title)}</h2>
        ${versionLabel ? `<div style="display:flex; align-items:center; gap:6px;">
          <span style="color:var(--text-3); font-size:12px;">${versionLabel}</span>
          ${versionCount > 1 ? `
            <button id="prev-ver" style="background:var(--surface-3); color:var(--text-1); border:1px solid var(--border); border-radius:6px; padding:2px 8px; font-size:12px; cursor:pointer; ${currentVersionIndex <= 0 ? 'opacity:0.3; cursor:default;' : ''}">&lsaquo;</button>
            <button id="next-ver" style="background:var(--surface-3); color:var(--text-1); border:1px solid var(--border); border-radius:6px; padding:2px 8px; font-size:12px; cursor:pointer; ${currentVersionIndex >= versionCount - 1 ? 'opacity:0.3; cursor:default;' : ''}">&rsaquo;</button>
          ` : ''}
        </div>` : ''}
      </div>
      <div id="preview-thumb-container" style="flex:1; width:100%; max-width:360px; display:flex; align-items:center; justify-content:center; position:relative; cursor:pointer; border-radius:12px; overflow:hidden; background:#000; min-height:200px;">
        <canvas id="preview-thumb" style="image-rendering:pixelated; max-width:100%; max-height:100%; object-fit:contain;"></canvas>
        <div id="play-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.35); transition:background 0.2s;">
          <div style="width:56px; height:56px; background:rgba(255,69,0,0.9); border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 20px var(--primary-glow);">
            <div style="width:0; height:0; border-style:solid; border-width:10px 0 10px 18px; border-color:transparent transparent transparent var(--text-1); margin-left:3px;"></div>
          </div>
        </div>
      </div>
      <div style="display:flex; gap:8px; width:100%; max-width:360px; justify-content:center;">
        <button id="publish-btn" style="flex:1; background:var(--surface-2); color:var(--primary); border:1px solid var(--primary); border-radius:12px; padding:10px; font-size:13px; font-weight:bold; cursor:pointer; transition:transform 0.1s;">PUBLISH</button>
        <button id="edit-btn" style="flex:1; background:var(--surface-2); color:var(--text-2); border:1px solid var(--border); border-radius:12px; padding:10px; font-size:13px; cursor:pointer; transition:transform 0.1s;">EDIT</button>
        <button id="reroll-btn" style="width:44px; background:var(--surface-2); color:var(--text-3); border:1px solid var(--border); border-radius:12px; padding:10px; font-size:15px; cursor:pointer; transition:transform 0.1s;" title="Reroll">&#8635;</button>
      </div>
      <button id="back-btn" style="background:transparent; color:var(--text-3); border:none; font-size:12px; cursor:pointer; text-decoration:underline;">
        drafts
      </button>
    </div>
    <style>
      #preview-thumb-container:hover #play-overlay { background: rgba(0,0,0,0.2); }
      #publish-btn:active, #edit-btn:active, #reroll-btn:active { transform: scale(0.96); }
    </style>
  `;

  // Render first frame thumbnail
  if (version.gameCode) {
    renderThumbnail(version.gameCode);
  }

  document.getElementById('preview-thumb-container').addEventListener('click', () => {
    state = 'playing';
    render();
  });

  document.getElementById('publish-btn').addEventListener('click', publishGame);

  document.getElementById('edit-btn').addEventListener('click', () => {
    state = 'editing';
    render();
  });

  document.getElementById('reroll-btn').addEventListener('click', () => {
    rollAll();
    state = 'roll';
    render();
  });

  document.getElementById('back-btn').addEventListener('click', async () => {
    await loadDrafts();
    state = 'drafts-list';
    render();
  });

  if (versionCount > 1) {
    const prevBtn = document.getElementById('prev-ver');
    const nextBtn = document.getElementById('next-ver');
    if (prevBtn && currentVersionIndex > 0) {
      prevBtn.addEventListener('click', () => {
        currentVersionIndex--;
        render();
      });
    }
    if (nextBtn && currentVersionIndex < versionCount - 1) {
      nextBtn.addEventListener('click', () => {
        currentVersionIndex++;
        render();
      });
    }
  }
}

async function renderThumbnail(code) {
  const canvas = document.getElementById('preview-thumb');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 400, h = 400;

  try {
    await initQuickJS();
    const thumbSandbox = createSandbox();
    const { metadata, resources } = thumbSandbox.loadGame(code);
    if (metadata.width) w = metadata.width;
    if (metadata.height) h = metadata.height;
    canvas.width = w;
    canvas.height = h;

    let thumbImages = {};
    if (resources.images) {
      thumbImages = await loadPreviewImages(resources.images, ctx);
    }

    // Run one frame with zero input to get initial state
    const emptyInput = {
      up:false, down:false, left:false, right:false, a:false, b:false,
      upPressed:false, downPressed:false, leftPressed:false, rightPressed:false,
      aPressed:false, bPressed:false,
      pointerDown:false, pointerX:0, pointerY:0, pointerPressed:false,
    };
    const commands = thumbSandbox.callUpdate(0.016, emptyInput);
    if (Array.isArray(commands)) {
      const drawCmds = commands.filter(c => c && c.op && !['tone','noise','sample','stop','stopAll','volume','score','gameOver'].includes(c.op));
      executeCommands(ctx, drawCmds, thumbImages);
    }
    thumbSandbox.dispose();
  } catch (err) {
    canvas.width = w;
    canvas.height = h;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#444';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Preview unavailable', w / 2, h / 2);
  }
}

// --- Playing (inline game preview) ---
function stopPreviewGame() {
  if (previewAnimFrame) {
    cancelAnimationFrame(previewAnimFrame);
    previewAnimFrame = null;
  }
  if (previewSandbox) {
    previewSandbox.dispose();
    previewSandbox = null;
  }
  previewImagePool = {};
}

// --- Debug inspection panel ---
function resetDebugStats() {
  debugFrameStats = {
    frameCount: 0,
    cmdCounts: {},
    imgInstances: {},
    offscreen: [],
    audioThisFrame: [],
    totalCmds: 0,
    peakCmds: 0,
    peakFrame: 0,
    cmdHistory: [],
    fps: 0,
    _fpsFrames: 0,
    _fpsLastTime: performance.now(),
  };
  debugConsoleLog = [];
}

function addConsoleLog(type, msg) {
  const elapsed = debugGameStartTime ? ((performance.now() - debugGameStartTime) / 1000) : 0;
  const min = Math.floor(elapsed / 60);
  const sec = (elapsed % 60).toFixed(1);
  const time = `${min.toString().padStart(2, '0')}:${sec.padStart(4, '0')}`;
  debugConsoleLog.push({ time, type, msg });
  if (debugConsoleLog.length > 200) debugConsoleLog.shift();
}

function collectFrameStats(drawCmds, audioCmds, gw, gh) {
  if (!debugFrameStats) return;
  const s = debugFrameStats;
  s.frameCount++;

  s._fpsFrames++;
  const now = performance.now();
  if (now - s._fpsLastTime >= 1000) {
    s.fps = Math.round(s._fpsFrames * 1000 / (now - s._fpsLastTime));
    s._fpsFrames = 0;
    s._fpsLastTime = now;
    s.cmdHistory.push(s.totalCmds);
    if (s.cmdHistory.length > 60) s.cmdHistory.shift();
  }

  s.cmdCounts = {};
  s.imgInstances = {};
  s.offscreen = [];
  s.audioThisFrame = audioCmds;
  s.totalCmds = drawCmds.length;

  if (drawCmds.length > s.peakCmds) {
    s.peakCmds = drawCmds.length;
    s.peakFrame = s.frameCount;
  }

  for (const cmd of drawCmds) {
    s.cmdCounts[cmd.op] = (s.cmdCounts[cmd.op] || 0) + 1;
    if (cmd.op === 'img') {
      s.imgInstances[cmd.id] = (s.imgInstances[cmd.id] || 0) + 1;
      const w = cmd.w || 0, h = cmd.h || 0;
      if (cmd.x + w < 0 || cmd.x > gw || cmd.y + h < 0 || cmd.y > gh) {
        s.offscreen.push({ id: cmd.id, x: Math.round(cmd.x), y: Math.round(cmd.y) });
      }
    }
  }
}

function toggleDebugPanel() {
  debugPanelOpen = !debugPanelOpen;
  const drawer = document.getElementById('debug-drawer');
  const btn = document.getElementById('debug-btn');
  if (drawer) drawer.style.display = debugPanelOpen ? 'flex' : 'none';
  if (btn) btn.style.color = debugPanelOpen ? 'var(--primary)' : 'var(--text-3)';
  if (debugPanelOpen) fillDebugTab();
}

function switchDebugTab(tab) {
  debugActiveTab = tab;
  debugExpandedImage = null;
  document.querySelectorAll('.dbg-tab').forEach(el => {
    el.style.color = el.dataset.tab === tab ? 'var(--primary)' : 'var(--text-3)';
    el.style.borderBottom = el.dataset.tab === tab ? '2px solid var(--primary)' : '2px solid transparent';
  });
  fillDebugTab();
}

function fillDebugTab() {
  const container = document.getElementById('debug-tab-content');
  if (!container) return;
  switch (debugActiveTab) {
    case 'code': fillCodeTab(container); break;
    case 'imgs': fillImgsTab(container); break;
    case 'snd': fillSndTab(container); break;
    case 'stats': fillStatsTab(container); break;
    case 'log': fillLogTab(container); break;
  }
}

function fillCodeTab(container) {
  if (!debugGameCode) {
    container.innerHTML = '<div style="color:var(--text-3); padding:8px;">No game code loaded</div>';
    return;
  }
  const lines = debugGameCode.split('\n');
  const lineCount = lines.length;
  const size = (debugGameCode.length / 1024).toFixed(1);
  const numbered = lines.map((line, i) =>
    `<span style="color:var(--text-3); user-select:none;">${String(i + 1).padStart(3)}</span> ${escapeHtml(line)}`
  ).join('\n');

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; border-bottom:1px solid var(--border);">
      <span style="color:var(--text-3); font-size:10px;">${lineCount} lines | ${size} KB</span>
      <button id="dbg-copy-code" style="background:var(--surface-3); color:var(--text-2); border:none; border-radius:4px; padding:2px 8px; font-size:10px; cursor:pointer;">Copy</button>
    </div>
    <pre style="padding:8px; margin:0; overflow:auto; flex:1; font-size:11px; line-height:1.5; color:var(--text-1); font-family:monospace; white-space:pre; tab-size:2;">${numbered}</pre>
  `;

  document.getElementById('dbg-copy-code')?.addEventListener('click', () => {
    navigator.clipboard.writeText(debugGameCode).then(() => {
      const btn = document.getElementById('dbg-copy-code');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
    });
  });
}

function fillImgsTab(container) {
  const images = debugResources?.images;
  if (!images || Object.keys(images).length === 0) {
    container.innerHTML = '<div style="color:var(--text-3); padding:8px;">No images defined</div>';
    return;
  }

  if (debugExpandedImage && images[debugExpandedImage]) {
    fillExpandedImage(container, debugExpandedImage, images[debugExpandedImage]);
    return;
  }

  const count = Object.keys(images).length;
  const items = Object.entries(images).map(([id, res]) => `
    <div class="dbg-img-item" data-id="${escapeHtml(id)}" style="display:flex; flex-direction:column; align-items:center; gap:2px; cursor:pointer; padding:6px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2);">
      <canvas class="dbg-img-canvas" data-id="${escapeHtml(id)}" width="1" height="1" style="image-rendering:pixelated; width:48px; height:48px; background:#000; border-radius:4px;"></canvas>
      <div style="font-size:9px; color:var(--text-2); max-width:64px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center;">${escapeHtml(id)}</div>
      <div style="font-size:8px; color:var(--text-3);">${res.type} ${res.w || '?'}x${res.h || '?'}</div>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="padding:6px 8px; border-bottom:1px solid var(--border); font-size:10px; color:var(--text-3);">Images (${count}/20)</div>
    <div style="display:flex; flex-wrap:wrap; gap:8px; padding:8px; overflow:auto; flex:1;">
      ${items}
    </div>
  `;

  // Render bitmaps onto thumbnail canvases
  requestAnimationFrame(() => {
    container.querySelectorAll('.dbg-img-canvas').forEach(canvas => {
      const id = canvas.dataset.id;
      const bitmap = previewImagePool[id];
      if (bitmap) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const cx = canvas.getContext('2d');
        cx.drawImage(bitmap, 0, 0);
      }
    });
  });

  container.querySelectorAll('.dbg-img-item').forEach(el => {
    el.addEventListener('click', () => {
      debugExpandedImage = el.dataset.id;
      fillDebugTab();
    });
  });
}

function fillExpandedImage(container, id, res) {
  const bitmap = previewImagePool[id];
  const details = [`Type: ${res.type}`, `Size: ${res.w || '?'} × ${res.h || '?'}`];
  if (res.type === 'hex' && res.palette) details.push(`Palette: ${res.palette.join(' ')}`);
  if (res.type === 'generate' && res.prompt) details.push(`Prompt: ${res.prompt}`);
  if (res.type === 'procedural' && res.draw) details.push(`Draw ops: ${res.draw.length}`);

  container.innerHTML = `
    <div style="padding:6px 8px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
      <span style="font-size:11px; color:var(--text-1); font-weight:600;">${escapeHtml(id)}</span>
      <button id="dbg-img-back" style="background:var(--surface-3); color:var(--text-2); border:none; border-radius:4px; padding:2px 8px; font-size:10px; cursor:pointer;">Back</button>
    </div>
    <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:8px; overflow:auto;">
      <canvas id="dbg-img-expanded" style="image-rendering:pixelated; max-width:100%; max-height:160px; background:#000; border:1px solid var(--border); border-radius:4px;"></canvas>
      <div style="font-size:10px; color:var(--text-2); font-family:monospace; line-height:1.6;">
        ${details.map(l => escapeHtml(l)).join('<br>')}
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    const canvas = document.getElementById('dbg-img-expanded');
    if (canvas && bitmap) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
    }
  });

  document.getElementById('dbg-img-back')?.addEventListener('click', () => {
    debugExpandedImage = null;
    fillDebugTab();
  });
}

function fillSndTab(container) {
  const sounds = debugResources?.sounds;
  if (!sounds || Object.keys(sounds).length === 0) {
    container.innerHTML = '<div style="color:var(--text-3); padding:8px;">No sounds defined</div>';
    return;
  }

  const count = Object.keys(sounds).length;
  const items = Object.entries(sounds).map(([id, res]) => {
    let info = '';
    if (res.type === 'generate') {
      info = `${res.wave || 'sine'}`;
      if (res.note) info += ` | ${res.note}`;
      if (res.notes) info += ` | ${res.notes.join(',')}`;
      if (res.env) info += `<br>ADSR: ${res.env.a || 0}/${res.env.d || 0}/${res.env.s || 0}/${res.env.r || 0}`;
      if (res.sweep) info += `<br>Sweep: ${res.sweep.from || '?'} → ${res.sweep.to || '?'}Hz`;
      if (res.dur) info += ` | ${res.dur}s`;
    } else if (res.type === 'pcm') {
      const dur = res.data ? (res.data.length / (res.rate || 22050)).toFixed(2) : '?';
      info = `pcm | ${res.rate || 22050}Hz | ${res.data?.length || 0} samples | ${dur}s`;
    }
    return `
      <div style="display:flex; align-items:flex-start; gap:8px; padding:8px; border-bottom:1px solid var(--border);">
        <button class="dbg-snd-play" data-id="${escapeHtml(id)}" style="background:var(--surface-3); color:var(--primary); border:1px solid var(--border); border-radius:50%; width:28px; height:28px; cursor:pointer; flex-shrink:0; font-size:12px; display:flex; align-items:center; justify-content:center;">&#9654;</button>
        <div style="flex:1; min-width:0;">
          <div style="font-size:11px; color:var(--text-1); font-weight:600;">${escapeHtml(id)}</div>
          <div style="font-size:9px; color:var(--text-3); font-family:monospace; line-height:1.5; margin-top:2px;">${info}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="padding:6px 8px; border-bottom:1px solid var(--border); font-size:10px; color:var(--text-3);">Sounds (${count}/20)</div>
    <div style="overflow:auto; flex:1;">${items}</div>
  `;

  container.querySelectorAll('.dbg-snd-play').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      tryResumeAudio();
      processAudioCommands([{ op: 'sample', id: btn.dataset.id, ch: 7, vol: 0.5 }]);
    });
  });
}

function fillStatsTab(container) {
  container.innerHTML = `<div id="dbg-stats-content" style="padding:8px; overflow:auto; flex:1; font-family:monospace; font-size:10px; line-height:1.6;"><div style="color:var(--text-3);">Collecting...</div></div>`;
  updateStatsDOM();
}

function updateStatsDOM() {
  const el = document.getElementById('dbg-stats-content');
  if (!el || !debugFrameStats) return;
  const s = debugFrameStats;

  const maxCount = Math.max(1, ...Object.values(s.cmdCounts));
  const cmdBars = Object.entries(s.cmdCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const pct = Math.round(count / maxCount * 100);
      return `<div style="display:flex; align-items:center; gap:6px; height:14px;">
        <span style="width:52px; text-align:right; color:var(--text-2);">${type}</span>
        <div style="flex:1; height:8px; background:var(--surface-2); border-radius:2px; overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:var(--primary); border-radius:2px;"></div>
        </div>
        <span style="width:24px; color:var(--text-1);">${count}</span>
      </div>`;
    }).join('');

  const imgEntries = Object.entries(s.imgInstances).sort((a, b) => b[1] - a[1]);
  const imgLine = imgEntries.map(([id, n]) => `${id} ×${n}`).join('  ');

  const allImageIds = debugResources?.images ? Object.keys(debugResources.images) : [];
  const unusedImgs = allImageIds.filter(id => !s.imgInstances[id]);

  const offscreenHtml = s.offscreen.length > 0
    ? `<div style="color:#f90; margin-top:4px;">&#9888; ${s.offscreen.length} offscreen: ${s.offscreen.slice(0, 3).map(o => `${o.id}@${o.x},${o.y}`).join(', ')}${s.offscreen.length > 3 ? '...' : ''}</div>`
    : '';

  const audioHtml = s.audioThisFrame.length > 0
    ? s.audioThisFrame.map(a => `<span style="color:var(--accent-cyan);">&#9835; ${a.op} ${a.id || ''} ${a.wave || ''} ${a.note || ''}</span>`).join(' ')
    : '<span style="color:var(--text-3);">--</span>';

  const sparkline = renderSparkline(s.cmdHistory);

  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; color:var(--text-1); font-size:12px; font-weight:600; margin-bottom:8px;">
      <span>Frame ${s.frameCount}</span>
      <span>${s.fps}fps</span>
      <span>${s.totalCmds} cmd</span>
    </div>
    <div style="color:var(--text-3); font-size:9px; margin-bottom:4px;">COMMANDS BY TYPE</div>
    ${cmdBars || '<div style="color:var(--text-3);">--</div>'}
    <div style="color:var(--text-3); font-size:9px; margin-top:8px; margin-bottom:4px;">IMAGE INSTANCES</div>
    <div style="color:var(--text-2); word-break:break-word;">${imgLine || '--'}</div>
    ${unusedImgs.length > 0 ? `<div style="color:var(--text-3); margin-top:2px;">(unused: ${unusedImgs.join(', ')})</div>` : ''}
    ${offscreenHtml}
    <div style="color:var(--text-3); font-size:9px; margin-top:8px; margin-bottom:4px;">AUDIO THIS FRAME</div>
    <div>${audioHtml}</div>
    <div style="color:var(--text-3); font-size:9px; margin-top:8px; margin-bottom:4px;">CMD/FRAME (peak: ${s.peakCmds} @ #${s.peakFrame})</div>
    ${sparkline}
  `;
}

function renderSparkline(data) {
  if (data.length < 2) return '<div style="color:var(--text-3);">collecting...</div>';
  const max = Math.max(...data, 1);
  const w = 200;
  const h = 32;
  const barW = Math.max(2, Math.floor(w / data.length) - 1);
  const bars = data.map((v, i) => {
    const barH = Math.max(1, Math.round(v / max * h));
    const x = i * (barW + 1);
    return `<div style="position:absolute; bottom:0; left:${x}px; width:${barW}px; height:${barH}px; background:var(--primary); border-radius:1px; opacity:${i === data.length - 1 ? 1 : 0.5};"></div>`;
  }).join('');
  return `<div style="position:relative; width:${w}px; height:${h}px; background:var(--surface-2); border-radius:4px; overflow:hidden; border:1px solid var(--border);">${bars}</div>`;
}

function fillLogTab(container) {
  const entries = debugConsoleLog;
  const errorCount = entries.filter(e => e.type === 'error').length;
  const warnCount = entries.filter(e => e.type === 'warn').length;

  const logHtml = entries.length > 0
    ? entries.map(e => {
        const color = e.type === 'error' ? 'var(--error)' : e.type === 'warn' ? '#f90' : 'var(--text-2)';
        const icon = e.type === 'error' ? '&#10007;' : e.type === 'warn' ? '&#9888;' : '&#183;';
        return `<div style="color:${color}; font-size:10px; padding:1px 0; font-family:monospace;"><span style="color:var(--text-3);">${e.time}</span> ${icon} ${escapeHtml(e.msg)}</div>`;
      }).join('')
    : '<div style="color:var(--text-3); padding:8px;">No events yet</div>';

  container.innerHTML = `
    <div style="padding:6px 8px; border-bottom:1px solid var(--border); font-size:10px; color:var(--text-3);">
      ${entries.length} events${errorCount > 0 ? ` | <span style="color:var(--error);">${errorCount} errors</span>` : ''}${warnCount > 0 ? ` | <span style="color:#f90;">${warnCount} warnings</span>` : ''}
    </div>
    <div id="dbg-log-entries" style="overflow:auto; flex:1; padding:4px 8px;">${logHtml}</div>
  `;

  // Scroll to bottom
  const logEl = document.getElementById('dbg-log-entries');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

async function renderPlaying() {
  const versions = currentDraft?.versions || [];
  const version = versions[currentVersionIndex];
  if (!version?.gameCode) {
    state = 'preview';
    render();
    return;
  }

  const dbgTabStyle = (tab) => `background:none; border:none; font-size:11px; cursor:pointer; padding:4px 8px; color:${debugActiveTab === tab ? 'var(--primary)' : 'var(--text-3)'}; border-bottom:2px solid ${debugActiveTab === tab ? 'var(--primary)' : 'transparent'};`;

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; height:100vh; padding:8px; gap:6px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <button id="stop-btn" style="background:var(--surface-3); color:var(--text-1); border:none; border-radius:12px; padding:6px 16px; font-size:12px; cursor:pointer;">STOP</button>
        <span style="color:var(--text-2); font-size:12px;">${escapeHtml(version.metadata?.title || 'Untitled')}</span>
        <button id="restart-btn" style="background:var(--surface-3); color:var(--text-1); border:none; border-radius:12px; padding:6px 16px; font-size:12px; cursor:pointer;">RESTART</button>
        <button id="debug-btn" style="background:none; border:1px solid var(--border); border-radius:8px; padding:4px 10px; font-size:10px; font-family:monospace; cursor:pointer; color:${debugPanelOpen ? 'var(--primary)' : 'var(--text-3)'};">DBG</button>
      </div>
      <div id="game-container" style="flex:1; display:flex; align-items:center; justify-content:center; width:100%; overflow:hidden; position:relative; min-height:0;">
        <canvas id="preview-canvas" style="image-rendering: pixelated; background:#000;"></canvas>
        <div id="preview-gameover" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.75); flex-direction:column; align-items:center; justify-content:center; gap:12px; animation:fadeIn 0.4s ease-out;">
          <div style="color:var(--text-1); font-family:var(--font-display); font-size:24px; text-transform:uppercase; letter-spacing:3px; text-shadow:0 0 20px var(--primary-glow);">Game Over</div>
          <div id="preview-go-score" style="color:var(--primary); font:bold 20px monospace;"></div>
          <button id="preview-go-replay" style="background:var(--primary); color:var(--text-1); border:none; border-radius:16px; padding:10px 28px; font:bold 14px var(--font-body); cursor:pointer;">PLAY AGAIN</button>
          <button id="preview-go-stop" style="background:transparent; color:var(--text-2); border:1px solid var(--border-light); border-radius:16px; padding:6px 16px; font-size:12px; cursor:pointer;">back to preview</button>
        </div>
      </div>
      <div id="debug-drawer" style="display:${debugPanelOpen ? 'flex' : 'none'}; flex-direction:column; width:100%; height:40vh; background:var(--surface-1); border:1px solid var(--border); border-radius:8px; overflow:hidden; flex-shrink:0;">
        <div id="debug-tabs" style="display:flex; border-bottom:1px solid var(--border); flex-shrink:0;">
          <button class="dbg-tab" data-tab="code" style="${dbgTabStyle('code')}">Code</button>
          <button class="dbg-tab" data-tab="imgs" style="${dbgTabStyle('imgs')}">Imgs</button>
          <button class="dbg-tab" data-tab="snd" style="${dbgTabStyle('snd')}">Snd</button>
          <button class="dbg-tab" data-tab="stats" style="${dbgTabStyle('stats')}">Stats</button>
          <button class="dbg-tab" data-tab="log" style="${dbgTabStyle('log')}">Log</button>
        </div>
        <div id="debug-tab-content" style="flex:1; overflow:auto; display:flex; flex-direction:column; min-height:0;"></div>
      </div>
      <div id="preview-score" style="color:var(--primary); font-size:14px; font-weight:bold; height:20px; flex-shrink:0;"></div>
      <div id="preview-error" style="color:var(--error); font-size:12px; max-width:360px; text-align:center; display:none;"></div>
    </div>
  `;

  document.getElementById('stop-btn').addEventListener('click', () => {
    state = 'preview';
    render();
  });

  document.getElementById('restart-btn').addEventListener('click', () => {
    stopPreviewGame();
    renderPlaying();
  });

  document.getElementById('debug-btn').addEventListener('click', toggleDebugPanel);
  document.querySelectorAll('.dbg-tab').forEach(el => {
    el.addEventListener('click', () => switchDebugTab(el.dataset.tab));
  });

  document.getElementById('preview-go-replay')?.addEventListener('click', () => {
    stopPreviewGame();
    renderPlaying();
  });

  document.getElementById('preview-go-stop')?.addEventListener('click', () => {
    state = 'preview';
    render();
  });

  await startPreviewGame(version.gameCode);
}

async function startPreviewGame(code) {
  const canvas = document.getElementById('preview-canvas');
  const container = document.getElementById('game-container');
  const scoreEl = document.getElementById('preview-score');
  const errorEl = document.getElementById('preview-error');
  if (!canvas || !container) return;

  const ctx = canvas.getContext('2d');
  let gameWidth = 400;
  let gameHeight = 400;
  let isGameOver = false;

  function resizePreviewCanvas() {
    const maxW = container.clientWidth;
    const maxH = container.clientHeight;
    const scale = Math.min(maxW / gameWidth, maxH / gameHeight);
    canvas.width = gameWidth;
    canvas.height = gameHeight;
    canvas.style.width = Math.floor(gameWidth * scale) + 'px';
    canvas.style.height = Math.floor(gameHeight * scale) + 'px';
  }

  // Loading progress drawn on canvas
  canvas.width = gameWidth;
  canvas.height = gameHeight;
  resizePreviewCanvas();

  function drawLoading(text, progress) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, gameWidth, gameHeight);
    ctx.fillStyle = '#666';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, gameWidth / 2, gameHeight / 2 - 12);
    if (progress != null) {
      const barW = 200, barH = 6;
      const bx = (gameWidth - barW) / 2, by = gameHeight / 2 + 8;
      ctx.fillStyle = '#222';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = '#ff4500';
      ctx.fillRect(bx, by, barW * Math.min(1, progress), barH);
    }
  }
  drawLoading('Loading...', 0);

  try {
    await initQuickJS();
    previewSandbox = createSandbox();
    const { metadata, resources } = previewSandbox.loadGame(code);

    if (metadata.width) gameWidth = metadata.width;
    if (metadata.height) gameHeight = metadata.height;
    resizePreviewCanvas();

    if (resources.images) {
      previewImagePool = await loadPreviewImages(resources.images, ctx, (loaded, total, name) => {
        drawLoading(`Loading ${loaded}/${total}: ${name}`, loaded / total);
      });
    }
    if (resources.sounds) {
      drawLoading('Loading sounds...', null);
      await preloadSounds(resources.sounds);
    }

    // Save for debug panel
    debugGameCode = code;
    debugResources = resources;
    debugMetadata = metadata;
    debugGameStartTime = performance.now();
    resetDebugStats();
    const imgCount = resources.images ? Object.keys(resources.images).length : 0;
    const sndCount = resources.sounds ? Object.keys(resources.sounds).length : 0;
    addConsoleLog('info', `Loaded: ${metadata.title || 'Untitled'} (${gameWidth}×${gameHeight})`);
    addConsoleLog('info', `Resources: ${imgCount} images, ${sndCount} sounds`);
    if (debugPanelOpen) fillDebugTab();

    // Input state for this preview session
    const input = {
      up: false, down: false, left: false, right: false, a: false, b: false,
      upPressed: false, downPressed: false, leftPressed: false, rightPressed: false,
      aPressed: false, bPressed: false,
      pointerDown: false, pointerX: 0, pointerY: 0, pointerPressed: false,
    };
    const prevInput = {};

    const keyMap = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
      z: 'a', x: 'b', ' ': 'a',
    };

    function onKeyDown(e) {
      const btn = keyMap[e.key];
      if (btn) { input[btn] = true; e.preventDefault(); tryResumeAudio(); }
    }
    function onKeyUp(e) {
      const btn = keyMap[e.key];
      if (btn) { input[btn] = false; }
    }
    function onPointerDown(e) {
      input.pointerDown = true;
      updatePointer(e);
      tryResumeAudio();
    }
    function onPointerMove(e) { updatePointer(e); }
    function onPointerUp() { input.pointerDown = false; }

    function updatePointer(e) {
      const rect = canvas.getBoundingClientRect();
      input.pointerX = (e.clientX - rect.left) * (gameWidth / rect.width);
      input.pointerY = (e.clientY - rect.top) * (gameHeight / rect.height);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);

    // Clean up listeners when sandbox is disposed
    const origDispose = previewSandbox.dispose.bind(previewSandbox);
    previewSandbox.dispose = () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      origDispose();
    };

    const resizeObs = new ResizeObserver(() => resizePreviewCanvas());
    resizeObs.observe(container);

    let lastTime = performance.now();
    let lastSlowLogTime = 0;
    function loop(now) {
      if (isGameOver || !previewSandbox) return;

      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      for (const key of ['up', 'down', 'left', 'right', 'a', 'b']) {
        input[key + 'Pressed'] = input[key] && !prevInput[key];
      }
      input.pointerPressed = input.pointerDown && !prevInput.pointerDown;

      const _t0 = performance.now();
      const commands = previewSandbox.callUpdate(dt, input);
      const _updateMs = performance.now() - _t0;

      Object.assign(prevInput, input);
      input.pointerPressed = false;
      for (const key of ['up', 'down', 'left', 'right', 'a', 'b']) {
        input[key + 'Pressed'] = false;
      }

      if (_updateMs > 16 && now - lastSlowLogTime > 2000) {
        addConsoleLog('warn', `update() took ${_updateMs.toFixed(1)}ms`);
        lastSlowLogTime = now;
      }

      if (Array.isArray(commands)) {
        const drawCmds = [];
        const audioCmds = [];
        for (const cmd of commands) {
          if (!cmd || !cmd.op) continue;
          if (cmd.op === 'score') {
            if (scoreEl) scoreEl.textContent = 'SCORE: ' + cmd.value;
          } else if (cmd.op === 'gameOver') {
            isGameOver = true;
            addConsoleLog('info', `Game Over (score: ${cmd.value || 0})`);
            if (scoreEl) scoreEl.textContent = '';
            const goOverlay = document.getElementById('preview-gameover');
            const goScore = document.getElementById('preview-go-score');
            if (goOverlay) goOverlay.style.display = 'flex';
            if (goScore) goScore.textContent = '\u2605 ' + (cmd.value || 0) + ' \u2605';
          } else if (['tone', 'noise', 'sample', 'stop', 'stopAll', 'volume'].includes(cmd.op)) {
            audioCmds.push(cmd);
          } else {
            if (cmd.op === 'text' && cmd.text?.startsWith('ERROR:')) {
              addConsoleLog('error', cmd.text);
            }
            drawCmds.push(cmd);
          }
        }
        executeCommands(ctx, drawCmds, previewImagePool);
        processAudioCommands(audioCmds);

        // Debug stats collection
        collectFrameStats(drawCmds, audioCmds, gameWidth, gameHeight);
        if (debugPanelOpen && debugFrameStats) {
          if (debugActiveTab === 'stats' && debugFrameStats.frameCount % 30 === 0) {
            updateStatsDOM();
          }
          if (debugActiveTab === 'log' && debugFrameStats.frameCount % 60 === 0) {
            fillLogTab(document.getElementById('debug-tab-content'));
          }
        }
      }

      previewAnimFrame = requestAnimationFrame(loop);
    }
    previewAnimFrame = requestAnimationFrame(loop);
  } catch (err) {
    console.error('Preview game error:', err);
    addConsoleLog('error', `Load error: ${err.message}`);
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = 'Error: ' + err.message;
    }
  }
}

async function loadPreviewImages(images, ctx, onProgress) {
  const pool = {};
  const entries = Object.entries(images);
  const total = entries.length;
  let loaded = 0;

  function reportProgress(name) {
    loaded++;
    if (onProgress) onProgress(loaded, total, name);
  }

  // Decode a single image resource into an ImageBitmap
  async function decodeImage(id, res) {
    if (res.type === 'pixels') {
      const offscreen = new OffscreenCanvas(res.w, res.h);
      const offCtx = offscreen.getContext('2d');
      const imageData = offCtx.createImageData(res.w, res.h);
      for (let i = 0; i < res.data.length; i++) {
        const color = res.data[i];
        if (!color) continue;
        const hex = color.replace('#', '');
        imageData.data[i * 4] = parseInt(hex.substring(0, 2), 16);
        imageData.data[i * 4 + 1] = parseInt(hex.substring(2, 4), 16);
        imageData.data[i * 4 + 2] = parseInt(hex.substring(4, 6), 16);
        imageData.data[i * 4 + 3] = 255;
      }
      offCtx.putImageData(imageData, 0, 0);
      return createImageBitmap(offscreen);
    } else if (res.type === 'hex') {
      const offscreen = new OffscreenCanvas(res.w, res.h);
      const offCtx = offscreen.getContext('2d');
      const imageData = offCtx.createImageData(res.w, res.h);
      const palette = res.palette.map(c => {
        const hex = c.replace('#', '');
        return [parseInt(hex.substring(0, 2), 16), parseInt(hex.substring(2, 4), 16), parseInt(hex.substring(4, 6), 16)];
      });
      for (let y = 0; y < res.rows.length; y++) {
        for (let x = 0; x < res.rows[y].length; x++) {
          const idx = parseInt(res.rows[y][x], 16);
          if (idx === 0) continue;
          const [r, g, b] = palette[idx] || [0, 0, 0];
          const pi = (y * res.w + x) * 4;
          imageData.data[pi] = r; imageData.data[pi + 1] = g; imageData.data[pi + 2] = b; imageData.data[pi + 3] = 255;
        }
      }
      offCtx.putImageData(imageData, 0, 0);
      return createImageBitmap(offscreen);
    } else if (res.type === 'procedural') {
      const offscreen = new OffscreenCanvas(res.w, res.h);
      const offCtx = offscreen.getContext('2d');
      executeCommands(offCtx, res.draw, {});
      return createImageBitmap(offscreen);
    } else if (res.type === 'generate') {
      const resp = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: res.prompt, w: res.w || 64, h: res.h || 64 }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        console.warn(`Image generate "${id}" failed:`, data.error);
        return null;
      }
      if (!data.url) {
        console.warn(`Image generate "${id}": no url in response`);
        return null;
      }
      const imgResp = await fetch(data.url);
      const blob = await imgResp.blob();
      return createImageBitmap(blob);
    }
    return null;
  }

  // Load all images in parallel, report progress as each finishes
  await Promise.all(entries.map(async ([id, res]) => {
    try {
      const bitmap = await decodeImage(id, res);
      if (bitmap) pool[id] = bitmap;
    } catch (err) {
      console.warn(`Failed to load image "${id}":`, err);
      addConsoleLog('error', `Image "${id}": ${err.message}`);
    }
    reportProgress(id);
  }));

  return pool;
}

async function publishGame() {
  const versions = currentDraft?.versions || [];
  const version = versions[currentVersionIndex];
  if (!version?.gameCode) return;

  const btn = document.getElementById('publish-btn');
  btn.textContent = 'Publishing...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/game/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: currentDraftId,
        gameCode: version.gameCode,
        metadata: version.metadata,
        description: version.description || currentDraft?.description,
      }),
    });

    const data = await res.json();
    if (data.error) {
      showError(data.error);
      return;
    }

    // Navigate to the new post
    if (data.url) {
      navigateTo(data.url);
    }
  } catch (err) {
    showError(err.message);
  }
}

// --- Editing ---
function renderEditing() {
  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; padding:20px;">
      <h1 style="font-size:20px; color:var(--primary);">Edit Game</h1>
      <p style="color:var(--text-2); font-size:13px; text-align:center; max-width:320px;">
        Describe what you want to change
      </p>
      <textarea id="edit-desc" placeholder="e.g. make the enemies faster and add a shield powerup"
        style="width:100%; max-width:360px; height:100px; padding:12px; border-radius:8px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-1); font-size:14px; resize:none; font-family:var(--font-body);"
      ></textarea>
      <button id="apply-btn" style="background:var(--primary); color:var(--text-1); border:none; border-radius:20px; padding:12px 32px; font-size:15px; font-weight:bold; cursor:pointer;">
        APPLY
      </button>
      <button id="back-btn" style="background:transparent; color:var(--text-2); border:none; font-size:13px; cursor:pointer; text-decoration:underline;">
        Back to preview
      </button>
    </div>
  `;

  document.getElementById('apply-btn').addEventListener('click', () => {
    const desc = document.getElementById('edit-desc').value.trim();
    if (desc) startEdit(desc);
  });

  document.getElementById('back-btn').addEventListener('click', () => {
    state = 'preview';
    render();
  });
}

// --- Error ---
function showError(message) {
  if (typeof message !== 'string') message = message?.message || JSON.stringify(message) || 'Unknown error';
  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; padding:20px;">
      <h1 class="logo-mark" style="font-size:20px; color:var(--primary);">rerollgame</h1>
      <p style="color:var(--error); font-size:14px; text-align:center; max-width:300px;">${escapeHtml(message)}</p>
      <button id="retry-btn" style="background:var(--primary); color:var(--text-1); border:none; border-radius:20px; padding:10px 24px; font-size:15px; font-weight:bold; cursor:pointer;">
        TRY AGAIN
      </button>
    </div>
  `;

  document.getElementById('retry-btn').addEventListener('click', async () => {
    await loadDrafts();
    state = 'drafts-list';
    render();
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
