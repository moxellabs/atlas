/** JavaScript port of the moxel.ai banded-field canvas background. */
export const moxelBandedFieldScript = `
(() => {
  const canvas = document.getElementById("banded-field");
  const pointer = { x: 0.5, y: 0.5, active: false };
  const pulses = [];
  let frameHandle = null;
  let stageWidth = 0;
  let stageHeight = 0;
  let deviceRatio = Math.min(window.devicePixelRatio || 1, 1.8);
  let lastTime = performance.now();
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  function wrap01(value) {
    return ((value % 1) + 1) % 1;
  }

  function seedPulses() {
    pulses.length = 0;
    for (let idx = 0; idx < 42; idx += 1) {
      pulses.push({
        position: Math.random(),
        offset: Math.random(),
        intensity: 0.45 + Math.random() * 0.55,
        speed: 0.00004 + Math.random() * 0.00008
      });
    }
  }

  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (ctx === null) return;

  function resize() {
    deviceRatio = Math.min(window.devicePixelRatio || 1, 1.8);
    stageWidth = window.innerWidth;
    stageHeight = window.innerHeight;
    canvas.width = Math.round(stageWidth * deviceRatio);
    canvas.height = Math.round(stageHeight * deviceRatio);
    canvas.style.width = stageWidth + "px";
    canvas.style.height = stageHeight + "px";
    ctx.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
  }

  function drawFrame(time, staticFrame = false) {
    const dt = Math.max(16, time - lastTime);
    lastTime = time;

    ctx.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
    const gradient = ctx.createLinearGradient(0, 0, stageWidth, stageHeight);
    gradient.addColorStop(0, "#030711");
    gradient.addColorStop(1, "#081224");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, stageWidth, stageHeight);

    const columns = 28;
    const rows = 18;
    const cellW = stageWidth / columns;
    const cellH = stageHeight / rows;
    const slope = 0.72 + Math.sin(time * 0.00028) * 0.12;
    const shift = Math.sin(time * 0.00021) * 0.22;
    const pulsePhase = Math.sin(time * 0.0006) * 0.15;

    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.65;
    for (let c = 0; c <= columns; c += 1) {
      const x = c * cellW;
      const alpha = 0.08 + 0.12 * Math.sin(time * 0.0004 + c * 0.45);
      ctx.strokeStyle = "rgba(52, 132, 208, " + alpha + ")";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, stageHeight);
      ctx.stroke();
    }

    for (let r = 0; r <= rows; r += 1) {
      const y = r * cellH;
      const alpha = 0.05 + 0.14 * Math.cos(time * 0.00033 + r * 0.4);
      ctx.strokeStyle = "rgba(36, 92, 164, " + alpha + ")";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(stageWidth, y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    for (let c = 0; c < columns; c += 1) {
      const u = (c + 0.5) / columns;
      for (let r = 0; r < rows; r += 1) {
        const v = (r + 0.5) / rows;
        const diag = v - (u * slope + shift + 0.25);
        const normalized = diag - Math.round(diag);
        const wave = 0.45 + 0.55 * Math.sin(time * 0.0011 + u * 14 + v * 12);
        const gaussian = Math.exp(-(normalized * normalized) / 0.0085);
        const pointerInfluence = pointer.active ? Math.max(0, 0.20 - Math.hypot(u - pointer.x, v - pointer.y)) * 1.6 : 0;
        const value = Math.min(1, wave * gaussian + pointerInfluence + pulsePhase * 0.4);

        if (value > 0.08) {
          ctx.fillStyle = "rgba(53, 240, 255, " + (0.06 + value * 0.22) + ")";
          ctx.fillRect(c * cellW, r * cellH, cellW + 1, cellH + 1);
        }
      }
    }

    if (!staticFrame) {
      ctx.globalCompositeOperation = "lighter";
      for (const pulse of pulses) {
        pulse.position = wrap01(pulse.position + pulse.speed * dt);
        const u = pulse.position;
        const v = wrap01(u * slope + shift + pulse.offset * 0.6 + 0.25);
        const x = u * stageWidth;
        const y = v * stageHeight;
        const radius = 1.6 + pulse.intensity * 3.6;
        ctx.fillStyle = "rgba(109, 242, 214, " + (0.18 + pulse.intensity * 0.35) + ")";
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(53, 240, 255, " + (0.12 + pulse.intensity * 0.22) + ")";
        ctx.lineWidth = 0.6 + pulse.intensity * 0.6;
        ctx.beginPath();
        ctx.moveTo(x - cellW * 0.4, y - cellH * 0.12);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function loop(time) {
    drawFrame(time);
    frameHandle = requestAnimationFrame(loop);
  }

  function startAnimation() {
    cancelAnimationFrame(frameHandle ?? 0);
    frameHandle = null;
    if (reduceMotionQuery.matches) {
      drawFrame(performance.now(), true);
    } else {
      seedPulses();
      lastTime = performance.now();
      frameHandle = requestAnimationFrame(loop);
    }
  }

  resize();
  startAnimation();
  window.addEventListener("resize", () => {
    resize();
    startAnimation();
  });
  reduceMotionQuery.addEventListener("change", startAnimation);
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX / window.innerWidth;
    pointer.y = event.clientY / window.innerHeight;
    pointer.active = true;
  });
  window.addEventListener("pointerleave", () => {
    pointer.active = false;
  });
})();
`;

