import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const month = new Date().toISOString().slice(0, 7);

  const { data } = await supabaseAdmin
    .from('usage')
    .select('*')
    .eq('user_id', auth.userId)
    .eq('month', month)
    .single();

  const limits = {
    free: { writes: 10000, queries: 50000, vectors: 100000 },
    pro: { writes: 1000000, queries: 5000000, vectors: 10000000 },
  };

  return NextResponse.json({
    month,
    plan: auth.plan,
    usage: data ?? { write_count: 0, query_count: 0, vector_count: 0 },
    limits: limits[auth.plan],
  });
}
