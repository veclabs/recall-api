import { SolVec } from '@veclabs/solvec';
import type { DistanceMetric } from '@veclabs/solvec';
import { Keypair } from '@solana/web3.js';
import { getRedis, collectionKey } from './redis';
import { uploadToIrys, downloadFromIrys } from './irys';
import { computeMerkleRoot } from './merkle';

// In-memory cache — survives within a warm function instance only
const cache = new Map<string, any>();

// Server wallet — signs Shadow Drive uploads (not the user's wallet)
// VECLABS_SERVER_WALLET is the base58-encoded secret key of the VecLabs server wallet
function getServerWallet(): Keypair {
  const raw = process.env.VECLABS_SERVER_WALLET;
  if (!raw) throw new Error('VECLABS_SERVER_WALLET not set');
  const bytes = Uint8Array.from(Buffer.from(raw, 'base64'));
  return Keypair.fromSecretKey(bytes);
}

type CollectionSnapshot = {
  vectors: Record<string, number[]>;
  metadata: Record<string, Record<string, any>>;
  writtenAt: Record<string, number>;
  merkleRootAtWrite: Record<string, string>;
};

// Restore a SolVec collection from a snapshot object
async function restoreFromSnapshot(
  name: string,
  dimensions: number,
  metric: string,
  snapshot: CollectionSnapshot
): Promise<any> {
  const sv = new SolVec({ network: 'mainnet-beta' }); // hosted API key mode — no wallet needed for in-memory ops
  const collection = sv.collection(name, { dimensions, metric: metric as DistanceMetric });

  if (snapshot.vectors && Object.keys(snapshot.vectors).length > 0) {
    const records = Object.entries(snapshot.vectors).map(([id, values]) => ({
      id,
      values,
      metadata: snapshot.metadata?.[id] ?? {},
    }));
    await collection.upsert(records);
  }

  return collection;
}

// Get a collection — in-memory cache first, Redis second, Shadow Drive third
export async function getCollection(
  userId: string,
  collectionName: string,
  dimensions: number,
  metric: string = 'cosine',
  userWallet?: Keypair
): Promise<any> {
  const cacheKey = `${userId}:${collectionName}`;

  // 1. In-memory — warm instance
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // 2. Redis cache — fast path
  try {
    const redis = getRedis();
    const snapshot = await redis.get<string>(collectionKey(userId, collectionName));
    if (snapshot) {
      const data = JSON.parse(snapshot) as CollectionSnapshot;
      if (data.vectors && Object.keys(data.vectors).length > 0) {
        const collection = await restoreFromSnapshot(collectionName, dimensions, metric, data);
        cache.set(cacheKey, collection);
        console.log(`[collections] restored ${Object.keys(data.vectors).length} vectors from Redis for ${userId}:${collectionName}`);
        return collection;
      }
    }
  } catch (err) {
    console.warn('[collections] Redis restore failed:', err);
  }

  // 3. Shadow Drive — source of truth for cold starts
  if (userWallet) {
    try {
      const sdData = await downloadFromIrys(userId, collectionName, userWallet);
      if (sdData) {
        const data = sdData as CollectionSnapshot;
        const collection = await restoreFromSnapshot(collectionName, dimensions, metric, data);

        // Populate Redis cache from Shadow Drive restore
        await _writeRedisCache(userId, collectionName, data);

        cache.set(cacheKey, collection);
        console.log(`[collections] restored ${Object.keys(data.vectors ?? {}).length} vectors from Shadow Drive for ${userId}:${collectionName}`);
        return collection;
      }
    } catch (err) {
      console.warn('[collections] Shadow Drive restore failed:', err);
    }
  }

  // 4. Fresh collection — no existing data
  const sv = new SolVec({ network: 'mainnet-beta' });
  const collection = sv.collection(collectionName, { dimensions, metric: metric as DistanceMetric });
  cache.set(cacheKey, collection);
  return collection;
}

// Save a collection — Shadow Drive is source of truth, Redis is cache
// Never throws — write failures are logged, never crash the request
export async function saveCollection(
  userId: string,
  collectionName: string,
  collection: any,
  userWallet?: Keypair
): Promise<string | null> {
  const snapshot: CollectionSnapshot = {
    vectors: collection._vectors ?? {},
    metadata: collection._metadata ?? {},
    writtenAt: collection._written_at ?? {},
    merkleRootAtWrite: collection._merkle_root_at_write ?? {},
  };

  // Compute fresh Merkle root from current vector IDs
  const vectorIds = Object.keys(snapshot.vectors);
  const merkleRoot = computeMerkleRoot(vectorIds);

  // 1. Shadow Drive — primary persistence (best effort, log failures)
  if (userWallet) {
    try {
      const serverWallet = getServerWallet();
      await uploadToIrys(userId, collectionName, serverWallet, userWallet, snapshot);
      console.log(`[collections] uploaded ${vectorIds.length} vectors to Shadow Drive for ${userId}:${collectionName}`);
    } catch (err) {
      // Log but don't crash — Redis cache still has data
      console.error(`[collections] Shadow Drive upload failed for ${userId}:${collectionName}:`, err);
    }
  }

  // 2. Redis — read cache (7 day TTL, refreshed on every write)
  await _writeRedisCache(userId, collectionName, snapshot);

  return merkleRoot;
}

// Write snapshot to Redis cache
async function _writeRedisCache(
  userId: string,
  collectionName: string,
  snapshot: CollectionSnapshot
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(
      collectionKey(userId, collectionName),
      JSON.stringify(snapshot),
      { ex: 60 * 60 * 24 * 7 }
    );
  } catch (err) {
    console.warn('[collections] Redis write failed:', err);
  }
}

// Delete a collection from all layers
export async function deleteCollection(
  userId: string,
  collectionName: string
): Promise<void> {
  const cacheKey = `${userId}:${collectionName}`;
  cache.delete(cacheKey);

  try {
    const redis = getRedis();
    await redis.del(collectionKey(userId, collectionName));
  } catch (err) {
    console.warn('[collections] Redis delete failed:', err);
  }

  // TODO: delete file from Shadow Drive
  // await drive.deleteFile(storageAccount, fileUrl(userId, collectionName));
}