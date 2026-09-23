-- One-off repair (2026-09-23, America/Chicago), run after migration 0003.
-- Before schema 3, drops were stored as one running total per item+build+npc+uploader+account and each upload SET it.
-- Forever doesn't load SavedVariables back, so every upload was a separate session and later uploads overwrote
-- earlier ones (Linen Cloth from Vile Familiar: 3, 2, 1 → stored 1). raw_uploads keeps every batch verbatim, so
-- rebuild one row per upload (session 'upload-<id>') and drop the overwritten '' rows they replace.
-- Sessions whose counts matched the previous upload were never sent (same content hash) and can't be recovered.
begin;

create temp table rebuilt on commit drop as
select (d->>'itemId')::int as item_id,
       (d->>'build')::int as build,
       (d->>'npcId')::int as npc_id,
       u.payload->>'uploaderId' as uploader_id,
       u.payload->>'account' as account,
       'upload-' || u.id as session,
       (d->>'count')::int as count
from raw_uploads u, jsonb_array_elements(u.payload->'records'->'drops') d
where coalesce(d->>'session', '') = '';

delete from drops x
using (select distinct item_id, build, npc_id, uploader_id, account from rebuilt) k
where x.session = '' and (x.item_id, x.build, x.npc_id, x.uploader_id, x.account)
      = (k.item_id, k.build, k.npc_id, k.uploader_id, k.account);

insert into drops (item_id, build, npc_id, uploader_id, account, session, count)
select item_id, build, npc_id, uploader_id, account, session, count from rebuilt
on conflict do nothing;

select item_id, npc_id, sum(count) as total, count(*) as sessions
from drops where session like 'upload-%' group by 1, 2 order by total desc limit 10;

commit;
