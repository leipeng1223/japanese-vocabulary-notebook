import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {localDictionary} from '../scripts/local-dictionary.js';
test('local dictionary requires same origin and login, uses local translation and preserves senses',async()=>{
 let calls=0;
 const handler=localDictionary({DEEPL_API_KEY:'local-test'}, {client:{auth:{getUser:async token=>({data:{user:token==='valid'?{id:'user'}:null},error:null})}},fetcher:async(url,options)=>{
 calls++;
 if(url.includes('jisho.org'))return Response.json({data:[{japanese:[{word:'堪能',reading:'たんのう'}],senses:[{english_definitions:['skilled'],parts_of_speech:['Na-adjective (keiyodoshi)']}]}]});
 const body=JSON.parse(options.body);assert.equal(JSON.parse(body.context).word,'堪能');return Response.json({translations:[{text:'精通'}]});
 }});
 const server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const request=(headers={},body='{"query":"堪能"}')=>fetch(origin+'/api/local-dictionary',{method:'POST',headers:{Origin:origin,...headers},body});
 try {
 assert.equal((await request({Origin:'https://evil.example'})).status,403);
 assert.equal((await request()).status,401);assert.equal(calls,0);
 assert.equal((await request({Authorization:'Bearer invalid'})).status,401);
 assert.equal((await request({Authorization:'Bearer valid'},'x'.repeat(2001))).status,413);
 const response=await request({Authorization:'Bearer valid'});assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.results[0].meaning,'①〔な形〕精通');assert.equal(calls,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('auth network failures are 503 rather than misleading login errors',async()=>{
 const handler=localDictionary({}, {client:{auth:{getUser:async()=>({data:{user:null},error:{name:'AuthRetryableFetchError',status:0}})}}});
 const server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 try{const response=await fetch(origin+'/api/local-dictionary',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test'},body:'{"query":"堪能"}'});assert.equal(response.status,503);assert.match((await response.json()).error,/无法连接 Supabase/);}finally{await new Promise(r=>server.close(r));}
});
