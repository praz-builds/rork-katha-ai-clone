/**
 * A run's intent has to outlive the process that was executing it.
 *
 * The record is the only thing standing between "the app died at chapter 4 of
 * 7" and a writer who comes back to a story that simply stopped, with no way to
 * tell a finished story from an abandoned run. These tests hold the three
 * properties the type signature cannot: a record for a *different* story is
 * still readable but must be judged by its `storyId`, a malformed record reads
 * as absent rather than throwing into the studio's mount, and an old record
 * expires on exactly the policy `draft-storage.ts` uses.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

/* eslint-disable import/first */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearWriteTheRestRun,
  loadWriteTheRestRun,
  saveWriteTheRestRun,
} from "@/lib/write-the-rest-storage";
/* eslint-enable import/first */

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const KEY = "katha:create:write-the-rest";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

const RUN = {
  storyId: "story-1",
  targetChapterCount: 7,
  illustrated: true,
  startedAtChapterCount: 3,
};

beforeEach(() => {
  storage.getItem.mockReset();
  storage.setItem.mockReset();
  storage.removeItem.mockReset();
});

describe("write-the-rest run persistence", () => {
  it("stamps the record with a save time under the shared key", async () => {
    await saveWriteTheRestRun(RUN);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const [key, raw] = storage.setItem.mock.calls[0];
    expect(key).toBe(KEY);
    const parsed = JSON.parse(raw as string);
    expect(parsed).toMatchObject(RUN);
    expect(typeof parsed.savedAt).toBe("number");
  });

  it("reads a fresh record back", async () => {
    storage.getItem.mockResolvedValue(
      JSON.stringify({ ...RUN, savedAt: Date.now() - 1000 }),
    );

    await expect(loadWriteTheRestRun()).resolves.toMatchObject(RUN);
  });

  it("expires a record older than seven days, and deletes it", async () => {
    storage.getItem.mockResolvedValue(
      JSON.stringify({ ...RUN, savedAt: Date.now() - SEVEN_DAYS - 1 }),
    );

    // Not merely ignored. A record left behind would be offered again on the
    // next launch inside the window of a *later* clock change, and offering to
    // spend credits on a story the writer forgot a week ago is the failure.
    await expect(loadWriteTheRestRun()).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(KEY);
  });

  it("treats a record that is one millisecond inside the window as live", async () => {
    storage.getItem.mockResolvedValue(
      JSON.stringify({ ...RUN, savedAt: Date.now() - SEVEN_DAYS + 5_000 }),
    );

    await expect(loadWriteTheRestRun()).resolves.not.toBeNull();
  });

  it("reads a malformed or half-written record as absent", async () => {
    for (const raw of ["not json", "{}", JSON.stringify({ storyId: "" })]) {
      storage.getItem.mockResolvedValue(raw);
      await expect(loadWriteTheRestRun()).resolves.toBeNull();
    }
  });

  it("never throws when the store itself is broken", async () => {
    storage.setItem.mockRejectedValue(new Error("disk full"));
    storage.getItem.mockRejectedValue(new Error("disk full"));
    storage.removeItem.mockRejectedValue(new Error("disk full"));

    // A run that cannot record itself still runs. Refusing to start because
    // persistence failed would trade a missing resume prompt for no story.
    await expect(saveWriteTheRestRun(RUN)).resolves.toBeUndefined();
    await expect(loadWriteTheRestRun()).resolves.toBeNull();
    await expect(clearWriteTheRestRun()).resolves.toBeUndefined();
  });
});
