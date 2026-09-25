/**
 * Profile > Blocked accounts: when two loads overlap (the sheet reopened, or
 * Try again pressed, while one is in flight), only the newest answer may be
 * shown. The older one resolving last must not replace it.
 */
import React from "react";
import { act, render } from "@testing-library/react-native";

type Result = { ok: true; accounts: { id: string; name: string; avatarUrl: null; blockedAt: null }[] };
const mockResolvers: ((r: Result) => void)[] = [];

jest.mock("@/lib/blocks", () => ({
  fetchBlockedAccounts: jest.fn(
    () => new Promise((resolve) => mockResolvers.push(resolve)),
  ),
  unblockAuthorEverywhere: jest.fn(() => Promise.resolve()),
}));

/* eslint-disable import/first */
import BlockedAccountsSheet from "@/components/profile/BlockedAccountsSheet";
/* eslint-enable import/first */

const account = (id: string, name: string) => ({ id, name, avatarUrl: null, blockedAt: null });

it("shows the newest load, not an older one that answered last", async () => {
  const view = await render(<BlockedAccountsSheet visible onClose={jest.fn()} />);
  // Close and reopen while the first load is still in flight.
  await view.rerender(<BlockedAccountsSheet visible={false} onClose={jest.fn()} />);
  await view.rerender(<BlockedAccountsSheet visible onClose={jest.fn()} />);
  expect(mockResolvers).toHaveLength(2);

  // The newer load answers first: Bea is the only blocked account now.
  await act(async () => mockResolvers[1]({ ok: true, accounts: [account("b", "Bea")] }));
  // The older load, started before Ada was unblocked elsewhere, answers last.
  await act(async () => mockResolvers[0]({ ok: true, accounts: [account("a", "Ada"), account("b", "Bea")] }));

  expect(view.queryByLabelText("Unblock Ada")).toBeNull();
  expect(view.getByLabelText("Unblock Bea")).toBeTruthy();
});
