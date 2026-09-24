-- 00096: three free character images per account, not six.
--
-- Product owner, 2026-09-24: "3 free character images per account." Every
-- other rule 00088 wrote stands exactly as it was -- lifetime, per USER
-- (anonymous and named alike), generations and edits both count, the free
-- tier and every paid plan get the same number, and past the allowance each
-- image reserves 1 credit and refunds it if nothing arrives. Only the number
-- moves. `source-of-truth/CREDITS_AND_PRICING.md` §3 (*Character images*) is
-- amended in the same change.
--
-- ## What this redefines, and why these three
--
-- The number lives in three function bodies, and each one is restated here
-- with CREATE OR REPLACE. 00088 is applied in production and is never edited.
--
--   1. `claim_character_image_request` -- the enforcement. `v_free_max` 6 -> 3.
--      The body is otherwise 00088's exactly, including every guard; it is
--      copied rather than patched because plpgsql has no way to change one
--      constant in place.
--   2. `character_image_free_remaining` -- what `bootstrap-user` and every
--      image response quote to the client, so the sheet can show the price
--      before the button is pressed. `greatest(0, 3 - used)`.
--   3. `claim_guest_portrait_request` -- 00084's superseded wrapper, kept
--      executable by 00088 for an older deploy of `generate-character-image`.
--      Nothing current calls it, but a function that still exists must agree
--      with the number rather than hand out six to whoever does.
--
-- `release_character_image_request` and `complete_character_image_request`
-- carry no ceiling -- release floors the counter at zero and nothing more --
-- so they are not restated.
--
-- ## Accounts that have already used more than three
--
-- `guest_portrait_quotas.claimed_count` is NOT rewritten. An account that has
-- spent 4, 5 or 6 keeps that count, and every reader here clamps: remaining is
-- `greatest(0, 3 - used)`, so it reads 0, and the claim's `used >= max` branch
-- charges a credit. Nobody is billed retroactively and nobody is handed back
-- slots. Clamping the stored count to 3 instead would lose the history support
-- reads when someone asks "how many did I make", for no behavioural gain.
--
-- A free reservation still in flight when this lands (claimed under 00088,
-- released after) decrements the counter as before. At 4+ that still leaves
-- the account at or above three, i.e. still out of free images -- the refund
-- is for the failed image, not a new free one, and that is the right answer.
--
-- ## Deploy order
--
-- This migration on its own is the whole enforcement change: the deployed
-- `generate-character-image` already reads the allowance from these functions
-- rather than holding its own copy of the number. Redeploy the function
-- afterwards so its comments match, and ship the client so its quote
-- (`FREE_PORTRAITS_PER_ACCOUNT`) agrees; until then the client only ever
-- quotes from the server's `free_remaining`, so it cannot promise a free image
-- the server will charge for.
--
-- Repo rule (00071): NULLIF, COALESCE, GREATEST and LEAST are parser
-- constructs, not `pg_catalog` functions. Under `set search_path = ''` every
-- real function is qualified and these four must NOT be.

comment on table public.guest_portrait_quotas is
  'Lifetime free character images per USER -- three since 00096 (six under 00088), generations and edits alike, anonymous and named. Named "guest" because 00084 created it for anonymous identities only. Never reset; a count above three from before 00096 is kept and reads as none left. Past three the request costs a credit; see character_image_operations.';

comment on column public.guest_portrait_quotas.claimed_count is
  'Free slots spent. A charged image does NOT increment it -- only free ones are counted here, so remaining is greatest(0, 3 - this). May exceed 3 for an account that spent them under the six of 00088.';

-- ---------------------------------------------------------------------------
-- 1. Claim: the free three, then the credit
-- ---------------------------------------------------------------------------

