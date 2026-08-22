import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";

serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  return new Response(
    JSON.stringify({
      error:
        "Ad rewards are unavailable until AdMob server-side verification is configured.",
    }),
    {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
