-- 00088: six character images per person for their whole life, then a credit
-- each -- and the credit is reserved and refunded rather than simply taken.
--
-- `generate-character-image` charges nothing. Its only bound for a signed-in
-- caller is 00055's window of 12 requests per 60 minutes, and a window bounds a
-- burst, not a person: twelve an hour, forever, free, is what a named account
-- can draw today. One call can become up to six paid provider generations (two
-- models across three safety rungs), so that is an unbounded cost with a
-- documented owner and no owner's limit.
--
-- 00084 built the missing half for anonymous identities only -- four for the
-- life of the identity -- and said in its own closing paragraph that the named
-- half was "the 4-free-then-1-credit ledger when it lands". This is it landing,
-- with the number revised by the product owner:
--
--     Six character images per USER, for their lifetime. Generating and
--     editing both count. Past six, one credit each. Free tier and paid plan
--     alike.
--
-- Three things that changes, stated plainly because each supersedes something
-- written down elsewhere:
--
--   1. The four become six, and they stop being anonymous-only. An anonymous
--      identity and a named account are now the same subject with the same
--      allowance, which is why this does not add a second counter beside
--      00084's -- it widens that one. Every count already stored carries: an
--      identity that has spent 3 of its 4 has 3 of 6 spent, not a fresh six.
--   2. `CREDITS_AND_PRICING.md`'s 2026-09-11 amendment gave subscribers
--      UNLIMITED portraits as an explicit exception to the entitlement rule,
--      and §5 recorded it as an exception that "fails the rule". The product
--      owner has withdrawn it: a plan holder gets the same six and then pays
--      from the grant they already bought. The document is updated in the same
--      change as this migration.
--   3. The 12-per-hour window is untouched and still runs first. It bounds a
--      loop; this bounds a person. Neither replaces the other, and a request
--      refused by the window must not also cost one of the six -- which is why
--      the window is claimed before this is.
--
-- ## Why the counter table keeps a name that now says "guest"
--
-- `public.guest_portrait_quotas` is applied to production with real rows in it,
-- and those rows are the counts this migration must not orphan. Renaming it
-- would carry them perfectly -- and would also rewrite the identity of two test
-- files and every reference in 00084 and 00086, for a cosmetic gain. The name
-- is wrong and the comment below says so; the data and the lock key are right.
-- A future migration that has a structural reason to touch this table should
-- rename it then.
--
-- ## Why the reservation is a table of its own and not `generation_operations`
--
-- `generation_operations.story_id` is NOT NULL and references `stories`. A
-- character image has no story -- onboarding draws one before a story exists at
-- all, and the Craft sheet draws one for a brief that may never be generated.
-- Making that column nullable would weaken the constraint that stops a chapter
-- reservation from floating free of its story, to accommodate a row that is not
-- a chapter reservation. So this is its own small table with the same three
-- states and the same idempotency discipline.
--
-- ## What makes a retry safe, given there is no idempotency key worth the name
--
-- The client mints a fresh `request_id` on every tap, so a replay only collides
-- when it is the SAME tap arriving twice -- a network retry, a double-fired
-- promise, an edge invocation the platform re-delivered. That is exactly the
-- case that must not charge twice, and it is the case this handles: the claim
-- is keyed on `(user_id, request_id)`, and a second claim for a key that is
-- already `reserved` returns the first reservation and charges nothing.
--
-- A retry the USER makes is a different tap with a different id, and it is a
-- new paid provider call, so it is a new charge -- but it is never a charge for
-- the failed attempt, because every path that does not deliver an image
-- releases first: a charged reservation is refunded, a free one gives its slot
-- back. The user is never out for work that did not arrive, which is the
-- property that matters; "the same id cannot be billed twice" is the property
-- that makes a retried HTTP request safe.
--
-- A replay of an id that already COMPLETED or was already REFUNDED is neither.
-- It is a client reusing a spent id, and it is refused (`request_id_spent`)
-- rather than silently drawing a second image for one charge -- the same
-- decision `_shared/cover-regeneration.ts` made for regenerated covers.
--
-- ## Fail closed
--
-- Every refusal here is a `false`, a raise, or a KTH02 the caller turns into a
-- 402. There is no path that answers "allowed" when it could not read the
-- count or could not read the balance, because a database blip must not turn
-- the only bound on this endpoint off. 00055 and 00084 both say that; it now
-- has to hold for the credit half too.
--
-- Repo rule (00071 paid for it): NULLIF, COALESCE, GREATEST and LEAST are
-- parser constructs, not `pg_catalog` functions. Under `set search_path = ''`
-- every real function is qualified and these four must NOT be.

-- ---------------------------------------------------------------------------
-- 1. The counter, widened in place
-- ---------------------------------------------------------------------------

