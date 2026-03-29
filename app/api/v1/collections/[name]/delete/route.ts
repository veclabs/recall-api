import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getCollection, saveCollection } from '@/lib/collections';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ids } = await req.json();
  if (!ids?.length) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 });
  }

  const { name } = await params;

  const { data: col } = await supabaseAdmin
    .from('collections')
    .select('dimensions, metric')
    .eq('user_id', auth.userId)
    .eq('name', name)
    .single();

  if (!col) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });

  const collection = await getCollection(auth.userId, name, col.dimensions, col.metric);
  await collection.delete(ids);

  await saveCollection(auth.userId, name, collection);

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

  return NextResponse.json({ deleted: true, deletedCount: ids.length });
}
