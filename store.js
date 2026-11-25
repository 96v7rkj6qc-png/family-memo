// store.js — データの読み書きはこのモジュールだけで行う（Firestore 版）。
// 起動時に init() → 未登録なら join(合言葉) → start() の順で呼ぶ。
// 書き込みはサーバーの応答を待たずに返す（画面には手元の反映がすぐ出る）。

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, writeBatch, runTransaction,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { categoriesOf, guessCategory } from './categories.js';

const USER_KEY = 'familyMemo.user';
const ROOT = ['family', 'main'];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const col = (name) => collection(db, ...ROOT, name);
const ref = (name, id) => doc(db, ...ROOT, name, id);

let errorHandler = () => {};
const report = (e) => { console.error(e); errorHandler(e); };
const send = (promise) => { promise.catch(report); };

export function onError(fn) { errorHandler = fn; }

// ---------- 認証と合言葉 ----------
// 戻り値: true = 登録済み / false = 合言葉の入力が必要。通信できないときは例外。
export async function init() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  try {
    const snap = await getDoc(ref('members', auth.currentUser.uid));
    return snap.exists();
  } catch (e) {
    if (e.code === 'permission-denied') return false; // 合言葉が変更された
    throw e;
  }
}

// 戻り値: true = 登録できた / false = 合言葉が違う
export async function join(code) {
  try {
    await setDoc(ref('members', auth.currentUser.uid), { code: code.trim(), joinedAt: Date.now() });
    return true;
  } catch (e) {
    if (e.code === 'permission-denied') return false;
    throw e;
  }
}

// ---------- 初期データ ----------
// サンプル定番（リスト名に「日用品」を含むなら日用品、それ以外はスーパー用）
const SAMPLE_SUPER = ['牛乳', '卵', '食パン', 'ヨーグルト', '納豆', '豆腐', 'バナナ', '玉ねぎ', 'じゃがいも', '鶏肉', '豚肉', 'お米'];
const SAMPLE_DAILY = ['トイレットペーパー', 'ティッシュ', '洗濯洗剤', '柔軟剤', '食器用洗剤', 'シャンプー', 'ハンドソープ', '歯磨き粉', 'ゴミ袋', 'キッチンペーパー', 'ラップ', 'スポンジ'];

// 家族で最初の1回だけ、スーパー・日用品とサンプル定番を作る
export async function start() {
  const seedRef = ref('meta', 'seed');
  await runTransaction(db, async (tx) => {
    if ((await tx.get(seedRef)).exists()) return;
    const now = Date.now();
    [['super', 'スーパー', SAMPLE_SUPER], ['daily', '日用品', SAMPLE_DAILY]].forEach(([id, name, samples], n) => {
      tx.set(ref('lists', id), { name, createdAt: now + n, categories: categoriesOf({ name }) });
      samples.forEach((title, i) => {
        tx.set(ref('presets', id + '-' + i), { listId: id, title, category: guessCategory(title), createdAt: now + i });
      });
    });
    tx.set(seedRef, { createdAt: now });
  });
}

// ---------- 内部 ----------
const toArray = (snap) => snap.docs
  .map((d) => ({ ...d.data(), id: d.id }))
  .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));

function subscribe(target, cb) {
  return onSnapshot(target, (snap) => cb(toArray(snap)), report);
}

// 500件の上限があるので分割して削除
async function deleteRefs(refs) {
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

const itemCache = new Map(); // 購読中の項目（チェック切り替えと一括削除に使う）

// ---------- ユーザー名（端末ごと） ----------
export function getUser() {
  try { return localStorage.getItem(USER_KEY) || null; } catch (e) { return null; }
}
export async function setUser(name) {
  localStorage.setItem(USER_KEY, name.trim());
}

// ---------- リスト ----------
export function subscribeLists(cb) {
  return subscribe(col('lists'), cb);
}
export async function createList(name) {
  const r = doc(col('lists'));
  const list = { name: name.trim(), createdAt: Date.now(), categories: categoriesOf({ name: name.trim() }) };
  send(setDoc(r, list));
  return { ...list, id: r.id };
}
// list を渡すのは、名前を変えても今のカテゴリが変わらないようにするため
export async function renameList(list, name) {
  send(updateDoc(ref('lists', list.id), { name: name.trim(), categories: categoriesOf(list) }));
}
export async function setCategories(listId, categories) {
  send(updateDoc(ref('lists', listId), { categories }));
}

// ---------- 並び替え ----------
// kind: 'lists' | 'items' | 'presets'。ids の順に order を振る（新しく追加した分は末尾に並ぶ）
export async function reorder(kind, ids) {
  const batch = writeBatch(db);
  ids.forEach((id, i) => batch.update(ref(kind, id), { order: i }));
  send(batch.commit());
}
export async function deleteList(listId) {
  send((async () => {
    const [items, presets] = await Promise.all(
      ['items', 'presets'].map((n) => getDocs(query(col(n), where('listId', '==', listId)))),
    );
    await deleteRefs([...items.docs, ...presets.docs].map((d) => d.ref).concat(ref('lists', listId)));
  })());
}

// ---------- 定番（リストごとの、よく買うもの） ----------
export function subscribePresets(listId, cb) {
  return subscribe(query(col('presets'), where('listId', '==', listId)), cb);
}
export async function addPreset(listId, title, category = null) {
  send(setDoc(doc(col('presets')), { listId, title: title.trim(), category, createdAt: Date.now() }));
}
export async function updatePreset(presetId, patch) {
  send(updateDoc(ref('presets', presetId), patch));
}
export async function deletePreset(presetId) {
  send(deleteDoc(ref('presets', presetId)));
}
// 定番が空のリストにサンプルを入れる（固定IDなので、2台で同時に押しても重複しない）
export async function addSamplePresets(listId) {
  send((async () => {
    const list = await getDoc(ref('lists', listId));
    if (!list.exists()) return;
    const samples = /日用品/.test(list.data().name) ? SAMPLE_DAILY : SAMPLE_SUPER;
    const now = Date.now();
    const batch = writeBatch(db);
    samples.forEach((title, i) => {
      batch.set(ref('presets', listId + '-' + i), { listId, title, category: guessCategory(title), createdAt: now + i });
    });
    await batch.commit();
  })());
}

// ---------- 項目 ----------
export function subscribeItems(listId, cb) {
  itemCache.clear();
  return subscribe(query(col('items'), where('listId', '==', listId)), (arr) => {
    itemCache.clear();
    arr.forEach((i) => itemCache.set(i.id, i));
    cb(arr);
  });
}
export async function addItem(listId, title, category = null) {
  send(setDoc(doc(col('items')), {
    listId,
    title: title.trim(),
    category,
    done: false,
    addedBy: getUser() || '',
    checkedBy: null,
    createdAt: Date.now(),
    checkedAt: null,
  }));
}
export async function toggleItem(itemId) {
  const it = itemCache.get(itemId);
  if (!it) return;
  const done = !it.done;
  send(updateDoc(ref('items', itemId), {
    done,
    checkedBy: done ? (getUser() || '') : null,
    checkedAt: done ? Date.now() : null,
    doneOrder: null,
  }));
}
export async function updateItem(itemId, patch) {
  send(updateDoc(ref('items', itemId), patch));
}
export async function deleteItem(itemId) {
  send(deleteDoc(ref('items', itemId)));
}
export async function clearCompleted(listId) {
  const refs = [...itemCache.values()]
    .filter((i) => i.listId === listId && i.done)
    .map((i) => ref('items', i.id));
  send(deleteRefs(refs));
}
