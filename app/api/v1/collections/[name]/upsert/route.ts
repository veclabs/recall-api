import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getCollection, saveCollection } from '@/lib/collections';
import { getOrCreateUserWallet } from '@/lib/wallet';
import { postMerkleRootToSolana } from '@/lib/merkle';
import { trackUsage, checkLimits } from '@/lib/usage';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const writeCheck = await checkLimits(auth.userId, auth.plan, 'write', supabaseAdmin);
  if (!writeCheck.allowed) return NextResponse.json({ error: writeCheck.reason }, { status: 429 });

  const vectorCheck = await checkLimits(auth.userId, auth.plan, 'vectors', supabaseAdmin);
  if (!vectorCheck.allowed) return NextResponse.json({ error: vectorCheck.reason }, { status: 429 });

  const { records } = await req.json();
  if (!records?.length) return NextResponse.json({ error: 'records array required' }, { status: 400 });

  const { name } = await params;

  const { data: col } = await supabaseAdmin
    .from('collections')
    .select('dimensions, metric')
    .eq('user_id', auth.userId)
    .eq('name', name)
    .single();

  if (!col) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });

  // Get or create this user's Solana wallet — used for vector encryption key derivation
  const userWallet = await getOrCreateUserWallet(auth.userId);

  const collection = await getCollection(auth.userId, name, col.dimensions, col.metric, userWallet);
  const result = await collection.upsert(records);

  // saveCollection returns the computed Merkle root
  const merkleRoot = await saveCollection(auth.userId, name, collection, userWallet);

  const stats = await collection.describeIndexStats();

  // Update Supabase with new vector count and Merkle root
  await supabaseAdmin
    .from('collections')
    .update({
      vector_count: stats.vectorCount,
      merkle_root: merkleRoot ?? stats.merkleRoot,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', auth.userId)
    .eq('name', name);

  // Post Merkle root to Solana — fire and forget, does not block the response
  if (merkleRoot) {
    postMerkleRootToSolana(name, merkleRoot, userWallet.secretKey).catch((err) =>
      console.warn('[upsert] Solana Merkle post failed:', err)
    );
  }

  await trackUsage(auth.userId, 'write', records.length);

  return NextResponse.json({
    upsertedCount: result.upsertedCount,
    merkleRoot: merkleRoot ?? stats.merkleRoot,
    solanaProgram: '8xjQ2XrdhR4JkGAdTEB7i34DBkbrLRkcgchKjN1Vn5nP',
  });
}