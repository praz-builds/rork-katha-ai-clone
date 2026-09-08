import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleRecordRead } from "../_shared/engagement.ts";

serve((req) => handleRecordRead(req));
