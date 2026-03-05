const STORAGE_INDEX = "mens-cycle-users";
const authForm = document.getElementById("authForm");
const cycleForm = document.getElementById("cycleForm");
const logForm = document.getElementById("logForm");
const reminderForm = document.getElementById("reminderForm");
const logoutBtn = document.getElementById("logoutBtn");
const authStatus = document.getElementById("authStatus");

const authCard = document.getElementById("authCard");
const trackerCard = document.getElementById("trackerCard");
const calendarCard = document.getElementById("calendarCard");
const dailyLogCard = document.getElementById("dailyLogCard");
const remindersCard = document.getElementById("remindersCard");

let currentUser = null;
let currentKey = null;

const toISO = (d) => new Date(d).toISOString().slice(0, 10);
const fromISO = (s) => new Date(`${s}T00:00:00`);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const daysBetween = (a, b) => Math.round((fromISO(toISO(b)) - fromISO(toISO(a))) / 86400000);

async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function getIndex() {
  return JSON.parse(localStorage.getItem(STORAGE_INDEX) || "{}");
}
function setIndex(index) {
  localStorage.setItem(STORAGE_INDEX, JSON.stringify(index));
}

async function saveEncryptedData(email, key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const entry = getIndex()[email];
  entry.payload = btoa(String.fromCharCode(...new Uint8Array(cipher)));
  entry.iv = btoa(String.fromCharCode(...iv));
  const index = getIndex();
  index[email] = entry;
  setIndex(index);
}

