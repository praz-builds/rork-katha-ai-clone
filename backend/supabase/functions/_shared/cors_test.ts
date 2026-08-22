import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corsHeadersFor, handleCors } from "./cors.ts";

Deno.test("CORS echoes only configured origins", () => {
  const previous = Deno.env.get("ALLOWED_ORIGINS");
  try {
    Deno.env.set(
      "ALLOWED_ORIGINS",
      "https://app.katha.example, http://localhost:8090",
    );

    const allowed = new Request("https://api.katha.example", {
      headers: { Origin: "http://localhost:8090" },
    });
    const denied = new Request("https://api.katha.example", {
      headers: { Origin: "https://untrusted.example" },
    });

    assertEquals(
      corsHeadersFor(allowed)["Access-Control-Allow-Origin"],
      "http://localhost:8090",
    );
    assertEquals(
      corsHeadersFor(denied)["Access-Control-Allow-Origin"],
      undefined,
    );
  } finally {
    if (previous === undefined) Deno.env.delete("ALLOWED_ORIGINS");
    else Deno.env.set("ALLOWED_ORIGINS", previous);
  }
});

Deno.test("CORS preflight uses cached allowlisted headers", async () => {
  const previous = Deno.env.get("ALLOWED_ORIGINS");
  try {
    Deno.env.set("ALLOWED_ORIGINS", "https://app.katha.example");
    const response = handleCors(
      new Request("https://api.katha.example", {
        method: "OPTIONS",
        headers: { Origin: "https://app.katha.example" },
      }),
    );

    assertEquals(response?.status, 204);
    assertEquals(
      response?.headers.get("Access-Control-Allow-Origin"),
      "https://app.katha.example",
    );
    assertEquals(response?.headers.get("Access-Control-Max-Age"), "86400");
    assertEquals(await response?.text(), "");
  } finally {
    if (previous === undefined) Deno.env.delete("ALLOWED_ORIGINS");
    else Deno.env.set("ALLOWED_ORIGINS", previous);
  }
});
