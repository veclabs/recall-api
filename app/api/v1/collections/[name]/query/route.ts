import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getCollection } from '@/lib/collections';
import { getOrCreateUserWallet } from '@/lib/wallet';
import { trackUsage, checkLimits } from '@/lib/usage';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const queryCheck = await checkLimits(auth.userId, auth.plan, 'query', supabaseAdmin);
  if (!queryCheck.allowed) return NextResponse.json({ error: queryCheck.reason }, { status: 429 });

  const { vector, topK = 10, filter, includeValues = false } = await req.json();
  if (!vector) return NextResponse.json({ error: 'vector required' }, { status: 400 });

  const { name } = await params;

  const { data: col } = await supabaseAdmin
    .from('collections')
    .select('dimensions, metric')
    .eq('user_id', auth.userId)
    .eq('name', name)
    .single();

  if (!col) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });

  // User wallet needed for Shadow Drive restore on cold start / Redis miss
  const userWallet = await getOrCreateUserWallet(auth.userId);

  const collection = await getCollection(auth.userId, name, col.dimensions, col.metric, userWallet);
  const results = await collection.query({ vector, topK, filter, includeValues });

  await trackUsage(auth.userId, 'query');

  return NextResponse.json({ matches: results.matches });
}