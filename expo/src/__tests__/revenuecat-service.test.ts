/**
 * The RevenueCat service's start-up: who the customer is, and whether a
 * network failure at boot turns purchases off for the whole session.
 *
 * Both are about the closed test's first real purchase. The webhook can only
 * credit a purchase whose `app_user_id` is the Katha user id; before this,
 * `identify` returned without doing anything while the SDK was still
 * starting, and a session restored at boot never called it at all, so the
 * purchase could go out under the SDK's anonymous id. And a keyed build that
 * started offline stayed "unavailable" until the app was restarted.
 */
const mockConfigure = jest.fn();
const mockLogIn = jest.fn();
const mockGetCustomerInfo = jest.fn();

jest.mock("react-native-purchases", () => ({
  __esModule: true,
  default: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    logIn: (...args: unknown[]) => mockLogIn(...args),
    getCustomerInfo: (...args: unknown[]) => mockGetCustomerInfo(...args),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
  },
}));
jest.mock("react-native-purchases-ui", () => ({ __esModule: true, default: {} }));

type Service = typeof import("@/lib/revenuecat").revenueCatService;

/** A fresh singleton per test: the service is module state. */
function freshService(): Service {
  let service: Service | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    service = require("@/lib/revenuecat").revenueCatService;
  });
  return service!;
}

const PROFILE = { entitlements: { active: {} } };
const USER = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

beforeEach(() => {
  mockConfigure.mockReset();
  mockLogIn.mockReset().mockResolvedValue({ customerInfo: PROFILE });
  mockGetCustomerInfo.mockReset().mockResolvedValue(PROFILE);
});

it("configures as the Katha user when the id is known before activation", async () => {
  const service = freshService();
  await service.logIn(USER);
  await service.activate();
  expect(mockConfigure).toHaveBeenCalledWith(expect.objectContaining({ appUserID: USER }));
  expect(mockLogIn).not.toHaveBeenCalled();
});

it("logs in an id that arrives while activation is still running", async () => {
  let release: (value: unknown) => void = () => undefined;
  mockGetCustomerInfo.mockReturnValue(new Promise((resolve) => (release = resolve)));
  const service = freshService();
  const activating = service.activate();
  await service.logIn(USER); // `configure` has returned; customer info has not
  release(PROFILE);
  await activating;
  expect(mockLogIn).toHaveBeenCalledWith(USER);
});

it("logs in an id that arrived before configure returned, once it does", async () => {
  const service = freshService();
  mockConfigure.mockImplementation(() => {
    // The boot bootstrap resolving between `activate()` and `configure`.
    void service.logIn(USER);
  });
  await service.activate();
  expect(mockLogIn).toHaveBeenCalledWith(USER);
});

it("keeps purchases on when the first customer-info read fails offline", async () => {
  mockGetCustomerInfo.mockRejectedValue(new Error("offline"));
  const service = freshService();
  await service.activate();
  expect(service.isAvailable).toBe(true);
  expect(service.unavailableReason).toBeNull();
});

it("reports a failed start as failed, not as a missing key, and retries it", async () => {
  mockConfigure.mockImplementationOnce(() => {
    throw new Error("native module not ready");
  });
  const service = freshService();
  await service.activate();
  expect(service.isAvailable).toBe(false);
  expect(service.unavailableReason).toBe("failed");

  await service.activate();
  expect(mockConfigure).toHaveBeenCalledTimes(2);
  expect(service.isAvailable).toBe(true);
});