comment on table public.guest_portrait_quotas is
  'Lifetime free character images per USER -- six, generations and edits alike, anonymous and named (00088). Named "guest" because 00084 created it for anonymous identities only; the rows and the lock key are unchanged, the scope is not. Never reset. Past six the request costs a credit; see character_image_operations.';

comment on column public.guest_portrait_quotas.claimed_count is
  'Free slots spent, 0..6. A charged image does NOT increment it -- only the free six are counted here, so remaining is always 6 minus this.';

-- ---------------------------------------------------------------------------
-- 2. The reservation
-- ---------------------------------------------------------------------------

create table if not exists public.character_image_operations (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    request_id text not null,
    status text not null default 'reserved'
        check (status in ('reserved', 'completed', 'refunded')),
    -- What this request actually cost. 0 for one of the free six, 1 once they
    -- are gone. Stored rather than re-derived, because the refund has to give
    -- back what was taken and the counter may have moved since.
    credits smallint not null default 0 check (credits >= 0 and credits <= 1),
    last_error text,
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
    unique (user_id, request_id)
);

comment on table public.character_image_operations is
  'One row per generate-character-image request: what it cost and whether it was delivered, refunded, or is still in flight. Keyed (user_id, request_id) so a re-delivered request replays instead of charging twice. See 00088.';

alter table public.character_image_operations enable row level security;

-- No policy, for the reason 00055 and 00084 both state: with RLS on and no
-- policy, `anon` and `authenticated` read nothing and write nothing, and the
-- security-definer functions below are the only door. The row says what a user
-- was charged, so a client that could read it could enumerate its own
-- reservations, and one that could write it could mark a charge refunded.
revoke all on table public.character_image_operations
    from public, anon, authenticated;
-- Select only, and only for the service key, on 00086's reasoning: support
-- answering "I was charged and got nothing" needs to read this, and nobody
-- corrects a reservation by hand -- the release function does that.
grant select on table public.character_image_operations to service_role;

-- ---------------------------------------------------------------------------
-- 3. Claim: the free six, then the credit
-- ---------------------------------------------------------------------------

create or replace function public.claim_character_image_request(
    p_user_id uuid,
    p_request_id text,
    /*
      Whether this caller may BUY an image once their six are gone.
      False for an anonymous identity, and the default is false so a caller
      that forgets the argument refuses to spend rather than spending.

      An unverified user's credits are the three from `bootstrap_user`, and
      they exist to get them a STORY -- the thing that converts them. Letting
      them spend all three on portraits before they have written anything
      leaves them with no story, us with three provider bills, and nothing to
      convert them with. The wall is there to be converted, not waited out,
      which is what its copy has always said: "Sign in to keep making
      characters."
    */
    p_may_purchase boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.character_image_operations;
    v_free_used smallint;
    v_credits smallint := 0;
    v_balance integer;
    v_free_max constant smallint := 6;
begin
    if p_user_id is null then
        raise exception 'A user is required';
    end if;
    if p_request_id is null
       or pg_catalog.btrim(p_request_id) = ''
       or pg_catalog.char_length(p_request_id) > 128 then
        raise exception 'Invalid character image request ID';
    end if;

    -- The same key 00084 takes, deliberately. The superseded wrappers below
    -- still touch this counter during a deploy window where the old edge
    -- function and this migration are both live, and two different lock keys
    -- over one row is the race the lock exists to stop.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('guest-portrait:' || p_user_id::text, 0)
    );

    select *
    into v_operation
    from public.character_image_operations
    where user_id = p_user_id
      and request_id = p_request_id
    limit 1;

    if found then
        select balance_after
        into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, ledger_sequence desc
        limit 1;

        return pg_catalog.jsonb_build_object(
            'operation_id', v_operation.id,
            'status', v_operation.status,
            'credits', v_operation.credits,
            'replayed', true,
            'free_remaining', public.character_image_free_remaining(p_user_id),
            'balance', coalesce(v_balance, 0)
        );
    end if;

    select claimed_count
    into v_free_used
    from public.guest_portrait_quotas
    where user_id = p_user_id
    limit 1;
    v_free_used := coalesce(v_free_used, 0::smallint);

    begin
        insert into public.character_image_operations (user_id, request_id)
        values (p_user_id, p_request_id)
        returning * into v_operation;
    exception
        when unique_violation then
            -- The advisory lock above should make this unreachable. If it is
            -- ever reached the honest answer is a refusal, not a second
            -- reservation for one tap.
            raise exception using
                errcode = 'KTH01',
                message = 'That character image is already being made';
    end;

    -- Out of free images and not allowed to buy: the same KTH02 an empty
    -- balance raises, so the caller's existing refusal path covers both and an
    -- anonymous user is told to sign in rather than shown a price they cannot
    -- pay.
    if v_free_used >= v_free_max and not coalesce(p_may_purchase, false) then
        raise exception using
            errcode = 'KTH02',
            message = 'Insufficient credits';
    end if;

    if v_free_used < v_free_max then
        insert into public.guest_portrait_quotas (user_id, claimed_count)
        values (p_user_id, 1)
        -- The ceiling is restated here rather than trusted from the select: a
        -- concurrent first request can still win the race between the two if
        -- its advisory lock was taken in a transaction that has since
        -- committed. `not found` below is that race losing.
        on conflict (user_id) do update
            set claimed_count = public.guest_portrait_quotas.claimed_count + 1,
                updated_at = pg_catalog.now()
            where public.guest_portrait_quotas.claimed_count < v_free_max;

        if not found then
            -- Lost the race for the last free slot. Charge instead of refusing:
            -- the user asked for an image and can pay for one.
            v_credits := 1;
        end if;
    else
        v_credits := 1;
    end if;

    if v_credits > 0 then
        -- Raises KTH02 when the balance cannot cover it, which aborts this
        -- transaction and takes the reservation row with it -- so a refusal
        -- leaves no reservation behind and the request id stays usable.
        v_balance := public.deduct_credit(
            p_user_id,
            1,
            'generation',
            v_operation.id::text,
            'character_image:' || v_operation.id::text
        );

        update public.character_image_operations
        set credits = 1,
            updated_at = pg_catalog.now()
        where id = v_operation.id;
    else
        select balance_after
        into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, ledger_sequence desc
        limit 1;
    end if;

    return pg_catalog.jsonb_build_object(
        'operation_id', v_operation.id,
        'status', 'reserved',
        'credits', v_credits,
        'replayed', false,
        'free_remaining', public.character_image_free_remaining(p_user_id),
        'balance', coalesce(v_balance, 0)
    );
