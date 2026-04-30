import { createHash } from 'crypto';

const PROGRAM_ID = '8xjQ2XrdhR4JkGAdTEB7i34DBkbrLRkcgchKjN1Vn5nP';

// Compute SHA-256 Merkle root from vector IDs
// Domain separators MUST match solvec-core/src/merkle.rs exactly
// Leaf: sha256('leaf:' || id)
// Node: sha256('node:' || left || right)
export function computeMerkleRoot(vectorIds: string[]): string {
  if (vectorIds.length === 0) return '0'.repeat(64);

  // Sort for determinism — must match Rust implementation
  const sorted = [...vectorIds].sort();

  let layer: Buffer[] = sorted.map((id) => {
    const h = createHash('sha256');
    h.update('leaf:');
    h.update(id);
    return h.digest();
  });

  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const h = createHash('sha256');
      h.update('node:');
      h.update(layer[i]);
      // Duplicate last node if odd count — matches Rust impl
      h.update(i + 1 < layer.length ? layer[i + 1] : layer[i]);
      next.push(h.digest());
    }
    layer = next;
  }

  return layer[0].toString('hex');
}

// Post Merkle root to Solana Anchor program
// TODO: requires the Anchor IDL from programs/solvec/target/idl/solvec.json
// Until then, root is computed correctly and stored in Supabase — on-chain posting is next step
// The program ID is: 8xjQ2XrdhR4JkGAdTEB7i34DBkbrLRkcgchKjN1Vn5nP
export async function postMerkleRootToSolana(
  _collectionId: string,
  _root: string,
  _walletSecretKey: Uint8Array
): Promise<string | null> {
  // TODO: implement with @coral-xyz/anchor once IDL is available
  // Instruction: storeMerkleRoot(collection_id: String, root: [u8; 32])
  // Program: PROGRAM_ID
  // Cost: ~$0.00025 per tx on mainnet
  console.log(`[merkle] root computed: ${_root} — on-chain posting pending IDL`);
  return null;
}