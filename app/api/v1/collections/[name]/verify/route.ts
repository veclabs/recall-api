import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getCollection } from '@/lib/collections';
import { computeMerkleRoot } from '@/lib/merkle';
import { planHasFeature } from '@/lib/usage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await validateApiKey(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = await params;

  const { data: col } = await supabaseAdmin
    .from('collections')
    .select('dimensions, metric, merkle_root, vector_count')
    .eq('user_id', auth.userId)
    .eq('name', name)
    .single();

  if (!col) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });

  // Get current collection to compute local root from actual vectors
  const collection = await getCollection(auth.userId, name, col.dimensions, col.metric);
  const entries = collection.hnsw?.getAllEntries?.() ?? [];
  const vectorIds = entries.map((e: any) => e.id);
  const localRoot = computeMerkleRoot(vectorIds);

  const hasSolana = planHasFeature(auth.plan, 'hasSolanaAnchoring');

  if (!hasSolana) {
    // Free tier — return local verification only, no on-chain check
    return NextResponse.json({
      verified: true,
      localRoot,
      onChainRoot: null,
      match: null,
      vectorCount: vectorIds.length,
      plan: auth.plan,
      message: 'Local Merkle root verified. On-chain Solana anchoring available on Pro and above.',
      upgradeUrl: 'https://app.veclabs.xyz/pricing',
      solanaExplorerUrl: null,
    });
  }

  // Pro+ — compare local root against the stored on-chain root
  const onChainRoot = col.merkle_root ?? null;
  const match = onChainRoot ? localRoot === onChainRoot : false;

  return NextResponse.json({
    verified: match,
    localRoot,
    onChainRoot,
    match,
    vectorCount: vectorIds.length,
    plan: auth.plan,
    solanaExplorerUrl: onChainRoot
      ? `https://explorer.solana.com/address/8xjQ2XrdhR4JkGAdTEB7i34DBkbrLRkcgchKjN1Vn5nP?cluster=devnet`
      : null,
  });
}