create or replace function public.claim_character_image_request(
    p_user_id uuid,
    p_request_id text,
    /*
      Whether this caller may BUY an image once their three free ones are gone.
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
    v_free_max constant smallint := 3;
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
    for update;

    if found then
        /*
          ONE RESERVATION DRAWS ONCE.

          A replay used to hand the reserved row straight back as usable, and
          the caller drew again -- so two concurrent deliveries of the same
          request id both called the provider and we paid twice for one charge.
          The client mints a fresh id per tap, so this is never a person
          pressing twice; it is the platform re-delivering an invocation.

          `draw_claimed_at` is the claim. The first delivery takes it and draws;
          a second while it is fresh is told the request is in flight and draws
          nothing. The window exists so a delivery whose worker DIED can still
          be retried -- without it a crashed attempt would hold its reservation
          for ever and the user could never get the image they paid for. Three
          minutes is comfortably past the portrait chain's own 80s deadline.
        */
        if v_operation.status = 'reserved'
           and v_operation.draw_claimed_at is not null
           and v_operation.draw_claimed_at
               > pg_catalog.now() - interval '3 minutes' then
            return pg_catalog.jsonb_build_object(
                'operation_id', v_operation.id,
                'status', v_operation.status,
                'credits', v_operation.credits,
                'replayed', true,
                'drawing', false,
                'free_remaining',
                public.character_image_free_remaining(p_user_id),
                'balance', coalesce((
                    select balance_after from public.credit_ledger
                    where user_id = p_user_id
                    order by created_at desc, ledger_sequence desc limit 1
                ), 0)
            );
        end if;

        -- Reserved but unclaimed, or claimed long enough ago that the worker
        -- holding it is gone: this delivery takes the claim and draws.
        if v_operation.status = 'reserved' then
            update public.character_image_operations
            set draw_claimed_at = pg_catalog.now()
            where id = v_operation.id;
        end if;

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
            'drawing', v_operation.status = 'reserved',
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
        -- Stamped on creation: this delivery is the one that draws.
        insert into public.character_image_operations
            (user_id, request_id, draw_claimed_at)
        values (p_user_id, p_request_id, pg_catalog.now())
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
            -- THE SAME WALL AS ABOVE, REPEATED WHERE IT CAN ALSO BE REACHED.
            --
            -- This branch means the free slot was gone by the time the upsert
            -- ran, and it charged unconditionally -- so an anonymous caller
            -- could be debited here despite `p_may_purchase` being false. The
            -- advisory lock makes it unreachable from these RPCs, but 00086
            -- grants service_role UPDATE on `guest_portrait_quotas` and that
            -- writer takes no lock: a support correction landing between the
            -- read and the upsert is enough. A guard that holds only on the
            -- path somebody happened to think of is not a guard.
            if not coalesce(p_may_purchase, false) then
                raise exception using
                    errcode = 'KTH02',
                    message = 'Insufficient credits';
            end if;
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
        -- A fresh reservation is always this delivery's to draw with.
        'drawing', true,
        'free_remaining', public.character_image_free_remaining(p_user_id),
        'balance', coalesce(v_balance, 0)
    );
end;
$$;

comment on function public.claim_character_image_request(uuid, text, boolean) is
  'Service-only. Reserves one character image: free while the user has any of their three left (00096; was six), otherwise debits 1 credit -- but only when p_may_purchase, which is false for an anonymous identity so their bootstrap credits cannot be spent on portraits. KTH02 when they cannot or may not pay. Idempotent per (user, request_id). See 00088, 00096.';

-- ---------------------------------------------------------------------------
-- 2. How many free ones are left
-- ---------------------------------------------------------------------------

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
        3 - coalesce(
            (select claimed_count
             from public.guest_portrait_quotas
             where user_id = p_user_id),
            0
        )
    )::smallint;
$$;

comment on function public.character_image_free_remaining(uuid) is
  'Service-only. How many of the three free character images this user has left; 0 for an account that used more under the six of 00088. See 00096.';

-- ---------------------------------------------------------------------------
-- 3. 00084's superseded wrapper, kept in step
-- ---------------------------------------------------------------------------

create or replace function public.claim_guest_portrait_request(
    p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_claimed smallint;
    v_max constant smallint := 3;
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
  'SUPERSEDED by claim_character_image_request (00088). Kept so an older deploy of generate-character-image still bounds an anonymous caller, now at three (00096). Service role only.';

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE keeps a function's existing ACL, so these are restated
-- only so the file is correct on its own reading: the user id is an argument
-- taken on trust, so the caller must be the service role that verified it.

revoke all on function public.claim_character_image_request(uuid, text, boolean)
    from public, anon, authenticated;
revoke all on function public.character_image_free_remaining(uuid)
    from public, anon, authenticated;
revoke all on function public.claim_guest_portrait_request(uuid)
    from public, anon, authenticated;

grant execute on function public.claim_character_image_request(uuid, text, boolean)
    to service_role;
grant execute on function public.character_image_free_remaining(uuid)
    to service_role;
grant execute on function public.claim_guest_portrait_request(uuid)
    to service_role;
