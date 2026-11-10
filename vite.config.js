import { defineConfig, loadEnv } from 'vite';
import { localDictionary } from './scripts/local-dictionary.js';
export default defineConfig(({mode})=>{
 const env={...loadEnv(mode,process.cwd(),''),...process.env};
 return {envPrefix:'VITE_',plugins:[{name:'local-dictionary',configureServer(server){
  if(env.VITE_LOCAL_DICTIONARY==='0'||!env.VITE_SUPABASE_URL||!env.VITE_SUPABASE_ANON_KEY)return;
  const handler=localDictionary(env);
  server.middlewares.use('/api/local-dictionary',(req,res)=>{handler(req,res).catch(()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'本地查词服务暂不可用'}));});});
 }}]};
});
