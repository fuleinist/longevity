/** Errors that map to a CLI exit code. */
export class UsageError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export class DataError extends Error {
  readonly exitCode = 3;
  readonly problems: string[];
  constructor(message: string, problems: string[] = []) {
    super(problems.length ? `${message}: ${problems.join('; ')}` : message);
    this.name = 'DataError';
    this.problems = problems;
  }
}