import { firebaseApp, GOOGLE_CALENDAR_CLIENT_ID } from "./firebase-config.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("SW registration failed:", err));
  });
}

const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

let currentUser = null;
let tasks = [];
let unsubscribeTasks = null;

const ENERGIES = ["Low", "Medium", "High"];
const RECURRENCES = ["None", "Daily", "Weekly", "Monthly"];
const ESTIMATES = ["5 minutes", "15 minutes", "30 minutes", "60 minutes", "Over an hour"];
const TYPES = ["Email", "Meeting", "Finance", "Errand", "Admin"];
const VIEWS = ["list", "project", "type", "calendar"];

const state = {
  view: "list",
  search: "",
  hideDone: localStorage.getItem("hideDone") === "true",
  filterEnergy: "All",
  filterType: "All",
  filterProject: "All",
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
function fmt12Hour(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
      type: t.type || "", status: "To do",
      deadline: next, deadlineTime: t.deadlineTime || "", estimate: t.estimate || "", energy: t.energy || "Medium",
      recurrence: t.recurrence, starred: false
    });
  }
}

// ---------- Filtering ----------
function filteredTasks() {
  return tasks.filter((t) => {
    if (state.hideDone && t.status === "Done") return false;
    if (state.filterEnergy !== "All" && t.energy !== state.filterEnergy) return false;
    if (state.filterType !== "All" && t.type !== state.filterType) return false;
    if (state.filterProject !== "All" && t.project !== state.filterProject) return false;
    if (state.search) {
      const s = state.search.toLowerCase();
      const hit = [t.title, t.project, t.type].some((v) => (v || "").toLowerCase().includes(s));
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
  if (t.estimate) meta.appendChild(el("span", null, "⏱ " + t.estimate));
  if (t.recurrence && t.recurrence !== "None") meta.appendChild(el("span", null, "↻ " + t.recurrence));
  body.appendChild(title);
  body.appendChild(meta);

  const right = el("div", "flex items-center gap-2 shrink-0");
  const starBtn = el("button", "text-base leading-none " + (t.starred ? "text-amber-400" : "text-gray-300 hover:text-amber-300"));
  starBtn.innerHTML = t.starred ? "&#9733;" : "&#9734;";
  starBtn.title = t.starred ? "Unstar" : "Star";
  starBtn.addEventListener("click", (e) => { e.stopPropagation(); patchTask(t.id, { starred: !t.starred }); });
  right.appendChild(starBtn);
  if (t.deadline) {
    const dateLabel = fmtDate(t.deadline) + (t.deadlineTime ? " · " + fmt12Hour(t.deadlineTime) : "");
    right.appendChild(el("span", "text-xs font-medium " + (isOverdue(t) ? "text-rose-600" : "text-gray-500"), dateLabel));
  }
  right.appendChild(el("span", "text-gray-400 text-xs", isOpen ? "▾" : "▸"));

  header.appendChild(check);
  header.appendChild(body);
  header.appendChild(right);
  row.appendChild(header);

  if (isOpen) {
    const panel = el("div", "px-3.5 pb-4 pt-3 border-t border-gray-100 bg-gray-50/60");

    const titleInput = el("input", inputCls);
    titleInput.value = t.title || "";
    titleInput.addEventListener("change", (e) => {
      const v = e.target.value.trim();
      if (v) patchTask(t.id, { title: v });
      else e.target.value = t.title || "";
    });
    const titleField = field("Title", titleInput);
    titleField.className += " mb-3";
    panel.appendChild(titleField);

    const grid = el("div", "grid grid-cols-2 sm:grid-cols-4 gap-3");

    const projectField = field("Project", el("div"));
    grid.appendChild(projectField);
    mountCombo(projectField.lastChild, t.project, uniqueValues("project"), (v) => patchTask(t.id, { project: v }), "Project");

    const typeSel = el("select", inputCls);
    const typePlaceholder = el("option", null, "Select…");
    typePlaceholder.value = "";
    if (!t.type) typePlaceholder.selected = true;
    typeSel.appendChild(typePlaceholder);
    TYPES.forEach((ty) => { const o = el("option", null, ty); if (ty === t.type) o.selected = true; typeSel.appendChild(o); });
    typeSel.addEventListener("change", (e) => patchTask(t.id, { type: e.target.value }));
    grid.appendChild(field("Type", typeSel));

    const statusSel = el("select", inputCls);
    ["To do", "Done"].forEach((s) => { const o = el("option", null, s); if (s === t.status) o.selected = true; statusSel.appendChild(o); });
    statusSel.addEventListener("change", (e) => patchTask(t.id, { status: e.target.value }));
    grid.appendChild(field("Status", statusSel));

    const energySel = el("select", inputCls);
    ENERGIES.forEach((e_) => { const o = el("option", null, e_); if (e_ === t.energy) o.selected = true; energySel.appendChild(o); });
    energySel.addEventListener("change", (e) => patchTask(t.id, { energy: e.target.value }));
    grid.appendChild(field("Energy", energySel));

    const deadlineInput = el("input", inputCls);
    deadlineInput.type = "date"; deadlineInput.value = t.deadline || "";
    deadlineInput.addEventListener("change", (e) => patchTask(t.id, { deadline: e.target.value }));
    grid.appendChild(field("Deadline", deadlineInput));

    const timeInput = el("input", inputCls);
    timeInput.type = "time"; timeInput.value = t.deadlineTime || "";
    timeInput.addEventListener("change", (e) => patchTask(t.id, { deadlineTime: e.target.value }));
    grid.appendChild(field("Time (optional)", timeInput));

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

// ---------- Calendar view ----------
const TOKEN_LIFETIME_MS = 55 * 60 * 1000; // treat as expired a little before Google's real ~60min cutoff

function loadStoredToken() {
  const token = sessionStorage.getItem("calendarAccessToken");
  const savedAt = Number(sessionStorage.getItem("calendarTokenSavedAt") || 0);
  if (token && savedAt && Date.now() - savedAt < TOKEN_LIFETIME_MS) return token;
  sessionStorage.removeItem("calendarAccessToken");
  sessionStorage.removeItem("calendarTokenSavedAt");
  return null;
}

function saveToken(token) {
  sessionStorage.setItem("calendarAccessToken", token);
  sessionStorage.setItem("calendarTokenSavedAt", String(Date.now()));
}

function clearStoredToken() {
  sessionStorage.removeItem("calendarAccessToken");
  sessionStorage.removeItem("calendarTokenSavedAt");
}

let calendarAccessToken = loadStoredToken();
let calendarTokenClient = null;
let calendarDayOffset = 0;
let calendarEvents = [];
let calendarLoading = false;
let calendarError = "";
let calendarList = [];
let calendarListLoading = false;
let selectedCalendarIds = JSON.parse(localStorage.getItem("selectedCalendarIds") || "[]");
let showCalendarPicker = false;
let calendarRestoreInitDone = false;

function dateForOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

function isoDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function ensureGisClient() {
  if (calendarTokenClient || !window.google || !window.google.accounts) return;
  calendarTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CALENDAR_CLIENT_ID,
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    callback: (response) => {
      if (response.error) {
        calendarError = "Couldn't connect to Google Calendar. Please try again.";
        render();
        return;
      }
      calendarAccessToken = response.access_token;
      saveToken(calendarAccessToken);
      calendarError = "";
      fetchCalendarList();
    }
  });
}


function connectCalendar() {
  ensureGisClient();
  if (!calendarTokenClient) {
    calendarError = "Google sign-in library hasn't loaded yet — check your connection and try again.";
    render();
    return;
  }
  calendarTokenClient.requestAccessToken();
}

async function fetchCalendarList() {
  if (!calendarAccessToken) return;
  calendarListLoading = true;
  render();
  try {
    const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: { Authorization: "Bearer " + calendarAccessToken }
    });
    if (res.status === 401) {
      calendarAccessToken = null;
      clearStoredToken();
      calendarError = "Your calendar connection expired — click Connect to reconnect.";
      calendarListLoading = false;
      render();
      return;
    }
    const data = await res.json();
    calendarList = (data.items || []).map((c) => ({
      id: c.id,
      summary: c.summaryOverride || c.summary,
      color: c.backgroundColor || "#4f46e5",
      primary: !!c.primary
    }));
    // First time connecting: nothing selected yet, so surface the picker
    if (selectedCalendarIds.length === 0) showCalendarPicker = true;
    calendarError = "";
  } catch (err) {
    console.error("Calendar list error:", err);
    calendarError = "Couldn't load your list of calendars.";
  }
  calendarListLoading = false;
  render();
  if (selectedCalendarIds.length > 0) fetchCalendarEvents();
}

function toggleCalendarSelection(id) {
  if (selectedCalendarIds.includes(id)) {
    selectedCalendarIds = selectedCalendarIds.filter((x) => x !== id);
  } else {
    selectedCalendarIds = [...selectedCalendarIds, id];
  }
  localStorage.setItem("selectedCalendarIds", JSON.stringify(selectedCalendarIds));
  render();
  fetchCalendarEvents();
}

async function fetchCalendarEvents() {
  if (!calendarAccessToken || selectedCalendarIds.length === 0) {
    calendarEvents = [];
    render();
    return;
  }
  calendarLoading = true;
  render();
  const day = dateForOffset(calendarDayOffset);
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);
  const params = new URLSearchParams({
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: "true",
    orderBy: "startTime"
  });
  try {
    const results = await Promise.all(selectedCalendarIds.map(async (calId) => {
      const meta = calendarList.find((c) => c.id === calId);
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`, {
        headers: { Authorization: "Bearer " + calendarAccessToken }
      });
      if (res.status === 401) throw new Error("expired");
      const data = await res.json();
      return (data.items || []).map((ev) => ({ ...ev, _calColor: meta ? meta.color : "#4f46e5", _calName: meta ? meta.summary : "" }));
    }));
    calendarEvents = results.flat().sort((a, b) => {
      const aTime = a.start && a.start.dateTime ? a.start.dateTime : "0000";
      const bTime = b.start && b.start.dateTime ? b.start.dateTime : "0000";
      return aTime.localeCompare(bTime);
    });
    calendarError = "";
  } catch (err) {
    if (err.message === "expired") {
      calendarAccessToken = null;
      clearStoredToken();
      calendarError = "Your calendar connection expired — click Connect to reconnect.";
    } else {
      console.error("Calendar fetch error:", err);
      calendarError = "Couldn't load your calendar events.";
    }
    calendarEvents = [];
  }
  calendarLoading = false;
  render();
}

function fmtTime(dateObj) {
  return dateObj.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function renderCalendar(container) {
  if (!calendarRestoreInitDone) {
    calendarRestoreInitDone = true;
    if (calendarAccessToken) fetchCalendarList();
  }

  const day = dateForOffset(calendarDayOffset);
  const dayStr = isoDateStr(day);
  const isToday = calendarDayOffset === 0;

  const header = el("div", "flex items-center justify-between mb-1");
  const nav = el("div", "flex items-center gap-2");
  const prevBtn = el("button", "text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50", "←");
  prevBtn.addEventListener("click", () => { calendarDayOffset -= 1; if (calendarAccessToken) fetchCalendarEvents(); else render(); });
  const todayBtn = el("button", "text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50", "Today");
  todayBtn.addEventListener("click", () => { calendarDayOffset = 0; if (calendarAccessToken) fetchCalendarEvents(); else render(); });
  const nextBtn = el("button", "text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50", "→");
  nextBtn.addEventListener("click", () => { calendarDayOffset += 1; if (calendarAccessToken) fetchCalendarEvents(); else render(); });
  nav.appendChild(prevBtn); nav.appendChild(todayBtn); nav.appendChild(nextBtn);

  const dateLabel = el("p", "text-sm font-semibold text-gray-900", day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + (isToday ? " · Today" : ""));

  header.appendChild(nav);
  header.appendChild(dateLabel);
  const rightSlot = el("div");
  if (calendarAccessToken) {
    const manageBtn = el("button", "text-xs text-gray-400 hover:text-indigo-600 underline underline-offset-2", "Calendars");
    manageBtn.addEventListener("click", () => { showCalendarPicker = !showCalendarPicker; render(); });
    rightSlot.appendChild(manageBtn);
  }
  header.appendChild(rightSlot);
  container.appendChild(header);

  if (calendarAccessToken && selectedCalendarIds.length > 0 && !showCalendarPicker) {
    const names = selectedCalendarIds.map((id) => { const c = calendarList.find((x) => x.id === id); return c ? c.summary : null; }).filter(Boolean);
    container.appendChild(el("p", "text-[11px] text-gray-400 mb-4", "Showing: " + (names.join(", ") || "…")));
  } else {
    container.appendChild(el("div", "mb-3"));
  }

  if (calendarError) {
    container.appendChild(el("p", "text-xs text-rose-500 mb-3", calendarError));
  }

  if (!calendarAccessToken) {
    const connectBox = el("div", "border border-dashed border-gray-300 rounded-xl p-6 text-center mb-6");
    connectBox.appendChild(el("p", "text-sm text-gray-500 mb-3", "Connect your Google Calendar to see today's meetings alongside your tasks."));
    const connectBtn = el("button", "text-sm font-medium bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700", "Connect Google Calendar");
    connectBtn.addEventListener("click", connectCalendar);
    connectBox.appendChild(connectBtn);
    container.appendChild(connectBox);
  } else if (calendarListLoading) {
    container.appendChild(el("p", "text-sm text-gray-400 mb-6", "Loading your calendars…"));
  } else if (showCalendarPicker) {
    const pickerBox = el("div", "border border-gray-200 rounded-xl p-4 mb-6");
    pickerBox.appendChild(el("p", "text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3", "Which calendars should show up here?"));
    if (calendarList.length === 0) {
      pickerBox.appendChild(el("p", "text-sm text-gray-400", "No calendars found."));
    } else {
      calendarList.forEach((c) => {
        const row = el("label", "flex items-center gap-2.5 py-1.5 cursor-pointer");
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = selectedCalendarIds.includes(c.id);
        cb.addEventListener("change", () => toggleCalendarSelection(c.id));
        const dot = el("span", "w-2.5 h-2.5 rounded-full shrink-0");
        dot.style.backgroundColor = c.color;
        const label = el("span", "text-sm text-gray-700", c.summary + (c.primary ? " (primary)" : ""));
        row.appendChild(cb); row.appendChild(dot); row.appendChild(label);
        pickerBox.appendChild(row);
      });
    }
    const doneBtn = el("button", "text-sm font-medium bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 mt-3", "Done");
    doneBtn.addEventListener("click", () => { showCalendarPicker = false; render(); });
    pickerBox.appendChild(doneBtn);
    container.appendChild(pickerBox);
  } else if (selectedCalendarIds.length === 0) {
    container.appendChild(el("p", "text-sm text-gray-400 mb-6", "No calendars selected yet — click \"Calendars\" above to choose which ones to show."));
  } else if (calendarLoading) {
    container.appendChild(el("p", "text-sm text-gray-400 mb-6", "Loading your calendar…"));
  }

  const dueTasks = tasks.filter((t) => t.deadline === dayStr);
  const timedTasks = dueTasks.filter((t) => t.deadlineTime);
  const untimedTasks = dueTasks.filter((t) => !t.deadlineTime);

  const eventsAvailable = calendarAccessToken && selectedCalendarIds.length > 0 && !showCalendarPicker && !calendarLoading && !calendarListLoading;
  const scheduleItems = [];
  if (eventsAvailable) {
    calendarEvents.forEach((ev) => {
      const key = ev.start && ev.start.dateTime ? ev.start.dateTime : "0000";
      scheduleItems.push({ kind: "event", sortKey: key, data: ev });
    });
  }
  timedTasks.forEach((t) => {
    scheduleItems.push({ kind: "task", sortKey: `${dayStr}T${t.deadlineTime}:00`, data: t });
  });
  scheduleItems.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  if (!showCalendarPicker) {
    const scheduleSection = el("div", "mb-6");
    scheduleSection.appendChild(el("p", "text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2", "Your schedule"));
    if (scheduleItems.length === 0) {
      scheduleSection.appendChild(el("p", "text-sm text-gray-400", eventsAvailable ? "Nothing on your calendar this day." : "Nothing scheduled at a specific time this day."));
    } else {
      const list = el("div", "flex flex-col gap-2");
      scheduleItems.forEach((item) => {
        if (item.kind === "event") {
          const ev = item.data;
          const row = el("div", "flex items-start gap-3 px-3.5 py-2.5 border border-gray-200 rounded-xl bg-white");
          const bar = el("span", "w-1 self-stretch rounded-full shrink-0");
          bar.style.backgroundColor = ev._calColor || "#4f46e5";
          row.appendChild(bar);
          const body = el("div", "flex-1 min-w-0");
          body.appendChild(el("p", "text-sm font-medium text-gray-900", ev.summary || "(No title)"));
          let timeLabel = "All day";
          if (ev.start && ev.start.dateTime) {
            const s = new Date(ev.start.dateTime);
            const e = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : null;
            timeLabel = fmtTime(s) + (e ? " – " + fmtTime(e) : "");
          }
          if (selectedCalendarIds.length > 1 && ev._calName) timeLabel += " · " + ev._calName;
          body.appendChild(el("p", "text-xs text-gray-500 mt-0.5", timeLabel));
          row.appendChild(body);
          list.appendChild(row);
        } else {
          list.appendChild(buildRow(item.data));
        }
      });
      scheduleSection.appendChild(list);
    }
    container.appendChild(scheduleSection);
  }

  const tasksSection = el("div");
  tasksSection.appendChild(el("p", "text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2", `Tasks due this day, no set time · ${untimedTasks.length}`));
  if (untimedTasks.length === 0) {
    tasksSection.appendChild(el("p", "text-sm text-gray-400", "Nothing else due this day."));
  } else {
    const rows = el("div", "flex flex-col gap-2");
    untimedTasks.forEach((t) => rows.appendChild(buildRow(t)));
    tasksSection.appendChild(rows);
  }
  container.appendChild(tasksSection);
}

// ---------- Controls / chrome ----------
const contentEl = document.getElementById("content");
const searchInput = document.getElementById("search-input");
const hideDoneInput = document.getElementById("hide-done");
const filterEnergy = document.getElementById("filter-energy");
const filterType = document.getElementById("filter-type");
const filterProject = document.getElementById("filter-project");
const quickTitle = document.getElementById("quick-title");
const quickProjectContainer = document.getElementById("quick-project");
const quickType = document.getElementById("quick-type");
let quickProjectValue = "";
const addError = document.getElementById("add-error");

searchInput.addEventListener("input", (e) => { state.search = e.target.value; render(); });
hideDoneInput.addEventListener("change", (e) => {
  state.hideDone = e.target.checked;
  localStorage.setItem("hideDone", state.hideDone);
  render();
});
filterEnergy.addEventListener("change", (e) => { state.filterEnergy = e.target.value; render(); });
filterType.addEventListener("change", (e) => { state.filterType = e.target.value; render(); });
filterProject.addEventListener("change", (e) => { state.filterProject = e.target.value; render(); });

document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => { state.view = btn.dataset.view; render(); });
});

function renderChrome() {
  hideDoneInput.checked = state.hideDone;
  document.querySelectorAll(".view-btn").forEach((btn) => {
    const active = btn.dataset.view === state.view;
    btn.className = "view-btn inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border " +
      (active ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-600 hover:bg-gray-50");
  });
  mountCombo(quickProjectContainer, quickProjectValue, uniqueValues("project"), (v) => { quickProjectValue = v; renderChrome(); }, "Project *");
  const currentProjectFilter = filterProject.value;
  filterProject.innerHTML = '<option value="All">Any project</option>';
  uniqueValues("project").forEach((p) => { const o = document.createElement("option"); o.value = p; o.textContent = p; filterProject.appendChild(o); });
  filterProject.value = currentProjectFilter || "All";
}

function render() {
  renderChrome();
  contentEl.innerHTML = "";
  if (state.view === "list") renderList(contentEl);
  else if (state.view === "project") renderGrouped(contentEl, "project");
  else if (state.view === "type") renderGrouped(contentEl, "type");
  else if (state.view === "calendar") renderCalendar(contentEl);
}

// ---------- Add modal ----------
const addModal = document.getElementById("add-modal");
const openModalBtn = document.getElementById("open-modal-btn");
const closeModalBtn = document.getElementById("close-modal-btn");
const cancelModalBtn = document.getElementById("cancel-modal-btn");
const createTaskBtn = document.getElementById("create-task-btn");
const mTitle = document.getElementById("m-title");
const mEnergy = document.getElementById("m-energy");
const mDeadline = document.getElementById("m-deadline");
const mDeadlineTime = document.getElementById("m-deadline-time");
const mEstimate = document.getElementById("m-estimate");
const mRecurrence = document.getElementById("m-recurrence");
const mNotes = document.getElementById("m-notes");
const mProjectContainer = document.getElementById("m-project");
const mType = document.getElementById("m-type");

function renderModalCombos() {
  mountCombo(mProjectContainer, state.draft.project, uniqueValues("project"), (v) => { state.draft.project = v; renderModalCombos(); updateCreateBtnState(); }, "Project");
}

function openAddModal() {
  const title = quickTitle.value.trim();
  const project = quickProjectValue.trim();
  const type = quickType.value.trim();
  const quickTitleControl = quickTitle;
  const quickProjectControl = quickProjectContainer.querySelector("select, input");
  if (!title || !project || !type) {
    addError.classList.remove("hidden");
    if (!title) quickTitleControl.classList.add("border-rose-300"); else quickTitleControl.classList.remove("border-rose-300");
    if (quickProjectControl) { if (!project) quickProjectControl.classList.add("border-rose-300"); else quickProjectControl.classList.remove("border-rose-300"); }
    if (!type) quickType.classList.add("border-rose-300"); else quickType.classList.remove("border-rose-300");
    return;
  }
  addError.classList.add("hidden");
  state.draft = {
    title, project, type, energy: "Medium",
    deadline: "", deadlineTime: "", estimate: "", recurrence: "None", notes: ""
  };
  mTitle.value = title;
  mType.value = type;
  mEnergy.value = "Medium";
  mDeadline.value = "";
  mDeadlineTime.value = "";
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
mType.addEventListener("change", (e) => { state.draft.type = e.target.value; updateCreateBtnState(); });
mEnergy.addEventListener("change", (e) => { state.draft.energy = e.target.value; });
mDeadline.addEventListener("change", (e) => { state.draft.deadline = e.target.value; });
mDeadlineTime.addEventListener("change", (e) => { state.draft.deadlineTime = e.target.value; });
mEstimate.addEventListener("change", (e) => { state.draft.estimate = e.target.value; });
mRecurrence.addEventListener("change", (e) => { state.draft.recurrence = e.target.value; });
mNotes.addEventListener("change", (e) => { state.draft.notes = e.target.value; });

createTaskBtn.addEventListener("click", async () => {
  if (createTaskBtn.disabled || !state.draft) return;
  const d = state.draft;
  await createTask({
    title: d.title.trim(), notes: d.notes || "", project: d.project.trim(), type: d.type.trim(),
    status: "To do", deadline: d.deadline, deadlineTime: d.deadlineTime, estimate: d.estimate,
    energy: d.energy, recurrence: d.recurrence, starred: false
  });
  quickTitle.value = "";
  quickProjectValue = "";
  quickType.value = "";
  renderChrome();
  closeAddModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !addModal.classList.contains("hidden")) closeAddModal();
  if (e.key === "Escape" && !importModal.classList.contains("hidden")) closeImportModal();
});

// ---------- Bulk import ----------
const importModal = document.getElementById("import-modal");
const openImportBtn = document.getElementById("open-import-btn");
const closeImportBtn = document.getElementById("close-import-btn");
const cancelImportBtn = document.getElementById("cancel-import-btn");
const doImportBtn = document.getElementById("do-import-btn");
const importTextarea = document.getElementById("import-textarea");
const importCount = document.getElementById("import-count");
const importProjectContainer = document.getElementById("import-project");
const importType = document.getElementById("import-type");

let importDraft = { project: "" };

function parseImportLines() {
  return importTextarea.value
    .split("\n")
    .map((line) => line.split("\t").map((c) => c.trim()))
    .filter((cols) => cols[0])
    .map((cols) => ({
      title: cols[0],
      project: cols[1] || "",
      type: cols[2] || ""
    }));
}

function renderImportCombos() {
  mountCombo(importProjectContainer, importDraft.project, uniqueValues("project"), (v) => { importDraft.project = v; renderImportCombos(); }, "Project");
}

function updateImportBtnState() {
  doImportBtn.disabled = parseImportLines().length === 0;
}

function openImportModal() {
  importDraft = { project: "" };
  importTextarea.value = "";
  importType.value = "";
  importCount.textContent = "0 tasks will be created";
  renderImportCombos();
  updateImportBtnState();
  importModal.classList.remove("hidden");
}

function closeImportModal() {
  importModal.classList.add("hidden");
}

openImportBtn.addEventListener("click", openImportModal);
closeImportBtn.addEventListener("click", closeImportModal);
cancelImportBtn.addEventListener("click", closeImportModal);

importTextarea.addEventListener("input", () => {
  const n = parseImportLines().length;
  importCount.textContent = `${n} task${n === 1 ? "" : "s"} will be created`;
  updateImportBtnState();
});

doImportBtn.addEventListener("click", async () => {
  if (doImportBtn.disabled) return;
  const rows = parseImportLines();
  doImportBtn.disabled = true;
  doImportBtn.textContent = "Importing…";
  try {
    await Promise.all(rows.map((row) => createTask({
      title: row.title,
      notes: "",
      project: row.project || importDraft.project.trim(),
      type: row.type || importType.value,
      status: "To do",
      deadline: "",
      deadlineTime: "",
      estimate: "",
      energy: "Medium",
      recurrence: "None",
      starred: false
    })));
  } catch (err) {
    console.error("Import error:", err);
    alert("Something went wrong importing some tasks — check the console for details.");
  }
  doImportBtn.textContent = "Import tasks";
  closeImportModal();
});

// ---------- Rename project ----------
const renameModal = document.getElementById("rename-modal");
const openRenameBtn = document.getElementById("open-rename-btn");
const closeRenameBtn = document.getElementById("close-rename-btn");
const cancelRenameBtn = document.getElementById("cancel-rename-btn");
const doRenameBtn = document.getElementById("do-rename-btn");
const renameFrom = document.getElementById("rename-from");
const renameTo = document.getElementById("rename-to");
const renameCount = document.getElementById("rename-count");

function updateRenameCount() {
  const n = renameFrom.value ? tasks.filter((t) => t.project === renameFrom.value).length : 0;
  renameCount.textContent = renameFrom.value ? `Will update ${n} task${n === 1 ? "" : "s"}.` : "";
}

function updateRenameBtnState() {
  const to = renameTo.value.trim();
  doRenameBtn.disabled = !renameFrom.value || !to || to === renameFrom.value;
}

function openRenameModal() {
  renameFrom.innerHTML = '<option value="">Select a project…</option>';
  uniqueValues("project").forEach((p) => { const o = document.createElement("option"); o.value = p; o.textContent = p; renameFrom.appendChild(o); });
  renameTo.value = "";
  updateRenameCount();
  updateRenameBtnState();
  renameModal.classList.remove("hidden");
}

function closeRenameModal() {
  renameModal.classList.add("hidden");
}

openRenameBtn.addEventListener("click", openRenameModal);
closeRenameBtn.addEventListener("click", closeRenameModal);
cancelRenameBtn.addEventListener("click", closeRenameModal);
renameFrom.addEventListener("change", () => { updateRenameCount(); updateRenameBtnState(); });
renameTo.addEventListener("input", updateRenameBtnState);

doRenameBtn.addEventListener("click", async () => {
  if (doRenameBtn.disabled) return;
  const from = renameFrom.value;
  const to = renameTo.value.trim();
  const matching = tasks.filter((t) => t.project === from);
  doRenameBtn.disabled = true;
  doRenameBtn.textContent = "Renaming…";
  try {
    await Promise.all(matching.map((t) => patchTask(t.id, { project: to })));
  } catch (err) {
    console.error("Rename error:", err);
    alert("Something went wrong renaming some tasks — check the console for details.");
  }
  doRenameBtn.textContent = "Rename everywhere";
  closeRenameModal();
});

render();
