// app.js — 画面制御。データには store.js 経由でのみ触れる。
import { categoriesOf, categoryIdOf, groupByCategory, OTHER_NAME } from './categories.js';
import { makeSortable, isDragging, deferUntilDrop } from './sortable.js';

let store; // 起動時に読み込む（通信できないときに画面で知らせるため）

const $ = (id) => document.getElementById(id);
const ACTIVE_KEY = 'familyMemo.activeList'; // 端末ごとの表示状態（共有データではない）

let lists = [];
let items = [];
let activeId = null;
let unsubItems = null;
let unchecked = new Map(); // リストID → 未チェックの件数
let sorting = false; // 並び替えモード

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

// ---------- 部品 ----------
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  if (tag === 'button') e.type = 'button';
  return e;
}

function handle() {
  const h = el('span', 'handle', '≡');
  h.setAttribute('aria-label', 'つまんで並び替え');
  return h;
}

// 中身を自由に組み立てるシート
function makeSheet(title, { tall = false, onClose } = {}) {
  const ov = el('div', 'overlay');
  const sh = el('div', 'sheet' + (tall ? ' tall' : ''));
  sh.setAttribute('role', 'dialog');
  sh.setAttribute('aria-modal', 'true');
  const head = el('div', 'sheet-head');
  head.appendChild(el('h2', '', title));
  sh.appendChild(head);
  ov.appendChild(sh);
  const close = () => { ov.remove(); if (onClose) onClose(); };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  $('modal-root').appendChild(ov);
  return { sh, head, close };
}

function textInput(value, label) {
  const i = el('input', 'in');
  i.type = 'text';
  i.value = value;
  i.maxLength = 200;
  i.setAttribute('aria-label', label);
  return i;
}

// カテゴリの選択ボタン。value() で選択中のID（その他は null）
function categoryPicker(cats, selected) {
  let current = selected;
  const box = el('div', 'chips');
  [...cats, { id: null, name: OTHER_NAME }].forEach((c) => {
    const b = el('button', 'chip' + (c.id === current ? ' on' : ''), c.name);
    b.addEventListener('click', () => {
      current = c.id;
      [...box.children].forEach((x) => x.classList.toggle('on', x === b));
    });
    box.appendChild(b);
  });
  return { box, value: () => current };
}

