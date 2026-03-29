import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { deleteCollection } from '@/lib/collections';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = await params;

  const { data, error } = await supabaseAdmin
    .from('collections')
    .select('*')
    .eq('user_id', auth.userId)
    .eq('name', name)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  return NextResponse.json({ collection: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = await params;

  const { error } = await supabaseAdmin
    .from('collections')
    .delete()
    .eq('user_id', auth.userId)
    .eq('name', name);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await deleteCollection(auth.userId, name);

  return NextResponse.json({ deleted: true });
}
