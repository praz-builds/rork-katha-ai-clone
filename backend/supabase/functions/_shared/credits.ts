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
          ledger_sequence: number;
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
          p_operation_key: string;
        };
        Returns: number;
      };
      grant_credit: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_reason: string;
          p_reference_id: string;
          p_operation_key: string;
        };
        Returns: number;
      };
      refresh_subscription_grant: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_reference_id: string;
          p_operation_key: string;
        };
        Returns: number;
      };
      lapse_credits: {
        Args: {
          p_user_id: string;
          p_reference_id: string;
          p_operation_key: string;
        };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type CreditDeductionReason = "generation" | "chargeback";
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
    .order("ledger_sequence", { ascending: false })
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
  operationKey = `${reason}:${referenceId}`,
): Promise<number> {
  const { data, error } = await supabase.rpc("deduct_credit", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_reference_id: referenceId,
    p_operation_key: operationKey,
  });

  if (error) {
    if (error.message.includes("Insufficient credits")) {
      throw new Error("Insufficient credits");
    }
    if (isDuplicateCreditOperationError(error)) {
      throw new DuplicateCreditOperationError();
    }
    throw new Error(`Failed to deduct credit: ${error.message}`);
  }
  return data as number;
}

/**
 * Grant credits through the service-only, serialized database operation.
 * Reusing the same operation key is an idempotent no-op.
 */
export async function grantCredit(
  supabase: SupabaseClient<CreditDatabase>,
  userId: string,
  amount: number,
  reason: CreditGrantReason,
  referenceId: string,
  operationKey = `${reason}:${referenceId}`,
): Promise<number> {
  const { data, error } = await supabase.rpc("grant_credit", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
    p_reference_id: referenceId,
    p_operation_key: operationKey,
  });

  if (error) {
    if (isDuplicateCreditOperationError(error)) throw new DuplicateCreditOperationError();
    throw new Error(`Failed to grant credit: ${error.message}`);
  }
  return data as number;
}

/** Replace, rather than add to, the renewable subscription-grant bucket. */
export async function refreshSubscriptionGrant(
  supabase: SupabaseClient<CreditDatabase>,
  userId: string,
  amount: number,
  referenceId: string,
  operationKey: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("refresh_subscription_grant", {
    p_user_id: userId,
    p_amount: amount,
    p_reference_id: referenceId,
    p_operation_key: operationKey,
  });
  if (error) {
    if (isDuplicateCreditOperationError(error)) throw new DuplicateCreditOperationError();
    throw new Error(`Failed to refresh subscription grant: ${error.message}`);
  }
  return data as number;
}

/** A concurrent or redelivered payment operation was already recorded. */
export class DuplicateCreditOperationError extends Error {
  constructor() {
    super("Duplicate credit operation");
    this.name = "DuplicateCreditOperationError";
  }
}

export function isDuplicateCreditOperationError(error: unknown): boolean {
  if (error instanceof DuplicateCreditOperationError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = [candidate.message, candidate.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return candidate.code === "23505" ||
    message.includes("Duplicate credit operation") ||
    (/duplicate key/i.test(message) && /operation_key/i.test(message));
}

/** Atomically zero every credit bucket at subscription lapse. */
export async function lapseCredits(
  supabase: SupabaseClient<CreditDatabase>,
  userId: string,
  referenceId: string,
  operationKey: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("lapse_credits", {
    p_user_id: userId,
    p_reference_id: referenceId,
    p_operation_key: operationKey,
  });
  if (error) throw new Error(`Failed to lapse credits: ${error.message}`);
  return data as number;
}
