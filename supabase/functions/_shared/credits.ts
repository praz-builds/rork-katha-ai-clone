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
 * Deduct credits atomically using FOR UPDATE to prevent race conditions.
 * Returns new balance or throws if insufficient.
 */
export async function deductCredit(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  amount: number,
  reason: string,
  referenceId?: string
): Promise<number> {
  const { data, error } = await supabase.rpc("deduct_credit", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_reference_id: referenceId ?? null,
  });

  if (error) {
    if (error.message.includes("Insufficient credits")) {
      throw new Error("Insufficient credits");
    }
    throw new Error(`Failed to deduct credit: ${error.message}`);
  }
  return data as number;
}

/**
 * Grant credits atomically using FOR UPDATE to prevent race conditions.
 * Returns new balance.
 */
export async function grantCredit(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  amount: number,
  reason: string,
  referenceId?: string
): Promise<number> {
  const { data, error } = await supabase.rpc("grant_credit", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_reference_id: referenceId ?? null,
  });

  if (error) throw new Error(`Failed to grant credit: ${error.message}`);
  return data as number;
}
