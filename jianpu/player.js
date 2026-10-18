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
  const leadBtn = document.getElementById("view-lead");
  const diagramBtn = document.getElementById("diagram-toggle");
  const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6l8-4.8z"/></svg>';
  const PAUSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h2.6v10H4zm5.4 0H12v10H9.4z"/></svg>';

  editor.setStrings({
    jpLeadKey: "选调",
    jpLeadMeter: "拍号",
    jpLeadTempo: "拍速",
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
  let barKey = "";
  let renderer = null;
  let sourceAnchors = null;
  let sourceAnchorKey = "";
  let sourceScrollShown = null;
  let sourceScrollAt = 0;
  const voices = [];
  const SOURCE_ROW_Y_TOL = 18;
  const SOURCE_SCROLL_TAU = 0.16;

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

  function setPlayLabel(live) {
    const on = !!live;
    playBtn.innerHTML = on ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute("aria-label", on ? "暂停" : "播放");
    playBtn.setAttribute("aria-pressed", on ? "true" : "false");
    playBtn.title = on ? "暂停" : "播放";
  }

  function pause() {
    if (!playing && !arming) return;
    offset = nowPlaying();
    haltAudio();
    setPlayLabel(false);
    paint(offset);
  }

  function togglePlay() {
    if (playing || arming) pause();
    else void play();
  }

  function clearMotion() {
    paper.querySelectorAll(".is-on").forEach((el) => el.classList.remove("is-on"));
  }

  function clearBarOn() {
    paper.querySelectorAll("rect.bar-on").forEach((el) => el.remove());
    barKey = "";
  }

  function clearSourceScroll() {
    sourceAnchors = null;
    sourceAnchorKey = "";
    sourceScrollShown = null;
    sourceScrollAt = 0;
  }

  function clearPlayhead() {
    clearMotion();
    clearBarOn();
    clearSourceScroll();
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

  function viewBoxOf(svg) {
    const parts = String(svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
    try {
      const bb = svg.getBBox();
      return { x: bb.x, y: bb.y, w: bb.width || 1, h: bb.height || 1 };
    } catch (err) {
      return { x: 0, y: 0, w: 1, h: 1 };
    }
  }

  // Barlines share one path.d of Mx yv-h segments; thick bars sit ~3 units apart.
  function barXs(svg) {
    const xs = [];
    svg.querySelectorAll("path.bW, path.bthW").forEach((path) => {
      const d = path.getAttribute("d") || "";
      const re = /M\s*([-\d.]+)[\s,]+[-\d.]+/g;
      let match;
      while ((match = re.exec(d))) xs.push(Number(match[1]));
    });
    xs.sort((a, b) => a - b);
    const merged = [];
    for (const x of xs) {
      if (!Number.isFinite(x)) continue;
      if (!merged.length || x - merged[merged.length - 1] > 8) merged.push(x);
    }
    return merged;
  }

  function barSpanFor(node) {
    const svg = node && node.ownerSVGElement;
    if (!svg) return null;
    let box;
    try { box = node.getBBox(); } catch (err) { return null; }
    const cx = box.x + box.width / 2;
    const vb = viewBoxOf(svg);
    const xs = barXs(svg);
    if (!xs.length) return { svg: svg, x: vb.x, w: vb.w, y: vb.y, h: vb.h };
    let left = vb.x;
    let right = vb.x + vb.w;
    for (let i = 0; i < xs.length; i++) {
      if (cx < xs[i]) {
        right = xs[i];
        break;
      }
      left = xs[i];
    }
    const w = Math.max(1, right - left);
    return { svg: svg, x: left, w: w, y: vb.y, h: vb.h };
  }

  function paintBar(node) {
    // Keep the bar while paused/scrubbed mid-piece; clear only when idle at 0 (stop).
    if (!node || (!playing && !scrubbing && !(offset > 0))) {
      clearBarOn();
      return;
    }
    const span = barSpanFor(node);
    if (!span) {
      clearBarOn();
      return;
    }
    const nextKey = [
      Array.prototype.indexOf.call(paper.querySelectorAll("svg"), span.svg),
      span.x.toFixed(1),
      span.w.toFixed(1),
    ].join(":");
    if (nextKey === barKey) return;
    clearBarOn();
    barKey = nextKey;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", "bar-on");
    rect.setAttribute("x", String(span.x));
    rect.setAttribute("y", String(span.y));
    rect.setAttribute("width", String(span.w));
    rect.setAttribute("height", String(span.h));
    span.svg.insertBefore(rect, span.svg.firstChild);
  }

  function collectRowAnchors() {
    if (!paper.getBoundingClientRect) return [];
    const paperBox = paper.getBoundingClientRect();
    const scrollTop = paper.scrollTop || 0;
    const byKey = new Map();
    for (const el of paper.querySelectorAll("[data-start]")) {
      if (el.dataset.adorn === "1" || el.dataset.lyric === "1") continue;
      const voice = el.dataset.voice || "Vocal";
      byKey.set(voice + ":" + el.dataset.idx + ":" + (el.dataset.slice || "0"), el);
    }
    const items = [];
    for (const mark of marks) {
      if (!mark || (mark.voice && mark.voice !== "Vocal")) continue;
      const node = byKey.get((mark.voice || "Vocal") + ":" + mark.index + ":" + mark.slice);
      if (!node || !node.getBoundingClientRect) continue;
      const box = node.getBoundingClientRect();
      items.push({
        t: mark.start,
        y: box.top - paperBox.top + scrollTop,
      });
    }
    items.sort((a, b) => a.t - b.t || a.y - b.y);
    const rows = [];
    for (const item of items) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(item.y - last.y) < SOURCE_ROW_Y_TOL) continue;
      rows.push({ t: item.t, y: item.y });
    }
    return rows;
  }

  function followSourceScroll(now) {
    if (!playing || notation === "lead") return;
    const key = (paper.clientWidth || 0) + "x" + (paper.scrollHeight || 0);
    if (!sourceAnchors || sourceAnchorKey !== key) {
      sourceAnchors = collectRowAnchors();
      sourceAnchorKey = key;
    }
    const view = paper.clientHeight || 0;
    const maxScroll = Math.max(0, (paper.scrollHeight || 0) - view);
    const target = editor.sourceScrollTop(sourceAnchors, now, view, maxScroll);
    const nowMs = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const dt = sourceScrollShown == null || !sourceScrollAt
      ? 0
      : Math.max(0, (nowMs - sourceScrollAt) / 1000);
    const snap = Math.max(80, view * 0.5);
    const next = sourceScrollShown == null
      ? target
      : editor.easeScrollStep(sourceScrollShown, target, dt, SOURCE_SCROLL_TAU, snap);
    sourceScrollShown = next;
    sourceScrollAt = nowMs;
    paper.scrollTop = next;
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
    if (playing) followSourceScroll(shown);
    const followMark = editor.followMark(marks, shown)
      || editor.cursorAt(marksOf("Vocal"), shown)
      || editor.cursorAt(marksOf("Ins"), shown);
    const followNode = nodeFor(followMark);
    paintBar(followNode);
    const vocalMark = editor.cursorAt(marksOf("Vocal"), shown);
    const insMark = editor.cursorAt(marksOf("Ins"), shown);
    const key = markKey(vocalMark) + "|" + markKey(insMark);
    if (key === playKey) return;
    playKey = key;
    clearMotion();
    glowNote(nodeFor(vocalMark));
    glowNote(lyricFor(vocalMark));
    glowNote(nodeFor(insMark));
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
    leadBtn.setAttribute("aria-pressed", notation === "lead" ? "true" : "false");
    diagramBtn.setAttribute("aria-pressed", diagramOn ? "true" : "false");
    paper.classList.toggle("is-lead", notation === "lead");
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
    paper.innerHTML = "";
    playKey = "";
    barKey = "";
    clearSourceScroll();
    if (notation === "lead") {
      const sheet = editor.leadSheet(abc, current && current.title, selected);
      if (sheet.error) {
        paper.textContent = "无法生成弹唱谱";
        return;
      }
      const frame = document.createElement("iframe");
      frame.title = "弹唱谱";
      frame.srcdoc = editor.leadSheetDocument(sheet);
      paper.appendChild(frame);
      paint(playing ? nowPlaying() : offset);
      return;
    }
    const view = editor.chordsInKey(abc, selected === info.keyName ? "" : selected);
    const legend = editor.withKeyLegend(view, editor.keyLegend(info.keyName, selected));
    const body = notation === "jianpu" ? editor.jianpuAbcWithDirective(legend) : legend;
    const src = (diagramOn ? editor.diagramDirective("guitar") : "") + body;
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
    setPlayLabel(false);
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
        setPlayLabel(false);
      }
      return;
    }
    if (gen !== generation) return;
    if (window.yuePiano.prepare) void window.yuePiano.prepare(ctx);
    arming = false;
    playing = true;
    setPlayLabel(true);
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
        setPlayLabel(false);
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
  playBtn.addEventListener("click", () => { togglePlay(); });
  stopBtn.addEventListener("click", () => {
    haltAudio();
    offset = 0;
    clearPlayhead();
    setPlayLabel(false);
    paint(0);
  });
  jianpuBtn.addEventListener("click", () => showNotation("jianpu"));
  staffBtn.addEventListener("click", () => showNotation("staff"));
  leadBtn.addEventListener("click", () => showNotation("lead"));
  seekEl.addEventListener("pointerdown", () => {
    resumeAfterScrub = playing || arming;
    scrubbing = true;
    haltAudio();
    setPlayLabel(false);
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
