import { Keypair } from '@solana/web3.js';
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import { supabaseAdmin } from './supabase';

// WALLET_ENCRYPTION_KEY — 32 random bytes, hex-encoded (64 chars)
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
function getServerEncKey(): Buffer {
  const hex = process.env.WALLET_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('WALLET_ENCRYPTION_KEY must be 32 bytes hex-encoded');
  return Buffer.from(hex, 'hex');
}

// AES-256-GCM encrypt the wallet secret key for Supabase storage
export function encryptSecretKey(secretKey: Uint8Array): string {
  const iv = randomBytes(12); // 96-bit nonce for GCM
  const cipher = createCipheriv('aes-256-gcm', getServerEncKey(), iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

// AES-256-GCM decrypt the wallet secret key from Supabase
export function decryptSecretKey(stored: string): Uint8Array {
  const [ivHex, encHex, tagHex] = stored.split(':');
  const decipher = createDecipheriv('aes-256-gcm', getServerEncKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]);
  return new Uint8Array(dec);
}

// Get or create a Solana keypair for a user — stored encrypted in Supabase
export async function getOrCreateUserWallet(userId: string): Promise<Keypair> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('encrypted_keypair')
    .eq('id', userId)
    .single();

  if (user?.encrypted_keypair) {
    return Keypair.fromSecretKey(decryptSecretKey(user.encrypted_keypair));
  }

  // First time — generate a fresh keypair for this user
  const keypair = Keypair.generate();

  await supabaseAdmin
    .from('users')
    .update({
      solana_pubkey: keypair.publicKey.toString(),
      encrypted_keypair: encryptSecretKey(keypair.secretKey),
    })
    .eq('id', userId);

  return keypair;
}

// Derive AES-256 encryption key from wallet secret key — PBKDF2-HMAC-SHA256
// This MUST match the derivation in solvec-core/src/encryption.rs and sdk/typescript/src/encryption.ts
export function deriveVectorEncKey(secretKey: Uint8Array): Buffer {
  return pbkdf2Sync(
    Buffer.from(secretKey.slice(0, 32)), // seed portion of the keypair
    Buffer.from('solvec-v1'),            // salt — must match SDK
    100_000,                             // iterations — must match SDK
    32,                                  // 256-bit key
    'sha256'
  );
}