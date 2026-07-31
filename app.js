import { firebaseApp } from "./firebase-config.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let currentUser = null;
let tasks = [];
let unsubscribeTasks = null;

const PRIORITIES = ["Low", "Medium", "High"];
const ENERGIES = ["Low", "Medium", "High"];
const RECURRENCES = ["None", "Daily", "Weekly", "Monthly"];
const ESTIMATES = ["5 minutes", "15 minutes", "30 minutes", "60 minutes", "Over an hour"];
const VIEWS = ["list", "board", "project", "type"];

const state = {
  view: "list",
  search: "",
  hideDone: false,
  filterPriority: "All",
  filterEnergy: "All",
  filterContext: "All",
  expandedId: null,
  showAddModal: false,
  draft: null
};

// ---------- Auth ----------
const loginScreen = document.getElementById("login-screen");
const appEl = document.getElementById("app");
const loginError = document.getElementById("login-error");

const ALLOWED_EMAIL = "emmaleesharp@gmail.com";

document.getElementById("google-signin").addEventListener("click", async () => {
  loginError.textContent = "";
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    if (result.user.email !== ALLOWED_EMAIL) {
      await signOut(auth);
      loginError.textContent = "This app is private — that Google account isn't allowed to sign in.";
    }
  } catch (err) {
    loginError.textContent = "Sign-in failed. Please try again.";
    console.error(err);
  }
});

document.getElementById("signout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user && user.email !== ALLOWED_EMAIL) {
    signOut(auth);
    return;
  }
  currentUser = user;
  if (user) {
    loginScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    subscribeToTasks();
  } else {
    loginScreen.classList.remove("hidden");
    appEl.classList.add("hidden");
    if (unsubscribeTasks) unsubscribeTasks();
    tasks = [];
  }
});

// ---------- Firestore ----------
function tasksCollection() {
  return collection(db, "users", currentUser.uid, "tasks");
}

