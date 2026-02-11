import { navigateTo } from '@devvit/web/client';
import { executeCommands } from './renderer.js';
import { processAudioCommands, preloadSounds, tryResumeAudio } from './audio.js';
import { initQuickJS, createSandbox } from './sandbox.js';

const root = document.getElementById('root');

// Slot machine components
const SLOTS = {
  genre: ['platformer', 'shooter', 'puzzle', 'racing', 'tower defense', 'RPG', 'rhythm', 'survival', 'endless runner', 'breakout', 'snake', 'match-3', 'bullet hell', 'roguelike', 'pinball'],
  theme: ['space', 'underwater', 'medieval', 'cyberpunk', 'jungle', 'ice world', 'desert', 'haunted house', 'candy land', 'volcanic', 'pirate', 'ninja', 'robot factory', 'dream world', 'tiny bugs'],
  mechanic: ['powerups', 'gravity flip', 'time rewind', 'combo chains', 'shield bash', 'dash attack', 'double jump', 'teleport', 'shrink and grow', 'bouncing', 'grappling hook', 'wall sliding', 'clone split', 'magnet pull', 'charge shot'],
  twist: ['enemies split when hit', 'screen rotates slowly', 'everything speeds up over time', 'one-hit kills both ways', 'shrinking arena', 'random portals appear', 'collect coins to survive', 'day/night cycle changes enemies', 'floor is lava', 'everything bounces'],
};

const SLOT_LABELS = { genre: 'Genre', theme: 'Theme', mechanic: 'Mechanic', twist: 'Twist' };
const SLOT_KEYS = Object.keys(SLOTS);

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Current slot values
let slotValues = {};
function rollAll() { SLOT_KEYS.forEach(k => { slotValues[k] = pickRandom(SLOTS[k]); }); }
function rollOne(key) { slotValues[key] = pickRandom(SLOTS[key]); }
function buildDescription() {
  return `a ${slotValues.genre} game set in ${slotValues.theme} with ${slotValues.mechanic} where ${slotValues.twist}`;
}

// State
let state = 'roll'; // roll | drafts-list | generating | preview | playing | editing
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

