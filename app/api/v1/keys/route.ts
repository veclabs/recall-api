import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { generateApiKey } from '@/lib/keys';

export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabaseAdmin
    .from('api_keys')
    .select('id, key_prefix, name, created_at, last_used_at, revoked')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false });

  return NextResponse.json({ keys: data });
}

export async function POST(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = await req.json();
  const { key, hash, prefix } = generateApiKey();

  await supabaseAdmin.from('api_keys').insert({
    user_id: auth.userId,
    key_hash: hash,
    key_prefix: prefix,
    name: name ?? 'New key',
  });

  return NextResponse.json({ key });
}