end;
$$;

comment on function public.claim_character_image_request(uuid, text, boolean) is
  'Service-only. Reserves one character image: free while the user has any of their six left, otherwise debits 1 credit -- but only when p_may_purchase, which is false for an anonymous identity so their bootstrap credits cannot be spent on portraits. KTH02 when they cannot or may not pay. Idempotent per (user, request_id). See 00088.';

-- ---------------------------------------------------------------------------
-- 4. How many free ones are left
-- ---------------------------------------------------------------------------
-- Read by the claim above and by `bootstrap-user`, so the client can say what
-- the next image costs BEFORE the user taps a button that would charge them.
-- A count the user can see is not a secret: it is the price they are about to
-- pay. What stays unreadable by a client is the row, so the number always
-- comes from the server rather than from a client's own arithmetic.

create or replace function public.character_image_free_remaining(
    p_user_id uuid
) returns smallint
language sql
stable
security definer
set search_path = ''
as $$
    select greatest(
        0,
        6 - coalesce(
            (select claimed_count
             from public.guest_portrait_quotas
             where user_id = p_user_id),
            0
        )
    )::smallint;
$$;

comment on function public.character_image_free_remaining(uuid) is
  'Service-only. How many of the six free character images this user has left. See 00088.';

-- ---------------------------------------------------------------------------
-- 5. Complete
-- ---------------------------------------------------------------------------
-- Marks the reservation delivered, so a replay of the same request id is
-- refused rather than drawing a second image against one charge.

