import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleProfile } from "../_shared/profile.ts";

serve((req) => handleProfile(req));