function subscribeToTasks() {
  if (unsubscribeTasks) unsubscribeTasks();
  const q = query(tasksCollection(), orderBy("createdAt", "desc"));
  unsubscribeTasks = onSnapshot(q, (snap) => {
    tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => console.error("Sync error:", err));
}

async function createTask(data) {
  await addDoc(tasksCollection(), { ...data, createdAt: serverTimestamp() });
}
async function patchTask(id, data) {
  await updateDoc(doc(tasksCollection(), id), data);
}
async function removeTask(id) {
  await deleteDoc(doc(tasksCollection(), id));
}

// ---------- Helpers ----------
function todayStr() { return new Date().toISOString().slice(0, 10); }
function isOverdue(t) { return t.deadline && t.deadline < todayStr() && t.status !== "Done"; }
function fmtDate(str) {
  if (!str) return "";
  const d = new Date(str + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function priorityDotClass(p) {
  return p === "High" ? "bg-rose-500" : p === "Medium" ? "bg-amber-500" : "bg-gray-300";
}
function nextDueDate(dateStr, recurrence) {
  if (!dateStr || recurrence === "None") return null;
  const d = new Date(dateStr + "T00:00:00");
  if (recurrence === "Daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "Weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "Monthly") d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function uniqueValues(field) {
  return [...new Set(tasks.map((t) => t[field]).filter(Boolean))].sort();
}

async function toggleDone(t) {
  if (t.status === "Done") {
    await patchTask(t.id, { status: "To do" });
    return;
  }
  await patchTask(t.id, { status: "Done", completedAt: serverTimestamp() });
  const next = nextDueDate(t.deadline, t.recurrence);
  if (next) {
    await createTask({
      title: t.title, notes: t.notes || "", project: t.project || "",
      type: t.type || "", priority: t.priority || "Medium", status: "To do",
      deadline: next, estimate: t.estimate || "", energy: t.energy || "Medium",
      context: t.context || "", recurrence: t.recurrence
    });
  }
}

// ---------- Filtering ----------
function filteredTasks() {
  return tasks.filter((t) => {
    if (state.hideDone && t.status === "Done") return false;
    if (state.filterPriority !== "All" && t.priority !== state.filterPriority) return false;
    if (state.filterEnergy !== "All" && t.energy !== state.filterEnergy) return false;
    if (state.filterContext !== "All" && t.context !== state.filterContext) return false;
    if (state.search) {
      const s = state.search.toLowerCase();
      const hit = [t.title, t.project, t.type, t.context].some((v) => (v || "").toLowerCase().includes(s));
      if (!hit) return false;
    }
    return true;
  });
}

// ---------- Small DOM builders ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function mountCombo(container, currentValue, options, onCommit, placeholder) {
  container.innerHTML = "";
  const uniq = [...new Set(options)].filter(Boolean);
  if (currentValue && !uniq.includes(currentValue)) uniq.push(currentValue);
  uniq.sort();

  const select = el("select", inputCls);
  const placeholderOpt = el("option", null, placeholder || "Select…");
  placeholderOpt.value = "";
  if (!currentValue) placeholderOpt.selected = true;
  select.appendChild(placeholderOpt);

  uniq.forEach((o) => {
    const op = el("option", null, o);
    op.value = o;
    if (o === currentValue) op.selected = true;
    select.appendChild(op);
  });

  const addOpt = el("option", null, "+ Add new…");
  addOpt.value = "__add_new__";
  select.appendChild(addOpt);

  select.addEventListener("change", (e) => {
    if (e.target.value === "__add_new__") {
      container.innerHTML = "";
      const input = el("input", inputCls);
      input.placeholder = "Type a new value…";
      container.appendChild(input);
      input.focus();
      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        const v = input.value.trim();
        if (v) onCommit(v);
        else mountCombo(container, currentValue, options, onCommit, placeholder);
      };
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") input.blur(); });
      input.addEventListener("blur", commit);
    } else {
      onCommit(e.target.value);
    }
  });

  container.appendChild(select);
}

function field(label, node) {
  const wrap = el("div", "flex flex-col gap-1");
  wrap.appendChild(el("label", "text-xs font-medium text-gray-500", label));
  wrap.appendChild(node);
  return wrap;
}
const inputCls = "w-full text-sm px-2.5 py-1.5 rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200";

// ---------- Row rendering ----------
function buildRow(t) {
  const isOpen = state.expandedId === t.id;
  const row = el("div", "border border-gray-200 rounded-xl bg-white overflow-hidden");

  const header = el("div", "flex items-start gap-3 px-3.5 py-3 cursor-pointer hover:bg-gray-50");
  header.addEventListener("click", () => { state.expandedId = isOpen ? null : t.id; render(); });

  const check = el("button", "mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0 " +
    (t.status === "Done" ? "bg-indigo-500 border-indigo-500 text-white" : "border-gray-300 text-transparent hover:border-indigo-400"));
  check.innerHTML = t.status === "Done" ? "&#10003;" : "";
  check.addEventListener("click", (e) => { e.stopPropagation(); toggleDone(t); });

  const body = el("div", "flex-1 min-w-0");
  const title = el("p", "text-sm font-medium " + (t.status === "Done" ? "text-gray-400 line-through" : "text-gray-900"), t.title);
  const meta = el("div", "flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500");
  if (t.project) meta.appendChild(el("span", null, "📁 " + t.project));
  if (t.type) meta.appendChild(el("span", "px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600", t.type));
  if (t.context) meta.appendChild(el("span", null, "📍 " + t.context));
  if (t.estimate) meta.appendChild(el("span", null, "⏱ " + t.estimate));
  if (t.recurrence && t.recurrence !== "None") meta.appendChild(el("span", null, "↻ " + t.recurrence));
  body.appendChild(title);
  body.appendChild(meta);

  const right = el("div", "flex items-center gap-2 shrink-0");
  right.appendChild(el("span", "w-2 h-2 rounded-full " + priorityDotClass(t.priority)));
  if (t.deadline) {
    right.appendChild(el("span", "text-xs font-medium " + (isOverdue(t) ? "text-rose-600" : "text-gray-500"), fmtDate(t.deadline)));
  }
  right.appendChild(el("span", "text-gray-400 text-xs", isOpen ? "▾" : "▸"));

  header.appendChild(check);
  header.appendChild(body);
  header.appendChild(right);
  row.appendChild(header);

  if (isOpen) {
    const panel = el("div", "px-3.5 pb-4 pt-3 border-t border-gray-100 bg-gray-50/60");
    const grid = el("div", "grid grid-cols-2 sm:grid-cols-4 gap-3");

    const projectField = field("Project", el("div"));
    grid.appendChild(projectField);
    mountCombo(projectField.lastChild, t.project, uniqueValues("project"), (v) => patchTask(t.id, { project: v }), "Project");

    const typeField = field("Type", el("div"));
    grid.appendChild(typeField);
    mountCombo(typeField.lastChild, t.type, uniqueValues("type"), (v) => patchTask(t.id, { type: v }), "Type");

    const contextField = field("Context", el("div"));
    grid.appendChild(contextField);
    mountCombo(contextField.lastChild, t.context, uniqueValues("context"), (v) => patchTask(t.id, { context: v }), "Context");

    const statusSel = el("select", inputCls);
    ["To do", "Done"].forEach((s) => { const o = el("option", null, s); if (s === t.status) o.selected = true; statusSel.appendChild(o); });
    statusSel.addEventListener("change", (e) => patchTask(t.id, { status: e.target.value }));
    grid.appendChild(field("Status", statusSel));

    const prioSel = el("select", inputCls);
    PRIORITIES.forEach((p) => { const o = el("option", null, p); if (p === t.priority) o.selected = true; prioSel.appendChild(o); });
    prioSel.addEventListener("change", (e) => patchTask(t.id, { priority: e.target.value }));
    grid.appendChild(field("Priority", prioSel));

    const energySel = el("select", inputCls);
    ENERGIES.forEach((e_) => { const o = el("option", null, e_); if (e_ === t.energy) o.selected = true; energySel.appendChild(o); });
    energySel.addEventListener("change", (e) => patchTask(t.id, { energy: e.target.value }));
    grid.appendChild(field("Energy", energySel));

    const deadlineInput = el("input", inputCls);
    deadlineInput.type = "date"; deadlineInput.value = t.deadline || "";
    deadlineInput.addEventListener("change", (e) => patchTask(t.id, { deadline: e.target.value }));
    grid.appendChild(field("Deadline", deadlineInput));

    const estimateSel = el("select", inputCls);
    ["", ...ESTIMATES].forEach((opt) => {
      const o = el("option", null, opt || "No estimate");
      o.value = opt;
      if (opt === (t.estimate || "")) o.selected = true;
      estimateSel.appendChild(o);
    });
    estimateSel.addEventListener("change", (e) => patchTask(t.id, { estimate: e.target.value }));
    grid.appendChild(field("Estimate", estimateSel));

    const recurSel = el("select", inputCls);
    RECURRENCES.forEach((r) => { const o = el("option", null, r); if (r === t.recurrence) o.selected = true; recurSel.appendChild(o); });
    recurSel.addEventListener("change", (e) => patchTask(t.id, { recurrence: e.target.value }));
    grid.appendChild(field("Repeats", recurSel));

    panel.appendChild(grid);

    const notesWrap = el("div", "mt-3");
    const notesArea = el("textarea", inputCls + " min-h-[70px]");
    notesArea.value = t.notes || "";
    notesArea.placeholder = "Any extra notes…";
    notesArea.addEventListener("change", (e) => patchTask(t.id, { notes: e.target.value }));
    notesWrap.appendChild(el("label", "text-xs font-medium text-gray-500 block mb-1", "Details"));
    notesWrap.appendChild(notesArea);
    panel.appendChild(notesWrap);

    const delBtn = el("button", "mt-4 text-xs font-medium text-rose-500 hover:text-rose-700", "Delete task");
    delBtn.addEventListener("click", () => { if (confirm("Delete this task?")) removeTask(t.id); });
    panel.appendChild(delBtn);

    row.appendChild(panel);
  }
  return row;
}

function emptyState(text) {
  return el("div", "text-center py-14 text-sm text-gray-400", text);
}

// ---------- View rendering ----------
function renderList(container) {
  const items = filteredTasks();
  const today = todayStr();
  const groups = { Overdue: [], Today: [], Upcoming: [], "No date": [] };
  const open = items.filter((t) => t.status !== "Done");
  const done = items.filter((t) => t.status === "Done");
  open.forEach((t) => {
    if (!t.deadline) groups["No date"].push(t);
    else if (t.deadline < today) groups.Overdue.push(t);
    else if (t.deadline === today) groups.Today.push(t);
    else groups.Upcoming.push(t);
  });
  const entries = Object.entries(groups).filter(([, list]) => list.length);
  if (entries.length === 0 && (done.length === 0 || state.hideDone)) {
    container.appendChild(emptyState("Nothing here. Add a task above."));
    return;
  }
  entries.forEach(([label, list]) => {
    const section = el("div", "mb-6");
    section.appendChild(el("p", "text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2", `${label} · ${list.length}`));
    const rows = el("div", "flex flex-col gap-2");
    list.forEach((t) => rows.appendChild(buildRow(t)));
    section.appendChild(rows);
    container.appendChild(section);
  });
  if (!state.hideDone && done.length) {
    const section = el("div", "mb-6");
    section.appendChild(el("p", "text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2", `Done · ${done.length}`));
    const rows = el("div", "flex flex-col gap-2");
    done.forEach((t) => rows.appendChild(buildRow(t)));
    section.appendChild(rows);
    container.appendChild(section);
  }
}

function renderBoard(container) {
  const items = filteredTasks();
  const grid = el("div", "grid grid-cols-1 sm:grid-cols-2 gap-4");
  ["To do", "Done"].forEach((status) => {
    const list = items.filter((t) => t.status === status);
    const col = el("div", "bg-gray-50 rounded-xl border border-gray-200 p-3");
    col.appendChild(el("p", "text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3", `${status} · ${list.length}`));
    const rows = el("div", "flex flex-col gap-2");
    if (!list.length) rows.appendChild(el("p", "text-xs text-gray-400", "—"));
    list.forEach((t) => rows.appendChild(buildRow(t)));
    col.appendChild(rows);
    grid.appendChild(col);
  });
  container.appendChild(grid);
}

function renderGrouped(container, fieldName) {
  const items = filteredTasks();
  const groups = {};
  items.forEach((t) => {
    const key = t[fieldName] || "Uncategorized";
    (groups[key] = groups[key] || []).push(t);
  });
  const names = Object.keys(groups).sort();
  if (!names.length) { container.appendChild(emptyState("Nothing here yet.")); return; }
  names.forEach((name) => {
    const section = el("div", "mb-6");
    section.appendChild(el("p", "text-sm font-semibold text-indigo-600 mb-2", `${name} · ${groups[name].length}`));
    const rows = el("div", "flex flex-col gap-2");
    groups[name].forEach((t) => rows.appendChild(buildRow(t)));
    section.appendChild(rows);
    container.appendChild(section);
  });
}

// ---------- Controls / chrome ----------
const contentEl = document.getElementById("content");
const searchInput = document.getElementById("search-input");
const hideDoneInput = document.getElementById("hide-done");
const filterPriority = document.getElementById("filter-priority");
const filterEnergy = document.getElementById("filter-energy");
const filterContext = document.getElementById("filter-context");
const quickTitle = document.getElementById("quick-title");
const quickProjectContainer = document.getElementById("quick-project");
const quickTypeContainer = document.getElementById("quick-type");
let quickProjectValue = "";
let quickTypeValue = "";
const addError = document.getElementById("add-error");

searchInput.addEventListener("input", (e) => { state.search = e.target.value; render(); });
hideDoneInput.addEventListener("change", (e) => { state.hideDone = e.target.checked; render(); });
filterPriority.addEventListener("change", (e) => { state.filterPriority = e.target.value; render(); });
filterEnergy.addEventListener("change", (e) => { state.filterEnergy = e.target.value; render(); });
filterContext.addEventListener("change", (e) => { state.filterContext = e.target.value; render(); });

document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => { state.view = btn.dataset.view; render(); });
});

