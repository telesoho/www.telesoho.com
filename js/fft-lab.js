const N = 256;
const FS = 256;

const canvas = document.getElementById("fft-canvas");
const f2Input = document.getElementById("fft-f2");
const f3Input = document.getElementById("fft-f3");
const f2Out = document.getElementById("fft-f2-out");
const f3Out = document.getElementById("fft-f3-out");
const formula = document.getElementById("fft-formula");
const peaks = document.getElementById("fft-peaks");
const resetBtn = document.getElementById("fft-reset");

function sampleSignal(f2, f3) {
  const s = new Float64Array(N);
  const p2 = (-30 * Math.PI) / 180;
  const p3 = (90 * Math.PI) / 180;
  for (let n = 0; n < N; n++) {
    const t = n / FS;
    s[n] =
      2 +
      3 * Math.cos(2 * Math.PI * f2 * t + p2) +
      1.5 * Math.cos(2 * Math.PI * f3 * t + p3);
  }
  return s;
}

/** Real DFT magnitude for k = 0..N/2 (normalized by N). */
function dftMagnitude(s) {
  const half = N / 2;
  const mag = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const ang = (-2 * Math.PI * k * n) / N;
      re += s[n] * Math.cos(ang);
      im += s[n] * Math.sin(ang);
    }
    mag[k] = Math.hypot(re, im) / N;
  }
  return mag;
}

function draw(f2, f3) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 960;
  const cssH = 320;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const s = sampleSignal(f2, f3);
  const mag = dftMagnitude(s);

  const pad = 16;
  const midY = cssH * 0.28;
  const waveH = cssH * 0.18;
  const specTop = cssH * 0.52;
  const specH = cssH * 0.38;

  // Time domain
  ctx.strokeStyle = "rgba(232, 238, 240, 0.2)";
  ctx.beginPath();
  ctx.moveTo(pad, midY);
  ctx.lineTo(cssW - pad, midY);
  ctx.stroke();

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < N; i++) {
    min = Math.min(min, s[i]);
    max = Math.max(max, s[i]);
  }
  const span = max - min || 1;

  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const x = pad + (i / (N - 1)) * (cssW - pad * 2);
    const y = midY - ((s[i] - min) / span - 0.5) * 2 * waveH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(196, 165, 116, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "rgba(232, 238, 240, 0.55)";
  ctx.font = "12px IBM Plex Mono, monospace";
  ctx.fillText("时域 s[n]", pad, 18);

  // Spectrum
  let maxMag = 0;
  for (let k = 0; k < mag.length; k++) maxMag = Math.max(maxMag, mag[k]);
  maxMag = maxMag || 1;

  const barW = (cssW - pad * 2) / mag.length;
  for (let k = 0; k < mag.length; k++) {
    const h = (mag[k] / maxMag) * (specH - 8);
    const x = pad + k * barW;
    const y = specTop + specH - h;
    const isPeak = k === 0 || k === Math.round(f2) || k === Math.round(f3);
    ctx.fillStyle = isPeak ? "rgba(196, 165, 116, 0.95)" : "rgba(61, 138, 158, 0.55)";
    ctx.fillRect(x, y, Math.max(barW * 0.85, 1), h);
  }

  ctx.fillStyle = "rgba(232, 238, 240, 0.55)";
  ctx.fillText("|X[k]| / N", pad, specTop - 8);
  ctx.fillText("0 Hz", pad, cssH - 6);
  ctx.fillText(`${FS / 2} Hz`, cssW - pad - 40, cssH - 6);
}

function sync() {
  const f2 = Number(f2Input?.value ?? 50);
  const f3 = Number(f3Input?.value ?? 75);
  if (f2Out) f2Out.textContent = String(f2);
  if (f3Out) f3Out.textContent = String(f3);
  if (formula) {
    formula.textContent = `S(t) = 2 + 3 cos(2π·${f2}t − 30°) + 1.5 cos(2π·${f3}t + 90°)`;
  }
  if (peaks) {
    peaks.textContent = `0 · ${f2} · ${f3}（频点 1 / ${f2 + 1} / ${f3 + 1}）`;
  }
  draw(f2, f3);
}

f2Input?.addEventListener("input", sync);
f3Input?.addEventListener("input", sync);
resetBtn?.addEventListener("click", () => {
  if (f2Input) f2Input.value = "50";
  if (f3Input) f3Input.value = "75";
  sync();
});

window.addEventListener("resize", sync);

const modeObserver = new MutationObserver(() => {
  if (document.body.dataset.mode === "engineering") sync();
});
modeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-mode"] });

sync();
