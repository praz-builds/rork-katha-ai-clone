-- Atomic credit deduction with FOR UPDATE to prevent race conditions
create or replace function deduct_credit(
    p_user_id uuid,
    p_amount integer,
    p_reason text,
    p_reference_id uuid default null
) returns integer
language plpgsql
security definer
as $$
declare
    v_current_balance integer;
    v_new_balance integer;
begin
    -- Lock the latest ledger row for this user to prevent concurrent reads
    select balance_after into v_current_balance
    from credit_ledger
    where user_id = p_user_id
    order by created_at desc
    limit 1
    for update;

    -- Default to 0 if no rows exist
    v_current_balance := coalesce(v_current_balance, 0);

    if v_current_balance < p_amount then
        raise exception 'Insufficient credits';
    end if;

    v_new_balance := v_current_balance - p_amount;

    insert into credit_ledger (user_id, amount, reason, reference_id, balance_after)
    values (p_user_id, -p_amount, p_reason, p_reference_id, v_new_balance);

    return v_new_balance;
end;
$$;

-- Atomic credit grant with FOR UPDATE to prevent race conditions
create or replace function grant_credit(
    p_user_id uuid,
    p_amount integer,
    p_reason text,
    p_reference_id uuid default null
) returns integer
language plpgsql
security definer
as $$
declare
    v_current_balance integer;
    v_new_balance integer;
begin
    -- Lock the latest ledger row for this user
    select balance_after into v_current_balance
    from credit_ledger
    where user_id = p_user_id
    order by created_at desc
    limit 1
    for update;

    v_current_balance := coalesce(v_current_balance, 0);
    v_new_balance := v_current_balance + p_amount;

    insert into credit_ledger (user_id, amount, reason, reference_id, balance_after)
    values (p_user_id, p_amount, p_reason, p_reference_id, v_new_balance);

    return v_new_balance;
end;
$$;