function renderChrome() {
  document.querySelectorAll(".view-btn").forEach((btn) => {
    const active = btn.dataset.view === state.view;
    btn.className = "view-btn inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border " +
      (active ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-600 hover:bg-gray-50");
  });
  mountCombo(quickProjectContainer, quickProjectValue, uniqueValues("project"), (v) => { quickProjectValue = v; renderChrome(); }, "Project *");
  mountCombo(quickTypeContainer, quickTypeValue, uniqueValues("type"), (v) => { quickTypeValue = v; renderChrome(); }, "Type *");
  const currentContext = filterContext.value;
  filterContext.innerHTML = '<option value="All">Any context</option>';
  uniqueValues("context").forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; filterContext.appendChild(o); });
  filterContext.value = currentContext || "All";
}

function render() {
  renderChrome();
  contentEl.innerHTML = "";
  if (state.view === "list") renderList(contentEl);
  else if (state.view === "board") renderBoard(contentEl);
  else if (state.view === "project") renderGrouped(contentEl, "project");
  else if (state.view === "type") renderGrouped(contentEl, "type");
}

// ---------- Add modal ----------
const addModal = document.getElementById("add-modal");
const openModalBtn = document.getElementById("open-modal-btn");
const closeModalBtn = document.getElementById("close-modal-btn");
const cancelModalBtn = document.getElementById("cancel-modal-btn");
const createTaskBtn = document.getElementById("create-task-btn");
const mTitle = document.getElementById("m-title");
const mPriority = document.getElementById("m-priority");
const mEnergy = document.getElementById("m-energy");
const mDeadline = document.getElementById("m-deadline");
const mEstimate = document.getElementById("m-estimate");
const mRecurrence = document.getElementById("m-recurrence");
const mNotes = document.getElementById("m-notes");
const mProjectContainer = document.getElementById("m-project");
const mTypeContainer = document.getElementById("m-type");
const mContextContainer = document.getElementById("m-context");

