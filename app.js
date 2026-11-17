// app.js — 画面制御。データには store.js 経由でのみ触れる。
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const ACTIVE_KEY = 'familyMemo.activeList'; // 端末ごとの表示状態（共有データではない）

let lists = [];
let items = [];
let activeId = null;
let unsubItems = null;

// ---------- モーダル ----------
function openSheet({ title, message, input, actions, dismissible = true }) {
  return new Promise((resolve) => {
    const root = $('modal-root');
    const ov = document.createElement('div');
    ov.className = 'overlay';
    const sh = document.createElement('div');
    sh.className = 'sheet';
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-modal', 'true');

    const h = document.createElement('h2');
    h.textContent = title;
    sh.appendChild(h);
    if (message) {
      const p = document.createElement('p');
      p.textContent = message;
      sh.appendChild(p);
    }
    let inputEl = null;
    if (input) {
      inputEl = document.createElement('input');
      inputEl.className = 'in';
      inputEl.type = 'text';
      inputEl.value = input.value || '';
      inputEl.placeholder = input.placeholder || '';
      inputEl.maxLength = input.maxLength || 40;
      sh.appendChild(inputEl);
    }

    const close = (value) => {
      ov.remove();
      resolve(value);
    };
    const btns = [];
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.kind || '');
      b.textContent = a.label;
      b.addEventListener('click', () => close({ value: a.value, text: inputEl ? inputEl.value.trim() : '' }));
      sh.appendChild(b);
      btns.push([a, b]);
    });
    // 入力必須のとき、空欄の間は決定ボタンを無効化
    if (inputEl && input.required) {
      const sync = () => btns.forEach(([a, b]) => { if (a.needsText) b.disabled = !inputEl.value.trim(); });
      inputEl.addEventListener('input', sync);
      sync();
    }
    if (inputEl) {
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const ok = btns.find(([a, b]) => a.needsText && !b.disabled);
          if (ok) ok[1].click();
        }
      });
    }
    if (dismissible) ov.addEventListener('click', (e) => { if (e.target === ov) close(null); });

    ov.appendChild(sh);
    root.appendChild(ov);
    if (inputEl) inputEl.focus();
  });
}

async function askText({ title, message, value, placeholder, okLabel = '決定', dismissible = true }) {
  const r = await openSheet({
    title, message, dismissible,
    input: { value, placeholder, required: true },
    actions: [
      { label: okLabel, value: 'ok', kind: 'primary', needsText: true },
      ...(dismissible ? [{ label: 'キャンセル', value: 'cancel', kind: 'plain' }] : []),
    ],
  });
  return r && r.value === 'ok' ? r.text : null;
}

async function askConfirm({ title, message, okLabel }) {
  const r = await openSheet({
    title, message,
    actions: [
      { label: okLabel, value: 'ok', kind: 'danger solid' },
      { label: 'キャンセル', value: 'cancel', kind: 'plain' },
    ],
  });
  return !!r && r.value === 'ok';
}

