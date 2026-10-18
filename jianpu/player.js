(function () {
  const editor = window.yueScoreEditor;
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const queryEl = document.getElementById("query");
  const paper = document.getElementById("paper");
  const titleEl = document.getElementById("piece-title");
  const keyEl = document.getElementById("key");
  const clockEl = document.getElementById("clock");
  const seekEl = document.getElementById("seek");
  const libraryEl = document.querySelector(".library");
  const libraryBtn = document.getElementById("library-toggle");
  const playBtn = document.getElementById("play");
  const stopBtn = document.getElementById("stop");
  const jianpuBtn = document.getElementById("view-jianpu");
  const staffBtn = document.getElementById("view-staff");
  const diagramBtn = document.getElementById("diagram-toggle");

  editor.setStrings({
    jpLeadKey: "选调",
    jpCapoAt: "变调夹 {n}品",
    jpOriginalKey: "原调",
  });

  let catalog = [];
  let current = null;
  let abc = "";
  let chosen = "";
  let notation = "jianpu";
  let diagramOn = true;
  let ctx = null;
  let playing = false;
  let arming = false;
  let scrubbing = false;
  let resumeAfterScrub = false;
  let generation = 0;
  let timer = 0;
  let startedAt = 0;
  let playFrom = 0;
  let offset = 0;
  let total = 0;
  let marks = [];
  let playKey = "";
  let renderer = null;
  const voices = [];

  function label(name) {
    return String(name || "").endsWith("m") ? "6=" + name.slice(0, -1) : "1=" + name;
  }

  function clock(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
  }

  function clampTime(seconds) {
    const at = Number(seconds);
    if (!Number.isFinite(at)) return 0;
    return Math.max(0, Math.min(total || 0, at));
  }

  function refreshTiming() {
    const score = editor.timeline(abc);
    marks = score.error ? [] : editor.playMarks(abc);
    const noteEnd = (score.notes || []).reduce((max, note) => Math.max(max, note.start + note.duration), 0);
    const markEnd = marks.reduce((max, mark) => Math.max(max, mark.start), 0);
    total = Math.max(noteEnd, markEnd);
    return score;
  }

  function nowPlaying() {
    if (!playing || !ctx) return offset;
    return Math.min(total, playFrom + Math.max(0, ctx.currentTime - startedAt));
  }

  function stopVoices() {
    for (const node of voices.splice(0)) {
      try { if (node.stop) node.stop(); } catch (err) { /* already stopped */ }
    }
  }

  function haltAudio() {
    playing = false;
    arming = false;
    generation += 1;
    if (timer) cancelAnimationFrame(timer);
    timer = 0;
    stopVoices();
  }

  function clearMotion() {
    paper.querySelectorAll(".is-on").forEach((el) => el.classList.remove("is-on"));
  }

  function clearPlayhead() {
    clearMotion();
    playKey = "";
  }

  function glowNote(el) {
    if (!el) return;
    el.classList.add("is-on");
    if (el.dataset.lyric === "1" || el.dataset.adorn === "1") return;
    const voice = el.dataset.voice || "";
    const idx = el.dataset.idx || "";
    const slice = el.dataset.slice || "0";
    paper.querySelectorAll('[data-adorn="1"]').forEach((adorn) => {
      if ((adorn.dataset.voice || "") !== voice) return;
      if ((adorn.dataset.idx || "") !== idx) return;
      if ((adorn.dataset.slice || "0") !== slice) return;
      adorn.classList.add("is-on");
    });
  }

  function follow(node) {
    if (!node || !node.getBoundingClientRect) return;
    const box = node.getBoundingClientRect();
    const frame = paper.getBoundingClientRect();
    const margin = 48;
    if (box.bottom > frame.bottom - margin) paper.scrollTop += box.top - (frame.top + margin);
    else if (box.top < frame.top + 8) paper.scrollTop -= frame.top + 8 - box.top;
    if (box.right > frame.right - 16) paper.scrollLeft += box.right - (frame.right - 16);
    else if (box.left < frame.left + 8) paper.scrollLeft -= frame.left + 8 - box.left;
  }

  function findHit(voice, index, slice, lyric) {
    for (const el of paper.querySelectorAll("[data-start]")) {
      if (el.dataset.adorn === "1") continue;
      if ((el.dataset.lyric === "1") !== lyric) continue;
      if ((el.dataset.voice || "") !== voice) continue;
      if (Number(el.dataset.idx) !== index) continue;
      if (Number(el.dataset.slice || 0) !== slice) continue;
      return el;
    }
    return null;
  }

  function nodeFor(mark) {
    if (!mark) return null;
    return findHit(mark.voice, mark.index, mark.slice, false)
      || (notation === "staff" ? findHit(mark.voice, mark.index, 0, false) : null);
  }

  function lyricFor(mark) {
    if (!mark || mark.voice !== "Vocal") return null;
    return findHit("Vocal", mark.index, 0, true);
  }

  function marksOf(voice) {
    return marks.filter((mark) => mark.voice === voice);
  }

  function markKey(mark) {
    return mark ? mark.voice + ":" + mark.index + ":" + mark.slice : "";
  }

  function paint(seconds) {
    const shown = clampTime(seconds);
    clockEl.textContent = clock(shown) + " / " + clock(total);
    seekEl.max = String(total || 0);
    if (!scrubbing) seekEl.value = String(shown);
    seekEl.setAttribute("aria-valuetext", clock(shown));
    const vocalMark = editor.cursorAt(marksOf("Vocal"), shown);
    const insMark = editor.cursorAt(marksOf("Ins"), shown);
    const key = markKey(vocalMark) + "|" + markKey(insMark);
    if (key === playKey) return;
    playKey = key;
    clearMotion();
    glowNote(nodeFor(vocalMark));
    glowNote(lyricFor(vocalMark));
    glowNote(nodeFor(insMark));
    const followMark = editor.followMark(marks, shown) || vocalMark || insMark;
    const node = nodeFor(followMark);
    if (node) follow(node);
  }

  function fitDiagramSvg(svg) {
    return String(svg || "").replace(/<svg\b[\s\S]*?<\/svg>/g, (doc) => {
      if (doc.indexOf('class="diag"') < 0) return doc;
      const re = /<g(?: class="diag")? transform="translate\(([-\d.]+),([-\d.]+)\)"|<\/g>/g;
      let match;
      let ty = 0;
      const stack = [];
      const tops = [];
      while ((match = re.exec(doc))) {
        if (match[0] === "</g>") {
          ty = stack.length ? stack.pop() : 0;
          continue;
        }
        stack.push(ty);
        ty += Number(match[2]);
        if (match[0].indexOf("diag") >= 0) tops.push(ty - 34);
      }
      if (!tops.length) return doc;
      const minTop = Math.min.apply(null, tops);
      const pad = 6;
      if (minTop >= pad) return doc;
      const dy = pad - minTop;
      if (!/viewBox="0 0 [\d.]+ [\d.]+"/.test(doc) || !/height="[\d.]+px"/.test(doc)) return doc;
      const opened = doc.replace(/<svg\b([^>]*)>/, (_, attrs) => {
        const next = attrs
          .replace(/viewBox="0 0 ([\d.]+) ([\d.]+)"/, (__, w, h) =>
            'viewBox="0 0 ' + w + " " + (Number(h) + dy).toFixed(0) + '"')
          .replace(/height="([\d.]+)px"/, (__, h) =>
            'height="' + (Number(h) + dy).toFixed(0) + 'px"');
        return '<svg' + next + '><g transform="translate(0,' + dy.toFixed(1) + ')">';
      });
      return opened.replace(/<\/svg>\s*$/, "</g></svg>");
    });
  }

  function digitNodes(voice) {
    const nodes = [...paper.querySelectorAll("text.fj.v-" + voice)].filter((el) =>
      /^[0-7]$/.test((el.textContent || "").trim()));
    if (nodes.length || voice !== "Vocal") return nodes;
    return [...paper.querySelectorAll("text.fj")].filter((el) =>
      /^[0-7]$/.test((el.textContent || "").trim()));
  }

  function tagHit(el, mark, lyric) {
    el.dataset.voice = mark.voice;
    el.dataset.idx = String(mark.index);
    el.dataset.slice = String(mark.slice || 0);
    el.dataset.start = String(mark.start);
    if (lyric) el.dataset.lyric = "1";
  }

  // Accidentals (.jacc) and octave dots sit beside the digit; duration dots sit to the right.
  function tagAdornments(digit) {
    const svg = digit.ownerSVGElement;
    if (!svg || !digit.getBoundingClientRect) return;
    let box;
    try { box = digit.getBoundingClientRect(); } catch (err) { return; }
    if (!(box.width || box.height)) return;
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const padX = Math.max(16, box.width * 2.2);
    const padY = Math.max(22, box.height * 2.4);
    svg.querySelectorAll("text").forEach((el) => {
      if (el === digit || el.classList.contains("fj")) return;
      if (el.dataset.lyric === "1" || el.dataset.start) return;
      const cls = el.getAttribute("class") || "";
      const isJacc = el.classList.contains("jacc");
      if (!isJacc && /(?:^|\s)f\d+/.test(cls)) return;
      let b;
      try { b = el.getBoundingClientRect(); } catch (err) { return; }
      if (!(b.width || b.height)) return;
      const ex = (b.left + b.right) / 2;
      const ey = (b.top + b.bottom) / 2;
      if (ex > box.right + 6) return;
      if (Math.abs(ex - cx) > padX || Math.abs(ey - cy) > padY) return;
      el.dataset.voice = digit.dataset.voice;
      el.dataset.idx = digit.dataset.idx;
      el.dataset.slice = digit.dataset.slice || "0";
      el.dataset.start = digit.dataset.start;
      el.dataset.adorn = "1";
    });
  }

  function bindJianpu() {
    for (const voice of ["Vocal", "Ins"]) {
      const nodes = digitNodes(voice);
      const voiceMarks = marks.filter((mark) => mark.voice === voice);
      const count = Math.min(nodes.length, voiceMarks.length);
      for (let i = 0; i < count; i++) {
        tagHit(nodes[i], voiceMarks[i], false);
        tagAdornments(nodes[i]);
      }
    }
    const vocal = digitNodes("Vocal");
    const events = editor.listEvents(abc);
    const drawn = {};
    events.forEach((ev) => {
      if (editor.lyricIsDrawn(ev.lyric)) drawn[ev.index] = true;
    });
    const headBoxes = [];
    vocal.forEach((el) => {
      if (!el.getBoundingClientRect) return;
      const box = el.getBoundingClientRect();
      if (!(box.width || box.height)) return;
      headBoxes.push({
        x: (box.left + box.right) / 2,
        y: (box.top + box.bottom) / 2,
        h: box.height,
        index: Number(el.dataset.idx),
        voice: "Vocal",
      });
    });
    const glyphs = [];
    paper.querySelectorAll("text").forEach((el) => {
      if (el.classList.contains("fj") || el.classList.contains("jacc")) return;
      const cls = el.getAttribute("class") || "";
      if (!/(?:^|\s)f\d+/.test(cls)) return;
      const text = (el.textContent || "").replace(/\s+/g, "");
      if (!text || text === "V:" || text === "A:" || text.indexOf("=") >= 0) return;
      if (!el.getBoundingClientRect) return;
      const box = el.getBoundingClientRect();
      if (!(box.width || box.height)) return;
      glyphs.push({ el: el, x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
    });
    const heights = headBoxes.map((head) => head.h).filter((h) => h > 0).sort((a, b) => a - b);
    const noteH = heights.length ? heights[(heights.length / 2) | 0] : 16;
    const maxGap = Math.max(48, noteH * 4);
    const hits = editor.assignLyricHits(headBoxes, glyphs, drawn, {
      rowSlack: Math.max(4, noteH * 0.6),
      maxGap: maxGap,
    });
    const claimed = new Set();
    const claim = (hit) => {
      if (!hit || claimed.has(hit.index)) return;
      const el = hit.glyph && hit.glyph.el;
      const start = editor.markTime(marks, "Vocal", hit.index, 0);
      if (!el || start == null) return;
      claimed.add(hit.index);
      tagHit(el, { voice: "Vocal", index: hit.index, slice: 0, start: start }, true);
    };
    hits.forEach(claim);
    const claimedGlyph = new Set(hits.map((hit) => hit.glyph));
    const xs = headBoxes.map((head) => head.x).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    let neighbor = 36;
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      if (gap > 4 && gap < neighbor) neighbor = gap;
    }
    editor.glyphsUnderNotes(
      headBoxes.filter((head) => !claimed.has(head.index)),
      glyphs.filter((glyph) => !claimedGlyph.has(glyph)),
      { maxGap: maxGap, xSlack: Math.max(16, neighbor * 0.65) },
    ).forEach(claim);
  }

  function bindStaff() {
    const groups = { Vocal: [], Ins: [] };
    const lyrics = [];
    paper.querySelectorAll("rect.hit").forEach((el) => {
      if (el.dataset.kind === "lyrics") lyrics.push(el);
      else if (groups[el.dataset.voice]) groups[el.dataset.voice].push(el);
    });
    for (const voice of ["Vocal", "Ins"]) {
      const slots = [];
      const seen = new Set();
      for (const mark of marks) {
        if (mark.voice !== voice || seen.has(mark.index)) continue;
        seen.add(mark.index);
        slots.push(mark);
      }
      const nodes = groups[voice];
      const count = Math.min(nodes.length, slots.length);
      for (let i = 0; i < count; i++) tagHit(nodes[i], slots[i], false);
    }
    const lyricMarks = [];
    for (const ev of editor.listEvents(abc)) {
      if (!editor.lyricIsDrawn(ev.lyric)) continue;
      const start = editor.markTime(marks, "Vocal", ev.index, 0);
      if (start == null) continue;
      lyricMarks.push({ voice: "Vocal", index: ev.index, slice: 0, start: start });
    }
    const count = Math.min(lyrics.length, lyricMarks.length);
    for (let i = 0; i < count; i++) tagHit(lyrics[i], lyricMarks[i], true);
  }

  function bindHits() {
    if (notation === "staff") bindStaff();
    else bindJianpu();
  }

  function render() {
    jianpuBtn.setAttribute("aria-pressed", notation === "jianpu" ? "true" : "false");
    staffBtn.setAttribute("aria-pressed", notation === "staff" ? "true" : "false");
    diagramBtn.setAttribute("aria-pressed", diagramOn ? "true" : "false");
    if (!abc) {
      paper.textContent = "";
      clearPlayhead();
      return;
    }
    const info = editor.inspectScore(abc);
    if (info.error) {
      paper.textContent = info.error;
      return;
    }
    refreshTiming();
    const names = editor.chordKeyNames(info.keyName);
    const selected = names.indexOf(chosen) >= 0 ? chosen : info.keyName;
    chosen = selected;
    if (keyEl.dataset.keys !== names.join(",")) {
      keyEl.dataset.keys = names.join(",");
      keyEl.innerHTML = names.map((name) => '<option value="' + name + '">' + label(name) + "</option>").join("");
    }
    keyEl.value = selected;
    const view = editor.chordsInKey(abc, selected === info.keyName ? "" : selected);
    const legend = editor.withKeyLegend(view, editor.keyLegend(info.keyName, selected));
    const body = notation === "jianpu" ? editor.jianpuAbcWithDirective(legend) : legend;
    const src = (diagramOn ? editor.diagramDirective("guitar") : "") + body;
    paper.innerHTML = "";
    playKey = "";
    if (typeof abc2svg === "undefined" || !abc2svg.Abc) {
      paper.textContent = "简谱模块没有载入。";
      return;
    }
    try {
      const user = {
        img_out: (svg) => paper.insertAdjacentHTML("beforeend", fitDiagramSvg(svg)),
        errmsg: () => {},
        get_abcmodel: () => {},
        anno_stop: (type, start, stop, x, y, w, h, sym) => {
          if (notation !== "staff" || !renderer) return;
          if (type !== "note" && type !== "rest" && type !== "Zrest" && type !== "lyrics") return;
          const voice = String((sym && sym.p_v && sym.p_v.id) || "").replace(/[^A-Za-z0-9_-]/g, "");
          renderer.out_svg('<rect class="hit" data-kind="' + type + '" data-voice="' + voice + '" x="');
          renderer.out_sxsy(x, '" y="', y);
          const height = Math.abs(renderer.sh(h));
          renderer.out_svg('" width="' + Math.abs(w).toFixed(2) + '" height="' + height.toFixed(2) + '" fill="transparent"/>\n');
        },
      };
      renderer = new abc2svg.Abc(user);
      if (abc2svg.diag && abc2svg.diag.set_hooks) abc2svg.diag.set_hooks(renderer);
      renderer.tosvg("score", src);
      bindHits();
      paint(playing ? nowPlaying() : offset);
    } catch (error) {
      paper.textContent = String(error);
    }
  }

  function seek(seconds) {
    const keep = playing || arming;
    offset = clampTime(seconds);
    if (keep) void play(offset);
    else paint(offset);
  }

  async function openPiece(entry) {
    haltAudio();
    offset = 0;
    playKey = "";
    current = entry;
    titleEl.textContent = entry.title;
    history.replaceState(null, "", "#" + encodeURIComponent(entry.id));
    drawList();
    const response = await fetch("../scores/" + encodeURIComponent(entry.id) + ".abc");
    if (!response.ok) {
      paper.textContent = "打不开这首简谱。";
      abc = "";
      total = 0;
      marks = [];
      paint(0);
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

  async function play(from) {
    if (!abc) return;
    const score = refreshTiming();
    if (score.error || !score.notes.length) return;
    let at = from == null ? offset : Number(from);
    if (!Number.isFinite(at) || at < 0) at = 0;
    if (at >= Math.max(0.02, total - 0.02)) at = 0;
    haltAudio();
    const gen = generation;
    arming = true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = ctx || new AudioCtx();
    try {
      if (ctx.state === "suspended") await ctx.resume();
    } catch (err) {
      if (gen === generation) {
        arming = false;
        playing = false;
      }
      return;
    }
    if (gen !== generation) return;
    if (window.yuePiano.prepare) void window.yuePiano.prepare(ctx);
    arming = false;
    playing = true;
    offset = at;
    playFrom = at;
    playKey = "";
    startedAt = ctx.currentTime + 0.05;
    const queue = editor.soundingNotes(score.notes, at);
    const tick = () => {
      if (!playing || gen !== generation) return;
      const now = Math.min(total, playFrom + Math.max(0, ctx.currentTime - startedAt));
      for (const item of editor.pumpMidi(queue, now)) {
        window.yuePiano.schedule(
          ctx,
          { midi: item.note.midi, volume: item.note.volume || 0.16, velocity: item.note.velocity },
          startedAt + item.delay,
          Math.max(0.06, item.duration),
          voices,
        );
      }
      paint(now);
      if (now < total - 0.02) timer = requestAnimationFrame(tick);
      else {
        playing = false;
        timer = 0;
        stopVoices();
        offset = total;
        paint(total);
      }
    };
    tick();
  }

  function showNotation(next) {
    if (notation === next) return;
    notation = next;
    const at = playing ? nowPlaying() : offset;
    offset = at;
    render();
  }

  keyEl.addEventListener("change", () => {
    chosen = keyEl.value;
    const at = playing ? nowPlaying() : offset;
    offset = at;
    render();
  });
  playBtn.addEventListener("click", () => { void play(); });
  stopBtn.addEventListener("click", () => {
    haltAudio();
    offset = 0;
    clearMotion();
    clearPlayhead();
    paint(0);
  });
  jianpuBtn.addEventListener("click", () => showNotation("jianpu"));
  staffBtn.addEventListener("click", () => showNotation("staff"));
  seekEl.addEventListener("pointerdown", () => {
    resumeAfterScrub = playing || arming;
    scrubbing = true;
    haltAudio();
  });
  seekEl.addEventListener("input", () => {
    offset = clampTime(Number(seekEl.value));
    if (scrubbing) paint(offset);
    else seek(offset);
  });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    offset = clampTime(Number(seekEl.value));
    if (resumeAfterScrub) void play(offset);
    else paint(offset);
  };
  seekEl.addEventListener("change", endScrub);
  seekEl.addEventListener("pointerup", endScrub);
  seekEl.addEventListener("pointercancel", endScrub);
  paper.addEventListener("click", (event) => {
    const el = event.target.closest && event.target.closest("[data-start]");
    if (!el || !paper.contains(el)) return;
    const at = Number(el.dataset.start);
    if (!Number.isFinite(at)) return;
    seek(at);
  });
  queryEl.addEventListener("input", drawList);

  function setLibrary(open) {
    libraryEl.classList.toggle("is-library-off", !open);
    libraryBtn.setAttribute("aria-pressed", open ? "true" : "false");
    try { localStorage.setItem("jianpu-library", open ? "1" : "0"); } catch (err) { /* private mode */ }
  }
  let libraryOpen = true;
  try { libraryOpen = localStorage.getItem("jianpu-library") !== "0"; } catch (err) { /* private mode */ }
  setLibrary(libraryOpen);
  libraryBtn.addEventListener("click", () => {
    setLibrary(libraryEl.classList.contains("is-library-off"));
  });

  function setDiagram(open) {
    diagramOn = !!open;
    diagramBtn.setAttribute("aria-pressed", diagramOn ? "true" : "false");
    try { localStorage.setItem("jianpu-diagram", diagramOn ? "1" : "0"); } catch (err) { /* private mode */ }
    const at = playing ? nowPlaying() : offset;
    offset = at;
    render();
  }
  try { diagramOn = localStorage.getItem("jianpu-diagram") !== "0"; } catch (err) { /* private mode */ }
  diagramBtn.setAttribute("aria-pressed", diagramOn ? "true" : "false");
  diagramBtn.addEventListener("click", () => {
    setDiagram(!diagramOn);
  });

  fetch("../scores/index.json?" + Date.now(), { cache: "no-store" })
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
