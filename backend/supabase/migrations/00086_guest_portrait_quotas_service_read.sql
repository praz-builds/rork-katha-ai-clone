-- 00086: the two abuse counters are unreadable by the key that is supposed to
-- read them.
--
-- 00084 and 00055 both close with the same three lines -- `revoke all on table`
-- from `public, anon, authenticated`, then `grant execute` on the function to
-- `service_role`. The function grant is right and the revoke is right. What
-- neither migration ever wrote is a table grant to anybody at all, and a table
-- created by the migration role has no grants of its own to fall back on. So
-- `guest_portrait_quotas` and `character_portrait_rate_limits` are readable by
-- exactly nothing that goes through PostgREST -- including a request holding
-- the service key, which comes back
--
--     permission denied for table guest_portrait_quotas
--
-- That is the intended answer for `anon` and `authenticated`, and it stays the
-- intended answer for them. It is the wrong answer for the service key, and it
-- was never a decision -- the grant was simply missing, and the symptom reads
-- identically to a deliberate lockout, which is why it survived two migrations.
--
-- ## Why this does not weaken either cap
--
-- Nothing about the enforcement path changes. The app never reads either table:
-- `generate-character-image` calls `claim_character_portrait_request` and
-- `claim_guest_portrait_request`, and the failure path calls
-- `release_guest_portrait_request`. Those three security-definer functions
-- remain the only door the product uses, they remain executable by
-- `service_role` alone, and a client still cannot read a counter to learn how
-- many slots it has left or write one to reset it. 00084's reasoning for why
-- the counter is a table of its own rather than a column on `profiles` is
-- untouched, because the grant below goes to a role no client ever holds.
--
-- Who the grant is for is humans and automation holding the service key:
-- support answering "why can't I make another character", an abuse review
-- reading how a cap was actually spent, and an agent or test asserting against
-- the live project rather than a PGlite copy of it. Those are all reads and the
-- occasional correction, done by someone who could already call the RPCs and
-- could already reach the table with a direct Postgres connection. Making them
-- go around PostgREST bought no safety; it only meant the correction happened
-- with a psql session and no audit of which key did it.
--
-- ## Why INSERT is not granted
--
-- Select to inspect, update to correct a count, delete to clear a row for an
-- identity that should never have been charged. Inserting a fresh quota row by
-- hand is not a correction -- it is starting a counter outside the RPC that
-- owns its shape, including `first_claimed_at`. The claim functions create the
-- row; let them.
--
-- ## Why RLS stays on
--
-- Because it is still doing its job, and because `service_role` is `bypassrls`
-- in Supabase -- so the policy-less RLS was never what blocked the service key,
-- and turning it off would not have fixed this. RLS with no policy is what
-- makes `anon` and `authenticated` read nothing even if a future migration
-- hands them a table grant by accident; it is the second lock, and the missing
-- grant was the first one. Add the grant, keep the lock.

grant select, update, delete on table public.guest_portrait_quotas
    to service_role;
grant select, update, delete on table public.character_portrait_rate_limits
    to service_role;

-- Restated rather than assumed. 00084 and 00055 each revoked once, at creation;
-- this repeats it immediately after the grant above so that the pair reads as
-- one statement of intent -- the service key may read these, and nothing a
-- browser holds may.
revoke all on table public.guest_portrait_quotas
    from public, anon, authenticated;
revoke all on table public.character_portrait_rate_limits
    from public, anon, authenticated;
