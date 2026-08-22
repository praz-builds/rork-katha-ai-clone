import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";

serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  return new Response(
    JSON.stringify({
      error:
        "Direct credit deductions are disabled. Use a trusted operation endpoint.",
    }),
    {
      status: 403,
      headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
    },
  );
});
