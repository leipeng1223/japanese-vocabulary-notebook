import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText, parseBackup, uniqueNewWords } from '../src/model.js';
import { normalizeQuery, lookup, createHandler } from '../supabase/functions/dictionary/core.js';

test('mixed spaces, kana and missing readings import correctly', () => {
  const rows = parseText('提出　ていしゅつ  提交\n口走る　说漏嘴\nオウム\n証拠品\tしょうこひん');
  assert.equal(rows[0].word, '提出'); assert.equal(rows[0].reading, 'ていしゅつ'); assert.equal(rows[0].meaning, '提交');
  assert.equal(rows[1].reading, ''); assert.equal(rows[1].meaning, '说漏嘴');
  assert.equal(uniqueNewWords([...rows, ...rows], []).length, 4);
});
test('local JSON migration preserves fields and timestamps but not owner/id', () => {
  const [row] = parseBackup(JSON.stringify([{ id:'seed-1', user_id:'other', word:'置物', reading:'おきもの', note:'原始备注', createdAt:1788246000001 }]));
  assert.equal(row.note, '原始备注'); assert.equal(Date.parse(row.created_at),1788246000001); assert.equal(row.user_id, undefined);
  assert.throws(() => parseBackup('[{"word":""}]'));
});
test('dictionary normalizes kanji, kana and common romaji including long vowels', () => {
  assert.equal(normalizeQuery('証拠品'),'証拠品');
  for (const input of ['しょうこひん','ショウコヒン','shouko hin','shōkohin']) assert.equal(normalizeQuery(input),'しょうこひん');
  assert.equal(normalizeQuery('chōsho'),'ちょうしょ'); assert.throws(() => normalizeQuery('zzz'));
});
const jisho = { data:[{ japanese:[{ word:'証拠品',reading:'しょうこひん' }], senses:[{ english_definitions:['evidence'],parts_of_speech:['Noun'] }] }] };
test('translation errors retain dictionary results without labeling English as Chinese', async () => {
  let calls = 0;
  const result = await lookup('証拠品','test:fx',async () => ++calls === 1 ? Response.json(jisho) : Promise.reject(new Error('timeout')));
  assert.equal(result.results[0].definitionEn,'evidence'); assert.equal(result.results[0].meaning,''); assert.ok(result.warning);
});
test('translation posts only definitions and returns Chinese; empty results skip translation', async () => {
  const result = await lookup('証拠品','test:fx',async (url, options) => {
    if (url.includes('jisho.org')) return Response.json(jisho);
    assert.equal(options.headers.Authorization,'DeepL-Auth-Key test:fx');
    assert.deepEqual(JSON.parse(options.body).text,['evidence']);
    return Response.json({ translations:[{ text:'证物' }] });
  });
  assert.equal(result.results[0].meaning,'证物'); assert.equal(result.warning,'');
  let calls=0; await lookup('无结果','test:fx',async()=>{calls++;return Response.json({data:[]});}); assert.equal(calls,1);
});
test('cloud function rejects anonymous calls, untrusted origins and exhausted quota before external calls', async () => {
  let calls=0;
  const handler=createHandler({authenticate:async()=>true,quota:async()=>false,deeplKey:'test:fx',allowedOrigins:['http://localhost:8001'],fetcher:async()=>{calls++;}});
  const request=(headers={})=>new Request('https://example.test/dictionary',{method:'POST',headers,body:'{"query":"証拠品"}'});
  assert.equal((await handler(request())).status,401);
  assert.equal((await handler(request({Origin:'https://bad.test'}))).status,403);
  assert.equal((await handler(request({Authorization:'Bearer valid'}))).status,429);
  assert.equal(calls,0);
});
