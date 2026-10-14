begin;
alter table public.words add column is_starred boolean not null default false;
create or replace function public.import_words(entries jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare imported integer;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) not between 1 and 10000 then raise exception '导入列表不正确'; end if;
  insert into public.words(user_id, source, word, reading, meaning, example, note, created_at, is_starred)
    select auth.uid(), coalesce(e.source,'逆转裁判'), trim(e.word), coalesce(e.reading,''), coalesce(e.meaning,''), coalesce(e.example,''), coalesce(e.note,''), coalesce(e.created_at,now()), coalesce(e.is_starred,false)
    from jsonb_to_recordset(entries) as e(source text, word text, reading text, meaning text, example text, note text, created_at timestamptz, is_starred boolean)
    on conflict(user_id,source,word,reading) do nothing;
  get diagnostics imported = row_count;
  return imported;
end;
$$;
commit;
