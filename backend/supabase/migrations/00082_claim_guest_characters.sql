-- Migration 00082: a character made before sign-in follows the person who made
-- it, on the one path where the identity cannot be kept.
--
-- Character onboarding makes its aha on the anonymous session: the portrait is
-- generated, `saveCharacterToLibrary` writes a `user_characters` row whose
-- `owner_id` is the ANONYMOUS `profiles(id)` (00057), and only then is an email
-- asked for. The client converts that identity in place -- `updateUser({ email
-- })` then `verifyOtp({ type: 'email_change' })` -- so `auth.users.id` survives
-- and the row needs no migration at all. That is the normal path and this
-- function is not on it.
--
-- The exception is an address that already belongs to an account. There is no
-- in-place merge for that: the user signs into the account they already had,
-- the anonymous identity is left behind, and the character they just watched
-- appear becomes invisible -- `user_characters` is owner-only under RLS, so the
-- row is still there and the library simply comes back empty. Nothing errors.
-- That silence is the bug this exists to close.
--
-- ## What proves the claim
--
-- Possession of a still-valid anonymous access token, verified server-side.
-- `bootstrap-user` hands the token to Supabase Auth, requires the user it
-- resolves to be `is_anonymous`, and only then calls this with both ids. The
-- client's own claim about which id it used to be is never trusted, which is
-- why this function is service-role only and takes the guest id as an argument
-- rather than reading `auth.uid()`. A version granted to `authenticated` that
-- took a guest id on trust would let any signed-in user name any anonymous
-- profile and take its characters.
--
-- ## What moves, and what deliberately does not
--
-- `user_characters.owner_id`, and nothing else. Not credits: the guest grant is
-- capped per network per day (00035), and letting it ride onto named accounts
-- would turn that cap into a farm. Not stories: a guest cannot publish, and a
-- draft is not what the onboarding promise was about. Not the profile row --
-- the anonymous `profiles` row and its ledger stay exactly where they are, so
-- nothing that references them (telemetry, rate-limit counters) is disturbed.
--
-- A name the claiming account already uses is skipped rather than merged or
-- renamed: `user_characters_owner_name_key` is unique on (owner_id, lowercased
-- trimmed name), and the row already under that name is the one the account
-- has been using. The guest copy is left on the abandoned profile.

create or replace function public.claim_guest_characters(
    p_guest_user_id uuid,
    p_owner_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_moved integer := 0;
begin
    if p_guest_user_id is null or p_owner_id is null then
        return 0;
    end if;
    -- The conversion path lands here as a no-op rather than an error: same id
    -- means the identity was kept and there is nothing to move.
    if p_guest_user_id = p_owner_id then
        return 0;
    end if;

    if not exists (select 1 from public.profiles where id = p_owner_id) then
        raise exception 'Claiming account has no profile';
    end if;

    -- Serialised on the destination, so two devices claiming onto the same
    -- account cannot both read "no row with that name" and both write one.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('claim-guest-characters:' || p_owner_id::text, 0)
    );

    update public.user_characters as guest
    set owner_id = p_owner_id,
        updated_at = pg_catalog.now()
    where guest.owner_id = p_guest_user_id
      and not exists (
          select 1
          from public.user_characters as owned
          where owned.owner_id = p_owner_id
            and pg_catalog.lower(pg_catalog.btrim(owned.name))
                = pg_catalog.lower(pg_catalog.btrim(guest.name))
      );

    get diagnostics v_moved = row_count;
    return v_moved;
end;
$$;

comment on function public.claim_guest_characters(uuid, uuid) is
  'Re-points user_characters.owner_id from an anonymous profile to a named one. Service role only: the caller must have verified the guest access token first. See 00082.';

revoke all on function public.claim_guest_characters(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.claim_guest_characters(uuid, uuid) to service_role;
