import { createClient } from '@supabase/supabase-js';
import { createHandler } from '../supabase/functions/dictionary/core.js';
export const localDictionaryFetch=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'User-Agent':'VocabularyNotebookLocal/1.0'}});
export function localDictionary(env,dependencies={}) {
 const client=dependencies.client||createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 return async(req,res)=>{
  const origin=req.headers.origin||'';
  const host=req.headers.host||'';
  if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host)||origin!=='http://'+host){res.writeHead(403);res.end('Forbidden origin');return;}
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  let body='';
  for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2000){res.writeHead(413);res.end();return;}}
  let authenticationUnavailable=false;
  const handler=createHandler({fetcher:dependencies.fetcher||localDictionaryFetch,allowedOrigins:[origin],deeplKey:env.DEEPL_API_KEY||'',authenticate:async(token)=>{
   try {
    const {data,error}=await client.auth.getUser(token);
    if(error && (!error.status || error.status>=500 || error.name==='AuthRetryableFetchError'))authenticationUnavailable=true;
    return !error&&Boolean(data.user);
   }catch{authenticationUnavailable=true;return false;}
  },quota:async()=>true});
  const result=await handler(new Request(origin+'/api/local-dictionary',{method:'POST',headers:{Origin:origin,Authorization:req.headers.authorization||''},body}));
  if(authenticationUnavailable){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'本地服务无法连接 Supabase 登录校验，请检查网络或代理；这不代表你未登录。'}));return;}
  res.writeHead(result.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(await result.text());
 };
}
