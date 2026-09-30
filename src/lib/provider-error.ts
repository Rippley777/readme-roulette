/** Safe messages only: provider response bodies can contain sensitive request details. */
export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
