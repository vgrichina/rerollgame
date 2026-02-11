// Roof Runner - endless runner across city rooftops
// Demonstrates: images (hex sprites, procedural backgrounds), parallax, score, audio

let state;

function metadata() {
  return {
    title: 'Roof Runner',
    description: 'Sprint across rooftops! Jump the gaps, dodge obstacles, survive the city.',
    controls: ['a/space: jump', 'a/space (in air): double jump'],
    width: 400,
    height: 400,
  };
}

function resources() {
  return {
    images: {
      // Player: 12x16 pixel art runner
      runner: {
        type: 'hex', w: 12, h: 16,
        palette: ['#000', '#ff4444', '#cc2222', '#ffcc88', '#eebb77', '#3344ff', '#2233cc', '#ffffff', '#333333', '#ffaa00'],
        rows: [
          '000008880000',
          '000083380000',
          '000833380000',
          '000033300000',
          '000034300000',
          '000111110000',
          '001111111000',
          '091111111900',
          '091111111900',
          '001111110000',
          '000111100000',
          '000066600000',
          '000660660000',
          '000660066000',
          '000880088000',
          '000880088000',
        ],
      },
      // Crate obstacle: 12x12
      crate: {
        type: 'hex', w: 12, h: 12,
        palette: ['#000', '#aa7744', '#886633', '#665522', '#ccaa66'],
        rows: [
          '222222222222',
          '211111111112',
          '214111114112',
          '211411411112',
          '211141411112',
          '211114111112',
          '211141411112',
          '211411411112',
          '214111114112',
          '211111111112',
          '211111111112',
          '222222222222',
        ],
      },
      // Antenna obstacle: 6x20
      antenna: {
        type: 'hex', w: 6, h: 20,
        palette: ['#000', '#888888', '#aaaaaa', '#ff2200', '#666666'],
        rows: [
          '003300',
          '003300',
          '002200',
          '002200',
          '012210',
          '002200',
          '002200',
          '012210',
          '002200',
          '002200',
          '012210',
          '002200',
          '002200',
          '012210',
          '002200',
          '002200',
          '002200',
          '002200',
          '014410',
          '014410',
        ],
      },
      // City skyline background layer (procedural)
      skyline: {
        type: 'procedural', w: 400, h: 200,
        draw: [
          { op: 'clear', color: 'rgba(0,0,0,0)' },
          // Far buildings
          { op: 'rect', x: 0, y: 100, w: 30, h: 100, fill: '#1a1a2e' },
          { op: 'rect', x: 35, y: 70, w: 25, h: 130, fill: '#16213e' },
          { op: 'rect', x: 65, y: 90, w: 35, h: 110, fill: '#1a1a2e' },
          { op: 'rect', x: 105, y: 60, w: 20, h: 140, fill: '#16213e' },
          { op: 'rect', x: 130, y: 80, w: 40, h: 120, fill: '#1a1a2e' },
          { op: 'rect', x: 175, y: 50, w: 25, h: 150, fill: '#16213e' },
          { op: 'rect', x: 205, y: 95, w: 30, h: 105, fill: '#1a1a2e' },
          { op: 'rect', x: 240, y: 65, w: 35, h: 135, fill: '#16213e' },
          { op: 'rect', x: 280, y: 85, w: 25, h: 115, fill: '#1a1a2e' },
          { op: 'rect', x: 310, y: 55, w: 30, h: 145, fill: '#16213e' },
          { op: 'rect', x: 345, y: 75, w: 25, h: 125, fill: '#1a1a2e' },
          { op: 'rect', x: 375, y: 90, w: 25, h: 110, fill: '#16213e' },
          // Window dots on buildings
          { op: 'rect', x: 7, y: 110, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 17, y: 120, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 42, y: 80, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 48, y: 95, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 75, y: 100, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 85, y: 115, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 110, y: 70, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 140, y: 90, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 155, y: 105, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 182, y: 60, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 188, y: 80, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 215, y: 105, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 250, y: 75, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 260, y: 90, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 290, y: 95, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 320, y: 65, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 330, y: 80, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 355, y: 85, w: 3, h: 3, fill: '#ffee88' },
          { op: 'rect', x: 385, y: 100, w: 3, h: 3, fill: '#ffee88' },
        ],
      },
    },
    sounds: {
      jump: { type: 'generate', wave: 'square', sweep: { from: 260, to: 600 }, dur: 0.15, env: { a: 0.01, d: 0.08, s: 0.2, r: 0.06 } },
      double: { type: 'generate', wave: 'sine', sweep: { from: 400, to: 900 }, dur: 0.12, env: { a: 0.01, d: 0.06, s: 0.1, r: 0.05 } },
      land: { type: 'generate', wave: 'noise', dur: 0.08, env: { a: 0.01, d: 0.05, s: 0, r: 0.02 }, type: 'generate' },
      hit: { type: 'generate', wave: 'noise', dur: 0.3, env: { a: 0.01, d: 0.2, s: 0, r: 0.1 } },
      score10: { type: 'generate', wave: 'sine', notes: ['E5'], dur: 0.1, env: { a: 0.01, d: 0.05, s: 0.2, r: 0.04 } },
    },
  };
}

