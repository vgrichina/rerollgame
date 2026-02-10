// Bouncer - a simple bouncing ball game with paddle
// Demonstrates: clear, rect, circle, text, score, audio tone

let state;

function metadata() {
  return {
    title: 'Bouncer',
    description: 'Keep the ball bouncing! Move your paddle to catch it.',
    controls: ['left/right: move paddle', 'a: launch ball'],
    width: 400,
    height: 400,
  };
}

function resources() {
  return {
    images: {},
    sounds: {
      bounce: { type: 'generate', wave: 'square', notes: ['E5'], dur: 0.08, env: { a: 0.01, d: 0.05, s: 0, r: 0.02 } },
      wall: { type: 'generate', wave: 'triangle', notes: ['C4'], dur: 0.06, env: { a: 0.01, d: 0.03, s: 0, r: 0.02 } },
      lose: { type: 'generate', wave: 'sawtooth', sweep: { from: 400, to: 100 }, dur: 0.5, env: { a: 0.01, d: 0.3, s: 0.2, r: 0.2 } },
      score: { type: 'generate', wave: 'sine', notes: ['C5', 'E5', 'G5'], dur: 0.15, env: { a: 0.01, d: 0.05, s: 0.3, r: 0.05 } },
    },
  };
}

function update(dt, input) {
  if (!state) {
    state = {
      paddleX: 175,
      paddleW: 80,
      paddleH: 12,
      ballX: 200,
      ballY: 350,
      ballR: 8,
      ballVX: 0,
      ballVY: 0,
      launched: false,
      score: 0,
      lives: 3,
      bricks: [],
      combo: 0,
    };
    // Create bricks
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 8; col++) {
        state.bricks.push({
          x: 10 + col * 48,
          y: 40 + row * 22,
          w: 44,
          h: 18,
          alive: true,
          color: ['#f44', '#f84', '#ff4', '#4f4', '#48f'][row],
        });
      }
    }
  }

  const cmds = [];
  const audio = [];

  // Background
  cmds.push({ op: 'clear', color: '#111' });

  // Move paddle
  const speed = 350;
  if (input.left) state.paddleX -= speed * dt;
  if (input.right) state.paddleX += speed * dt;
  state.paddleX = Math.max(0, Math.min(400 - state.paddleW, state.paddleX));

  // Launch ball
  if (!state.launched && (input.aPressed || input.pointerPressed)) {
    state.launched = true;
    state.ballVX = 180;
    state.ballVY = -300;
  }

  if (!state.launched) {
    state.ballX = state.paddleX + state.paddleW / 2;
    state.ballY = 380 - state.paddleH - state.ballR;
  } else {
    // Move ball
    state.ballX += state.ballVX * dt;
    state.ballY += state.ballVY * dt;

    // Wall bounce
    if (state.ballX - state.ballR < 0) {
      state.ballX = state.ballR;
      state.ballVX = Math.abs(state.ballVX);
      audio.push({ op: 'tone', ch: 1, wave: 'triangle', note: 'C4', dur: 0.06, vol: 0.3 });
    }
    if (state.ballX + state.ballR > 400) {
      state.ballX = 400 - state.ballR;
      state.ballVX = -Math.abs(state.ballVX);
      audio.push({ op: 'tone', ch: 1, wave: 'triangle', note: 'C4', dur: 0.06, vol: 0.3 });
    }
    if (state.ballY - state.ballR < 0) {
      state.ballY = state.ballR;
      state.ballVY = Math.abs(state.ballVY);
      audio.push({ op: 'tone', ch: 1, wave: 'triangle', note: 'D4', dur: 0.06, vol: 0.3 });
    }

    // Paddle bounce
    if (
      state.ballY + state.ballR >= 380 - state.paddleH &&
      state.ballY + state.ballR <= 385 &&
      state.ballX >= state.paddleX - state.ballR &&
      state.ballX <= state.paddleX + state.paddleW + state.ballR &&
      state.ballVY > 0
    ) {
      state.ballVY = -Math.abs(state.ballVY);
      const hitPos = (state.ballX - state.paddleX) / state.paddleW - 0.5;
      state.ballVX = hitPos * 400;
      state.combo = 0;
      audio.push({ op: 'tone', ch: 0, wave: 'square', note: 'E5', dur: 0.08, vol: 0.4 });
    }

    // Brick collision
    for (const brick of state.bricks) {
      if (!brick.alive) continue;
      if (
        state.ballX + state.ballR > brick.x &&
        state.ballX - state.ballR < brick.x + brick.w &&
        state.ballY + state.ballR > brick.y &&
        state.ballY - state.ballR < brick.y + brick.h
      ) {
        brick.alive = false;
        state.ballVY = -state.ballVY;
        state.combo++;
        state.score += 10 * state.combo;
        audio.push({ op: 'tone', ch: 2, wave: 'sine', note: 'C5', dur: 0.1, vol: 0.3 });
      }
    }

    // Ball lost
    if (state.ballY > 420) {
      state.lives--;
      state.launched = false;
      state.ballVX = 0;
      state.ballVY = 0;
      state.combo = 0;
      if (state.lives <= 0) {
        cmds.push({ op: 'score', value: state.score });
        cmds.push({ op: 'gameOver' });
        audio.push({ op: 'tone', ch: 3, wave: 'sawtooth', freq: 400, sweep: 100, dur: 0.5, vol: 0.4 });
        return cmds.concat(audio);
      }
      audio.push({ op: 'tone', ch: 3, wave: 'sawtooth', freq: 300, sweep: 150, dur: 0.3, vol: 0.3 });
    }

    // Win check
    if (state.bricks.every((b) => !b.alive)) {
      state.score += 500;
      cmds.push({ op: 'score', value: state.score });
      cmds.push({ op: 'gameOver' });
      return cmds.concat(audio);
    }
  }

  // Draw bricks
  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    cmds.push({ op: 'rect', x: brick.x, y: brick.y, w: brick.w, h: brick.h, fill: brick.color });
    cmds.push({ op: 'rect', x: brick.x, y: brick.y, w: brick.w, h: brick.h, stroke: '#fff', lineWidth: 1 });
  }

  // Draw paddle
  cmds.push({ op: 'rect', x: state.paddleX, y: 380 - state.paddleH, w: state.paddleW, h: state.paddleH, fill: '#fff' });

  // Draw ball
  cmds.push({ op: 'circle', x: state.ballX, y: state.ballY, r: state.ballR, fill: '#ff0' });

  // Draw HUD
  cmds.push({ op: 'text', x: 10, y: 10, text: 'SCORE: ' + state.score, fill: '#fff', font: 'bold 16px monospace' });
  cmds.push({ op: 'text', x: 310, y: 10, text: 'LIVES: ' + state.lives, fill: '#f88', font: 'bold 16px monospace' });

  if (!state.launched) {
    cmds.push({
      op: 'text',
      x: 200,
      y: 300,
      text: 'Press A to launch!',
      fill: '#888',
      font: '14px monospace',
      align: 'center',
    });
  }

  cmds.push({ op: 'score', value: state.score });

  return cmds.concat(audio);
}
