// sortable.js — ≡ をつまんで上下に並び替える（指・マウス共通）。
// 同じ group 要素の中でだけ動く。行には data-id、つまみには .handle を付ける。

let active = false;
const afterDrag = new Set();

export const isDragging = () => active;
// ドラッグ中に届いた再描画は、指を離したあとに実行する
export function deferUntilDrop(fn) { afterDrag.add(fn); }

export function makeSortable(group, onDrop) {
  group.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle || active) return;
    const row = handle.closest('[data-id]');
    if (!row || row.parentElement !== group) return;
    e.preventDefault();
    active = true;
    row.classList.add('dragging');
    const scroller = group.closest('.list, .plist, .scroll');
    const before = ids(group);

    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const y = ev.clientY;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (y < r.top + 40) scroller.scrollTop -= 12;
        else if (y > r.bottom - 40) scroller.scrollTop += 12;
      }
      // つまんでいる行は動かさず、隣の行を反対側へ移す（指の追跡が切れないように）
      for (let prev = row.previousElementSibling; prev; prev = row.previousElementSibling) {
        const r = prev.getBoundingClientRect();
        if (y >= r.top + r.height / 2) break;
        group.insertBefore(prev, row.nextSibling);
      }
      for (let next = row.nextElementSibling; next; next = row.nextElementSibling) {
        const r = next.getBoundingClientRect();
        if (y <= r.top + r.height / 2) break;
        group.insertBefore(next, row);
      }
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      active = false;
      const after = ids(group);
      if (after.join() !== before.join()) onDrop(after);
      const fns = [...afterDrag];
      afterDrag.clear();
      fns.forEach((fn) => fn());
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

const ids = (group) => [...group.children].map((c) => c.dataset.id).filter(Boolean);
