import { Uploader } from '@irys/upload';
import { Solana } from '@irys/upload-solana';
import { Keypair } from '@solana/web3.js';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { supabaseAdmin } from './supabase';
import { deriveVectorEncKey } from './wallet';

const IRYS_GATEWAY = 'https://gateway.irys.xyz';
const SOLANA_RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

// Encrypt collection snapshot with the user's wallet-derived AES-256-GCM key
function encryptSnapshot(data: object, encKey: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data))), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: [12 bytes iv][16 bytes tag][ciphertext]
  return Buffer.concat([iv, tag, enc]);
}

// Decrypt collection snapshot
function decryptSnapshot(raw: Buffer, encKey: Buffer): object {
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString());
}

// Get an authenticated Irys uploader using the server wallet + Solana
async function getIrysUploader(serverWallet: Keypair) {
  // @irys/upload-solana expects the raw secret key as a Uint8Array
  return await Uploader(Solana)
    .withWallet(serverWallet.secretKey)
    .withRpc(SOLANA_RPC)
    .devnet();
}

// Upload encrypted collection snapshot to Irys permanently
// Returns the Irys transaction ID — stored in Supabase collections.irys_tx_id
export async function uploadToIrys(
  userId: string,
  collectionName: string,
  serverWallet: Keypair,
  userWallet: Keypair,
  data: object
): Promise<string> {
  const encKey = deriveVectorEncKey(userWallet.secretKey);
  const encrypted = encryptSnapshot(data, encKey);

  const uploader = await getIrysUploader(serverWallet);

  // Check balance — auto-fund if low (0.001 SOL threshold covers ~20MB of uploads)
  const price = await uploader.getPrice(encrypted.length);
  const balance = await uploader.getLoadedBalance();
  if (balance < price) {
    await uploader.fund(price);
  }

  const receipt = await uploader.upload(encrypted, {
    tags: [
      { name: 'App-Name', value: 'recall' },
      { name: 'User-Id', value: userId },
      { name: 'Collection', value: collectionName },
      { name: 'Content-Type', value: 'application/octet-stream' },
      { name: 'Version', value: '1' },
    ],
  });

  // Persist the transaction ID in Supabase so we can fetch it later
  await supabaseAdmin
    .from('collections')
    .update({ irys_tx_id: receipt.id, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('name', collectionName);

  console.log(`[irys] uploaded ${encrypted.length} bytes for ${userId}:${collectionName} → ${receipt.id}`);
  return receipt.id;
}

// Download and decrypt a collection snapshot from Irys gateway
// Uses the transaction ID stored in Supabase
export async function downloadFromIrys(
  userId: string,
  collectionName: string,
  userWallet: Keypair
): Promise<object | null> {
  try {
    // Look up the latest transaction ID from Supabase
    const { data: col } = await supabaseAdmin
      .from('collections')
      .select('irys_tx_id')
      .eq('user_id', userId)
      .eq('name', collectionName)
      .single();

    if (!col?.irys_tx_id) return null;

    const res = await fetch(`${IRYS_GATEWAY}/${col.irys_tx_id}`);
    if (!res.ok) return null;

    const raw = Buffer.from(await res.arrayBuffer());
    const encKey = deriveVectorEncKey(userWallet.secretKey);
    return decryptSnapshot(raw, encKey);
  } catch (err) {
    console.warn(`[irys] download failed for ${userId}:${collectionName}:`, err);
    return null;
  }
}