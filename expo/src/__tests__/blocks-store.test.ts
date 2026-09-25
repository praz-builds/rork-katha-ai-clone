/**
 * The block store must never let a slow server read undo a block the reader
 * just made.
 *
 * The boot read of `user_blocks` can still be in flight when the reader
 * blocks somebody from a Home card. That read captured the list BEFORE the
 * block, so publishing it as it lands would bring the blocked writer's cards
 * back. The mock below captures the rows when the read STARTS and resolves
 * later, the way a real slow read does (AGENTS.md: "the mock reads state at
 * resolve time instead of call time" is how a stale-read test proves
 * nothing).
 */
type Rows = { blocked_id: string }[];
let mockPending: ((rows: Rows) => void)[] = [];

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: null } })) },
    from: () => ({
      select: () => ({
        eq: () =>
          new Promise((resolve) => {
            mockPending.push((rows: Rows) => resolve({ data: rows, error: null }));
          }),
      }),
    }),
  },
}));
jest.mock("@/lib/comments", () => ({
  blockAuthor: jest.fn(() => Promise.resolve({})),
  unblockAuthor: jest.fn(() => Promise.resolve({})),
}));

/* eslint-disable import/first */
import {
  clearBlockedAuthors,
  forgetBlocked,
  getBlockedAuthorIds,
  refreshBlockedAuthors,
  rememberBlocked,
} from "@/lib/blocks";
import { setViewerId } from "@/lib/ownership";
/* eslint-enable import/first */

const ME = "11111111-1111-4111-8111-111111111111";
const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  mockPending = [];
  clearBlockedAuthors();
  setViewerId(ME);
});

afterAll(() => setViewerId(null));

it("keeps a block made while the boot read was in flight", async () => {
  const refresh = refreshBlockedAuthors();
  await flush();
  expect(mockPending).toHaveLength(1);

  // The reader blocks Ada before the read lands.
  rememberBlocked(ADA);
  // The read was taken before the block, so it does not contain Ada.
  mockPending[0]([{ blocked_id: BEA }]);
  await refresh;

  const ids = getBlockedAuthorIds();
  expect(ids.has(ADA)).toBe(true);
  expect(ids.has(BEA)).toBe(true);
});

it("keeps an unblock made while the boot read was in flight", async () => {
  rememberBlocked(ADA);
  const refresh = refreshBlockedAuthors();
  await flush();

  forgetBlocked(ADA);
  // The read still lists Ada: it was taken before the unblock.
  mockPending[0]([{ blocked_id: ADA }]);
  await refresh;

  expect(getBlockedAuthorIds().has(ADA)).toBe(false);
});

it("takes the server's list as it is when nothing changed meanwhile", async () => {
  rememberBlocked(ADA);
  const refresh = refreshBlockedAuthors();
  await flush();
  // Ada was unblocked on another device; nothing changed here since the read began.
  mockPending[0]([{ blocked_id: BEA }]);
  await refresh;

  const ids = getBlockedAuthorIds();
  expect(ids.has(ADA)).toBe(false);
  expect(ids.has(BEA)).toBe(true);
});
