import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('Postgres migration: RLS, transactional imports/deletes, versions, per-account quota', async () => {
  const db = new PGlite();
  const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values('${a}'),('${b}');`);
    await db.exec(await readFile(new URL('../supabase/migrations/202609180001_initial.sql',import.meta.url),'utf8'));
    const asUser=async(id)=>{await db.exec(`reset role; set request.jwt.claim.sub='${id}'; set role authenticated;`);};
    await asUser(a);
    const rows=[{word:'置物',reading:'おきもの'},{word:'証拠品',reading:'しょうこひん'}];
    assert.equal((await db.query('select public.import_words($1::jsonb) as count',[JSON.stringify(rows)])).rows[0].count,2);
    assert.equal((await db.query('select public.import_words($1::jsonb) as count',[JSON.stringify(rows)])).rows[0].count,0);
    const before=(await db.query('select * from public.words order by word')).rows;
    await asUser(b); assert.equal((await db.query('select * from public.words')).rows.length,0);
    await assert.rejects(db.query('insert into public.words(user_id,word) values($1,$2)',[a,'不正アクセス']));
    assert.equal((await db.query('update public.words set meaning=$1 where id=$2 returning id',['changed',before[0].id])).rows.length,0);
    await assert.rejects(db.query('select public.delete_words_checked($1::jsonb)',[JSON.stringify(before.map(({id,version})=>({id,version})))]));
    await asUser(a);
    await db.query('update public.words set meaning=$1 where id=$2 and version=1',['新释义',before[0].id]);
    assert.equal((await db.query('update public.words set meaning=$1 where id=$2 and version=1 returning id',['旧设备覆盖',before[0].id])).rows.length,0);
    await assert.rejects(db.query('select public.delete_words_checked($1::jsonb)',[JSON.stringify(before.map(({id,version})=>({id,version})))]));
    assert.equal((await db.query('select * from public.words')).rows.length,2,'stale batch must not partially delete');
    await assert.rejects(db.query('select public.import_words($1::jsonb)',[JSON.stringify([{word:'valid'},{word:''}])]));
    assert.equal((await db.query('select * from public.words')).rows.length,2,'invalid import must roll back');
    assert.equal((await db.query('select public.consume_dictionary_quota() as ok')).rows[0].ok,false);
    await db.exec(`reset role; insert into public.dictionary_access values('${a}'); set role authenticated;`);
    for(let i=0;i<60;i++) assert.equal((await db.query('select public.consume_dictionary_quota() as ok')).rows[0].ok,true);
    assert.equal((await db.query('select public.consume_dictionary_quota() as ok')).rows[0].ok,false);
    await assert.rejects(db.query('update public.dictionary_usage set calls=0'));
    const current=(await db.query('select id,version from public.words')).rows;
    assert.equal((await db.query('select public.delete_words_checked($1::jsonb) as count',[JSON.stringify(current)])).rows[0].count,2);
    assert.equal((await db.query('select * from public.words')).rows.length,0);
    await db.exec('reset role; set role anon;'); await assert.rejects(db.query('select * from public.words'));
  } finally { await db.close(); }
});
