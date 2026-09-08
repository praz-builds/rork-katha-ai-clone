import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleToggle } from "../_shared/engagement.ts";

serve((req) =>
  handleToggle(req, {
    bodyKey: "authorId",
    rpc: "toggle_user_follow",
    logName: "follow-user",
  })
);