function renderModalCombos() {
  mountCombo(mProjectContainer, state.draft.project, uniqueValues("project"), (v) => { state.draft.project = v; renderModalCombos(); updateCreateBtnState(); }, "Project");
  mountCombo(mTypeContainer, state.draft.type, uniqueValues("type"), (v) => { state.draft.type = v; renderModalCombos(); updateCreateBtnState(); }, "Type");
  mountCombo(mContextContainer, state.draft.context, uniqueValues("context"), (v) => { state.draft.context = v; renderModalCombos(); }, "Context");
}

function openAddModal() {
  const title = quickTitle.value.trim();
  const project = quickProjectValue.trim();
  const type = quickTypeValue.trim();
  const quickTitleControl = quickTitle;
  const quickProjectControl = quickProjectContainer.querySelector("select, input");
  const quickTypeControl = quickTypeContainer.querySelector("select, input");
  if (!title || !project || !type) {
    addError.classList.remove("hidden");
    if (!title) quickTitleControl.classList.add("border-rose-300"); else quickTitleControl.classList.remove("border-rose-300");
    if (quickProjectControl) { if (!project) quickProjectControl.classList.add("border-rose-300"); else quickProjectControl.classList.remove("border-rose-300"); }
    if (quickTypeControl) { if (!type) quickTypeControl.classList.add("border-rose-300"); else quickTypeControl.classList.remove("border-rose-300"); }
    return;
  }
  addError.classList.add("hidden");
  state.draft = {
    title, project, type, priority: "Medium", energy: "Medium",
    deadline: "", estimate: "", context: "", recurrence: "None", notes: ""
  };
  mTitle.value = title;
  mPriority.value = "Medium";
  mEnergy.value = "Medium";
  mDeadline.value = "";
  mEstimate.value = "";
  mRecurrence.value = "None";
  mNotes.value = "";

  renderModalCombos();
  updateCreateBtnState();
  addModal.classList.remove("hidden");
}

