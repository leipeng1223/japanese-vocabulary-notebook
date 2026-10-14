import { client, configured, fetchWords, fetchSources, addSource, writeWord, removeWords, insertWords } from './api.js';
import { fields, cleanWord, parseText, parseBackup, uniqueNewWords } from './model.js';

const $ = selector => document.querySelector(selector);
let user = null, words = [], editing = null, importRows = [], channel = null;
const reviewSessions = new Map();
let starredOnly = false;
const reviewKey = () => JSON.stringify([activeSource, starredOnly]);
const reviewPool = () => sourceWords().filter(row => !starredOnly || row.is_starred);
function reviewSession() {
  const key = reviewKey();
  if (!reviewSessions.has(key)) reviewSessions.set(key, { seen: new Set(), ids: [], revealed: new Set(), started: false });
  return reviewSessions.get(key);
}
let generation = 0, loadSerial = 0, busy = false, lookupSerial = 0;
const selected = new Set();
let sources = [], activeSource = '逆转裁判';
const sourceWords = () => words.filter(row => (row.source || '逆转裁判') === activeSource);
function renderSources() {
  const names = [...new Set(['逆转裁判', ...sources, ...words.map(row => row.source || '逆转裁判')])];
  $('#source-tabs').replaceChildren();
  for (const name of names) {
    const button = element('button', name === activeSource ? 'primary' : '', name);
    button.type = 'button'; button.setAttribute('aria-pressed', String(name === activeSource));
    button.onclick = () => { if (busy) return; activeSource = name; selected.clear(); $('#search').value = ''; renderSources(); renderWords(); };
    $('#source-tabs').append(button);
  }
  $('#source-context').textContent = `当前来源：${activeSource} · 新增和导入单词将保存到此来源`;
}
const status = (message, error = false) => { $('#status').textContent = message; $('#status').classList.toggle('error', error); };
function element(tag, className, text) { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
function cardActions(row) {
  const actions = element('div', 'card-actions', '');
  const edit = element('button', 'edit-button', ''); edit.type = 'button';
  edit.setAttribute('aria-label', `编辑 ${row.word}`); edit.title = '编辑单词';
  // Lucide square-pen (ISC): inline SVG avoids an external icon dependency.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
  for (const d of ['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M16 3a2.1 2.1 0 0 1 3 3L9 16l-4 1 1-4Z']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path);
  }
  edit.append(svg); edit.onclick = event => { event.stopPropagation(); openWord(row); };
  actions.append(edit, starButton(row)); return actions;
}
function starButton(row) {
  const button = element('button', 'star-button' + (row.is_starred ? ' starred' : ''), row.is_starred ? '★' : '☆');
  button.type = 'button';
  button.setAttribute('aria-label', `${row.is_starred ? '取消重点生词' : '标记重点生词'}：${row.word}`);
  button.setAttribute('aria-pressed', String(Boolean(row.is_starred)));
  button.onclick = event => {
    event.stopPropagation();
    mutation(button, () => writeWord({ is_starred: !row.is_starred }, row, user.id), updated => {
      words = words.map(word => word.id === updated.id ? updated : word);
      renderWords();
    });
  };
  return button;
}
function visibleWords() {
  const query = $('#search').value.trim().toLowerCase();
  const rows = sourceWords().filter(row => fields.map(f => row[f]).join(' ').toLowerCase().includes(query));
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
  $('#word-count').textContent = `共 ${sourceWords().length} 个单词${$('#search').value ? ` · 当前 ${visible.length} 个` : ''}`;
  if (!visible.length) list.append(element('p', 'empty', words.length ? '没有匹配的单词。' : '还没有单词。新增一条，或导入本地版备份。'));
  for (const row of visible) {
    const card = element('article', 'word-item' + (selected.has(row.id) ? ' selected' : ''), '');
    const content = element('div', 'word-content', '');
    const heading = element('div', 'word-heading', '');
    heading.append(element('h2', 'word', row.word), cardActions(row));
    content.append(heading, element('p', 'reading', row.reading || '读音待补充'), element('p', 'meaning', row.meaning || '释义待补充'));
    if (row.example) content.append(element('p', 'example', `例　${row.example}`));
    if (row.note) content.append(element('p', 'note', `注　${row.note}`));
    const label = element('label', 'word-select', ''), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = selected.has(row.id); checkbox.setAttribute('aria-label', `选择 ${row.word}`);
    checkbox.onchange = () => { checkbox.checked ? selected.add(row.id) : selected.delete(row.id); card.classList.toggle('selected', checkbox.checked); renderSelection(); };
    label.append(checkbox); card.append(content, label); list.append(card);
  }
  renderSelection(); renderReview();
}
async function sync(quiet = false) {
  if (!user || busy) return;
  const current = generation, serial = ++loadSerial;
  try {
    if (!quiet) status('正在同步…');
    const [rows, names] = await Promise.all([fetchWords(), fetchSources()]);
    if (current !== generation || serial !== loadSerial || busy) return;
    words = rows; sources = names; renderSources(); renderWords(); status(`已同步 · ${new Date().toLocaleTimeString()}`);
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
  $('#word-form').elements.source.replaceChildren(...[...new Set([activeSource, ...sources, ...words.map(item => item.source || '逆转裁判')])].map(name => new Option(name, name)));
  $('#word-form').elements.source.value = row?.source || activeSource;
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
  if ($('#review-view').hidden) return;
  const session = reviewSession(), pool = reviewPool();
  if (!session.started) { nextReviewGroup(); return; }
  const grid = $('#review-grid'); grid.replaceChildren();
  const rows = session.ids.map(id => pool.find(row => row.id === id)).filter(Boolean);
  const remaining = pool.filter(row => !session.seen.has(row.id)).length;
  $('#review-count').textContent = `本轮已展示 ${pool.length - remaining} / ${pool.length} 个 · 剩余 ${remaining} 个`;
  $('#next').disabled = !remaining;
  $('#restart-review').hidden = !pool.length || Boolean(remaining);
  if (!rows.length) grid.append(element('p', 'empty', remaining ? '点击“换一组”继续复习。' : pool.length ? '本轮复习完成，点击“重新开始”开启新一轮。' : starredOnly ? '此来源还没有重点生词，点击词卡右上角的星星即可标记。' : '添加单词后即可开始复习'));
  for (const row of rows) {
    const card = element('div', 'review-card', '');
    const reveal = element('button', 'review-reveal', ''); reveal.type = 'button';
    reveal.setAttribute('aria-label', `显示或隐藏 ${row.word} 的答案`);
    const answer = element('span', 'review-answer', ''); answer.hidden = !session.revealed.has(row.id);
    reveal.setAttribute('aria-expanded', String(!answer.hidden));
    answer.append(element('span', 'reading', row.reading || '读音待补充'), element('span', 'meaning', row.meaning || '释义待补充'), element('span', 'example', row.example));
    reveal.append(element('span', 'review-word', row.word), answer);
    reveal.onclick = () => {
      answer.hidden = !answer.hidden;
      answer.hidden ? session.revealed.delete(row.id) : session.revealed.add(row.id);
      reveal.setAttribute('aria-expanded', String(!answer.hidden));
    };
    card.append(reveal, cardActions(row));
    grid.append(card);
  }
}
function nextReviewGroup() {
  const session = reviewSession(), pool = reviewPool().filter(row => !session.seen.has(row.id));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  session.ids = pool.slice(0, 6).map(row => row.id);
  session.ids.forEach(id => session.seen.add(id)); session.revealed.clear(); session.started = true;
  renderReview();
}
$('#next').onclick = nextReviewGroup;
$('#restart-review').onclick = () => { reviewSessions.delete(reviewKey()); nextReviewGroup(); };
$('#starred-only').onchange = event => { starredOnly = event.target.checked; renderReview(); };
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
  const unique = uniqueNewWords(rows.map(row => ({ ...row, source: activeSource })), words);
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
$('#add-source').onclick = () => { $('#source-form').reset(); $('#source-status').textContent = ''; $('#source-dialog').showModal(); $('#source-name').focus(); };
$('#source-form').onsubmit = async event => {
  event.preventDefault(); const name = $('#source-name').value.trim();
  if (!name || name.length > 80) { $('#source-status').textContent = '来源名称须为 1 至 80 个字符'; return; }
  await mutation($('#save-source'), () => addSource(name, user.id), () => {
    sources = [...new Set([...sources, name])]; activeSource = name; selected.clear();
    $('#search').value = ''; $('#source-dialog').close(); renderSources(); renderWords();
  }, '#source-status');
};
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
  ++generation; ++lookupSerial; ++loadSerial; user = next; words = []; selected.clear(); reviewSessions.clear(); importRows = [];
  sources = []; activeSource = '逆转裁判'; renderSources();
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
