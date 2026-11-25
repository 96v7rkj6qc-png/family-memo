// categories.js — カテゴリの定義と振り分け。
// 「その他」は保存せず、カテゴリが無い（または削除された）項目の行き先として常に最後に出す。

const SUPER = [
  { id: 'meat', name: '肉' }, { id: 'fish', name: '魚' }, { id: 'veg', name: '野菜・果物' },
  { id: 'dairy', name: '乳製品・卵' }, { id: 'drink', name: '飲み物' }, { id: 'season', name: '調味料' },
];
const DAILY = [
  { id: 'laundry', name: '洗濯' }, { id: 'clean', name: '掃除' },
  { id: 'kitchen', name: 'キッチン' }, { id: 'bath', name: 'お風呂・衛生' },
];

export const OTHER_NAME = 'その他';

// 保存されていないリストは、名前から初期カテゴリを決める
export function categoriesOf(list) {
  if (!list) return [];
  if (Array.isArray(list.categories)) return list.categories;
  if (/日用品/.test(list.name)) return DAILY;
  if (/スーパー|買い物|食/.test(list.name)) return SUPER;
  return [];
}

// カテゴリ機能より前に作られた項目・定番は、サンプルの名前から推定する
const GUESS = {
  牛乳: 'dairy', 卵: 'dairy', ヨーグルト: 'dairy', バナナ: 'veg', 玉ねぎ: 'veg', じゃがいも: 'veg',
  鶏肉: 'meat', 豚肉: 'meat',
  洗濯洗剤: 'laundry', 柔軟剤: 'laundry', 食器用洗剤: 'kitchen', キッチンペーパー: 'kitchen',
  ラップ: 'kitchen', スポンジ: 'kitchen', ゴミ袋: 'clean', トイレットペーパー: 'bath',
  ティッシュ: 'bath', シャンプー: 'bath', ハンドソープ: 'bath', 歯磨き粉: 'bath',
};

export function guessCategory(title) {
  return GUESS[title] || null;
}

// 戻り値はカテゴリID。「その他」は null
export function categoryIdOf(entry, cats) {
  const id = entry.category === undefined ? guessCategory(entry.title) : entry.category;
  return cats.some((c) => c.id === id) ? id : null;
}

// [{ id, name, entries }]。カテゴリが無いリストは見出しなし（name: null）の1組
export function groupByCategory(entries, cats) {
  if (!cats.length) return entries.length ? [{ id: null, name: null, entries }] : [];
  return [...cats, { id: null, name: OTHER_NAME }]
    .map((c) => ({ id: c.id, name: c.name, entries: entries.filter((e) => categoryIdOf(e, cats) === c.id) }))
    .filter((g) => g.entries.length);
}
