import { supabaseAdmin } from './supabase';

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
