/**
 * Create (idempotently) the house account that authors Katha Originals, and
 * fund it with credits for the generation run.
 *
 *   deno run -A backend/originals/setup-house.ts <credits>
 *
 * Credits go through `grant_credit`, the same ledger every user's balance uses,
 * so the run is charged exactly as a writer's stories are: 1 to start a story,
 * 1 per further chapter, reserved up front for an auto run.
 */
import { callFunction, HOUSE_EMAIL, houseClient, service } from "./lib.ts";

const credits = Number(Deno.args[0] ?? 0);

const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
let user = list?.users.find((u) => u.email === HOUSE_EMAIL);
if (!user) {
  const { data, error } = await service.auth.admin.createUser({
    email: HOUSE_EMAIL,
    email_confirm: true,
    user_metadata: { purpose: "Katha Originals house account" },
  });
  if (error) throw error;
  user = data.user;
  console.log("created", user.id);
} else {
  console.log("exists", user.id);
}

const { client, userId } = await houseClient();
const boot = await callFunction(client, "bootstrap-user", {});
console.log("bootstrap", boot.status, JSON.stringify(boot.body).slice(0, 160));

const { error: profileError } = await service.from("profiles").update({
  display_name: "Katha AI",
  bio: "The house account. Katha Originals, written and illustrated in-house.",
}).eq("id", userId);
if (profileError) console.error("profile", profileError.message);

if (credits > 0) {
  const { data, error } = await service.rpc("grant_credit", {
    p_user_id: userId,
    p_amount: credits,
    p_reason: "welcome",
    p_reference_id: "katha-originals-house-account",
    // Idempotent per amount and day: rerunning the same grant is a no-op.
    p_operation_key: `katha-originals-house-${new Date().toISOString().slice(0, 10)}-${credits}`,
  });
  console.log("grant", error ? error.message : JSON.stringify(data));
}
