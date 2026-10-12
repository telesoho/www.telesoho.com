const MODE_ENG = "engineering";
const MODE_VISITOR = "visitor";

const body = document.body;
const toggle = document.getElementById("mode-toggle");
const backBtn = document.getElementById("back-to-visitor");
const yearEl = document.getElementById("year");
const shoreline = document.getElementById("shoreline");

if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

const ENG_HASHES = new Set([
  "#engineering",
  "#eng-intro",
  "#eng-fft",
  "#eng-reorder",
  "#eng-open",
  "#eng-about",
]);

function modeFromHash() {
  return ENG_HASHES.has(location.hash) ? MODE_ENG : MODE_VISITOR;
}

function syncNav(isEng) {
  const projects = document.querySelector('[data-nav="projects"]');
  const about = document.querySelector('[data-nav="about"]');
  if (projects) projects.setAttribute("href", isEng ? "#eng-fft" : "#projects");
  if (about) about.setAttribute("href", isEng ? "#eng-about" : "#about");
}

function applyMode(mode, { updateHash = true } = {}) {
  body.dataset.mode = mode;
  const isEng = mode === MODE_ENG;
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(isEng));
    toggle.title = isEng ? "回到访客模式" : "切换工程模式";
  }
  syncNav(isEng);
  if (updateHash) {
    if (isEng) {
      if (!ENG_HASHES.has(location.hash)) {
        history.replaceState(null, "", `#${MODE_ENG}`);
      }
    } else if (ENG_HASHES.has(location.hash)) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }
  drawShoreline();
}

function toggleMode() {
  const next = body.dataset.mode === MODE_ENG ? MODE_VISITOR : MODE_ENG;
  applyMode(next);
}

toggle?.addEventListener("click", toggleMode);
backBtn?.addEventListener("click", () => applyMode(MODE_VISITOR));

window.addEventListener("hashchange", () => {
  const fromHash = modeFromHash();
  // Enter engineering via eng anchors; leave only when hash is no longer an eng section
  // and the user is not mid-navigation within engineering (handled by toggle clearing hash).
  if (fromHash === MODE_ENG) {
    applyMode(MODE_ENG, { updateHash: false });
  } else if (body.dataset.mode === MODE_ENG && !ENG_HASHES.has(location.hash)) {
    applyMode(MODE_VISITOR, { updateHash: false });
  }
});

applyMode(modeFromHash(), { updateHash: false });

/** Signature: lake shore in visitor mode, sampled waveform in engineering mode. */
function drawShoreline() {
  if (!shoreline) return;
  const ctx = shoreline.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = shoreline.clientWidth || 1200;
  const cssH = shoreline.clientHeight || 120;
  shoreline.width = Math.floor(cssW * dpr);
  shoreline.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const eng = body.dataset.mode === MODE_ENG;
  const ink = eng ? "rgba(196, 165, 116, 0.95)" : "rgba(30, 77, 92, 0.85)";
  const mist = eng ? "rgba(61, 138, 158, 0.25)" : "rgba(30, 77, 92, 0.18)";

  ctx.beginPath();
  ctx.moveTo(0, cssH * 0.72);
  for (let x = 0; x <= cssW; x += 2) {
    const t = x / cssW;
    const y = eng
      ? cssH * 0.5 +
        Math.sin(t * Math.PI * 8) * cssH * 0.12 +
        Math.sin(t * Math.PI * 18 + 0.4) * cssH * 0.05 +
        Math.cos(t * Math.PI * 3) * cssH * 0.04
      : cssH * (0.55 + Math.sin(t * Math.PI) * 0.08 + Math.sin(t * Math.PI * 2.2) * 0.03);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(cssW, cssH);
  ctx.lineTo(0, cssH);
  ctx.closePath();
  ctx.fillStyle = mist;
  ctx.fill();

  ctx.beginPath();
  for (let x = 0; x <= cssW; x += 1) {
    const t = x / cssW;
    const y = eng
      ? cssH * 0.5 +
        Math.sin(t * Math.PI * 8) * cssH * 0.12 +
        Math.sin(t * Math.PI * 18 + 0.4) * cssH * 0.05 +
        Math.cos(t * Math.PI * 3) * cssH * 0.04
      : cssH * (0.55 + Math.sin(t * Math.PI) * 0.08 + Math.sin(t * Math.PI * 2.2) * 0.03);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = eng ? 1.5 : 2;
  ctx.stroke();

  if (eng) {
    const marks = [0, 50 / 128, 75 / 128];
    ctx.fillStyle = "rgba(196, 165, 116, 0.9)";
    marks.forEach((m) => {
      const x = m * cssW;
      ctx.fillRect(x, cssH * 0.18, 1, cssH * 0.64);
    });
  }
}

window.addEventListener("resize", drawShoreline);
drawShoreline();

export { applyMode, MODE_ENG, MODE_VISITOR };
