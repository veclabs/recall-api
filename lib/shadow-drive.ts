import { Keypair } from '@solana/web3.js';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { deriveVectorEncKey } from './wallet';

// Set in Vercel env vars — the shared VecLabs Shadow Drive storage account pubkey
// Created once via Shadow Drive CLI: shdw-drive create-storage-account --name veclabs --size 10GB
const STORAGE_ACCOUNT = process.env.VECLABS_SHADOW_DRIVE_ACCOUNT!;
const SHADOW_UPLOAD = process.env.SHADOW_DRIVE_ENDPOINT ?? 'https://shadow-storage.genesysgo.net';
const SHADOW_CDN = process.env.SHADOW_DRIVE_CDN ?? 'https://shdw-drive.genesysgo.net';

// File path within the shared storage account — user-namespaced
function fileName(userId: string, collectionName: string): string {
  return `${userId}/${collectionName}.json`;
}

function fileUrl(userId: string, collectionName: string): string {
  return `${SHADOW_CDN}/${STORAGE_ACCOUNT}/${fileName(userId, collectionName)}`;
}

// Encrypt collection snapshot with the user's wallet-derived key
function encryptSnapshot(data: object, encKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(data))),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    ciphertext: enc.toString('hex'),
    tag: tag.toString('hex'),
  });
}

// Decrypt collection snapshot with the user's wallet-derived key
function decryptSnapshot(raw: string, encKey: Buffer): object {
  const { iv, ciphertext, tag } = JSON.parse(raw);
  const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString());
}

// Sign the Shadow Drive upload message with the server wallet
// Shadow Drive v2 signing: nacl ed25519, base58-encoded
function signUploadMessage(content: string, wallet: Keypair): string {
  const sha = createHash('sha256').update(content).digest('hex');
  const msg = Buffer.from(
    `Shadow Drive Signed Message:\nStorage Account: ${STORAGE_ACCOUNT}\nUpload files with hash: ${sha}`
  );
  const sig = nacl.sign.detached(msg, wallet.secretKey);
  return bs58.encode(sig);
}

// Upload encrypted collection snapshot to Shadow Drive
// Uses shared VecLabs storage account — vectors encrypted with user's wallet key
export async function uploadToShadowDrive(
  userId: string,
  collectionName: string,
  serverWallet: Keypair,  // signs the upload (VecLabs server wallet)
  userWallet: Keypair,    // derives the encryption key (user's wallet)
  data: object
): Promise<void> {
  if (!STORAGE_ACCOUNT) throw new Error('VECLABS_SHADOW_DRIVE_ACCOUNT not set');

  const encKey = deriveVectorEncKey(userWallet.secretKey);
  const encrypted = encryptSnapshot(data, encKey);
  const name = fileName(userId, collectionName);

  const blob = new Blob([encrypted], { type: 'application/json' });
  const signature = signUploadMessage(encrypted, serverWallet);

  // Check if file already exists — use edit endpoint if so
  const existing = await fetch(fileUrl(userId, collectionName), { method: 'HEAD' });

  const form = new FormData();
  form.append('file', blob, name);
  form.append('message', signature);
  form.append('signer', serverWallet.publicKey.toString());
  form.append('storage_account', STORAGE_ACCOUNT);

  let endpoint = `${SHADOW_UPLOAD}/upload`;
  if (existing.ok) {
    endpoint = `${SHADOW_UPLOAD}/edit`;
    form.append('url', fileUrl(userId, collectionName));
  }

  const res = await fetch(endpoint, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shadow Drive upload failed (${res.status}): ${body}`);
  }
}

// Download and decrypt a collection snapshot from Shadow Drive
export async function downloadFromShadowDrive(
  userId: string,
  collectionName: string,
  userWallet: Keypair
): Promise<object | null> {
  try {
    const res = await fetch(fileUrl(userId, collectionName));
    if (!res.ok) return null;

    const raw = await res.text();
    const encKey = deriveVectorEncKey(userWallet.secretKey);
    return decryptSnapshot(raw, encKey);
  } catch (err) {
    console.warn(`Shadow Drive download failed for ${userId}/${collectionName}:`, err);
    return null;
  }
}