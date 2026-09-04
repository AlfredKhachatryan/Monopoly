-- Monopoly game state, derived from what the client code actually uses.
--
-- src/Hooks/supabase.jsx
--   select * from test where uuid = <code>            (useFetch)
--   update test set <props> where uuid = <code>         (updateDB, followed by .select())
--   realtime: postgres_changes UPDATE on public.test    (useRealtimeUpdates)
--
-- src/Pages/Login.jsx, Board.js, Client.jsx read and write these columns:
--   position       jsonb object  - board keyed "1".."40", see src/Hooks/baseState.jsx
--   "Players"      jsonb array   - [{name, figure, money, position, order, playerId}], max 4 figures
--   current_order  integer       - whose turn: 0..3 (changeOrder wraps at Players.length - 1)
--
-- The client never inserts or deletes rows. Board.js and Client.jsx hard-code
-- uuid = 'v6Pstf', so that row is created at the end of this migration.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.test (
  uuid          text    not null,
  position      jsonb   not null default '{}'::jsonb,
  "Players"     jsonb   not null default '[]'::jsonb,
  current_order integer not null default 0,

  constraint test_pkey                 primary key (uuid),
  constraint test_uuid_format          check (uuid ~ '^[A-Za-z0-9]{4,12}$'),
  constraint test_position_is_object   check (jsonb_typeof(position) = 'object'),
  constraint test_players_is_array     check (jsonb_typeof("Players") = 'array'),
  constraint test_players_max_four     check (jsonb_array_length("Players") <= 4),
  constraint test_current_order_range  check (current_order between 0 and 3)
);

comment on table  public.test               is 'One Monopoly game room per row, looked up by the short code players type on the Login page.';
comment on column public.test.uuid          is 'Room code (short-unique-id, 6 chars). Not a real UUID; the client passes it as text.';
comment on column public.test.position      is 'Board state keyed by cell id "1".."40". Each cell: static card data + fig0..fig3 token flags + bought{fig0..fig3}. Shape from src/Hooks/baseState.jsx.';
comment on column public.test."Players"     is 'Array of up to 4 players: {name, figure, money, position, order, playerId}.';
comment on column public.test.current_order is 'Index of the player whose turn it is (matches Players[].order).';

-- ---------------------------------------------------------------------------
-- Data API exposure
--
-- Since 2026-04-28 new public tables are not exposed to the Data API
-- automatically. The app uses the anon key only, so anon needs the grants.
-- .update().select() in updateDB needs both select and update.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select, update on table public.test to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- There is no sign-in, so the only access model the code supports is
-- "whoever knows the room code can read and update that room".
-- Realtime authorises every event against these policies, so the select
-- policy is what lets subscribers receive UPDATE payloads.
-- No insert or delete policy: the client never does either.
-- ---------------------------------------------------------------------------

alter table public.test enable row level security;

create policy "Anyone can read games"
  on public.test
  for select
  to anon, authenticated
  using (true);

create policy "Anyone can update games"
  on public.test
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Realtime
--
-- useRealtimeUpdates subscribes to { event: "UPDATE", schema: "public",
-- table: "test" }. The table must be in the supabase_realtime publication.
-- Default replica identity is enough: the client reads payload.new only.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'test'
    ) then
      alter publication supabase_realtime add table public.test;
    end if;
  else
    raise notice 'Publication supabase_realtime does not exist; enable Realtime for public.test manually.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The one room the client hard-codes
--
-- Board.js and Client.jsx use uuid = 'v6Pstf' and Login.jsx only ever
-- updates an existing row, so the app is dead without this row.
-- position is the exact output of initialState() from src/Hooks/baseState.jsx.
-- ---------------------------------------------------------------------------

