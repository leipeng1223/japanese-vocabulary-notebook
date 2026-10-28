begin;
alter table public.words add constraint words_owner_id_unique unique(user_id,id);
create table public.confusion_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(trim(title)) between 1 and 200),
  note text not null default '' check(length(note)<=8000),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,id)
);
create table public.confusion_group_words (
  user_id uuid not null,
  group_id uuid not null,
  word_id uuid not null,
  position integer not null check(position>=0),
  primary key(group_id,word_id),
  foreign key(user_id,group_id) references public.confusion_groups(user_id,id) on delete cascade,
  foreign key(user_id,word_id) references public.words(user_id,id) on delete cascade
);
alter table public.confusion_groups enable row level security;
alter table public.confusion_group_words enable row level security;
grant select,insert,update,delete on public.confusion_groups,public.confusion_group_words to authenticated;
create policy own_groups on public.confusion_groups for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy own_members on public.confusion_group_words for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create function public.save_confusion_group(target uuid, expected_version integer, group_title text, group_note text, word_ids uuid[]) returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if cardinality(word_ids)<2 or word_ids is null or cardinality(word_ids)>100 then raise exception '请选择 2 至 100 个单词'; end if;
  if (select count(distinct id) from public.words where id=any(word_ids) and user_id=auth.uid())<>cardinality(word_ids) then raise exception '包含重复、已删除或无权访问的单词，请重新选择'; end if;
  if target is null then
    insert into public.confusion_groups(user_id,title,note) values(auth.uid(),trim(group_title),coalesce(group_note,'')) returning id into result;
  else
    update public.confusion_groups set title=trim(group_title),note=coalesce(group_note,''),version=version+1,updated_at=now()
    where id=target and user_id=auth.uid() and version=expected_version returning id into result;
    if result is null then raise exception '分组已被其他设备修改或删除，请同步后重试'; end if;
    delete from public.confusion_group_words where group_id=result;
  end if;
  insert into public.confusion_group_words(user_id,group_id,word_id,position)
    select auth.uid(),result,w.id,(w.ord-1)::integer from unnest(word_ids) with ordinality as w(id,ord);
  return result;
end;
$$;
revoke all on function public.save_confusion_group(uuid,integer,text,text,uuid[]) from public,anon;
grant execute on function public.save_confusion_group(uuid,integer,text,text,uuid[]) to authenticated;
commit;
