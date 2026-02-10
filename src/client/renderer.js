// Canvas command executor
// Takes an array of draw commands and executes them on a Canvas2D context

export function executeCommands(ctx, commands, imagePool) {
  for (const c of commands) {
    switch (c.op) {
      case 'clear':
        ctx.fillStyle = c.color || '#000';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        break;

      case 'rect':
        if (c.fill) {
          ctx.fillStyle = c.fill;
          ctx.fillRect(c.x, c.y, c.w, c.h);
        }
        if (c.stroke) {
          ctx.strokeStyle = c.stroke;
          ctx.lineWidth = c.lineWidth || 1;
          ctx.strokeRect(c.x, c.y, c.w, c.h);
        }
        break;

      case 'circle':
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
        if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = c.lineWidth || 1; ctx.stroke(); }
        break;

      case 'line':
        ctx.beginPath();
        ctx.moveTo(c.x1, c.y1);
        ctx.lineTo(c.x2, c.y2);
        ctx.strokeStyle = c.color || '#fff';
        ctx.lineWidth = c.lineWidth || 1;
        ctx.stroke();
        break;

      case 'poly': {
        if (!c.points || c.points.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(c.points[0][0], c.points[0][1]);
        for (let i = 1; i < c.points.length; i++) {
          ctx.lineTo(c.points[i][0], c.points[i][1]);
        }
        if (c.close !== false) ctx.closePath();
        if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
        if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = c.lineWidth || 1; ctx.stroke(); }
        break;
      }

      case 'arc':
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, c.start || 0, c.end || Math.PI * 2);
        if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
        if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = c.lineWidth || 1; ctx.stroke(); }
        break;

      case 'text':
        ctx.font = c.font || '16px monospace';
        ctx.textAlign = c.align || 'left';
        ctx.textBaseline = c.baseline || 'top';
        if (c.fill) { ctx.fillStyle = c.fill; ctx.fillText(c.text, c.x, c.y); }
        if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.strokeText(c.text, c.x, c.y); }
        if (!c.fill && !c.stroke) { ctx.fillStyle = '#fff'; ctx.fillText(c.text, c.x, c.y); }
        break;

      case 'img': {
        const img = imagePool[c.id];
        if (!img) break;
        const needsTransform = c.rotate || c.alpha != null;
        if (needsTransform) ctx.save();
        if (c.alpha != null) ctx.globalAlpha = c.alpha;
        if (c.rotate) {
          const cx = c.x + (c.w || img.width) / 2;
          const cy = c.y + (c.h || img.height) / 2;
          ctx.translate(cx, cy);
          ctx.rotate(c.rotate);
          ctx.translate(-cx, -cy);
        }
        if (c.sx != null) {
          // Sub-rectangle source
          ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, c.x, c.y, c.w || c.sw, c.h || c.sh);
        } else {
          ctx.drawImage(img, c.x, c.y, c.w || img.width, c.h || img.height);
        }
        if (needsTransform) ctx.restore();
        break;
      }

      case 'path': {
        if (!c.d || !c.d.length) break;
        ctx.beginPath();
        for (const step of c.d) {
          switch (step[0]) {
            case 'moveTo': ctx.moveTo(step[1], step[2]); break;
            case 'lineTo': ctx.lineTo(step[1], step[2]); break;
            case 'bezierTo': ctx.bezierCurveTo(step[1], step[2], step[3], step[4], step[5], step[6]); break;
            case 'quadTo': ctx.quadraticCurveTo(step[1], step[2], step[3], step[4]); break;
            case 'close': ctx.closePath(); break;
          }
        }
        if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
        if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = c.lineWidth || 1; ctx.stroke(); }
        break;
      }

      // Transform commands
      case 'save': ctx.save(); break;
      case 'restore': ctx.restore(); break;
      case 'translate': ctx.translate(c.x, c.y); break;
      case 'rotate': ctx.rotate(c.angle); break;
      case 'scale': ctx.scale(c.x, c.y); break;
      case 'alpha': ctx.globalAlpha = c.value; break;
      case 'clip':
        ctx.beginPath();
        ctx.rect(c.x, c.y, c.w, c.h);
        ctx.clip();
        break;
    }
  }
}
