import Stripe from 'stripe';

let _client: Stripe | null = null;

export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    if (!_client) {
      _client = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2026-03-25.dahlia' as any,
      });
    }
    const value = (_client as any)[prop];
    return typeof value === 'function' ? value.bind(_client) : value;
  },
});