insert into public.test (uuid, position, "Players", current_order)
values (
  'v6Pstf',
  $board${"1":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard1 ","id":1,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Старт","info":"Старт","start":true},"2":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard2 ","id":2,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#D92650","header":"Зайка","info":"Ownd By ''","price":60},"3":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard3 ","id":3,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Community","info":"Community","community":true},"4":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard4 ","id":4,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#D92650","header":"Статуя Гая","info":"Ownd By ''","price":60},"5":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard5 ","id":5,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Tax","info":"Tax","price":200,"tax":true},"6":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard6 ","id":6,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"RailRoad","info":"Support","price":200,"road":true},"7":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard7 ","id":7,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#eb75e7","header":"Фирмини","info":"Ownd By ''","price":100},"8":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard8 ","id":8,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Chance","info":"Chance","chance":true},"9":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard9 ","id":9,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#eb75e7","header":"Чинар","info":"Ownd By ''","price":100},"10":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard10 ","id":10,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#eb75e7","header":"Циран","info":"Ownd By ''","price":120},"11":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard11 ","id":11,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Jail","info":"Jail","jail":true},"12":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard12 ","id":12,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#F5786C","header":"Дом Афо","info":"Ownd By ''","price":140},"13":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard13 ","id":13,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Communal","info":"Light","communal":true,"primary":"#de951f","secondary":"#e9b563","state":"loop-charging"},"14":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard14 ","id":14,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#F5786C","header":"Дом Эро","info":"Ownd By ''","price":140},"15":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard15 ","id":15,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#F5786C","header":"Дом Коли","info":"Ownd By ''","price":160},"16":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard16 ","id":16,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"RailRoad","info":"Offlane","price":200,"road":true},"17":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard17 ","id":17,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#1F8F5D","header":"Далма Молл","info":"Ownd By ''","price":160},"18":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard18 ","id":18,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Community","info":"Community","community":true},"19":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard19 ","id":19,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#1F8F5D","header":"Ереван Молл","info":"Ownd By ''","price":180},"20":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard20 ","id":20,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#1F8F5D","header":"Мега Молл","info":"Ownd By ''","price":200},"21":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard21 ","id":21,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Park","info":"Free Park","parking":true},"22":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard22 ","id":22,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#1F8FFF","header":"Minecraft","info":"Ownd By ''","price":220},"23":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard23 ","id":23,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Chance","info":"Chance","chance":true},"24":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard24 ","id":24,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#1F8FFF","header":"LOL","info":"Ownd By ''","price":220},"25":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard25 ","id":25,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#1F8FFF","header":"For Honor","info":"Ownd By ''","price":240},"26":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard26 ","id":26,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"RailRoad","info":"Midlane","price":200,"road":true},"27":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard27 ","id":27,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#F56CC6","header":"Ubisoft","info":"Ownd By ''","price":260},"28":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard28 ","id":28,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Communal","info":"Water","communal":true,"primary":"#0942b3","secondary":"#1f8fff","state":"hover-pinch"},"29":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard29 ","id":29,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#F56CC6","header":"EGS","info":"Ownd By ''","price":260},"30":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard30 ","id":30,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#F56CC6","header":"Steam","info":"Ownd By ''","price":280},"31":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard31 ","id":31,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Jail","info":"Go To Jail","GTJ":true},"32":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard32 ","id":32,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#6F6CF5","header":"Spotify","info":"Ownd By ''","price":300},"33":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard33 ","id":33,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Community","info":"Community","community":true},"34":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard34 ","id":34,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#6F6CF5","header":"Discord","info":"Ownd By ''","price":300},"35":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard35 ","id":35,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#6F6CF5","header":"Windows","info":"Ownd By ''","price":320},"36":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard36 ","id":36,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"RailRoad","info":"Carry","price":200,"road":true},"37":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard37 ","id":37,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Chance","info":"Chance","chance":true},"38":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard38 ","id":38,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#DE951F","header":"Rainbox 6 Siege","info":"Ownd By ''","price":350},"39":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard39 ","id":39,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#000","header":"Luxury Tax","info":"Luxury Tax","price":400,"tax":true},"40":{"fig0":false,"fig1":false,"fig2":false,"fig3":false,"name":"itemCard40 ","id":40,"bought":{"fig0":false,"fig1":false,"fig2":false,"fig3":false},"color":"#DE951F","header":"Dota 2","info":"Ownd By ''","price":400}}$board$::jsonb,
  '[]'::jsonb,
  0
)
on conflict (uuid) do nothing;
