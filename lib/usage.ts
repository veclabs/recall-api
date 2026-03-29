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

export async function checkLimits(
  userId: string,
  plan: string,
  type: 'write' | 'query' | 'vectors',
  supabaseAdmin: any
): Promise<{ allowed: boolean; reason?: string }> {
  const limits = PLAN_LIMITS[plan as Plan] ?? PLAN_LIMITS.free;

  // -1 means unlimited
  if (limits.writes === -1) return { allowed: true };

  const month = new Date().toISOString().slice(0, 7);

  const { data } = await supabaseAdmin
    .from('usage')
    .select('write_count, query_count, vector_count')
    .eq('user_id', userId)
    .eq('month', month)
    .single();

  const usage = data ?? { write_count: 0, query_count: 0, vector_count: 0 };

  if (type === 'write' && usage.write_count >= limits.writes) {
    return {
      allowed: false,
      reason: `Monthly write limit reached (${limits.writes.toLocaleString()} writes). Upgrade your plan at app.veclabs.xyz/pricing`,
    };
  }

  if (type === 'query' && usage.query_count >= limits.queries) {
    return {
      allowed: false,
      reason: `Monthly query limit reached (${limits.queries.toLocaleString()} queries). Upgrade your plan at app.veclabs.xyz/pricing`,
    };
  }

  if (type === 'vectors' && usage.vector_count >= limits.vectors) {
    return {
      allowed: false,
      reason: `Vector storage limit reached (${limits.vectors.toLocaleString()} vectors). Upgrade your plan at app.veclabs.xyz/pricing`,
    };
  }

  return { allowed: true };
}

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