function updateCreateBtnState() {
  const ok = state.draft && state.draft.title.trim() && state.draft.project.trim() && state.draft.type.trim();
  createTaskBtn.disabled = !ok;
}

function closeAddModal() {
  addModal.classList.add("hidden");
  state.draft = null;
}

openModalBtn.addEventListener("click", openAddModal);
quickTitle.addEventListener("keydown", (e) => { if (e.key === "Enter") openAddModal(); });
closeModalBtn.addEventListener("click", closeAddModal);
cancelModalBtn.addEventListener("click", closeAddModal);
mTitle.addEventListener("input", (e) => { state.draft.title = e.target.value; updateCreateBtnState(); });
mPriority.addEventListener("change", (e) => { state.draft.priority = e.target.value; });
mEnergy.addEventListener("change", (e) => { state.draft.energy = e.target.value; });
mDeadline.addEventListener("change", (e) => { state.draft.deadline = e.target.value; });
mEstimate.addEventListener("change", (e) => { state.draft.estimate = e.target.value; });
mRecurrence.addEventListener("change", (e) => { state.draft.recurrence = e.target.value; });
mNotes.addEventListener("change", (e) => { state.draft.notes = e.target.value; });

createTaskBtn.addEventListener("click", async () => {
  if (createTaskBtn.disabled || !state.draft) return;
  const d = state.draft;
  await createTask({
    title: d.title.trim(), notes: d.notes || "", project: d.project.trim(), type: d.type.trim(),
    priority: d.priority, status: "To do", deadline: d.deadline, estimate: d.estimate,
    energy: d.energy, context: d.context, recurrence: d.recurrence
  });
  quickTitle.value = "";
  quickProjectValue = "";
  quickTypeValue = "";
  renderChrome();
  closeAddModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !addModal.classList.contains("hidden")) closeAddModal();
});

render();
