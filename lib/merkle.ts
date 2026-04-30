import { createHash } from 'crypto';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, setProvider, Wallet } from '@coral-xyz/anchor';

const PROGRAM_ID = new PublicKey('8xjQ2XrdhR4JkGAdTEB7i34DBkbrLRkcgchKjN1Vn5nP');
const SOLANA_RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

const IDL = {
  address: '8xjQ2XrdhR4JkGAdTEB7i34DBkbrLRkcgchKjN1Vn5nP',
  metadata: { name: 'solvec', version: '0.1.0', spec: '0.1.0' },
  instructions: [
    {
      name: 'create_collection',
      discriminator: [156, 251, 92, 54, 233, 2, 16, 82],
      accounts: [
        { name: 'collection', writable: true, pda: { seeds: [{ kind: 'const', value: [99,111,108,108,101,99,116,105,111,110] }, { kind: 'account', path: 'owner' }, { kind: 'arg', path: 'name' }] } },
        { name: 'owner', writable: true, signer: true },
        { name: 'system_program', address: '11111111111111111111111111111111' },
      ],
      args: [
        { name: 'name', type: 'string' },
        { name: 'dimensions', type: 'u32' },
        { name: 'metric', type: 'u8' },
      ],
    },
    {
      name: 'update_merkle_root',
      discriminator: [195, 173, 38, 60, 242, 203, 158, 93],
      accounts: [
        { name: 'collection', writable: true, pda: { seeds: [{ kind: 'const', value: [99,111,108,108,101,99,116,105,111,110] }, { kind: 'account', path: 'collection.owner', account: 'Collection' }, { kind: 'account', path: 'collection.name', account: 'Collection' }] } },
        { name: 'authority', signer: true },
      ],
      args: [
        { name: 'new_root', type: { array: ['u8', 32] } },
        { name: 'new_vector_count', type: 'u64' },
      ],
    },
  ],
  accounts: [
    { name: 'AccessRecord', discriminator: [224, 96, 239, 97, 225, 133, 153, 188] },
    { name: 'Collection', discriminator: [48, 160, 232, 205, 191, 207, 26, 141] },
  ],
  errors: [],
  types: [
    {
      name: 'Collection',
      type: {
        kind: 'struct',
        fields: [
          { name: 'owner', type: 'pubkey' },
          { name: 'name', type: 'string' },
          { name: 'dimensions', type: 'u32' },
          { name: 'metric', type: 'u8' },
          { name: 'vector_count', type: 'u64' },
          { name: 'merkle_root', type: { array: ['u8', 32] } },
          { name: 'created_at', type: 'i64' },
          { name: 'last_updated', type: 'i64' },
          { name: 'is_frozen', type: 'bool' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
  events: [],
} as any;

export function computeMerkleRoot(vectorIds: string[]): string {
  if (vectorIds.length === 0) return '0'.repeat(64);

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
      h.update(i + 1 < layer.length ? layer[i + 1] : layer[i]);
      next.push(h.digest());
    }
    layer = next;
  }

  return layer[0].toString('hex');
}

function getCollectionPDA(owner: PublicKey, collectionName: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('collection'), owner.toBuffer(), Buffer.from(collectionName)],
    PROGRAM_ID
  );
  return pda;
}

export async function postMerkleRootToSolana(
  collectionName: string,
  merkleRootHex: string,
  walletSecretKey: Uint8Array,
  vectorCount: number = 0
): Promise<string | null> {
  try {
    const wallet = Keypair.fromSecretKey(walletSecretKey);
    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const anchorWallet = new Wallet(wallet);
    const provider = new AnchorProvider(connection, anchorWallet, { commitment: 'confirmed' });
    setProvider(provider);

    const program = new Program(IDL, provider);
    const rootBytes = Array.from(Buffer.from(merkleRootHex, 'hex'));
    const collectionPDA = getCollectionPDA(wallet.publicKey, collectionName);

    // Create collection on-chain if it doesn't exist yet
    const accountInfo = await connection.getAccountInfo(collectionPDA);
    if (!accountInfo) {
      await (program.methods as any)
        .createCollection(collectionName, 1536, 0)
        .accounts({
          collection: collectionPDA,
          owner: wallet.publicKey,
          systemProgram: new PublicKey('11111111111111111111111111111111'),
        })
        .rpc();
      console.log(`[merkle] created collection on-chain: ${collectionPDA.toString()}`);
    }

    const sig = await (program.methods as any)
      .updateMerkleRoot(rootBytes, BigInt(vectorCount))
      .accounts({ collection: collectionPDA, authority: wallet.publicKey })
      .rpc();

    console.log(`[merkle] root posted → https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    return sig;
  } catch (err) {
    console.error('[merkle] on-chain post failed:', err);
    return null;
  }
}