-- Migration 00065: a stranger can list every story's cover and narration.
--
-- Verified against production on 2026-09-10, unauthenticated except for the
-- publishable anon key that ships inside the app bundle:
--
--   POST /storage/v1/object/list/covers  {"prefix":"covers/","limit":6}
--     -> 200, six story UUIDs
--   GET  /storage/v1/object/public/covers/covers/<a PRIVATE story>/cover.png
--     -> 200, 1,942,065 bytes
--
-- The `covers` and `audio` buckets were created by hand rather than by a
-- migration -- which is why no file in this directory has ever described
-- their policies -- and they were created public-read with a SELECT policy
-- broad enough to permit `list`. Public-read was the intended half. Listing
-- was not, and listing is what turns "you need the UUID" into "here are the
-- UUIDs".
--
-- What that costs today: every private story's cover art is downloadable by
-- anyone, and so is every chapter's narration. That includes a story forced
-- private by 00050 for naming a real living person -- the one category where
-- we made an explicit promise about who gets to see it. The prose itself is
-- safe (RLS on `stories` and `chapters` holds; an anonymous select returns
-- zero rows, checked the same day), so this is the media only. It is still a
-- private thing served to the public on request.
--
-- The fix here is narrow and deliberate: client roles lose SELECT on
-- `storage.objects` for these two buckets, which is the privilege `list`
-- requires. Serving is unaffected -- `/object/public/...` on a public bucket
-- does not consult RLS -- so covers and audio keep loading for everyone,
-- including signed-out readers, and no client change is needed.
--
-- What this does NOT fix, stated plainly because the next person will assume
-- it does: a URL that has already been handed out still works, and anyone who
-- learns a story's UUID by other means can still fetch its media. The real
-- fix is private buckets and short-lived signed URLs, which is a client change
-- (every cover in the feed, the story page, the reader and the Listen screen)
-- and is tracked as such. This closes the discovery half now, because
-- discovery is what makes the rest reachable by someone who was not given
-- anything.
--
-- Policies are dropped by predicate rather than by name: they were created
-- through the dashboard, so their names are not in this repository, and
-- guessing them would leave whichever one we guessed wrong still granting the
-- read. `storage.objects` also carries policies for `avatars` (00060) and for
-- the service role, and neither is touched -- the filter is bucket-scoped and
-- role-scoped.

do $$
declare
    v_policy record;
begin
    if to_regclass('storage.objects') is null then
        raise notice 'storage.objects is absent; skipping (local/test harness)';
        return;
    end if;

    for v_policy in
        select policyname
          from pg_policies
         where schemaname = 'storage'
           and tablename = 'objects'
           and cmd in ('SELECT', 'ALL')
           -- Only policies reachable by a client role. `service_role` bypasses
           -- RLS entirely and has no policy of its own to lose; a policy
           -- granted to `{public}` is the permissive default the dashboard
           -- writes, and is the one actually answering these list calls.
           and (roles && array['anon', 'authenticated', 'public']::name[])
           -- Bucket-scoped: the policy body must name one of these two
           -- buckets. A policy that does not mention them cannot be the one
           -- granting a read on them, and avatars keeps 00060's policies.
           and (
                coalesce(qual, '') like '%covers%'
             or coalesce(qual, '') like '%audio%'
           )
    loop
        execute format(
            'drop policy if exists %I on storage.objects',
            v_policy.policyname
        );
        raise notice 'dropped storage.objects policy %', v_policy.policyname;
    end loop;
end;
$$;
