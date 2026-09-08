import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleToggle } from "../_shared/engagement.ts";

serve((req) =>
  handleToggle(req, {
    bodyKey: "storyId",
    rpc: "toggle_story_like",
    logName: "like",
  })
);
