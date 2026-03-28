import { supabaseAdmin } from './supabase';

export type Plan = 'free' | 'pro' | 'business' | 'enterprise';

export const PLAN_LIMITS: Record<Plan, {
  writes: number;
  queries: number;
  vectors: number;
  collections: number;
  api_keys: number;
}> = {
  free: {
    writes: 10_000,
    queries: 50_000,
    vectors: 100_000,
    collections: 3,
    api_keys: 1,
  },
  pro: {
    writes: 500_000,
    queries: 1_000_000,
    vectors: 2_000_000,
    collections: 25,
    api_keys: 5,
  },
  business: {
    writes: 5_000_000,
    queries: 10_000_000,
    vectors: 20_000_000,
    collections: -1,
    api_keys: -1,
  },
  enterprise: {
    writes: -1,
    queries: -1,
    vectors: -1,
    collections: -1,
    api_keys: -1,
  },
};

export async function trackUsage(
  userId: string,
  type: 'write' | 'query',
  count: number = 1
) {
  const month = new Date().toISOString().slice(0, 7);
  const field = type === 'write' ? 'write_count' : 'query_count';

  await supabaseAdmin.rpc('increment_usage', {
    p_user_id: userId,
    p_month: month,
    p_field: field,
    p_count: count,
  });
}
