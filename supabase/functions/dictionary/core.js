import { toHiragana } from 'wanakana';
export function normalizeQuery(raw) {
  const input = raw.normalize('NFKC').trim();
  if (!input || input.length > 100) throw new Error('请输入 1–100 个字符');
  if (/^[a-zāīūēōâîûêô\s'’-]+$/i.test(input)) {
    const expanded = input.toLowerCase().replace(/[āâ]/g,'aa').replace(/[īî]/g,'ii').replace(/[ūû]/g,'uu').replace(/[ēê]/g,'ee').replace(/[ōô]/g,'ou').replace(/[\s-]/g,'').replace(/’/g,"'");
    const kana = toHiragana(expanded);
    if (/[a-z]/i.test(kana)) throw new Error('无法识别罗马音，请改用假名或词典形');
    return kana;
  }
  return toHiragana(input);
}
// Mechanical deduplication only: never merge distinct senses or near-synonyms.
export function uniquePhrases(values) {
  const seen=new Set();
  return values.map(value=>String(value).normalize('NFKC').replace(/\s+/g,' ').trim()).filter(value=>{
    const key=value.toLowerCase().replace(/[。.;；]+$/u,'').trim();
    if(!key||seen.has(key))return false;seen.add(key);return true;
  });
}
const labels={ 'Noun':'名','Na-adjective (keiyodoshi)':'な形','I-adjective (keiyoushi)':'い形','Suru verb':'する','Transitive verb':'他','Intransitive verb':'自','Ichidan verb':'一段動','Adverb (fukushi)':'副','Expressions (phrases, clauses, etc.)':'表現','Buddhism':'仏教','Archaism':'古語','Colloquialism':'口語','Humble (kenjougo) language':'謙譲語','Honorific or respectful (sonkeigo) language':'尊敬語' };
const senseNumber=index=>index<20?String.fromCodePoint(0x2460+index):String(index+1)+'.';
function senseLabel(sense) {
  return uniquePhrases([...sense.partsOfSpeech,...sense.tags].map(value=>labels[value]||(value.startsWith('Godan verb')?'五段動':value))).join('・');
}
function formatSense(sense,index,text) {
  const label=senseLabel(sense);
  const notes=[...sense.info,...sense.restrictions.map(value=>'限用：'+value)];
  return senseNumber(index)+(label?'〔'+label+'〕':'')+text+(notes.length?'（'+notes.join('；')+'）':'');
}
export async function lookup(query, key, fetcher = fetch) {
  const remote=await fetcher('https://jisho.org/api/v1/search/words?keyword='+encodeURIComponent(query),{signal:AbortSignal.timeout(10000)});
  if(!remote.ok)throw new Error('日语词典暂不可用，请稍后重试');
  const payload=await remote.json();if(!Array.isArray(payload.data))throw new Error('词典返回格式异常');
  const results=payload.data.slice(0,8).map(entry=>{
    const form=entry.japanese?.find(f=>f.word===query||f.reading===query)||entry.japanese?.[0]||{};
    const senses=(entry.senses||[]).map(s=>({definitions:uniquePhrases(s.english_definitions||[]),partsOfSpeech:uniquePhrases(s.parts_of_speech||[]),tags:uniquePhrases(s.tags||[]),info:uniquePhrases(s.info||[]),restrictions:uniquePhrases(s.restrictions||[]),meaning:''})).filter(s=>s.definitions.length);
    return {word:form.word||form.reading||'',reading:form.reading||'',meaning:'',senses,definitionEn:senses.map(s=>s.definitions.join('；')).join('\n'),partOfSpeech:senses[0]?.partsOfSpeech.join(' · ')||''};
  }).filter(item=>item.word&&item.senses.length);
  let warning='';
  if(results.length){
    if(!key)warning='中文翻译尚未配置；英文义项仍可参考。';
    else try{
      const jobs=results.flatMap(item=>item.senses.map(sense=>({item,sense})));
      let cursor=0;
      const translated=new Array(jobs.length);
      const host=key.endsWith(':fx')?'https://api-free.deepl.com':'https://api.deepl.com';
      await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
        while(cursor<jobs.length){
          const index=cursor++,{item,sense}=jobs[index];
          const context=JSON.stringify({language:'Japanese dictionary entry',word:item.word,reading:item.reading,parts_of_speech:sense.partsOfSpeech,usage_tags:sense.tags,usage_notes:sense.info,restrictions:sense.restrictions});
          const response=await fetcher(host+'/v2/translate',{method:'POST',headers:{Authorization:'DeepL-Auth-Key '+key,'Content-Type':'application/json'},body:JSON.stringify({text:[sense.definitions.join('；')],context,source_lang:'EN',target_lang:'ZH-HANS'}),signal:AbortSignal.timeout(12000)});
          if(!response.ok)throw new Error('translation unavailable');
          const data=await response.json();
          if(data.translations?.length!==1||typeof data.translations[0].text!=='string'||!data.translations[0].text.trim())throw new Error('translation incomplete');
          translated[index]=uniquePhrases(data.translations[0].text.split(/[；;\n]+/u)).join('；');
          if(!translated[index])throw new Error('translation empty');
        }
      }));
      jobs.forEach(({sense},i)=>sense.meaning=translated[i]);
      results.forEach(item=>item.meaning=item.senses.map((sense,i)=>formatSense(sense,i,sense.meaning)).join('\n'));
    }catch{warning='中文翻译暂不可用；可参考英文义项，中文释义保持为空。';}
  }
  // Preserve labels even when translation is unavailable.
  results.forEach(item=>item.definitionEn=item.senses.map((sense,i)=>formatSense(sense,i,sense.definitions.join('；'))).join('\n'));
  return {query,results,warning};
}
export function createHandler({ authenticate, quota, deeplKey, allowedOrigins, fetcher = fetch }) {
  return async request => {
    const origin = request.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : '', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS', Vary:'Origin' };
    const reply = (body, status=200) => Response.json(body, { status, headers:cors });
    if (origin && !allowedOrigins.includes(origin)) return reply({ error:'来源未允许' },403);
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:cors });
    if (request.method !== 'POST') return reply({ error:'只支持 POST' },405);
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
      if (!token || !await authenticate(token)) return reply({ error:'请先登录' },401);
      const text = await request.text();
      if (text.length > 2000) return reply({ error:'请求过长' },413);
      let query;
      try { const body = JSON.parse(text); if (typeof body.query !== 'string') throw new Error('请输入查询词'); query = normalizeQuery(body.query); }
      catch (error) { return reply({ error:error.message },400); }
      if (!await quota(token)) return reply({ error:'此账号未开通查词，或已达到今日 60 次上限。' },429);
      return reply(await lookup(query, deeplKey, fetcher));
    } catch { return reply({ error:'查词服务暂不可用，请稍后重试。' },502); }
  };
}
