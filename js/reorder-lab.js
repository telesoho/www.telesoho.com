const PARAGRAPHS = [
  {
    id: "a",
    text: "人的眼睛只能看到三维空间，却看不到时间；大脑却能「看见」时间这个维度，否则不会有过去、现在和将来的感觉。",
  },
  {
    id: "b",
    text: "因此，思维是唯一可以让人自由穿越时空的器官。那些在三维物理时间中做不到的事，都可以在正确的公式与想象里预先看见。",
  },
  {
    id: "c",
    text: "相比宇宙，人是如此渺小。探索宇宙、训练大脑，进化出能正确认识世界的心智，是现阶段值得持续做的事。",
  },
];

const CORRECT = PARAGRAPHS.map((p) => p.id);

const listEl = document.getElementById("reorder-list");
const statusEl = document.getElementById("reorder-status");
const shuffleBtn = document.getElementById("reorder-shuffle");
const resetBtn = document.getElementById("reorder-reset");

/** @type {string[]} */
let durable = [...CORRECT];
let dragId = null;

function shuffleIds(ids) {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  if (next.every((id, i) => id === CORRECT[i])) {
    return shuffleIds(ids);
  }
  return next;
}

function byId(id) {
  return PARAGRAPHS.find((p) => p.id === id);
}

function validPermutation(ids) {
  if (ids.length !== CORRECT.length) return false;
  const set = new Set(ids);
  return CORRECT.every((id) => set.has(id));
}

function isCorrect(ids) {
  return ids.every((id, i) => id === CORRECT[i]);
}

/**
 * reduce(durable, command) — invalid moves keep previous state.
 * command: { type: 'move', from: number, to: number }
 */
function reduce(state, command) {
  if (command.type !== "move") return state;
  const { from, to } = command;
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= state.length ||
    to >= state.length
  ) {
    return state;
  }
  const candidate = [...state];
  const [item] = candidate.splice(from, 1);
  candidate.splice(to, 0, item);
  return validPermutation(candidate) ? candidate : state;
}

function setStatus(message, state) {
  if (!statusEl) return;
  statusEl.textContent = message;
  if (state) statusEl.dataset.state = state;
  else delete statusEl.dataset.state;
}

function render() {
  if (!listEl) return;
  listEl.innerHTML = "";
  durable.forEach((id, index) => {
    const p = byId(id);
    if (!p) return;
    const li = document.createElement("li");
    li.className = "reorder-item";
    li.draggable = true;
    li.dataset.id = id;
    li.dataset.index = String(index);
    li.innerHTML = `
      <span class="reorder-item__handle" aria-hidden="true">⋮⋮ ${String(index + 1).padStart(2, "0")}</span>
      <p>${p.text}</p>
    `;
    li.addEventListener("dragstart", onDragStart);
    li.addEventListener("dragend", onDragEnd);
    li.addEventListener("dragover", onDragOver);
    li.addEventListener("dragleave", onDragLeave);
    li.addEventListener("drop", onDrop);
    listEl.appendChild(li);
  });

  if (isCorrect(durable)) {
    setStatus("顺序正确 · 状态已提交", "ok");
  } else {
    setStatus("打乱后的段落 · 拖到正确位置", "");
  }
}

function onDragStart(e) {
  const li = e.currentTarget;
  dragId = li.dataset.id;
  li.classList.add("is-dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
}

function onDragEnd(e) {
  e.currentTarget.classList.remove("is-dragging");
  listEl?.querySelectorAll(".is-over").forEach((el) => el.classList.remove("is-over"));
  dragId = null;
}

function onDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add("is-over");
  e.dataTransfer.dropEffect = "move";
}

function onDragLeave(e) {
  e.currentTarget.classList.remove("is-over");
}

function onDrop(e) {
  e.preventDefault();
  const target = e.currentTarget;
  target.classList.remove("is-over");
  const fromId = e.dataTransfer.getData("text/plain") || dragId;
  const toId = target.dataset.id;
  if (!fromId || !toId || fromId === toId) return;

  const from = durable.indexOf(fromId);
  const to = durable.indexOf(toId);
  const next = reduce(durable, { type: "move", from, to });
  if (next === durable || next.every((id, i) => id === durable[i])) {
    setStatus("无效移动 · 保持上一状态", "");
    return;
  }
  durable = next;
  render();
}

shuffleBtn?.addEventListener("click", () => {
  durable = shuffleIds(CORRECT);
  render();
});

resetBtn?.addEventListener("click", () => {
  durable = [...CORRECT];
  render();
});

// Start shuffled so the lab asks for interaction.
durable = shuffleIds(CORRECT);
render();
