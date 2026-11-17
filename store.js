// store.js — データの読み書きはこのモジュールだけで行う。
// Step 2 では、このファイルの中身を Firestore 版に差し替える（公開関数の形は変えない）。
// 公開関数はすべて async / subscribe 形式にしてある。

const DATA_KEY = 'familyMemo.data.v1';
const USER_KEY = 'familyMemo.user';

const listeners = new Set();
let data = load();

// ---------- 内部 ----------
function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function seed() {
  const now = Date.now();
  const d = {
    lists: [
      { id: uid(), name: '買い物', createdAt: now },
      { id: uid(), name: 'TODO', createdAt: now + 1 },
    ],
    items: [],
  };
  try { localStorage.setItem(DATA_KEY, JSON.stringify(d)); } catch (e) { /* 保存不可でも動かす */ }
  return d;
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(DATA_KEY));
    if (d && Array.isArray(d.lists) && Array.isArray(d.items)) return d;
  } catch (e) { /* 壊れていたら初期化 */ }
  return seed();
}

function commit() {
  try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) { console.error(e); }
  listeners.forEach((fn) => fn());
}

// 別タブ・別ウィンドウでの変更も反映
window.addEventListener('storage', (e) => {
  if (e.key === DATA_KEY) {
    data = load();
    listeners.forEach((fn) => fn());
  }
});

function subscribe(snapshotFn, cb) {
  const run = () => cb(snapshotFn());
  listeners.add(run);
  run();
  return () => listeners.delete(run);
}

// ---------- ユーザー名 ----------
export function getUser() {
  try { return localStorage.getItem(USER_KEY) || null; } catch (e) { return null; }
}
export async function setUser(name) {
  localStorage.setItem(USER_KEY, name.trim());
}

// ---------- リスト ----------
export function subscribeLists(cb) {
  return subscribe(
    () => data.lists.slice().sort((a, b) => a.createdAt - b.createdAt),
    cb,
  );
}
export async function createList(name) {
  const list = { id: uid(), name: name.trim(), createdAt: Date.now() };
  data.lists.push(list);
  commit();
  return list;
}
export async function renameList(listId, name) {
  const l = data.lists.find((x) => x.id === listId);
  if (l) { l.name = name.trim(); commit(); }
}
export async function deleteList(listId) {
  data.lists = data.lists.filter((l) => l.id !== listId);
  data.items = data.items.filter((i) => i.listId !== listId);
  commit();
}

// ---------- 項目 ----------
export function subscribeItems(listId, cb) {
  return subscribe(() => data.items.filter((i) => i.listId === listId), cb);
}
export async function addItem(listId, title) {
  const item = {
    id: uid(),
    listId,
    title: title.trim(),
    done: false,
    addedBy: getUser() || '',
    checkedBy: null,
    createdAt: Date.now(),
    checkedAt: null,
  };
  data.items.push(item);
  commit();
  return item;
}
export async function toggleItem(itemId) {
  const it = data.items.find((i) => i.id === itemId);
  if (!it) return;
  it.done = !it.done;
  it.checkedBy = it.done ? (getUser() || '') : null;
  it.checkedAt = it.done ? Date.now() : null;
  commit();
}
export async function deleteItem(itemId) {
  data.items = data.items.filter((i) => i.id !== itemId);
  commit();
}
export async function clearCompleted(listId) {
  data.items = data.items.filter((i) => !(i.listId === listId && i.done));
  commit();
}
