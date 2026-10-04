begin;
create table public.word_sources (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name = trim(name) and length(name) between 1 and 80),
  primary key(user_id, name)
);
alter table public.word_sources enable row level security;
grant select, insert on public.word_sources to authenticated;
create policy sources_read on public.word_sources for select to authenticated using ((select auth.uid()) = user_id);
create policy sources_add on public.word_sources for insert to authenticated with check ((select auth.uid()) = user_id);
insert into public.word_sources select id, '逆转裁判' from auth.users;
alter table public.words add column source text not null default '逆转裁判' check (source = trim(source) and length(source) between 1 and 80);
alter table public.words drop constraint words_user_id_word_reading_key;
alter table public.words add unique(user_id, source, word, reading);
create function public.ensure_word_source() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.word_sources(user_id,name) values(new.user_id,new.source) on conflict do nothing;
  return new;
end;
$$;
create trigger words_source before insert or update on public.words for each row execute function public.ensure_word_source();
create or replace function public.import_words(entries jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare imported integer;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) not between 1 and 10000 then raise exception '导入列表不正确'; end if;
  insert into public.words(user_id, source, word, reading, meaning, example, note, created_at)
    select auth.uid(), coalesce(e.source,'逆转裁判'), trim(e.word), coalesce(e.reading,''), coalesce(e.meaning,''), coalesce(e.example,''), coalesce(e.note,''), coalesce(e.created_at,now())
    from jsonb_to_recordset(entries) as e(source text, word text, reading text, meaning text, example text, note text, created_at timestamptz)
    on conflict(user_id,source,word,reading) do nothing;
  get diagnostics imported = row_count;
  return imported;
end;
$$;
commit;
