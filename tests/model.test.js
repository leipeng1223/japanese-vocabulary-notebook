import test from 'node:test';
import assert from 'node:assert/strict';
import { parseText, parseBackup, uniqueNewWords, readingRomaji, matchesWord } from '../src/model.js';
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
  assert.equal(result.results[0].definitionEn,'①〔名〕evidence'); assert.equal(result.results[0].meaning,''); assert.ok(result.warning);
});
test('translation posts only definitions and returns Chinese; empty results skip translation', async () => {
  const result = await lookup('証拠品','test:fx',async (url, options) => {
    if (url.includes('jisho.org')) return Response.json(jisho);
    assert.equal(options.headers.Authorization,'DeepL-Auth-Key test:fx');
    assert.deepEqual(JSON.parse(options.body).text,['evidence']);
    return Response.json({ translations:[{ text:'证物' }] });
  });
  assert.equal(result.results[0].meaning,'①〔名〕证物'); assert.equal(result.warning,'');
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

test('romaji derives only from kana and all word search normalizes case and spaces',()=>{
  assert.equal(readingRomaji('かぐ'),'kagu');assert.equal(readingRomaji('しょうこひん'),'shoukohin');assert.equal(readingRomaji('がっこう'),'gakkou');
  assert.equal(readingRomaji(''),'');assert.equal(readingRomaji('証拠品'),'');
  assert.equal(parseBackup('[{"word":"家具","reading":"かぐ","romaji":"wrong"}]')[0].romaji,'kagu');
  for(const query of ['KAGU','kagu','ＫＡＧＵ','ka gu','家具'])assert.equal(matchesWord({word:'家具',reading:'かぐ'},query),true);
  assert.equal(matchesWord({word:'家具',reading:'かぐ'},'shoukohin'),false);
});

test('dictionary retains every sense, labels and per-sense translation context',async()=>{
 const entry={data:[{japanese:[{word:'堪能',reading:'たんのう'}],senses:[
 {english_definitions:['skilled',' skilled ','SKILLED','proficient'],parts_of_speech:['Na-adjective (keiyodoshi)']},
 {english_definitions:['enjoying to the full'],parts_of_speech:['Noun','Suru verb'],tags:['Buddhism'],info:['original meaning'],restrictions:['堪能']},
 {english_definitions:['third'],parts_of_speech:['Noun']},
 {english_definitions:['fourth'],parts_of_speech:['Noun']}
 ]}]};
 const contexts=[];
 const result=await lookup('堪能','test:fx',async(url,options)=>{
 if(url.includes('jisho.org'))return Response.json(entry);
 const body=JSON.parse(options.body),context=JSON.parse(body.context);contexts.push(context);
 assert.equal(context.word,'堪能');assert.equal(context.reading,'たんのう');assert.equal(body.text.length,1);
 const value=body.text[0]==='skilled；proficient'?'熟练；熟练；精通':body.text[0]==='enjoying to the full'?'充分领略':body.text[0];
 return Response.json({translations:[{text:value}]});
 });
 assert.equal(contexts.length,4);assert.equal(result.results[0].senses.length,4);
 assert.equal(result.results[0].meaning.split('\n')[0],'①〔な形〕熟练；精通');
 assert.ok(result.results[0].meaning.includes('②〔名・する・佛教〕充分领略（原义；限用:堪能）'));
 assert.ok(result.results[0].meaning.includes('④〔名〕fourth'));
 assert.deepEqual(contexts.find(c=>c.usage_tags.length).parts_of_speech,['Noun','Suru verb']);
});

test('known labels are localized and unknown labels preserve original English',async()=>{
 const {localizeLabel,localizeMeaningLabels}=await import('../supabase/functions/dictionary/labels.js');
 assert.equal(localizeLabel('Usually written using kana alone'),'通常用假名书写');
 assert.equal(localizeLabel('Unknown future tag'),'Unknown future tag');
 assert.equal(localizeMeaningLabels('①〔一段動・他・Usually written using kana alone〕测试'),'①〔一段動・他・通常用假名书写〕测试');
 const result=await lookup('test','',async()=>Response.json({data:[{japanese:[{word:'試験',reading:'しけん'}],senses:[{english_definitions:['test'],parts_of_speech:['Unknown POS'],tags:['Usually written using kana alone','Unknown usage'],info:['unknown note']}]}]}));
 const item=result.results[0];assert.equal(item.partOfSpeech,'Unknown POS');assert.equal(item.definitionEn.match(/〔([^〕]*)〕/)[1],'Unknown POS・通常用假名书写・Unknown usage');assert.deepEqual(item.senses[0].tags,['Usually written using kana alone','Unknown usage']);
});
