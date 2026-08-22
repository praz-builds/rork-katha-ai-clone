import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type CreditDatabase = {
  public: {
    Tables: {
      credit_ledger: {
        Row: {
          id: string;
          user_id: string;
          balance_after: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      deduct_credit: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_reason: string;
          p_reference_id: string;
        };
        Returns: number;
      };
      grant_credit: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_reason: string;
          p_reference_id: string;
        };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type CreditDeductionReason = "generation";
export type CreditGrantReason =
  | "purchase"
  | "subscription"
  | "ad_reward"
  | "streak"
  | "feedback"
  | "referral"
  | "social"
  | "welcome"
  | "refund"
  | "reader_earning";

/**
 * Get current credit balance for a user.
 * Balance = balance_after from the most recent ledger entry.
 */
export async function getBalance(
  supabase: SupabaseClient<CreditDatabase>,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("balance_after")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .single();

  if (error?.code === "PGRST116") return 0; // no rows = 0 balance
  if (error) throw new Error(`Failed to get balance: ${error.message}`);
  return data.balance_after;
}

/**
 * Deduct credits through the service-only, serialized database operation.
 * A reference ID is mandatory so retries cannot charge twice.
 */
export async function deductCredit(
  supabase: SupabaseClient<CreditDatabase>,
  userId: string,
  amount: number,
  reason: CreditDeductionReason,
  referenceId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("deduct_credit", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_reference_id: referenceId,
  });

  if (error) {
    if (error.message.includes("Insufficient credits")) {
      throw new Error("Insufficient credits");
    }
    if (error.message.includes("Duplicate credit operation")) {
      throw new Error("Duplicate credit operation");
    }
    throw new Error(`Failed to deduct credit: ${error.message}`);
  }
  return data as number;
}

/**
 * Grant credits through the service-only, serialized database operation.
 * Reusing the same reason and reference ID is an idempotent no-op.
 */
export async function grantCredit(
  supabase: SupabaseClient<CreditDatabase>,
  userId: string,
  amount: number,
  reason: CreditGrantReason,
  referenceId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("grant_credit", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_reference_id: referenceId,
  });

  if (error) throw new Error(`Failed to grant credit: ${error.message}`);
  return data as number;
}
