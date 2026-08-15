import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Get current credit balance for a user.
 * Balance = balance_after from the most recent ledger entry.
 */
export async function getBalance(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("balance_after")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error?.code === "PGRST116") return 0; // no rows = 0 balance
  if (error) throw new Error(`Failed to get balance: ${error.message}`);
  return data.balance_after;
}

/**
 * Deduct credits atomically. Returns new balance or throws if insufficient.
 */
export async function deductCredit(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  amount: number,
  reason: string,
  referenceId?: string
): Promise<number> {
  const currentBalance = await getBalance(supabase, userId);
  if (currentBalance < amount) {
    throw new Error("Insufficient credits");
  }

  const newBalance = currentBalance - amount;

  const { error } = await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount: -amount,
    reason,
    reference_id: referenceId,
    balance_after: newBalance,
  });

  if (error) throw new Error(`Failed to deduct credit: ${error.message}`);
  return newBalance;
}

/**
 * Grant credits. Returns new balance.
 */
export async function grantCredit(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  amount: number,
  reason: string,
  referenceId?: string
): Promise<number> {
  const currentBalance = await getBalance(supabase, userId);
  const newBalance = currentBalance + amount;

  const { error } = await supabase.from("credit_ledger").insert({
    user_id: userId,
    amount,
    reason,
    reference_id: referenceId,
    balance_after: newBalance,
  });

  if (error) throw new Error(`Failed to grant credit: ${error.message}`);
  return newBalance;
}
