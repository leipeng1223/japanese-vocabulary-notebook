import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const configured = Boolean(url && key && /^https:\/\//.test(url));
// Only a publishable / legacy anon key belongs here. RLS enforces account isolation.
export const client = configured ? createClient(url, key) : null;
export async function fetchWords() {
  const all = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await client.from('words').select('*').order('created_at').order('id').range(from, from + 499);
    if (error) throw error;
    all.push(...data);
    if (data.length < 500) return all;
  }
}
export async function writeWord(item, previous, userId) {
  let query;
  if (previous) {
    query = client.from('words').update(item).eq('id', previous.id).eq('version', previous.version);
  } else {
    query = client.from('words').insert({ ...item, user_id: userId });
  }
  const { data, error } = await query.select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('此词已在另一台设备修改或删除。请保留当前输入，取消后同步并重新编辑。');
  return data;
}
export async function removeWords(rows) {
  // RPC checks every version and deletes the batch in one transaction.
  const { error } = await client.rpc('delete_words_checked', { targets: rows.map(({ id, version }) => ({ id, version })) });
  if (error) throw error;
}
export async function insertWords(rows) {
  const { data, error } = await client.rpc('import_words', { entries: rows });
  if (error) throw error;
  return data;
}
