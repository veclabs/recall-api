import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { PLAN_LIMITS, Plan } from '@/lib/usage';

export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabaseAdmin
    .from('collections')
    .select('*')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false });

  return NextResponse.json({ collections: data });
}

export async function POST(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, dimensions, metric } = await req.json();

  if (!name || !dimensions) {
    return NextResponse.json({ error: 'name and dimensions required' }, { status: 400 });
  }

  const { count } = await supabaseAdmin
    .from('collections')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', auth.userId);

  const limits = PLAN_LIMITS[auth.plan as Plan] ?? PLAN_LIMITS.free;

  if (limits.collections !== -1 && (count ?? 0) >= limits.collections) {
    return NextResponse.json(
      { error: `Collection limit reached (${limits.collections} collections on ${auth.plan} plan). Upgrade at app.veclabs.xyz/pricing` },
      { status: 429 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from('collections')
    .insert({
      user_id: auth.userId,
      name,
      dimensions,
      metric: metric ?? 'cosine',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ collection: data });
}
