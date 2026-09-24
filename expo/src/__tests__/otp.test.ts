import { isCompleteOtp, normaliseOtpInput, OTP_LENGTH } from "@/lib/otp";

describe("normaliseOtpInput", () => {
  it("is six digits long", () => {
    expect(OTP_LENGTH).toBe(6);
  });

  it.each([
    ["123456", "123456"],
    ["123 456", "123456"],
    ["123456\n", "123456"],
    ["123-456", "123456"],
    [" 1 2 3 4 5 6 ", "123456"],
    ["12 3", "123"],
    ["", ""],
  ])("reads %j as %j", (raw, code) => {
    expect(normaliseOtpInput(raw)).toEqual({ code, overflow: false });
  });

  it.each(["12345678", "1234 5678", "1234567"])(
    "refuses %j instead of keeping its first six digits",
    (raw) => {
      expect(normaliseOtpInput(raw)).toEqual({ code: "", overflow: true });
    },
  );
});

describe("isCompleteOtp", () => {
  it("is true for exactly six digits only", () => {
    expect(isCompleteOtp("123456")).toBe(true);
    expect(isCompleteOtp("12345")).toBe(false);
    expect(isCompleteOtp("1234567")).toBe(false);
    expect(isCompleteOtp("12345a")).toBe(false);
  });
});
