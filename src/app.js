import { client, configured, fetchWords, writeWord, removeWords, insertWords } from './api.js';
import { fields, cleanWord, parseText, parseBackup, uniqueNewWords } from './model.js';

const $ = selector => document.querySelector(selector);
let user = null, words = [], editing = null, reviewId = null, importRows = [], channel = null;
let generation = 0, loadSerial = 0, busy = false, lookupSerial = 0;
const selected = new Set();
const status = (message, error = false) => { $('#status').textContent = message; $('#status').classList.toggle('error', error); };
function element(tag, className, text) { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
function visibleWords() {
  const query = $('#search').value.trim().toLowerCase();
  const rows = words.filter(row => fields.map(f => row[f]).join(' ').toLowerCase().includes(query));
  return rows.sort((a, b) => $('#sort').value === 'word' ? a.word.localeCompare(b.word, 'ja') : ($('#sort').value === 'oldest' ? 1 : -1) * (a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)));
}
function renderSelection() {
  const visible = visibleWords(), count = visible.filter(row => selected.has(row.id)).length;
  $('#select-all').checked = visible.length > 0 && count === visible.length;
  $('#select-all').indeterminate = count > 0 && count < visible.length;
  $('#select-all').disabled = !visible.length;
  $('#selection-count').textContent = selected.size ? `已选择 ${selected.size} 个` : '未选择单词';
  $('#delete-selected').disabled = !selected.size || busy;
}
function renderWords() {
  const ids = new Set(words.map(row => row.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  const visible = visibleWords(), list = $('#word-list');
  list.replaceChildren();
  $('#word-count').textContent = `共 ${words.length} 个单词${$('#search').value ? ` · 当前 ${visible.length} 个` : ''}`;
  if (!visible.length) list.append(element('p', 'empty', words.length ? '没有匹配的单词。' : '还没有单词。新增一条，或导入本地版备份。'));
  for (const row of visible) {
    const card = element('article', 'word-item' + (selected.has(row.id) ? ' selected' : ''), '');
    const content = element('div', 'word-content', '');
    content.append(element('h2', 'word', row.word), element('p', 'reading', row.reading || '读音待补充'), element('p', 'meaning', row.meaning || '释义待补充'));
    if (row.example) content.append(element('p', 'example', `例　${row.example}`));
    if (row.note) content.append(element('p', 'note', `注　${row.note}`));
    const edit = element('button', 'edit-button', '编辑');
    edit.onclick = () => openWord(row);
    const label = element('label', 'word-select', ''), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = selected.has(row.id); checkbox.setAttribute('aria-label', `选择 ${row.word}`);
    checkbox.onchange = () => { checkbox.checked ? selected.add(row.id) : selected.delete(row.id); card.classList.toggle('selected', checkbox.checked); renderSelection(); };
    label.append(checkbox); card.append(content, edit, label); list.append(card);
  }
  renderSelection(); renderReview();
}
async function sync(quiet = false) {
  if (!user || busy) return;
  const current = generation, serial = ++loadSerial;
  try {
    if (!quiet) status('正在同步…');
    const rows = await fetchWords();
    if (current !== generation || serial !== loadSerial || busy) return;
    words = rows; renderWords(); status(`已同步 · ${new Date().toLocaleTimeString()}`);
  } catch (error) { if (current === generation) status(`同步失败，仍显示上次读取的数据：${error.message}`, true); }
}
async function mutation(button, action, done, errorTarget = '#status') {
  if (busy || !user) return;
  busy = true; button.disabled = true; ++loadSerial;
  const current = generation;
  try {
    const result = await action();
    if (current !== generation) return;
    done?.(result);
    status('已保存到云端');
  } catch (error) { if (current === generation) $(errorTarget).textContent = `操作未完成：${error.message}`; return; }
  finally { busy = false; button.disabled = false; renderSelection(); }
  await sync(true);
}
function openWord(row = null, draft = null) {
  editing = row ? { ...row } : null;
  $('#word-form').reset(); $('#word-title').textContent = row ? '编辑单词' : '新增单词';
  for (const field of fields) $('#word-form').elements[field].value = (row || draft)?.[field] || '';
  $('#delete-one').hidden = !row; $('#save-status').textContent = '';
  $('#word-dialog').showModal(); $('#word-form').elements.word.focus();
}
$('#word-form').onsubmit = async event => {
  event.preventDefault();
  let item;
  try { item = cleanWord({ ...Object.fromEntries(new FormData(event.target)), created_at: editing?.created_at }); }
  catch (error) { $('#save-status').textContent = error.message; return; }
  await mutation($('#save-word'), () => writeWord(item, editing, user.id), () => $('#word-dialog').close(), '#save-status');
};
$('#delete-one').onclick = () => {
  if (!editing || !confirm(`删除「${editing.word}」？这会同步删除云端记录。`)) return;
  mutation($('#delete-one'), () => removeWords([editing]), () => $('#word-dialog').close(), '#save-status');
};
$('#delete-selected').onclick = () => {
  const targets = words.filter(row => selected.has(row.id));
  if (!targets.length || !confirm(`删除选中的 ${targets.length} 个单词？这会同步到所有设备，无法撤销。`)) return;
  mutation($('#delete-selected'), () => removeWords(targets), () => selected.clear());
};
function renderReview() {
  const card = $('#review-card'); card.replaceChildren();
  let row = words.find(item => item.id === reviewId);
  if (!row) row = words[Math.floor(Math.random() * words.length)];
  reviewId = row?.id;
  $('#review-count').textContent = `从 ${words.length} 个单词中随机抽取`;
  if (!row) { card.textContent = '添加单词后即可开始复习'; return; }
  const answer = element('span', 'review-answer', ''); answer.hidden = true;
  answer.append(element('span', 'reading', row.reading || '读音待补充'), element('p', 'meaning', row.meaning || '释义待补充'), element('p', 'example', row.example));
  card.append(element('span', 'review-word', row.word), answer);
  card.onclick = () => { answer.hidden = !answer.hidden; };
}
$('#next').onclick = () => { const pool = words.filter(row => row.id !== reviewId); if (pool.length) reviewId = pool[Math.floor(Math.random() * pool.length)].id; renderReview(); };
$('#json-file').onchange = async event => {
  importRows = []; $('#import-json-button').disabled = true;
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB');
    importRows = parseBackup(await file.text());
    $('#import-summary').textContent = `读取到 ${importRows.length} 条记录。确认后将上传到当前登录账号。`;
    $('#import-json-button').disabled = !importRows.length;
  } catch (error) { $('#import-summary').textContent = `无法导入：${error.message}`; }
};
async function importBatch(rows, button, finish) {
  const unique = uniqueNewWords(rows, words);
  if (!unique.length) { status('没有需要导入的新单词'); return; }
  await mutation(button, () => insertWords(unique), count => { finish(); status(`已导入 ${count} 个单词`); $('#import-summary').textContent = `已保存 ${count} 个新词，其他重复项已跳过。`; });
}
$('#import-json-button').onclick = () => importBatch(importRows, $('#import-json-button'), () => { importRows = []; $('#json-file').value = ''; });
$('#import-text-button').onclick = () => { try { importBatch(parseText($('#import-text').value), $('#import-text-button'), () => { $('#import-text').value = ''; }); } catch (error) { status(error.message, true); } };
$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), words }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `我的单词本-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#lookup').onclick = () => { $('#dictionary-dialog').showModal(); $('#query').focus(); };
$('#dictionary-dialog').addEventListener('close', () => { ++lookupSerial; });
$('#dictionary-form').onsubmit = async event => {
  event.preventDefault(); const query = $('#query').value.trim(); if (!query) return;
  const serial = ++lookupSerial, current = generation;
  $('#lookup-submit').disabled = true; $('#results').replaceChildren(); $('#dictionary-status').textContent = '正在查询词典并翻译…';
  try {
    const { data, error } = await client.functions.invoke('dictionary', { body: { query } });
    if (error) throw new Error('查词暂不可用，请确认云端函数已部署且账号已获准查词。');
    if (data.error) throw new Error(data.error);
    if (serial !== lookupSerial || current !== generation) return;
    $('#dictionary-status').textContent = `按「${data.query}」查询 · ${data.results.length} 个候选。${data.warning || '中文为机器翻译，请结合游戏语境确认。'}`;
    for (const item of data.results) {
      const result = element('button', 'dictionary-result', ''); result.type = 'button';
      result.append(element('span', 'result-word', item.word), element('span', 'result-reading', item.reading), element('span', 'result-definition', item.meaning || '中文翻译暂不可用'), element('span', 'result-english', item.definitionEn), element('span', 'result-hint', '填入单词本 →'));
      result.onclick = () => { $('#dictionary-dialog').close(); openWord(null, { word: item.word, reading: item.reading, meaning: item.meaning }); };
      $('#results').append(result);
    }
  } catch (error) { if (serial === lookupSerial && current === generation) $('#dictionary-status').textContent = error.message; }
  finally { $('#lookup-submit').disabled = false; }
};
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(`#${button.dataset.close}`).close();
for (const tab of document.querySelectorAll('.tab')) tab.onclick = () => {
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `${tab.dataset.view}-view`;
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('active', button === tab);
  if (tab.dataset.view === 'review') renderReview();
};
$('#search').oninput = () => { selected.clear(); renderWords(); }; $('#sort').onchange = renderWords;
$('#select-all').onchange = event => { for (const row of visibleWords()) event.target.checked ? selected.add(row.id) : selected.delete(row.id); renderWords(); };
$('#add').onclick = () => openWord(); $('#refresh').onclick = () => sync();
async function authenticate(signup = false) {
  if (!$('#auth-form').reportValidity()) return;
  const controls = [...$('#auth-form').querySelectorAll('button')]; controls.forEach(b => b.disabled = true);
  $('#auth-status').textContent = signup ? '正在注册…' : '正在登录…';
  try {
    const credentials = { email: $('#email').value.trim(), password: $('#password').value };
    const { data, error } = signup ? await client.auth.signUp(credentials) : await client.auth.signInWithPassword(credentials);
    if (error) throw error;
    $('#password').value = '';
    $('#auth-status').textContent = data.session ? '' : '请打开验证邮件完成验证，再回到这里登录。';
  } catch (error) { $('#auth-status').textContent = `未能完成：${error.message}`; }
  finally { controls.forEach(b => b.disabled = false); }
}
$('#auth-form').onsubmit = event => { event.preventDefault(); authenticate(); }; $('#signup').onclick = () => authenticate(true);
$('#logout').onclick = async () => { if (busy) return; const { error } = await client.auth.signOut(); if (error) status(error.message, true); };
async function applySession(session) {
  const next = session?.user || null;
  if (next?.id === user?.id && user) return;
  ++generation; ++lookupSerial; ++loadSerial; user = next; words = []; selected.clear(); reviewId = null; importRows = [];
  $('#json-file').value = ''; $('#import-text').value = ''; $('#import-summary').textContent = ''; $('#import-json-button').disabled = true;
  $('#word-form').reset(); $('#query').value = ''; $('#results').replaceChildren(); $('#dictionary-status').textContent = '';
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  if (channel) { client.removeChannel(channel); channel = null; }
  $('#auth-panel').hidden = Boolean(user); $('#workspace').hidden = !user; renderWords();
  if (!user) return;
  $('#account').textContent = user.email;
  await sync();
  if (user?.id !== next.id) return;
  channel = client.channel(`words-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'words', filter: `user_id=eq.${user.id}` }, () => sync(true)).subscribe();
}
if (!configured) $('#setup').hidden = false;
else {
  client.auth.onAuthStateChange((_event, session) => { setTimeout(() => applySession(session), 0); });
  client.auth.getSession().then(({ data, error }) => { if (error) { $('#auth-panel').hidden = false; $('#auth-status').textContent = error.message; } else applySession(data.session); });
  // Realtime is supplemented by refresh-on-focus and periodic reads for reconnection.
  window.addEventListener('focus', () => sync(true)); window.addEventListener('online', () => sync(true));
  setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) sync(true); }, 30000);
}
