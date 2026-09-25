/**
 * A public profile read that says the viewer blocked this writer must reach
 * the block store, even when the boot read of the block list failed. Without
 * it the writer's page shows an empty shelf and a live Follow button.
 */
const mockInvoke = jest.fn();

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) },
  },
}));
jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn(() => Promise.resolve(null)) }));
jest.mock("@/lib/comments", () => ({
  blockAuthor: jest.fn(() => Promise.resolve({})),
  unblockAuthor: jest.fn(() => Promise.resolve({})),
}));

/* eslint-disable import/first */
import { clearBlockedAuthors, getBlockedAuthorIds } from "@/lib/blocks";
import { fetchPublicProfile } from "@/lib/profile";
/* eslint-enable import/first */

const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  clearBlockedAuthors();
  mockInvoke.mockReset();
});

it("records a block the server reports for this writer", async () => {
  mockInvoke.mockResolvedValue({
    data: { profile: { id: ADA, username: "ada" }, stories: [], viewerBlocked: true },
    error: null,
  });
  await fetchPublicProfile(ADA);
  expect(getBlockedAuthorIds().has(ADA)).toBe(true);
});

it("records nothing when the viewer has not blocked the writer", async () => {
  mockInvoke.mockResolvedValue({
    data: { profile: { id: ADA, username: "ada" }, stories: [] },
    error: null,
  });
  await fetchPublicProfile(ADA);
  expect(getBlockedAuthorIds().has(ADA)).toBe(false);
});