// ---------- 日付 ----------
const pad = (n) => String(n).padStart(2, '0');
function shortDate(ms) {
  const d = new Date(ms);
  const md = (d.getMonth() + 1) + '/' + d.getDate();
  return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '/' + md;
}
function inputDate(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
// 日付だけ差し替えて、時刻は元のまま
function withDate(ms, value) {
  const [y, m, day] = value.split('-').map(Number);
  const d = new Date(ms);
  d.setFullYear(y, m - 1, day);
  return d.getTime();
}

function dateField(label, ms) {
  const wrap = el('label', 'field');
  wrap.appendChild(el('span', 'f', label));
  const i = el('input', 'in');
  i.type = 'date';
  i.value = ms ? inputDate(ms) : '';
  wrap.appendChild(i);
  const first = i.value;
  // 変更されていれば新しい時刻、そうでなければ null
  return { wrap, changed: () => (i.value && i.value !== first ? withDate(ms || Date.now(), i.value) : null) };
}

// ---------- 項目の編集 ----------
function openItemEditor(it) {
  const cats = categoriesOf(lists.find((l) => l.id === it.listId));
  const { sh, close } = makeSheet('項目を編集');

  const title = textInput(it.title, '内容');
  sh.append(el('span', 'f', '内容'), title);

  let picker = null;
  const firstCat = categoryIdOf(it, cats);
  if (cats.length) {
    picker = categoryPicker(cats, firstCat);
    sh.append(el('span', 'f', 'カテゴリ'), picker.box);
  }
  const created = dateField('追加した日', it.createdAt);
  sh.appendChild(created.wrap);
  const checked = it.done ? dateField('チェックした日', it.checkedAt) : null;
  if (checked) sh.appendChild(checked.wrap);

  const save = el('button', 'btn primary', '保存');
  save.addEventListener('click', () => {
    // 変えた箇所だけを書き込む（他の人の変更を上書きしないように）
    const patch = {};
    const t = title.value.trim();
    if (t && t !== it.title) patch.title = t;
    if (picker && picker.value() !== firstCat) patch.category = picker.value();
    else if (patch.title && it.category === undefined) patch.category = firstCat;
    const c = created.changed();
    if (c) { patch.createdAt = c; patch.order = it.order ?? it.createdAt; } // 並び順は変えない
    const k = checked && checked.changed();
    if (k) { patch.checkedAt = k; patch.doneOrder = it.doneOrder ?? it.checkedAt; }
    if (Object.keys(patch).length) store.updateItem(it.id, patch);
    close();
  });
  const cancel = el('button', 'btn plain', 'キャンセル');
  cancel.addEventListener('click', close);
  sh.append(save, cancel);
}

// ---------- 定番の編集 ----------
function openPresetEditor(p, cats) {
  const { sh, close } = makeSheet('定番を編集');
  const title = textInput(p.title, '名前');
  sh.append(el('span', 'f', '名前'), title);
  let picker = null;
  if (cats.length) {
    picker = categoryPicker(cats, categoryIdOf(p, cats));
    sh.append(el('span', 'f', 'カテゴリ'), picker.box);
  }
  const save = el('button', 'btn primary', '保存');
  save.addEventListener('click', () => {
    const patch = { title: title.value.trim() || p.title };
    if (picker) patch.category = picker.value();
    store.updatePreset(p.id, patch);
    close();
  });
  const cancel = el('button', 'btn plain', 'キャンセル');
  cancel.addEventListener('click', close);
  sh.append(save, cancel);
}

// ---------- カテゴリの編集 ----------
let categoryView = null;

function openCategories(listId) {
  const { sh, close } = makeSheet('カテゴリの編集', { tall: true, onClose: () => { categoryView = null; } });
  sh.appendChild(el('p', '', '名前をタップで変更、≡ で並び替え。「その他」は常に最後に表示します。'));
  const box = el('div', 'plist');
  const form = el('form', 'padd');
  const input = textInput('', 'カテゴリを追加');
  input.placeholder = 'カテゴリを追加…';
  input.maxLength = 20;
  const add = el('button', 'add', '＋');
  add.type = 'submit';
  add.setAttribute('aria-label', 'カテゴリを追加');
  form.append(input, add);
  const done = el('button', 'btn plain', '閉じる');
  done.addEventListener('click', close);
  sh.append(box, form, done);

  const current = () => categoriesOf(lists.find((l) => l.id === listId));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    input.value = '';
    store.setCategories(listId, [...current(), { id: 'c' + Date.now().toString(36), name }]);
  });

  function render() {
    if (isDragging()) { deferUntilDrop(render); return; }
    box.textContent = '';
    const group = el('div');
    current().forEach((c) => {
      const row = el('div', 'prow');
      row.dataset.id = c.id;
      const name = el('button', 'pt', c.name);
      name.addEventListener('click', async () => {
        const n = await askText({ title: 'カテゴリ名の変更', value: c.name, okLabel: '保存' });
        if (n) store.setCategories(listId, current().map((x) => (x.id === c.id ? { ...x, name: n } : x)));
      });
      const x = el('button', 'px', '✕');
      x.setAttribute('aria-label', c.name + 'を削除');
      x.addEventListener('click', async () => {
        const ok = await askConfirm({
          title: '「' + c.name + '」を削除',
          message: 'このカテゴリの項目と定番は「その他」になります。',
          okLabel: '削除する',
        });
        if (ok) store.setCategories(listId, current().filter((y) => y.id !== c.id));
      });
      row.append(name, x, handle());
      group.appendChild(row);
    });
    makeSortable(group, (ids) => {
      const cats = current();
      store.setCategories(listId, ids.map((id) => cats.find((c) => c.id === id)).filter(Boolean));
    });
    box.appendChild(group);
  }
  categoryView = { refresh: render };
  render();
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
  // 追加する定番のカテゴリ
  const cats = categoriesOf(list);
  const addCat = el('select', 'in sel');
  addCat.setAttribute('aria-label', 'カテゴリ');
  [...cats, { id: '', name: OTHER_NAME }].forEach((c) => {
    const o = el('option', '', c.name);
    o.value = c.id || '';
    addCat.appendChild(o);
  });
  addCat.value = '';
  addCat.hidden = !cats.length;
  addRow.append(addCat, addIn, addBtn);
  addRow.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = addIn.value.trim();
    if (!v) return;
    addIn.value = '';
    store.addPreset(listId, v, addCat.value || null);
    addIn.focus();
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn plain';
  closeBtn.textContent = '閉じる';

  sh.append(head, hint, plist, addRow, closeBtn);

  function render() {
    if (isDragging()) { deferUntilDrop(render); return; }
    editBtn.textContent = editing ? '完了' : '編集';
    hint.textContent = editing
      ? '名前をタップで変更、✕で削除、≡ で並び替え。'
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
    groupByCategory(presets, cats).forEach((g) => {
      if (g.name) plist.appendChild(el('div', 'cat', g.name));
      const group = el('div');
      g.entries.forEach((p) => {
        if (editing) {
          const row = el('div', 'prow');
          row.dataset.id = p.id;
          const t = el('button', 'pt', p.title);
          t.addEventListener('click', () => openPresetEditor(p, cats));
          const x = el('button', 'px', '✕');
          x.setAttribute('aria-label', p.title + 'を定番から削除');
          x.addEventListener('click', () => store.deletePreset(p.id));
          row.append(t, x, handle());
          group.appendChild(row);
        } else {
          const added = pending.has(p.title);
          const row = el('button', 'prow' + (added ? ' added' : ''));
          row.append(el('span', 'pt', p.title), el('span', 'pa', added ? '追加済み' : '＋'));
          row.disabled = added;
          row.addEventListener('click', () => store.addItem(listId, p.title, categoryIdOf(p, cats)));
          group.appendChild(row);
        }
      });
      if (editing) makeSortable(group, (ids) => store.reorder('presets', ids));
      plist.appendChild(group);
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
  const scroll = nav.scrollTop;
  nav.textContent = '';
  lists.forEach((l) => {
    const b = document.createElement('button');
    b.className = 'tab' + (l.id === activeId ? ' on' : '');
    b.appendChild(el('span', 'tab-name', l.name));
    const n = unchecked.get(l.id);
    if (n) {
      b.appendChild(el('span', 'badge', n > 99 ? '99+' : String(n)));
      b.setAttribute('aria-label', l.name + '、未チェック' + n + '件');
    }
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
  nav.scrollTop = scroll;
  // 4段目以降にある選択中のタブは見える位置へ
  const on = nav.querySelector('.tab.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}

function itemRow(it) {
  const row = el('div', 'item' + (it.done ? ' done' : ''));

  const chkBtn = el('button', 'chk-btn');
  chkBtn.setAttribute('role', 'checkbox');
  chkBtn.setAttribute('aria-checked', String(it.done));
  chkBtn.setAttribute('aria-label', it.title);
  chkBtn.appendChild(el('span', 'chk', it.done ? '✓' : ''));
  chkBtn.addEventListener('click', () => store.toggleItem(it.id));

  const body = el('button', 'body');
  const added = [shortDate(it.createdAt), it.addedBy].filter(Boolean).join(' ');
  const meta = it.done
    ? '追加 ' + added + (it.checkedAt ? ' ・ 完了 ' + [shortDate(it.checkedAt), it.checkedBy].filter(Boolean).join(' ') : '')
    : added;
  body.append(el('div', 't', it.title), el('div', 'm', meta));
  body.setAttribute('aria-label', it.title + 'を編集。' + meta);
  body.addEventListener('click', () => openItemEditor(it));

  const x = el('button', 'x', '✕');
  x.setAttribute('aria-label', it.title + 'を削除');
  x.addEventListener('click', () => store.deleteItem(it.id));

  row.append(chkBtn, body, x);
  return row;
}

function sortRow(id, text) {
  const row = el('div', 'item');
  row.dataset.id = id;
  row.append(el('div', 'body', text), handle());
  return row;
}

// 並び替えモード：リストの順番と、未完了の項目（カテゴリの中で移動）
function renderSorting(box, todo, cats) {
  box.appendChild(el('p', 'note', '≡ をつまんで上下に動かします。'));
  box.appendChild(el('div', 'cat', 'リストの順番'));
  const listGroup = el('div');
  lists.forEach((l) => listGroup.appendChild(sortRow(l.id, l.name)));
  makeSortable(listGroup, (ids) => store.reorder('lists', ids));
  box.appendChild(listGroup);

  groupByCategory(todo, cats).forEach((g) => {
    box.appendChild(el('div', 'cat', g.name || '項目'));
    const group = el('div');
    g.entries.forEach((it) => group.appendChild(sortRow(it.id, it.title)));
    makeSortable(group, (ids) => store.reorder('items', ids));
    box.appendChild(group);
  });
}

function renderItems() {
  if (presetView) presetView.refresh(); // 定番シートの「追加済み」表示を更新
  if (isDragging()) { deferUntilDrop(renderItems); return; }
  const box = $('items');
  const scroll = box.scrollTop;
  box.textContent = '';
  $('btn-sort').textContent = sorting ? '完了' : '並び替え';
  $('btn-sort').hidden = !activeId;
  $('add-form').hidden = sorting;
  if (!activeId) return;

  const cats = categoriesOf(lists.find((l) => l.id === activeId));
  const todo = items.filter((i) => !i.done); // store 側で並び順どおり
  const done = items.filter((i) => i.done)
    .sort((a, b) => (b.doneOrder ?? b.checkedAt ?? 0) - (a.doneOrder ?? a.checkedAt ?? 0));

  if (sorting) {
    renderSorting(box, todo, cats);
    box.scrollTop = scroll;
    return;
  }
  if (!todo.length && !done.length) {
    box.appendChild(el('div', 'empty', '項目はまだありません。下の入力欄から追加できます。'));
    return;
  }
  groupByCategory(todo, cats).forEach((g) => {
    if (g.name) {
      const h = el('div', 'cat');
      h.append(el('span', '', g.name), el('span', '', String(g.entries.length)));
      box.appendChild(h);
    }
    g.entries.forEach((it) => box.appendChild(itemRow(it)));
  });

  if (done.length) {
    const sec = el('div', 'sec');
    const clear = el('button', 'clear', '完了を一括削除');
    clear.addEventListener('click', async () => {
      const ok = await askConfirm({
        title: '完了を一括削除',
        message: '完了済みの ' + done.length + ' 件を削除します。元に戻せません。',
        okLabel: '削除する',
      });
      if (ok) store.clearCompleted(activeId);
    });
    sec.append(el('span', '', '完了 ' + done.length), clear);
    box.appendChild(sec);
    done.forEach((it) => box.appendChild(itemRow(it)));
  }
  box.scrollTop = scroll;
}

// ---------- 操作 ----------
function selectList(id) {
  activeId = id;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* 無視 */ }
  if (unsubItems) unsubItems();
  items = [];
  renderTabs();
  unsubItems = store.subscribeItems(id, (arr) => { items = arr; renderItems(); });
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
      { label: 'このリストのカテゴリを編集', value: 'cats' },
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
    if (n) store.renameList(cur, n);
  } else if (r.value === 'cats' && cur) {
    openCategories(cur.id);
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
      renderItems();
    }
    if (categoryView) categoryView.refresh();
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
  store.subscribeAllItems((arr) => {
    unchecked = new Map();
    arr.filter((i) => !i.done).forEach((i) => unchecked.set(i.listId, (unchecked.get(i.listId) || 0) + 1));
    renderTabs();
  });
  $('btn-settings').addEventListener('click', onSettings);
  $('btn-presets').addEventListener('click', openPresets);
  $('btn-sort').addEventListener('click', () => { sorting = !sorting; $('items').scrollTop = 0; renderItems(); });
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 非対応環境は無視 */ });
  });
}