async function loadEncryptedData(email, key) {
  const entry = getIndex()[email];
  if (!entry?.payload || !entry?.iv) return { logs: {}, reminders: { periodReminder: true, ovulationReminder: true } };
  const payload = Uint8Array.from(atob(entry.payload), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(entry.iv), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
  return JSON.parse(new TextDecoder().decode(plain));
}

function showApp() {
  authCard.classList.add("hidden");
  [trackerCard, calendarCard, dailyLogCard, remindersCard].forEach((x) => x.classList.remove("hidden"));
}

function hideApp() {
  authCard.classList.remove("hidden");
  [trackerCard, calendarCard, dailyLogCard, remindersCard].forEach((x) => x.classList.add("hidden"));
}

function computePredictions(cycle) {
  const lastPeriodStart = fromISO(cycle.lastPeriodStart);
  const nextPeriod = addDays(lastPeriodStart, cycle.cycleLength);
  const ovulation = addDays(nextPeriod, -14);
  const fertileStart = addDays(ovulation, -4);
  const fertileEnd = addDays(ovulation, 1);
  return { nextPeriod, ovulation, fertileStart, fertileEnd };
}

function renderPredictions(cycle) {
  const p = computePredictions(cycle);
  document.getElementById("predictions").innerHTML = `
    <p><strong>Next period:</strong> ${toISO(p.nextPeriod)}</p>
    <p><strong>Ovulation:</strong> ${toISO(p.ovulation)} (≈14 days before next period)</p>
    <p><strong>Fertile window:</strong> ${toISO(p.fertileStart)} to ${toISO(p.fertileEnd)}</p>
  `;
}

function renderCalendar(cycle) {
  const calendar = document.getElementById("calendar");
  calendar.innerHTML = "";
  const p = computePredictions(cycle);
  const start = fromISO(cycle.lastPeriodStart);

  for (let i = 0; i < 60; i++) {
    const d = addDays(start, i);
    const ds = toISO(d);
    const cell = document.createElement("div");
    cell.className = "day";
    const periodOffset = daysBetween(start, d) % cycle.cycleLength;
    if (periodOffset >= 0 && periodOffset < cycle.periodLength) cell.classList.add("period");
    if (d >= p.fertileStart && d <= p.fertileEnd) cell.classList.add("fertile");
    if (ds === toISO(p.ovulation)) cell.classList.add("ovulation");
    cell.innerHTML = `<div class="num">${ds}</div>`;
    calendar.appendChild(cell);
  }
}

function renderLogs(data) {
  const logs = document.getElementById("logs");
  const entries = Object.entries(data.logs || {}).sort(([a], [b]) => (a < b ? 1 : -1));
  if (!entries.length) {
    logs.innerHTML = "<p class='muted'>No daily logs yet.</p>";
    return;
  }
  logs.innerHTML = `<ul>${entries
    .map(
      ([date, log]) =>
        `<li><strong>${date}</strong> — Mood: ${log.mood || "-"}, Symptoms: ${log.symptoms || "-"}, Flow: ${log.flow || "-"}<br/>Notes: ${log.notes || "-"}</li>`
    )
    .join("")}</ul>`;
}

function renderReminders(data) {
  const list = document.getElementById("reminderList");
  if (!data.cycle) {
    list.innerHTML = "<p class='muted'>Set cycle data first to see reminder dates.</p>";
    return;
  }
  const p = computePredictions(data.cycle);
  const items = [];
  if (data.reminders?.periodReminder) items.push(`Period reminder: ${toISO(addDays(p.nextPeriod, -2))}`);
  if (data.reminders?.ovulationReminder) items.push(`Ovulation reminder: ${toISO(addDays(p.ovulation, -1))}`);
  list.innerHTML = items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>` : "<p class='muted'>No reminders enabled.</p>";
}

async function refreshUI() {
  const data = await loadEncryptedData(currentUser, currentKey);
  if (data.cycle) {
    document.getElementById("lastPeriodStart").value = data.cycle.lastPeriodStart;
    document.getElementById("periodLength").value = data.cycle.periodLength;
    document.getElementById("cycleLength").value = data.cycle.cycleLength;
    renderPredictions(data.cycle);
    renderCalendar(data.cycle);
  }
  document.getElementById("periodReminder").checked = data.reminders?.periodReminder ?? true;
  document.getElementById("ovulationReminder").checked = data.reminders?.ovulationReminder ?? true;
  renderLogs(data);
  renderReminders(data);
}

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim().toLowerCase();
  const password = document.getElementById("password").value;
  const index = getIndex();
  let entry = index[email];

  if (!entry) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    entry = { salt: btoa(String.fromCharCode(...salt)) };
    index[email] = entry;
    setIndex(index);
  }

  try {
    const salt = Uint8Array.from(atob(entry.salt), (c) => c.charCodeAt(0));
    currentKey = await deriveKey(password, salt);
    currentUser = email;

    const existing = await loadEncryptedData(currentUser, currentKey).catch(() => null);
    if (!existing) throw new Error("Invalid email/password for existing account");

    showApp();
    authStatus.textContent = `Logged in as ${email}`;
    await refreshUI();
  } catch {
    authStatus.textContent = "Unable to decrypt data. Check email/password.";
  }
});

cycleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = await loadEncryptedData(currentUser, currentKey);
  data.cycle = {
    lastPeriodStart: document.getElementById("lastPeriodStart").value,
    periodLength: Number(document.getElementById("periodLength").value),
    cycleLength: Number(document.getElementById("cycleLength").value),
  };
  await saveEncryptedData(currentUser, currentKey, data);
  renderPredictions(data.cycle);
  renderCalendar(data.cycle);
  renderReminders(data);
});

logForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = await loadEncryptedData(currentUser, currentKey);
  data.logs = data.logs || {};
  data.logs[document.getElementById("logDate").value] = {
    mood: document.getElementById("mood").value,
    symptoms: document.getElementById("symptoms").value,
    flow: document.getElementById("flow").value,
    notes: document.getElementById("notes").value,
  };
  await saveEncryptedData(currentUser, currentKey, data);
  logForm.reset();
  renderLogs(data);
});

reminderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = await loadEncryptedData(currentUser, currentKey);
  data.reminders = {
    periodReminder: document.getElementById("periodReminder").checked,
    ovulationReminder: document.getElementById("ovulationReminder").checked,
  };
  await saveEncryptedData(currentUser, currentKey, data);
  renderReminders(data);
});

logoutBtn.addEventListener("click", () => {
  currentUser = null;
  currentKey = null;
  hideApp();
  authStatus.textContent = "Logged out.";
});

hideApp();
