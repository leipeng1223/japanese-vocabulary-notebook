begin;
alter table public.word_sources add column position integer not null default 0;
grant update,delete on public.word_sources to authenticated;
create policy sources_update on public.word_sources for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy sources_delete on public.word_sources for delete to authenticated using(user_id=auth.uid());
create function public.order_sources(names text[]) returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception '请先登录'; end if;
 update public.word_sources s set position=n.ord::integer from unnest(names) with ordinality n(name,ord) where s.user_id=auth.uid() and s.name=n.name;
end; $$;
create function public.delete_source(source_name text,target_name text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception '请先登录'; end if;
 perform 1 from public.word_sources where user_id=auth.uid() order by name for update;
 if target_name=source_name then raise exception '请选择其他来源'; end if;
 if exists(select 1 from public.words where user_id=auth.uid() and source=source_name) then
   if target_name is null or not exists(select 1 from public.word_sources where user_id=auth.uid() and name=target_name) then raise exception '请选择有效的接收来源'; end if;
   update public.words set source=target_name where user_id=auth.uid() and source=source_name;
 end if;
 delete from public.word_sources where user_id=auth.uid() and name=source_name;
exception when unique_violation then raise exception '目标来源存在同名同读音单词，已取消转移和删除，请先处理重复词';
end; $$;
revoke all on function public.order_sources(text[]),public.delete_source(text,text) from public,anon;
grant execute on function public.order_sources(text[]),public.delete_source(text,text) to authenticated;
commit;
