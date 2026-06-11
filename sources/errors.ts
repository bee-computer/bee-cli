export class BeeError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly recoverable: boolean,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AuthError extends BeeError {
  constructor(message: string, suggestion?: string) {
    super(message, 2, true, suggestion ?? "Run bee login");
  }
}

export class ValidationError extends BeeError {
  constructor(message: string) {
    super(message, 3, false);
  }
}

export class ApiError extends BeeError {
  constructor(message: string, suggestion?: string) {
    super(message, 4, true, suggestion ?? "Retry with backoff");
  }
}

export class RateLimitError extends BeeError {
  constructor(message: string) {
    super(message, 5, true, "Wait and retry");
  }
}
