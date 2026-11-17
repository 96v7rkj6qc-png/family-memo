// store.js — データの読み書きはこのモジュールだけで行う。
// Step 2 では、このファイルの中身を Firestore 版に差し替える（公開関数の形は変えない）。
// 公開関数はすべて async / subscribe 形式にしてある。

const DATA_KEY = 'familyMemo.data.v1';
const USER_KEY = 'familyMemo.user';

const listeners = new Set();
let data; // 下の load() 定義のあとで初期化する（サンプル定数より後にするため）

// ---------- 内部 ----------
function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// サンプル定番（リスト名に「日用品」を含むなら日用品、それ以外はスーパー用）
const SAMPLE_SUPER = ['牛乳', '卵', '食パン', 'ヨーグルト', '納豆', '豆腐', 'バナナ', '玉ねぎ', 'じゃがいも', '鶏肉', '豚肉', 'お米'];
const SAMPLE_DAILY = ['トイレットペーパー', 'ティッシュ', '洗濯洗剤', '柔軟剤', '食器用洗剤', 'シャンプー', 'ハンドソープ', '歯磨き粉', 'ゴミ袋', 'キッチンペーパー', 'ラップ', 'スポンジ'];

function samplesFor(listName) {
  return /日用品/.test(listName) ? SAMPLE_DAILY : SAMPLE_SUPER;
}

function makePresets(listId, titles, base) {
  return titles.map((title, i) => ({ id: uid(), listId, title, createdAt: base + i }));
}

function seed() {
  const now = Date.now();
  const superList = { id: uid(), name: 'スーパー', createdAt: now };
  const dailyList = { id: uid(), name: '日用品', createdAt: now + 1 };
  const d = {
    lists: [superList, dailyList],
    items: [],
    presets: [
      ...makePresets(superList.id, SAMPLE_SUPER, now),
      ...makePresets(dailyList.id, SAMPLE_DAILY, now),
    ],
  };
  try { localStorage.setItem(DATA_KEY, JSON.stringify(d)); } catch (e) { /* 保存不可でも動かす */ }
  return d;
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(DATA_KEY));
    if (d && Array.isArray(d.lists) && Array.isArray(d.items)) {
      if (!Array.isArray(d.presets)) d.presets = []; // 定番機能の追加前に作られたデータ
      return d;
    }
  } catch (e) { /* 壊れていたら初期化 */ }
  return seed();
}

data = load();

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
  data.presets = data.presets.filter((p) => p.listId !== listId);
  commit();
}

// ---------- 定番（リストごとの、よく買うもの） ----------
export function subscribePresets(listId, cb) {
  return subscribe(
    () => data.presets.filter((p) => p.listId === listId).sort((a, b) => a.createdAt - b.createdAt),
    cb,
  );
}
export async function addPreset(listId, title) {
  const p = { id: uid(), listId, title: title.trim(), createdAt: Date.now() };
  data.presets.push(p);
  commit();
  return p;
}
export async function renamePreset(presetId, title) {
  const p = data.presets.find((x) => x.id === presetId);
  if (p) { p.title = title.trim(); commit(); }
}
export async function deletePreset(presetId) {
  data.presets = data.presets.filter((p) => p.id !== presetId);
  commit();
}
// 定番が空のリストにサンプルを入れる
export async function addSamplePresets(listId) {
  const l = data.lists.find((x) => x.id === listId);
  if (!l) return;
  data.presets.push(...makePresets(listId, samplesFor(l.name), Date.now()));
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
