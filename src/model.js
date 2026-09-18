export const fields = ['word', 'reading', 'meaning', 'example', 'note'];
export function cleanWord(item) {
  if (!item || typeof item !== 'object') throw new Error('词条格式不正确');
  const row = Object.fromEntries(fields.map(key => [key, String(item[key] ?? '').trim()]));
  if (!row.word || row.word.length > 200 || row.reading.length > 300 || fields.slice(2).some(key => row[key].length > 8000)) throw new Error('词条为空或长度超出限制');
  const timestamp = item.created_at ?? item.createdAt;
  const date = timestamp == null ? new Date() : new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error('词条添加时间不正确');
  return { ...row, created_at: date.toISOString() };
}
export function parseText(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [word, second = '', ...rest] = line.split(/\s+/u);
    const isReading = /^[ぁ-ゖァ-ヺー・]+$/u.test(second);
    return cleanWord({ word, reading: isReading ? second : '', meaning: (isReading ? rest : [second, ...rest]).join(' ') });
  });
}
export function parseBackup(text) {
  const payload = JSON.parse(text);
  const rows = Array.isArray(payload) ? payload : payload.words;
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('请选择最多 10000 条单词的 JSON 备份');
  return rows.map(cleanWord);
}
export function uniqueNewWords(rows, existing) {
  const key = row => `${row.word.normalize('NFKC')}\0${row.reading.normalize('NFKC')}`;
  const known = new Set(existing.map(key));
  return rows.filter(row => { const k = key(row); if (known.has(k)) return false; known.add(k); return true; });
}
