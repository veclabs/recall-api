import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getCollection } from '@/lib/collections';
import { trackUsage, checkLimits } from '@/lib/usage';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const writeCheck = await checkLimits(auth.userId, auth.plan, 'write', supabaseAdmin);
  if (!writeCheck.allowed) {
    return NextResponse.json({ error: writeCheck.reason }, { status: 429 });
  }

  const vectorCheck = await checkLimits(auth.userId, auth.plan, 'vectors', supabaseAdmin);
  if (!vectorCheck.allowed) {
    return NextResponse.json({ error: vectorCheck.reason }, { status: 429 });
  }

  const { records } = await req.json();
  if (!records?.length) {
    return NextResponse.json({ error: 'records array required' }, { status: 400 });
  }

  const { name } = await params;

  const { data: col } = await supabaseAdmin
    .from('collections')
    .select('dimensions, metric')
    .eq('user_id', auth.userId)
    .eq('name', name)
    .single();

  if (!col) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  const collection = getCollection(auth.userId, name, col.dimensions, col.metric);
  const result = await collection.upsert(records);

  const stats = await collection.describeIndexStats();

  await supabaseAdmin
    .from('collections')
    .update({
      vector_count: stats.vectorCount,
      merkle_root: stats.merkleRoot,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', auth.userId)
    .eq('name', name);

  await trackUsage(auth.userId, 'write', records.length);

  return NextResponse.json({
    upsertedCount: result.upsertedCount,
    merkleRoot: stats.merkleRoot,
  });
}
