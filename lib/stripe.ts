import Stripe from 'stripe';

let _client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_client) {
    _client = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-03-25.dahlia' as any,
    });
  }
  return _client;
}

export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    const client = getStripe();
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