function render() {
  // Stop preview game loop when leaving playing state
  if (state !== 'playing') stopPreviewGame();

  switch (state) {
    case 'roll': renderRoll(); break;
    case 'drafts-list': renderDraftsList(); break;
    case 'generating': renderGenerating(); break;
    case 'preview': renderPreview(); break;
    case 'playing': renderPlaying(); break;
    case 'editing': renderEditing(); break;
  }
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
        ? '<span style="width:8px; height:8px; border-radius:50%; background:#39ff14; display:inline-block;"></span>'
        : '<span style="width:8px; height:8px; border-radius:50%; background:#444; display:inline-block;"></span>';
    const statusText = d.status === 'generating' ? 'generating' : d.status === 'published' ? 'published' : 'draft';
    const borderColor = d.status === 'generating' ? '#f90' : d.status === 'published' ? '#39ff14' : '#2a2a2a';
    return `
      <div class="draft-item" data-id="${d.id}" style="display:flex; align-items:center; gap:12px; padding:12px 14px; background:#111; border-radius:10px; cursor:pointer; border:1px solid #2a2a2a; border-left:3px solid ${borderColor}; transition:background 0.15s;">
        <div style="width:44px; height:44px; background:#1a1a1a; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:inset 0 1px 4px rgba(0,0,0,0.4);">
          <span style="font-size:18px; color:#555;">${genre ? '&#127918;' : '&#9776;'}</span>
        </div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:14px; font-weight:600; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(d.title || 'Untitled')}</div>
          <div style="display:flex; align-items:center; gap:6px; margin-top:3px;">
            ${genre ? `<span style="font-size:10px; color:#888; background:#1a1a1a; border:1px solid #333; border-radius:4px; padding:1px 6px;">${escapeHtml(genre)}</span>` : ''}
            <span style="display:flex; align-items:center; gap:4px; font-size:10px; color:#666;">${statusDot} ${statusText}</span>
          </div>
        </div>
        <button class="delete-draft" data-id="${d.id}" style="background:none; border:none; color:#444; font-size:14px; cursor:pointer; padding:6px; flex-shrink:0; transition:color 0.15s;">&times;</button>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; height:100vh; padding:16px; gap:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h1 style="font-size:18px; font-weight:bold; color:#fff;">My Games</h1>
        <button id="new-game-btn" style="background:#ff4500; color:#fff; border:none; border-radius:10px; padding:8px 16px; font-size:13px; font-weight:bold; cursor:pointer; transition:transform 0.1s;">+ New</button>
      </div>
      <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
        ${drafts.length > 0 ? draftItems : '<p style="color:#555; text-align:center; margin-top:40px; font-size:14px;">No games yet</p>'}
      </div>
    </div>
    <style>
      .draft-item:hover { background: #181818 !important; }
      .delete-draft:hover { color: #f44 !important; }
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
      <div style="color:#666; font-size:10px; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:4px; padding-left:2px;">${SLOT_LABELS[key]}</div>
      <div class="slot-value" data-key="${key}" style="background:#111; border:1px solid #2a2a2a; border-radius:10px; padding:12px 16px; color:#fff; font-size:15px; cursor:pointer; user-select:none; box-shadow:inset 0 2px 8px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04); display:flex; justify-content:space-between; align-items:center; transition:background 0.15s, border-color 0.15s;">
        <span class="slot-text">${escapeHtml(slotValues[key])}</span>
        <span style="color:#555; font-size:13px;">&#8635;</span>
      </div>
    </div>
  `).join('');

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:12px; padding:20px;">
      <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">rerollgame</h1>
      <div style="display:flex; flex-direction:column; gap:10px; width:100%; align-items:center;">
        ${slotRows}
      </div>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button id="roll-all-btn" style="background:#1a1a1a; color:#ff4500; border:1px solid #ff4500; border-radius:20px; padding:11px 28px; font-size:14px; font-weight:bold; cursor:pointer; transition:transform 0.1s;">
          ROLL
        </button>
        <button id="generate-btn" style="background:#ff4500; color:#fff; border:none; border-radius:20px; padding:11px 28px; font-size:14px; font-weight:bold; cursor:pointer; transition:transform 0.1s;">
          GENERATE
        </button>
      </div>
      <button id="drafts-btn" style="background:transparent; color:#888; border:none; font-size:13px; cursor:pointer; text-decoration:underline;">
        My drafts${drafts.length > 0 ? ` (${drafts.length})` : ''}
      </button>
    </div>
    <style>
      .slot-value:hover { background: #181818 !important; border-color: #444 !important; }
      .slot-value:active { transform: scale(0.98); }
      .slot-spin .slot-text { animation: slotSpin 0.3s ease-out; display:inline-block; }
      @keyframes slotSpin { 0% { opacity:0; transform:translateY(-12px); } 100% { opacity:1; transform:translateY(0); } }
      #roll-all-btn:active, #generate-btn:active { transform: scale(0.96); }
    </style>
  `;

  // Tap individual slot to re-roll
  root.querySelectorAll('.slot-value').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.key;
      rollOne(key);
      const textEl = el.querySelector('.slot-text');
      if (textEl) textEl.textContent = slotValues[key];
      el.classList.remove('slot-spin');
      void el.offsetWidth; // reflow
      el.classList.add('slot-spin');
    });
  });

  // Roll all with staggered animation
  document.getElementById('roll-all-btn').addEventListener('click', () => {
    rollAll();
    root.querySelectorAll('.slot-value').forEach((el, i) => {
      setTimeout(() => {
        const textEl = el.querySelector('.slot-text');
        if (textEl) textEl.textContent = slotValues[el.dataset.key];
        el.classList.remove('slot-spin');
        void el.offsetWidth;
        el.classList.add('slot-spin');
      }, i * 100);
    });
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
    { label: `Building ${slotValues.theme || 'world'} theme`, threshold: 30 },
    { label: `Adding ${slotValues.mechanic || 'mechanics'}`, threshold: 55 },
    { label: `Wiring ${slotValues.twist || 'twist'} logic`, threshold: 75 },
    { label: 'Polishing & testing', threshold: 90 },
  ];
}

function renderGenerating() {
  const elapsed = generationStartTime ? Math.round((Date.now() - generationStartTime) / 1000) : 0;
  const steps = getGenerationSteps();
  const debugLines = debugLog.slice(-20).map(l => `<div style="color:#888; font-size:10px; font-family:monospace; white-space:pre-wrap;">[${l.time}] ${escapeHtml(l.msg)}</div>`).join('');

  const stepsHtml = steps.map((step, i) => {
    const done = progressValue >= step.threshold;
    const active = !done && (i === 0 || progressValue >= steps[i - 1].threshold);
    const icon = done ? '<span style="color:#39ff14;">&#10003;</span>' : active ? '<span class="gen-spinner">&#9697;</span>' : '<span style="color:#444;">&#9675;</span>';
    const color = done ? '#39ff14' : active ? '#fff' : '#555';
    return `<div style="display:flex; align-items:center; gap:10px; padding:6px 0; color:${color}; font-size:13px; transition:color 0.3s;">${icon} ${escapeHtml(step.label)}</div>`;
  }).join('');

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; padding:20px;">
      <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">Building your game</h1>
      <div style="width:80%; max-width:300px;">
        <div id="gen-steps">${stepsHtml}</div>
      </div>
      <div style="width:80%; max-width:300px; height:6px; background:#222; border-radius:3px; overflow:hidden; margin-top:4px;">
        <div id="progress-bar" style="height:100%; background:linear-gradient(90deg, #ff4500, #ff6a33); border-radius:3px; transition:width 0.5s; width:${progressValue}%;"></div>
      </div>
      <p id="progress-text" style="color:#555; font-size:11px;">${progressValue}%</p>
      <div style="display:flex; gap:12px; align-items:center;">
        <button id="cancel-btn" style="background:transparent; color:#888; border:1px solid #444; border-radius:16px; padding:6px 16px; font-size:12px; cursor:pointer;">Cancel</button>
        <button id="debug-toggle" style="background:transparent; color:#555; border:none; font-size:11px; cursor:pointer; text-decoration:underline;">
          ${debugExpanded ? 'Hide' : 'Show'} Debug
        </button>
      </div>
      <div style="width:100%; max-width:400px;">
        <div id="debug-panel" style="display:${debugExpanded ? 'block' : 'none'}; margin-top:8px; padding:10px; background:#111; border:1px solid #333; border-radius:8px; max-height:300px; overflow-y:auto;">
          <div style="font-size:11px; color:#ff4500; font-weight:600; margin-bottom:6px;">Job Debug</div>
          <div style="font-size:10px; color:#aaa; font-family:monospace; margin-bottom:8px;">
            jobId: ${currentJobId || 'n/a'}<br>
            polls: ${pollCount} | errors: ${pollErrors}<br>
            elapsed: ${elapsed}s<br>
            lastStatus: ${lastPollData ? (lastPollData.status || 'unknown') : 'n/a'}<br>
            openaiId: ${lastPollData?.debug?.openaiResponseId || 'n/a'}<br>
            openaiStatus: ${lastPollData?.debug?.openaiStatus || 'n/a'}<br>
            serverElapsed: ${lastPollData?.debug?.elapsed ? Math.round(lastPollData.debug.elapsed / 1000) + 's' : 'n/a'}
          </div>
          <div style="font-size:11px; color:#ff4500; font-weight:600; margin-bottom:4px;">Log</div>
          ${debugLines || '<div style="color:#666; font-size:10px;">No events yet</div>'}
          <div style="margin-top:8px; border-top:1px solid #333; padding-top:8px;">
            <div style="font-size:11px; color:#ff4500; font-weight:600; margin-bottom:4px;">Lookup Job by ID</div>
            <div style="display:flex; gap:4px;">
              <input id="debug-job-input" type="text" placeholder="paste job ID" style="flex:1; background:#1a1a1a; border:1px solid #444; border-radius:4px; padding:4px 6px; color:#fff; font-size:10px; font-family:monospace;">
              <button id="debug-lookup-btn" style="background:#333; color:#fff; border:none; border-radius:4px; padding:4px 8px; font-size:10px; cursor:pointer;">Lookup</button>
            </div>
            <pre id="debug-lookup-result" style="color:#aaa; font-size:10px; font-family:monospace; white-space:pre-wrap; margin-top:4px; max-height:150px; overflow-y:auto;"></pre>
          </div>
        </div>
      </div>
    </div>
    <style>
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .gen-spinner { display:inline-block; animation: spin 1s linear infinite; color: #ff4500; }
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
          const icon = done ? '<span style="color:#39ff14;">&#10003;</span>' : active ? '<span class="gen-spinner">&#9697;</span>' : '<span style="color:#444;">&#9675;</span>';
          const color = done ? '#39ff14' : active ? '#fff' : '#555';
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
        <h2 style="font-size:16px; font-weight:600; color:#fff; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(title)}</h2>
        ${versionLabel ? `<div style="display:flex; align-items:center; gap:6px;">
          <span style="color:#555; font-size:12px;">${versionLabel}</span>
          ${versionCount > 1 ? `
            <button id="prev-ver" style="background:#222; color:#fff; border:1px solid #333; border-radius:6px; padding:2px 8px; font-size:12px; cursor:pointer; ${currentVersionIndex <= 0 ? 'opacity:0.3; cursor:default;' : ''}">&lsaquo;</button>
            <button id="next-ver" style="background:#222; color:#fff; border:1px solid #333; border-radius:6px; padding:2px 8px; font-size:12px; cursor:pointer; ${currentVersionIndex >= versionCount - 1 ? 'opacity:0.3; cursor:default;' : ''}">&rsaquo;</button>
          ` : ''}
        </div>` : ''}
      </div>
      <div id="preview-thumb-container" style="flex:1; width:100%; max-width:360px; display:flex; align-items:center; justify-content:center; position:relative; cursor:pointer; border-radius:12px; overflow:hidden; background:#000; min-height:200px;">
        <canvas id="preview-thumb" style="image-rendering:pixelated; max-width:100%; max-height:100%; object-fit:contain;"></canvas>
        <div id="play-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.35); transition:background 0.2s;">
          <div style="width:56px; height:56px; background:rgba(255,69,0,0.9); border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 20px rgba(255,69,0,0.4);">
            <div style="width:0; height:0; border-style:solid; border-width:10px 0 10px 18px; border-color:transparent transparent transparent #fff; margin-left:3px;"></div>
          </div>
        </div>
      </div>
      <div style="display:flex; gap:8px; width:100%; max-width:360px; justify-content:center;">
        <button id="publish-btn" style="flex:1; background:#1a1a1a; color:#ff4500; border:1px solid #ff4500; border-radius:12px; padding:10px; font-size:13px; font-weight:bold; cursor:pointer; transition:transform 0.1s;">PUBLISH</button>
        <button id="edit-btn" style="flex:1; background:#1a1a1a; color:#aaa; border:1px solid #333; border-radius:12px; padding:10px; font-size:13px; cursor:pointer; transition:transform 0.1s;">EDIT</button>
        <button id="reroll-btn" style="width:44px; background:#1a1a1a; color:#666; border:1px solid #333; border-radius:12px; padding:10px; font-size:15px; cursor:pointer; transition:transform 0.1s;" title="Reroll">&#8635;</button>
      </div>
      <button id="back-btn" style="background:transparent; color:#666; border:none; font-size:12px; cursor:pointer; text-decoration:underline;">
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

async function renderPlaying() {
  const versions = currentDraft?.versions || [];
  const version = versions[currentVersionIndex];
  if (!version?.gameCode) {
    state = 'preview';
    render();
    return;
  }

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; height:100vh; padding:8px; gap:6px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <button id="stop-btn" style="background:#333; color:#fff; border:none; border-radius:12px; padding:6px 16px; font-size:12px; cursor:pointer;">STOP</button>
        <span style="color:#888; font-size:12px;">${escapeHtml(version.metadata?.title || 'Untitled')}</span>
        <button id="restart-btn" style="background:#333; color:#fff; border:none; border-radius:12px; padding:6px 16px; font-size:12px; cursor:pointer;">RESTART</button>
      </div>
      <div id="game-container" style="flex:1; display:flex; align-items:center; justify-content:center; width:100%; overflow:hidden; position:relative;">
        <canvas id="preview-canvas" style="image-rendering: pixelated; background:#000;"></canvas>
      </div>
      <div id="preview-score" style="color:#ff4500; font-size:14px; font-weight:bold; height:20px;"></div>
      <div id="preview-error" style="color:#f44; font-size:12px; max-width:360px; text-align:center; display:none;"></div>
      <div id="preview-gameover" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.75); flex-direction:column; align-items:center; justify-content:center; gap:12px; animation:fadeIn 0.4s ease-out;">
        <div style="color:#fff; font:bold 24px monospace; text-transform:uppercase; letter-spacing:3px; text-shadow:0 0 20px rgba(255,69,0,0.6);">Game Over</div>
        <div id="preview-go-score" style="color:#ff4500; font:bold 20px monospace;"></div>
        <button id="preview-go-replay" style="background:#ff4500; color:#fff; border:none; border-radius:16px; padding:10px 28px; font:bold 14px system-ui,sans-serif; cursor:pointer;">PLAY AGAIN</button>
        <button id="preview-go-stop" style="background:transparent; color:#888; border:1px solid #444; border-radius:16px; padding:6px 16px; font-size:12px; cursor:pointer;">back to preview</button>
      </div>
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

  // Show loading
  canvas.width = gameWidth;
  canvas.height = gameHeight;
  resizePreviewCanvas();
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, gameWidth, gameHeight);
  ctx.fillStyle = '#666';
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Loading...', gameWidth / 2, gameHeight / 2);

  try {
    await initQuickJS();
    previewSandbox = createSandbox();
    const { metadata, resources } = previewSandbox.loadGame(code);

    if (metadata.width) gameWidth = metadata.width;
    if (metadata.height) gameHeight = metadata.height;
    resizePreviewCanvas();

    if (resources.images) {
      previewImagePool = await loadPreviewImages(resources.images, ctx);
    }
    if (resources.sounds) {
      await preloadSounds(resources.sounds);
    }

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
    function loop(now) {
      if (isGameOver || !previewSandbox) return;

      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      for (const key of ['up', 'down', 'left', 'right', 'a', 'b']) {
        input[key + 'Pressed'] = input[key] && !prevInput[key];
      }
      input.pointerPressed = input.pointerDown && !prevInput.pointerDown;

      const commands = previewSandbox.callUpdate(dt, input);

      Object.assign(prevInput, input);
      input.pointerPressed = false;
      for (const key of ['up', 'down', 'left', 'right', 'a', 'b']) {
        input[key + 'Pressed'] = false;
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
            if (scoreEl) scoreEl.textContent = '';
            const goOverlay = document.getElementById('preview-gameover');
            const goScore = document.getElementById('preview-go-score');
            if (goOverlay) goOverlay.style.display = 'flex';
            if (goScore) goScore.textContent = '\u2605 ' + (cmd.value || 0) + ' \u2605';
          } else if (['tone', 'noise', 'sample', 'stop', 'stopAll', 'volume'].includes(cmd.op)) {
            audioCmds.push(cmd);
          } else {
            drawCmds.push(cmd);
          }
        }
        executeCommands(ctx, drawCmds, previewImagePool);
        processAudioCommands(audioCmds);
      }

      previewAnimFrame = requestAnimationFrame(loop);
    }
    previewAnimFrame = requestAnimationFrame(loop);
  } catch (err) {
    console.error('Preview game error:', err);
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = 'Error: ' + err.message;
    }
  }
}

async function loadPreviewImages(images, ctx) {
  const pool = {};
  for (const [id, res] of Object.entries(images)) {
    try {
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
        pool[id] = await createImageBitmap(offscreen);
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
        pool[id] = await createImageBitmap(offscreen);
      } else if (res.type === 'procedural') {
        const offscreen = new OffscreenCanvas(res.w, res.h);
        const offCtx = offscreen.getContext('2d');
        executeCommands(offCtx, res.draw, {});
        pool[id] = await createImageBitmap(offscreen);
      } else if (res.type === 'generate') {
        const resp = await fetch('/api/image/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: res.prompt, w: res.w || 64, h: res.h || 64 }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const blob = await fetch(`data:image/png;base64,${data.image}`).then(r => r.blob());
          pool[id] = await createImageBitmap(blob);
        }
      }
    } catch (err) {
      console.warn(`Failed to load preview image "${id}":`, err);
    }
  }
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
      <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">Edit Game</h1>
      <p style="color:#888; font-size:13px; text-align:center; max-width:320px;">
        Describe what you want to change
      </p>
      <textarea id="edit-desc" placeholder="e.g. make the enemies faster and add a shield powerup"
        style="width:100%; max-width:360px; height:100px; padding:12px; border-radius:8px; border:1px solid #333; background:#1a1a1a; color:#fff; font-size:14px; resize:none; font-family:system-ui,sans-serif;"
      ></textarea>
      <button id="apply-btn" style="background:#ff4500; color:#fff; border:none; border-radius:20px; padding:12px 32px; font-size:15px; font-weight:bold; cursor:pointer;">
        APPLY
      </button>
      <button id="back-btn" style="background:transparent; color:#888; border:none; font-size:13px; cursor:pointer; text-decoration:underline;">
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
      <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">rerollgame</h1>
      <p style="color:#f44; font-size:14px; text-align:center; max-width:300px;">${escapeHtml(message)}</p>
      <button id="retry-btn" style="background:#ff4500; color:#fff; border:none; border-radius:20px; padding:10px 24px; font-size:15px; font-weight:bold; cursor:pointer;">
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
