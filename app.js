// app.js — 画面制御。データには store.js 経由でのみ触れる。
let store; // 起動時に読み込む（通信できないときに画面で知らせるため）

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
      if (input.raw) { // 合言葉用：自動大文字化や自動修正をしない
        inputEl.setAttribute('autocapitalize', 'off');
        inputEl.setAttribute('autocorrect', 'off');
        inputEl.autocomplete = 'off';
        inputEl.spellcheck = false;
      }
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

// ---------- 定番シート ----------
let presetView = null; // 開いている間だけ { refresh }

function openPresets() {
  const list = lists.find((l) => l.id === activeId);
  if (!list) return;
  const listId = list.id;
  let presets = [];
  let editing = false;

  const ov = document.createElement('div');
  ov.className = 'overlay';
  const sh = document.createElement('div');
  sh.className = 'sheet tall';
  sh.setAttribute('role', 'dialog');
  sh.setAttribute('aria-modal', 'true');
  ov.appendChild(sh);

  const head = document.createElement('div');
  head.className = 'sheet-head';
  const h = document.createElement('h2');
  h.textContent = '定番：' + list.name;
  const editBtn = document.createElement('button');
  editBtn.className = 'btn';
  head.append(h, editBtn);

  const hint = document.createElement('p');
  const plist = document.createElement('div');
  plist.className = 'plist';

  const addRow = document.createElement('form');
  addRow.className = 'padd';
  addRow.autocomplete = 'off';
  const addIn = document.createElement('input');
  addIn.className = 'in';
  addIn.type = 'text';
  addIn.placeholder = '定番を追加…';
  addIn.maxLength = 100;
  addIn.setAttribute('aria-label', '定番を追加');
  const addBtn = document.createElement('button');
  addBtn.className = 'add';
  addBtn.type = 'submit';
  addBtn.textContent = '＋';
  addBtn.setAttribute('aria-label', '定番に追加');
  addRow.append(addIn, addBtn);
  addRow.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = addIn.value.trim();
    if (!v) return;
    addIn.value = '';
    store.addPreset(listId, v);
    addIn.focus();
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn plain';
  closeBtn.textContent = '閉じる';

  sh.append(head, hint, plist, addRow, closeBtn);

  function render() {
    editBtn.textContent = editing ? '完了' : '編集';
    hint.textContent = editing
      ? '名前をタップで変更、✕で削除できます。'
      : 'タップするとリストに追加されます。';
    addRow.hidden = !editing;
    plist.textContent = '';
    if (!presets.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = '定番はまだありません。';
      plist.appendChild(e);
      const s = document.createElement('button');
      s.className = 'btn primary';
      s.style.width = '100%';
      s.textContent = 'サンプル定番を入れる';
      s.addEventListener('click', () => store.addSamplePresets(listId));
      plist.appendChild(s);
      return;
    }
    const pending = new Set(items.filter((i) => !i.done).map((i) => i.title));
    presets.forEach((p) => {
      if (editing) {
        const row = document.createElement('div');
        row.className = 'prow';
        const t = document.createElement('button');
        t.className = 'pt';
        t.style.textAlign = 'left';
        t.style.minHeight = '44px';
        t.textContent = p.title;
        t.addEventListener('click', async () => {
          const n = await askText({ title: '定番の名前を変更', value: p.title, okLabel: '保存' });
          if (n) store.renamePreset(p.id, n);
        });
        const x = document.createElement('button');
        x.className = 'px';
        x.textContent = '✕';
        x.setAttribute('aria-label', p.title + 'を定番から削除');
        x.addEventListener('click', () => store.deletePreset(p.id));
        row.append(t, x);
        plist.appendChild(row);
      } else {
        const added = pending.has(p.title);
        const row = document.createElement('button');
        row.className = 'prow' + (added ? ' added' : '');
        row.style.minHeight = '52px';
        const t = document.createElement('span');
        t.className = 'pt';
        t.textContent = p.title;
        const a = document.createElement('span');
        a.className = 'pa';
        a.textContent = added ? '追加済み' : '＋';
        row.append(t, a);
        row.disabled = added;
        row.addEventListener('click', () => store.addItem(listId, p.title));
        plist.appendChild(row);
      }
    });
  }

  const unsub = store.subscribePresets(listId, (arr) => { presets = arr; render(); });
  const close = () => {
    unsub();
    presetView = null;
    ov.remove();
  };
  presetView = { refresh: render };
  editBtn.addEventListener('click', () => { editing = !editing; render(); if (editing) addIn.focus(); });
  closeBtn.addEventListener('click', close);
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });

  $('modal-root').appendChild(ov);
  render();
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
  if (presetView) presetView.refresh(); // 定番シートの「追加済み」表示を更新
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
function showStatus(text) {
  const box = $('items');
  box.textContent = '';
  const e = document.createElement('div');
  e.className = 'empty';
  e.textContent = text;
  box.appendChild(e);
}

// 通信エラーなどで先へ進めないとき
async function retrySheet(title, message) {
  await openSheet({
    title, message, dismissible: false,
    actions: [{ label: 'もう一度試す', value: 'retry', kind: 'primary' }],
  });
  location.reload();
}

async function ensureMember() {
  if (await store.init()) return;
  let message = '家族で決めた合言葉を入力してください。';
  for (;;) {
    const r = await openSheet({
      title: '合言葉', message, dismissible: false,
      input: { placeholder: '合言葉', required: true, raw: true, maxLength: 100 },
      actions: [{ label: '確認', value: 'ok', kind: 'primary', needsText: true }],
    });
    showStatus('確認しています…');
    if (await store.join(r.text)) return;
    message = '合言葉が違います。もう一度入力してください。';
  }
}

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

let errorShown = false;
function handleStoreError(e) {
  if (errorShown) return;
  errorShown = true;
  if (e.code === 'permission-denied') {
    retrySheet('アクセスできません', '合言葉が変更された可能性があります。もう一度確認します。');
  } else {
    retrySheet('通信エラー', '保存や読み込みに失敗しました。電波の状態を確認してください。');
  }
}

function watchLists() {
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
}

async function init() {
  let ready = false;
  // 準備ができる前に送信しても、ページが再読み込みされないようにする
  $('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('add-input');
    const title = input.value.trim();
    if (!ready || !title || !activeId) return;
    input.value = '';
    await store.addItem(activeId, title);
    input.focus(); // 続けて入力できるよう、キーボードを出したままにする
    $('items').scrollTop = 0;
  });

  showStatus('接続しています…');
  try {
    store = await import('./store.js');
    store.onError(handleStoreError);
    await ensureMember();
    await ensureUser();
    showStatus('読み込んでいます…');
    await store.start();
  } catch (e) {
    console.error(e);
    showStatus('接続できませんでした。');
    retrySheet('接続できません', '電波の状態を確認して、もう一度試してください。');
    return;
  }
  ready = true;
  watchLists();
  $('btn-settings').addEventListener('click', onSettings);
  $('btn-presets').addEventListener('click', openPresets);
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 非対応環境は無視 */ });
  });
}