// ---------- 描画 ----------
function renderTabs() {
  const nav = $('tabs');
  nav.textContent = '';
  lists.forEach((l) => {
    const b = document.createElement('button');
    b.className = 'tab' + (l.id === activeId ? ' on' : '');
    b.textContent = l.name;
    b.addEventListener('click', () => selectList(l.id));
    nav.appendChild(b);
  });
  const plus = document.createElement('button');
  plus.className = 'tab';
  plus.textContent = '＋';
  plus.setAttribute('aria-label', 'リストを追加');
  plus.addEventListener('click', onCreateList);
  nav.appendChild(plus);

  const cur = lists.find((l) => l.id === activeId);
  $('list-title').textContent = cur ? cur.name : '家族メモ';
  const on = nav.querySelector('.tab.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

function itemRow(it) {
  const row = document.createElement('div');
  row.className = 'item' + (it.done ? ' done' : '');

  const chkBtn = document.createElement('button');
  chkBtn.className = 'chk-btn';
  chkBtn.setAttribute('role', 'checkbox');
  chkBtn.setAttribute('aria-checked', String(it.done));
  chkBtn.setAttribute('aria-label', it.title);
  const box = document.createElement('span');
  box.className = 'chk';
  box.textContent = it.done ? '✓' : '';
  chkBtn.appendChild(box);
  chkBtn.addEventListener('click', () => store.toggleItem(it.id));

  const body = document.createElement('button');
  body.className = 'body';
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = it.title;
  const m = document.createElement('div');
  m.className = 'm';
  const parts = [];
  if (it.addedBy) parts.push('追加：' + it.addedBy);
  if (it.done && it.checkedBy) parts.push('完了：' + it.checkedBy);
  m.textContent = parts.join(' ・ ');
  body.append(t, m);
  body.addEventListener('click', () => store.toggleItem(it.id));

  const x = document.createElement('button');
  x.className = 'x';
  x.textContent = '✕';
  x.setAttribute('aria-label', it.title + 'を削除');
  x.addEventListener('click', () => store.deleteItem(it.id));

  row.append(chkBtn, body, x);
  return row;
}

function renderItems() {
  const box = $('items');
  box.textContent = '';
  if (!activeId) return;
  const todo = items.filter((i) => !i.done).sort((a, b) => a.createdAt - b.createdAt);
  const done = items.filter((i) => i.done).sort((a, b) => (b.checkedAt || 0) - (a.checkedAt || 0));

  if (!todo.length && !done.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = '項目はまだありません。下の入力欄から追加できます。';
    box.appendChild(e);
    return;
  }
  todo.forEach((it) => box.appendChild(itemRow(it)));

  if (done.length) {
    const sec = document.createElement('div');
    sec.className = 'sec';
    const label = document.createElement('span');
    label.textContent = '完了 ' + done.length;
    const clear = document.createElement('button');
    clear.className = 'clear';
    clear.textContent = '完了を一括削除';
    clear.addEventListener('click', async () => {
      const ok = await askConfirm({
        title: '完了を一括削除',
        message: '完了済みの ' + done.length + ' 件を削除します。元に戻せません。',
        okLabel: '削除する',
      });
      if (ok) store.clearCompleted(activeId);
    });
    sec.append(label, clear);
    box.appendChild(sec);
    done.forEach((it) => box.appendChild(itemRow(it)));
  }
}

// ---------- 操作 ----------
function selectList(id) {
  activeId = id;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* 無視 */ }
  if (unsubItems) unsubItems();
  unsubItems = store.subscribeItems(id, (arr) => { items = arr; renderItems(); });
  renderTabs();
}

async function onCreateList() {
  const name = await askText({ title: '新しいリスト', placeholder: '例：買い物、TODO', okLabel: '作成' });
  if (name) {
    const l = await store.createList(name);
    selectList(l.id);
  }
}

async function onSettings() {
  const cur = lists.find((l) => l.id === activeId);
  const r = await openSheet({
    title: '設定',
    message: '自分の名前：' + (store.getUser() || '未設定'),
    actions: [
      { label: '自分の名前を変更', value: 'user' },
      { label: 'このリストの名前を変更', value: 'rename' },
      { label: 'このリストを削除', value: 'delete', kind: 'danger' },
      { label: '閉じる', value: 'close', kind: 'plain' },
    ],
  });
  if (!r) return;
  if (r.value === 'user') {
    const n = await askText({ title: '自分の名前', value: store.getUser() || '', okLabel: '保存' });
    if (n) await store.setUser(n);
    renderItems();
  } else if (r.value === 'rename' && cur) {
    const n = await askText({ title: 'リスト名の変更', value: cur.name, okLabel: '保存' });
    if (n) store.renameList(cur.id, n);
  } else if (r.value === 'delete' && cur) {
    const ok = await askConfirm({
      title: '「' + cur.name + '」を削除',
      message: 'リストと中の項目をすべて削除します。元に戻せません。',
      okLabel: '削除する',
    });
    if (ok) store.deleteList(cur.id);
  }
}

// ---------- 起動 ----------
async function ensureUser() {
  if (store.getUser()) return;
  const name = await askText({
    title: 'はじめまして',
    message: '家族に表示される自分の名前を入力してください（あとから変更できます）。',
    placeholder: '例：ママ、パパ、たろう',
    okLabel: 'はじめる',
    dismissible: false,
  });
  await store.setUser(name);
}

function init() {
  store.subscribeLists((arr) => {
    lists = arr;
    if (!lists.length) { // 全リスト削除後は空のまま
      activeId = null; items = [];
      if (unsubItems) { unsubItems(); unsubItems = null; }
      renderTabs(); renderItems();
      return;
    }
    if (!lists.some((l) => l.id === activeId)) {
      let saved = null;
      try { saved = localStorage.getItem(ACTIVE_KEY); } catch (e) { /* 無視 */ }
      selectList(lists.some((l) => l.id === saved) ? saved : lists[0].id);
    } else {
      renderTabs();
    }
  });

  $('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('add-input');
    const title = input.value.trim();
    if (!title || !activeId) return;
    input.value = '';
    await store.addItem(activeId, title);
    input.focus(); // 続けて入力できるよう、キーボードを出したままにする
    const box = $('items');
    box.scrollTop = 0;
  });
  $('btn-settings').addEventListener('click', onSettings);

  ensureUser();
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 非対応環境は無視 */ });
  });
}
