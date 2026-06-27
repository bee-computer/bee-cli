import { describe, expect, it } from "bun:test";
import { BeeError, AuthError, ValidationError, ApiError, RateLimitError } from "./errors";

describe("error classes", () => {
  it("AuthError has exit code 2 and is recoverable", () => {
    const err = new AuthError("Not logged in");
    expect(err).toBeInstanceOf(BeeError);
    expect(err.exitCode).toBe(2);
    expect(err.recoverable).toBe(true);
    expect(err.suggestion).toBe("Run bee login");
    expect(err.message).toBe("Not logged in");
  });

  it("AuthError accepts custom suggestion", () => {
    const err = new AuthError("Token expired", "Refresh your token");
    expect(err.suggestion).toBe("Refresh your token");
  });

  it("ValidationError has exit code 3 and is not recoverable", () => {
    const err = new ValidationError("Missing --text flag");
    expect(err).toBeInstanceOf(BeeError);
    expect(err.exitCode).toBe(3);
    expect(err.recoverable).toBe(false);
    expect(err.message).toBe("Missing --text flag");
  });

  it("ApiError has exit code 4 and is recoverable", () => {
    const err = new ApiError("Server error");
    expect(err).toBeInstanceOf(BeeError);
    expect(err.exitCode).toBe(4);
    expect(err.recoverable).toBe(true);
    expect(err.suggestion).toBe("Retry with backoff");
  });

  it("RateLimitError has exit code 5 and is recoverable", () => {
    const err = new RateLimitError("Too many requests");
    expect(err).toBeInstanceOf(BeeError);
    expect(err.exitCode).toBe(5);
    expect(err.recoverable).toBe(true);
    expect(err.suggestion).toBe("Wait and retry");
  });

  it("all errors have correct name property", () => {
    expect(new AuthError("x").name).toBe("AuthError");
    expect(new ValidationError("x").name).toBe("ValidationError");
    expect(new ApiError("x").name).toBe("ApiError");
    expect(new RateLimitError("x").name).toBe("RateLimitError");
  });
});
