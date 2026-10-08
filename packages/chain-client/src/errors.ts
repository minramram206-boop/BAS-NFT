/** Errors surfaced by the District chain client. */
export class DistrictClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DistrictClientError';
  }
}
