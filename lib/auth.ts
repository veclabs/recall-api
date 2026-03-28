import { NextRequest } from 'next/server';
import { supabaseAdmin } from './supabase';
import { hashKey } from './keys';

export interface AuthResult {
  userId: string;
  plan: 'free' | 'pro';
}

export async function validateApiKey(req: NextRequest): Promise<AuthResult | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const key = authHeader.replace('Bearer ', '').trim();
  if (!key.startsWith('vl_live_')) {
    return null;
  }

  const hash = hashKey(key);

  const { data: apiKey } = await supabaseAdmin
    .from('api_keys')
    .select('user_id, revoked')
    .eq('key_hash', hash)
    .single();

  if (!apiKey || apiKey.revoked) return null;

  await supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', hash);

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('plan')
    .eq('id', apiKey.user_id)
    .single();

  return {
    userId: apiKey.user_id,
    plan: user?.plan ?? 'free',
  };
}
