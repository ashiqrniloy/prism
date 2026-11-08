export class PricingError extends Error {
  constructor(message) {
    super(message);
    this.name = "PricingError";
  }
}
