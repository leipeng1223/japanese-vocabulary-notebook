begin;

create table public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null check (length(trim(word)) between 1 and 200),
  reading text not null default '' check (length(reading) <= 300),
  meaning text not null default '' check (length(meaning) <= 8000),
  example text not null default '' check (length(example) <= 8000),
  note text not null default '' check (length(note) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (user_id, word, reading)
);
create index words_owner_date on public.words(user_id, created_at, id);
alter table public.words enable row level security;
revoke all on public.words from anon;
grant select, insert, update, delete on public.words to authenticated;
create policy words_read on public.words for select to authenticated using ((select auth.uid()) = user_id);
create policy words_add on public.words for insert to authenticated with check ((select auth.uid()) = user_id);
create policy words_edit on public.words for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy words_remove on public.words for delete to authenticated using ((select auth.uid()) = user_id);

create function public.bump_word_version() returns trigger language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
create trigger words_version before update on public.words for each row execute function public.bump_word_version();

create function public.delete_words_checked(targets jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare target_count integer; matched integer;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if jsonb_typeof(targets) <> 'array' or jsonb_array_length(targets) not between 1 and 10000 then raise exception '删除列表不正确'; end if;
  target_count := jsonb_array_length(targets);
  perform w.id from public.words w join jsonb_to_recordset(targets) as t(id uuid, version integer)
    on w.id = t.id and w.version = t.version where w.user_id = auth.uid() for update of w;
  get diagnostics matched = row_count;
  if matched <> target_count or (select count(distinct t.id) from jsonb_to_recordset(targets) as t(id uuid)) <> target_count then
    raise exception '部分单词已在其他设备修改或删除，请同步后重试';
  end if;
  delete from public.words w using jsonb_to_recordset(targets) as t(id uuid, version integer)
    where w.id = t.id and w.version = t.version and w.user_id = auth.uid();
  get diagnostics matched = row_count;
  return matched;
end;
$$;
revoke all on function public.delete_words_checked(jsonb) from public;
grant execute on function public.delete_words_checked(jsonb) to authenticated;

create function public.import_words(entries jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare imported integer;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) not between 1 and 10000 then raise exception '导入列表不正确'; end if;
  insert into public.words(user_id, word, reading, meaning, example, note, created_at)
    select auth.uid(), trim(e.word), coalesce(e.reading,''), coalesce(e.meaning,''), coalesce(e.example,''), coalesce(e.note,''), coalesce(e.created_at,now())
    from jsonb_to_recordset(entries) as e(word text, reading text, meaning text, example text, note text, created_at timestamptz)
    on conflict(user_id,word,reading) do nothing;
  get diagnostics imported = row_count;
  return imported;
end;
$$;
revoke all on function public.import_words(jsonb) from public;
grant execute on function public.import_words(jsonb) to authenticated;

-- The owner explicitly enables dictionary use for their account in SQL Editor.
create table public.dictionary_access(user_id uuid primary key references auth.users(id) on delete cascade);
create table public.dictionary_usage(user_id uuid not null references auth.users(id) on delete cascade, day date not null, calls integer not null, primary key(user_id,day));
alter table public.dictionary_access enable row level security;
alter table public.dictionary_usage enable row level security;
revoke all on public.dictionary_access, public.dictionary_usage from anon, authenticated;

create function public.consume_dictionary_quota() returns boolean
language plpgsql security definer set search_path = '' as $$
declare count_now integer;
begin
  if auth.uid() is null or not exists(select 1 from public.dictionary_access where user_id = auth.uid()) then return false; end if;
  insert into public.dictionary_usage(user_id,day,calls) values(auth.uid(),(now() at time zone 'UTC')::date,1)
    on conflict(user_id,day) do update set calls = public.dictionary_usage.calls + 1 where public.dictionary_usage.calls < 60
    returning calls into count_now;
  return count_now is not null;
end;
$$;
revoke all on function public.consume_dictionary_quota() from public;
grant execute on function public.consume_dictionary_quota() to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.words;
  end if;
end $$;
commit;
