(function () {
  const editor = window.yueScoreEditor;
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const queryEl = document.getElementById("query");
  const paper = document.getElementById("paper");
  const titleEl = document.getElementById("piece-title");
  const keyEl = document.getElementById("key");
  const capoEl = document.getElementById("capo");
  const clockEl = document.getElementById("clock");
  const playBtn = document.getElementById("play");
  const stopBtn = document.getElementById("stop");

  editor.setStrings({
    jpLeadKey: "选调",
    jpCapoAt: "变调夹 {n}品",
    jpOriginalKey: "原调",
  });

  let catalog = [];
  let current = null;
  let abc = "";
  let chosen = "";
  let ctx = null;
  let playing = false;
  let timer = 0;
  const voices = [];

  function label(name) {
    return String(name || "").endsWith("m") ? "6=" + name.slice(0, -1) : "1=" + name;
  }

  function clock(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
  }

  function silence() {
    playing = false;
    if (timer) clearInterval(timer);
    timer = 0;
    for (const node of voices.splice(0)) {
      try { if (node.stop) node.stop(); } catch (err) { /* already stopped */ }
    }
  }

  function render() {
    if (!abc) {
      paper.textContent = "";
      return;
    }
    const info = editor.inspectScore(abc);
    if (info.error) {
      paper.textContent = info.error;
      return;
    }
    const names = editor.chordKeyNames(info.keyName);
    const selected = names.indexOf(chosen) >= 0 ? chosen : info.keyName;
    chosen = selected;
    if (keyEl.dataset.keys !== names.join(",")) {
      keyEl.dataset.keys = names.join(",");
      keyEl.innerHTML = names.map((name) => '<option value="' + name + '">' + label(name) + "</option>").join("");
    }
    keyEl.value = selected;
    capoEl.textContent = editor.keyLegend(info.keyName, selected);
    const view = editor.chordsInKey(abc, selected === info.keyName ? "" : selected);
    const src = editor.jianpuAbcWithDirective(editor.withKeyLegend(view, capoEl.textContent));
    paper.innerHTML = "";
    if (typeof abc2svg === "undefined" || !abc2svg.Abc || !abc2svg.jianpu) {
      paper.textContent = "简谱模块没有载入。";
      return;
    }
    try {
      const renderer = new abc2svg.Abc({
        img_out: (svg) => paper.insertAdjacentHTML("beforeend", svg),
        errmsg: () => {},
        get_abcmodel: () => {},
      });
      renderer.tosvg("jianpu", src);
    } catch (error) {
      paper.textContent = String(error);
    }
  }

  async function openPiece(entry) {
    silence();
    clockEl.textContent = "0:00";
    current = entry;
    titleEl.textContent = entry.title;
    history.replaceState(null, "", "#" + encodeURIComponent(entry.id));
    drawList();
    const response = await fetch("../scores/" + encodeURIComponent(entry.id) + ".abc");
    if (!response.ok) {
      paper.textContent = "打不开这首简谱。";
      abc = "";
      return;
    }
    abc = await response.text();
    const info = editor.inspectScore(abc);
    chosen = info.keyName || entry.key || "C";
    render();
  }

  function drawList() {
    const query = queryEl.value.trim().toLowerCase();
    const shown = catalog.filter((entry) => !query || String(entry.title || "").toLowerCase().includes(query));
    emptyEl.hidden = shown.length > 0;
    listEl.innerHTML = "";
    for (const entry of shown) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.title || entry.id;
      if (current && current.id === entry.id) button.setAttribute("aria-current", "true");
      const key = document.createElement("span");
      key.className = "library__key";
      key.textContent = label(entry.key || "C");
      button.appendChild(key);
      button.addEventListener("click", () => { void openPiece(entry); });
      item.appendChild(button);
      listEl.appendChild(item);
    }
  }

  async function play() {
    if (!abc) return;
    silence();
    const score = editor.timeline(abc);
    if (score.error || !score.notes.length) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = ctx || new AudioCtx();
    if (ctx.state === "suspended") await ctx.resume();
    if (window.yuePiano.prepare) void window.yuePiano.prepare(ctx);
    const total = score.notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
    const queue = editor.soundingNotes(score.notes, 0);
    const started = ctx.currentTime + 0.05;
    playing = true;
    const pump = () => {
      if (!playing) return;
      const now = Math.max(0, ctx.currentTime - started);
      for (const item of editor.pumpMidi(queue, now)) {
        window.yuePiano.schedule(
          ctx,
          { midi: item.note.midi, volume: item.note.volume || 0.16, velocity: item.note.velocity },
          started + item.delay,
          Math.max(0.06, item.duration),
          voices,
        );
      }
      clockEl.textContent = clock(now);
      if (now >= total) silence();
    };
    timer = setInterval(pump, 100);
    pump();
  }

  keyEl.addEventListener("change", () => {
    chosen = keyEl.value;
    render();
  });
  playBtn.addEventListener("click", () => { void play(); });
  stopBtn.addEventListener("click", () => {
    silence();
    clockEl.textContent = "0:00";
  });
  queryEl.addEventListener("input", drawList);

  fetch("../scores/index.json")
    .then((response) => response.json())
    .then((entries) => {
      catalog = Array.isArray(entries) ? entries : [];
      drawList();
      const id = decodeURIComponent(location.hash.replace(/^#/, ""));
      const found = catalog.find((entry) => entry.id === id) || catalog[0];
      if (found) void openPiece(found);
    })
    .catch(() => {
      emptyEl.hidden = false;
      emptyEl.textContent = "简谱库没有载入。";
    });
})();
