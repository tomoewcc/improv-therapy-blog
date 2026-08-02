-- 瀏覽計數器 —— 在 Supabase 的 SQL Editor 貼上整段執行一次即可。
--
-- 安全模型：
--   前端帶的是 anon public key（本來就會公開在原始碼裡）。
--   因此 anon 只給「讀取次數」的權限，寫入一律走 SECURITY DEFINER 函式，
--   前端無法直接 UPDATE 任意數字。

create table if not exists public.page_views (
  slug       text primary key,
  views      bigint      not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.page_views enable row level security;

-- 任何人都可以讀次數（頁面要顯示）
drop policy if exists "anyone can read view counts" on public.page_views;
create policy "anyone can read view counts"
  on public.page_views for select
  to anon, authenticated
  using (true);

-- 刻意不建立 insert / update / delete 政策：
-- 前端無法直接改數字，只能透過下面的函式 +1。

create or replace function public.increment_page_view(page_slug text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count bigint;
begin
  -- 擋掉空值與過長的 slug，避免被灌垃圾資料
  if page_slug is null or length(page_slug) = 0 or length(page_slug) > 128 then
    raise exception 'invalid slug';
  end if;

  insert into public.page_views as pv (slug, views, updated_at)
  values (page_slug, 1, now())
  on conflict (slug)
  do update set views = pv.views + 1, updated_at = now()
  returning pv.views into new_count;

  return new_count;
end;
$$;

revoke all on function public.increment_page_view(text) from public;
grant execute on function public.increment_page_view(text) to anon, authenticated;