create or replace function public.complete_character_image_request(
    p_operation_id uuid,
    p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.character_image_operations
    set status = 'completed',
        updated_at = pg_catalog.now()
    where id = p_operation_id
      and user_id = p_user_id
      and status = 'reserved';
end;
$$;

comment on function public.complete_character_image_request(uuid, uuid) is
  'Service-only. Marks a character image reservation delivered. Idempotent. See 00088.';

-- ---------------------------------------------------------------------------
-- 6. Release: the refund, and the returned free slot
-- ---------------------------------------------------------------------------
-- `CREDITS_AND_PRICING.md` principle 4: a failed paid action refunds itself.
-- The free half of that rule matters just as much here -- onboarding shows
-- "We couldn't find {Name} this time. / Try again" and promises the retry is
-- free, and without the decrement the third failure in a row would end the
-- flow having silently spent three of six.

create or replace function public.release_character_image_request(
    p_operation_id uuid,
    p_user_id uuid,
    p_error text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.character_image_operations;
    v_balance integer;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('guest-portrait:' || p_user_id::text, 0)
    );

    select *
    into v_operation
    from public.character_image_operations
    where id = p_operation_id
      and user_id = p_user_id
    for update;

    if not found then
        raise exception 'Character image operation not found';
    end if;

    select balance_after
    into v_balance
    from public.credit_ledger
    where user_id = p_user_id
    order by created_at desc, ledger_sequence desc
    limit 1;
    v_balance := coalesce(v_balance, 0);

    -- Already settled either way. Returning rather than raising is what makes
    -- a double release harmless: the 502 path and the catch-all both call this,
    -- and a request that failed after being marked complete must not mint a
    -- credit.
    if v_operation.status <> 'reserved' then
        return pg_catalog.jsonb_build_object(
            'status', v_operation.status,
            'refunded', false,
            'credits', v_operation.credits,
            'free_remaining', public.character_image_free_remaining(p_user_id),
            'balance', v_balance
        );
    end if;

    if v_operation.credits > 0 then
        -- Idempotent on its own operation key, so even a release that somehow
        -- ran twice inside one transaction cannot grant twice. The reference id
        -- matches the debit's, which is how `grant_credit` restores the credit
        -- to the bucket it came out of.
        v_balance := public.grant_credit(
            p_user_id,
            v_operation.credits,
            'refund',
            v_operation.id::text,
            'refund:character_image:' || v_operation.id::text
        );
    else
        -- Floors at zero rather than trusting the caller to release once: a
        -- double release must not mint a free slot.
        update public.guest_portrait_quotas
        set claimed_count = claimed_count - 1,
            updated_at = pg_catalog.now()
        where user_id = p_user_id
          and claimed_count > 0;
    end if;

    update public.character_image_operations
    set status = 'refunded',
        last_error = pg_catalog.left(p_error, 1000),
        updated_at = pg_catalog.now()
    where id = p_operation_id;

    return pg_catalog.jsonb_build_object(
        'status', 'refunded',
        'refunded', true,
        'credits', v_operation.credits,
        'free_remaining', public.character_image_free_remaining(p_user_id),
        'balance', v_balance
    );
end;
$$;

comment on function public.release_character_image_request(uuid, uuid, text) is
  'Service-only. Settles a character image that never arrived: refunds the credit, or gives the free slot back. Idempotent. See 00088.';

-- ---------------------------------------------------------------------------
-- 7. 00084's pair, superseded but kept executable
-- ---------------------------------------------------------------------------
-- `claim_guest_portrait_request` / `release_guest_portrait_request` are what the
-- CURRENTLY DEPLOYED `generate-character-image` calls. This migration is
-- applied before that function is redeployed, so for the length of that window
-- they are the live enforcement and they must agree with the new number -- four
-- would mean an anonymous user hitting a wall this migration has already moved.
--
-- They are left in place rather than dropped for the same reason 00077 left a
-- defaulted parameter last: a function an older deploy still names must resolve
-- to something correct, not to `42883`. They touch the same column and take the
-- same lock as the functions above, so the two can be live at once without
-- disagreeing about the count. `release` is unchanged and is not restated.
--
-- Removal condition: delete both, and their entries in 00084's test, once no
-- deployed function calls them.

create or replace function public.claim_guest_portrait_request(
    p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_claimed smallint;
    v_max constant smallint := 6;
begin
    if p_user_id is null then
        return false;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('guest-portrait:' || p_user_id::text, 0)
    );

    select claimed_count into v_claimed
    from public.guest_portrait_quotas
    where user_id = p_user_id
    limit 1;

    if v_claimed is not null and v_claimed >= v_max then
        return false;
    end if;

    insert into public.guest_portrait_quotas (user_id, claimed_count)
    values (p_user_id, 1)
    on conflict (user_id) do update
        set claimed_count = public.guest_portrait_quotas.claimed_count + 1,
            updated_at = pg_catalog.now()
        where public.guest_portrait_quotas.claimed_count < v_max;

    if not found then
        return false;
    end if;

    return true;
end;
$$;

comment on function public.claim_guest_portrait_request(uuid) is
  'SUPERSEDED by claim_character_image_request (00088). Kept so an older deploy of generate-character-image still bounds an anonymous caller, now at six rather than four. Service role only.';

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
-- The user id is an argument taken on trust in every one of these, so the
-- caller must be the service role that verified the token.

revoke all on function public.claim_character_image_request(uuid, text, boolean)
    from public, anon, authenticated;
revoke all on function public.character_image_free_remaining(uuid)
    from public, anon, authenticated;
revoke all on function public.complete_character_image_request(uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.release_character_image_request(uuid, uuid, text)
    from public, anon, authenticated;

grant execute on function public.claim_character_image_request(uuid, text, boolean)
    to service_role;
grant execute on function public.character_image_free_remaining(uuid)
    to service_role;
grant execute on function public.complete_character_image_request(uuid, uuid)
    to service_role;
grant execute on function public.release_character_image_request(uuid, uuid, text)
    to service_role;
