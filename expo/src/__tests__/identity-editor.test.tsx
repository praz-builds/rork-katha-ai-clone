/**
 * The profile sheet, and the two ways it could hand back a lie.
 *
 * It is a `<Modal visible={…}>`, so it MOUNTS with the screen and merely
 * becomes visible later. Both failures below come from that: state seeded
 * once at mount is state seeded before the profile exists, and a save that
 * writes two things in sequence has a middle where one has landed and the
 * other has not.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

const mockClaimUsername = jest.fn();
const mockSaveBio = jest.fn();

jest.mock("@/lib/profile", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...jest.requireActual("@/lib/profile"),
  claimUsername: (raw: string) => mockClaimUsername(raw),
  saveBio: (raw: string) => mockSaveBio(raw),
  pickAndUploadAvatar: jest.fn(),
}));

/* eslint-disable import/first */
import IdentityEditor from "@/components/profile/IdentityEditor";
/* eslint-enable import/first */

type Props = React.ComponentProps<typeof IdentityEditor>;

const renderEditor = async (overrides: Partial<Props> = {}) => {
  const props: Props = {
    visible: true,
    username: null,
    avatarUrl: null,
    bio: null,
    onClose: jest.fn(),
    onSaved: jest.fn(),
    ...overrides,
  };
  const view = await render(<IdentityEditor {...props} />);
  return {
    view,
    props,
    rerender: async (next: Partial<Props>) =>
      await view.rerender(<IdentityEditor {...props} {...next} />),
  };
};

beforeEach(() => {
  mockClaimUsername.mockReset();
  mockSaveBio.mockReset();
});

describe("a profile that arrives after the sheet is already open", () => {
  it("fills the fields in rather than leaving them blank", async () => {
    // `useState(username ?? "")` runs at MOUNT, and the sheet mounts with the
    // screen. Anyone who opened the editor before the profile fetch landed
    // saw an empty handle and an empty bio over a profile that had both —
    // and saving from there would have written the blanks back.
    const { view, rerender } = await renderEditor({ username: null, bio: null });
    expect(view.getByTestId("username-input").props.value).toBe("");

    await rerender({ username: "adalovelace", bio: "I write about engines." });

    await waitFor(() =>
      expect(view.getByTestId("username-input").props.value).toBe("adalovelace")
    );
    expect(view.getByTestId("bio-input").props.value).toBe(
      "I write about engines.",
    );
  });

  it("does not overwrite what somebody is in the middle of typing", async () => {
    const { view, rerender } = await renderEditor({ username: null, bio: null });

    await fireEvent.changeText(view.getByTestId("username-input"), "newname");
    await rerender({ username: "adalovelace", bio: "I write about engines." });

    // A late fetch must not reach in and take the keyboard away.
    expect(view.getByTestId("username-input").props.value).toBe("newname");
  });

  it("adopts the current profile again each time it reopens", async () => {
    const { view, rerender } = await renderEditor({ username: "adalovelace" });
    await fireEvent.changeText(view.getByTestId("username-input"), "halfway");

    await rerender({ visible: false });
    await rerender({ visible: true, username: "adalovelace" });

    // A closed-and-reopened sheet is a fresh edit of the profile as it
    // stands, not a resumption of an abandoned one.
    await waitFor(() =>
      expect(view.getByTestId("username-input").props.value).toBe("adalovelace")
    );
  });
});

describe("a save where the handle lands and the bio does not", () => {
  it("reports the handle that was actually claimed", async () => {
    // `claimUsername` writes to the server. If `saveBio` then fails, the
    // handle is already changed — and the earlier version returned without
    // calling `onSaved` at all, so the profile screen kept showing the old
    // handle while the server disagreed with it.
    mockClaimUsername.mockResolvedValue({ ok: true, username: "adalovelace" });
    mockSaveBio.mockResolvedValue(undefined);

    const onSaved = jest.fn();
    const onClose = jest.fn();
    const { view } = await renderEditor({ username: null, bio: null, onSaved, onClose });

    await fireEvent.changeText(view.getByTestId("username-input"), "adalovelace");
    await fireEvent.changeText(view.getByTestId("bio-input"), "Engines.");
    await act(async () => {
      await fireEvent.press(view.getByTestId("identity-save"));
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      username: "adalovelace",
    }));
    // No bio in the payload, because no bio was saved.
    expect(onSaved.mock.calls[0][0].bio).toBeUndefined();
    // And the sheet stays open with the explanation, so the bio can be
    // retried without re-claiming a handle they already own.
    expect(onClose).not.toHaveBeenCalled();
    expect(view.getByTestId("identity-notice")).toBeTruthy();
  });

  it("says nothing when the handle failed too", async () => {
    mockClaimUsername.mockResolvedValue({ ok: false, reason: "taken" });

    const onSaved = jest.fn();
    const { view } = await renderEditor({ username: null, bio: null, onSaved });

    await fireEvent.changeText(view.getByTestId("username-input"), "adalovelace");
    await act(async () => {
      await fireEvent.press(view.getByTestId("identity-save"));
    });

    await waitFor(() => expect(view.getByTestId("identity-notice")).toBeTruthy());
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockSaveBio).not.toHaveBeenCalled();
  });

  it("reports both when both land", async () => {
    mockClaimUsername.mockResolvedValue({ ok: true, username: "adalovelace" });
    mockSaveBio.mockResolvedValue("Engines.");

    const onSaved = jest.fn();
    const onClose = jest.fn();
    const { view } = await renderEditor({ username: null, bio: null, onSaved, onClose });

    await fireEvent.changeText(view.getByTestId("username-input"), "adalovelace");
    await fireEvent.changeText(view.getByTestId("bio-input"), "Engines.");
    await act(async () => {
      await fireEvent.press(view.getByTestId("identity-save"));
    });

    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        username: "adalovelace",
        bio: "Engines.",
      })
    );
    expect(onClose).toHaveBeenCalled();
  });
});
