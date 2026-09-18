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
export async function lookup(query, key, fetcher = fetch) {
  const remote = await fetcher(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10000) });
  if (!remote.ok) throw new Error('日语词典暂不可用，请稍后重试');
  const payload = await remote.json();
  if (!Array.isArray(payload.data)) throw new Error('词典返回格式异常');
  const results = payload.data.slice(0, 8).map(entry => {
    const form = entry.japanese?.find(f => f.word === query || f.reading === query) || entry.japanese?.[0] || {};
    return { word: form.word || form.reading || '', reading: form.reading || '', meaning: '', definitionEn: (entry.senses || []).slice(0,3).flatMap(s => s.english_definitions || []).join('；').slice(0,1800), partOfSpeech: entry.senses?.[0]?.parts_of_speech?.join(' · ') || '' };
  }).filter(item => item.word && item.definitionEn);
  let warning = '';
  if (results.length) {
    if (!key) warning = '中文翻译尚未配置；英文义项仍可参考。';
    else try {
      const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
      const translated = await fetcher(`${host}/v2/translate`, { method:'POST', headers:{ Authorization:`DeepL-Auth-Key ${key}`, 'Content-Type':'application/json' }, body:JSON.stringify({ text:results.map(item=>item.definitionEn), source_lang:'EN', target_lang:'ZH-HANS' }), signal:AbortSignal.timeout(12000) });
      if (!translated.ok) throw new Error('translation unavailable');
      const data = await translated.json();
      if (data.translations?.length !== results.length) throw new Error('translation incomplete');
      results.forEach((item,i) => { item.meaning = data.translations[i].text; });
    } catch { warning = '中文翻译暂不可用；可参考英文义项，中文释义保持为空。'; }
  }
  return { query, results, warning };
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