function update(deltaTime, input) {
  const dt = Math.min(deltaTime, 0.05);

  if (!state) {
    state = {
      // Player
      px: 80, py: 0, vy: 0,
      grounded: false, jumps: 0, maxJumps: 2,
      runFrame: 0, runTimer: 0,
      alive: true,
      // World
      scrollSpeed: 160,
      buildings: [],
      obstacles: [],
      distance: 0,
      score: 0,
      nextBuildingX: 0,
      // Parallax
      skyOffset: 0,
      // Difficulty
      speedGrowth: 2,
      gapMin: 40, gapMax: 70,
      // Particles
      particles: [],
    };
    // Seed initial buildings
    let bx = 0;
    while (bx < 600) {
      const w = 80 + Math.floor(Math.random() * 80);
      const h = 120 + Math.floor(Math.random() * 80);
      state.buildings.push({ x: bx, w: w, h: h });
      bx += w + 30 + Math.floor(Math.random() * 30);
    }
    state.nextBuildingX = bx;
    // Place player on first building
    state.py = 400 - state.buildings[0].h - 32;
  }

  const cmds = [];
  const audio = [];
  const s = state;

  if (!s.alive) {
    cmds.push({ op: 'score', value: s.score });
    cmds.push({ op: 'gameOver' });
    return cmds.concat(audio);
  }

  // --- Scrolling ---
  s.scrollSpeed += s.speedGrowth * dt;
  const scroll = s.scrollSpeed * dt;
  s.distance += scroll;
  s.skyOffset = (s.skyOffset + scroll * 0.3) % 400;

  // Score every ~50px
  const newScore = Math.floor(s.distance / 50) * 10;
  if (newScore > s.score) {
    s.score = newScore;
    if (s.score % 100 === 0) {
      audio.push({ op: 'tone', ch: 3, wave: 'sine', note: 'E5', dur: 0.1, vol: 0.2 });
    }
  }

  // --- Scroll buildings ---
  for (const b of s.buildings) b.x -= scroll;
  for (const o of s.obstacles) o.x -= scroll;

  // Remove off-screen buildings
  s.buildings = s.buildings.filter(b => b.x + b.w > -50);
  s.obstacles = s.obstacles.filter(o => o.x > -30);

  // Spawn new buildings
  while (s.nextBuildingX - s.distance < 600) {
    const w = 70 + Math.floor(Math.random() * 100);
    const h = 100 + Math.floor(Math.random() * 100);
    const gap = s.gapMin + Math.floor(Math.random() * (s.gapMax - s.gapMin));
    const lastB = s.buildings[s.buildings.length - 1];
    const bx = lastB ? lastB.x + lastB.w + gap : s.nextBuildingX;
    s.buildings.push({ x: bx, w: w, h: h });

    // Maybe spawn obstacle on this building
    if (Math.random() < 0.4) {
      const kind = Math.random() < 0.5 ? 'crate' : 'antenna';
      const ox = bx + 20 + Math.floor(Math.random() * (w - 40));
      s.obstacles.push({ x: ox, kind: kind });
    }

    s.nextBuildingX = bx + w + gap;
  }

  // --- Player physics ---
  const GRAVITY = 900;
  const JUMP_VEL = -380;
  const DOUBLE_JUMP_VEL = -340;

  // Check grounded
  s.grounded = false;
  let floorY = 999;
  for (const b of s.buildings) {
    const roofY = 400 - b.h;
    if (s.px + 10 > b.x && s.px - 4 < b.x + b.w) {
      if (s.py + 32 >= roofY - 2 && s.py + 32 <= roofY + 8 && s.vy >= 0) {
        floorY = roofY - 32;
        s.grounded = true;
      }
    }
  }

  if (s.grounded) {
    s.py = floorY;
    s.vy = 0;
    s.jumps = 0;
  } else {
    s.vy += GRAVITY * dt;
    s.py += s.vy * dt;
  }

  // Jump
  if (input.aPressed || input.pointerPressed) {
    if (s.grounded) {
      s.vy = JUMP_VEL;
      s.grounded = false;
      s.jumps = 1;
      audio.push({ op: 'tone', ch: 0, wave: 'square', freq: 260, sweep: 600, dur: 0.15, vol: 0.3 });
      // Jump dust particles
      for (let i = 0; i < 4; i++) {
        s.particles.push({ x: s.px + 6, y: s.py + 32, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 40, life: 0.4 });
      }
    } else if (s.jumps < s.maxJumps) {
      s.vy = DOUBLE_JUMP_VEL;
      s.jumps = s.maxJumps;
      audio.push({ op: 'tone', ch: 0, wave: 'sine', freq: 400, sweep: 900, dur: 0.12, vol: 0.25 });
    }
  }

  // Fell off screen
  if (s.py > 420) {
    s.alive = false;
    audio.push({ op: 'noise', ch: 2, vol: 0.4, dur: 0.3, type: 'white' });
  }

  // Obstacle collision
  for (const o of s.obstacles) {
    let ow, oh;
    if (o.kind === 'crate') { ow = 24; oh = 24; }
    else { ow = 12; oh = 40; }
    // Find building this obstacle is on
    let obstY = 300; // default
    for (const b of s.buildings) {
      if (o.x >= b.x && o.x <= b.x + b.w) {
        obstY = 400 - b.h - oh;
        break;
      }
    }
    if (
      s.px + 10 > o.x && s.px < o.x + ow &&
      s.py + 32 > obstY && s.py < obstY + oh
    ) {
      s.alive = false;
      audio.push({ op: 'noise', ch: 2, vol: 0.5, dur: 0.3, type: 'white' });
    }
  }

  // Run animation
  s.runTimer += dt;
  if (s.runTimer > 0.1) {
    s.runTimer = 0;
    s.runFrame = (s.runFrame + 1) % 4;
  }

  // Update particles
  for (const p of s.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
  }
  s.particles = s.particles.filter(p => p.life > 0);

  // === DRAW ===

  // Sky gradient (dark to lighter blue)
  cmds.push({ op: 'rect', x: 0, y: 0, w: 400, h: 400, fill: '#0a0a1a' });
  cmds.push({ op: 'rect', x: 0, y: 0, w: 400, h: 200, fill: '#0f1028' });
  // Stars
  for (let i = 0; i < 20; i++) {
    const sx = ((i * 97 + 13) % 400);
    const sy = ((i * 53 + 7) % 180);
    const bright = (i % 3 === 0) ? '#ffffff' : '#666688';
    cmds.push({ op: 'rect', x: sx, y: sy, w: 1, h: 1, fill: bright });
  }

  // Parallax city skyline
  const skyX = -Math.floor(s.skyOffset);
  cmds.push({ op: 'img', id: 'skyline', x: skyX, y: 200, w: 400, h: 200 });
  cmds.push({ op: 'img', id: 'skyline', x: skyX + 400, y: 200, w: 400, h: 200 });

  // Buildings (foreground)
  for (const b of s.buildings) {
    const roofY = 400 - b.h;
    // Building body
    cmds.push({ op: 'rect', x: b.x, y: roofY, w: b.w, h: b.h, fill: '#1e2a3a' });
    // Roof edge
    cmds.push({ op: 'rect', x: b.x - 2, y: roofY, w: b.w + 4, h: 4, fill: '#3a4a5a' });
    // Windows
    for (let wy = roofY + 14; wy < 400 - 10; wy += 20) {
      for (let wx = b.x + 8; wx < b.x + b.w - 8; wx += 16) {
        const lit = ((wx * 7 + wy * 13) % 5) > 1;
        cmds.push({ op: 'rect', x: wx, y: wy, w: 8, h: 10, fill: lit ? '#ffdd66' : '#0a1520' });
      }
    }
  }

  // Obstacles
  for (const o of s.obstacles) {
    let oh;
    if (o.kind === 'crate') oh = 24;
    else oh = 40;
    let obstY = 300;
    for (const b of s.buildings) {
      if (o.x >= b.x && o.x <= b.x + b.w) {
        obstY = 400 - b.h - oh;
        break;
      }
    }
    if (o.kind === 'crate') {
      cmds.push({ op: 'img', id: 'crate', x: o.x, y: obstY, w: 24, h: 24 });
    } else {
      cmds.push({ op: 'img', id: 'antenna', x: o.x, y: obstY, w: 12, h: 40 });
    }
  }

  // Particles
  for (const p of s.particles) {
    const alpha = Math.max(0, p.life / 0.4);
    cmds.push({ op: 'rect', x: Math.floor(p.x), y: Math.floor(p.y), w: 2, h: 2, fill: `rgba(255,255,255,${alpha.toFixed(2)})` });
  }

  // Player (with slight bob when running on ground)
  const bob = s.grounded ? Math.sin(s.runFrame * Math.PI / 2) * 2 : 0;
  const flip = false;
  cmds.push({ op: 'img', id: 'runner', x: s.px - 2, y: s.py - bob, w: 24, h: 32 });

  // Double-jump indicator
  if (!s.grounded && s.jumps < s.maxJumps) {
    cmds.push({ op: 'circle', x: s.px + 10, y: s.py + 36, r: 3, fill: '#ffaa00' });
  }

  // HUD
  cmds.push({ op: 'rect', x: 0, y: 0, w: 400, h: 24, fill: 'rgba(0,0,0,0.5)' });
  cmds.push({ op: 'text', x: 10, y: 6, text: 'SCORE: ' + s.score, fill: '#ffffff', font: 'bold 14px monospace' });
  const speedPct = Math.floor((s.scrollSpeed - 160) / 3);
  cmds.push({ op: 'text', x: 300, y: 6, text: 'SPD: ' + Math.floor(s.scrollSpeed), fill: '#88aacc', font: '12px monospace' });

  cmds.push({ op: 'score', value: s.score });

  return cmds.concat(audio);
}
