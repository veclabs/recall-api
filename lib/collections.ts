import { SolVec } from '@veclabs/solvec';
import type { DistanceMetric } from '@veclabs/solvec';
import { getRedis, collectionKey } from './redis';

// In-memory cache — survives within a warm function instance
const cache = new Map<string, any>();

export async function getCollection(
  userId: string,
  name: string,
  dimensions: number,
  metric: string = 'cosine'
): Promise<any> {
  const key = `${userId}:${name}`;

  // Return from in-memory cache if warm
  if (cache.has(key)) {
    return cache.get(key);
  }

  // Create fresh collection
  const sv = new SolVec({ network: 'mainnet-beta' });
  const collection = sv.collection(name, { dimensions, metric: metric as DistanceMetric });

  // Try to restore from Redis
  try {
    const redis = getRedis();
    const redisKey = collectionKey(userId, name);
    const snapshot = await redis.get<string>(redisKey);

    if (snapshot) {
      const data = JSON.parse(snapshot) as {
        vectors: Record<string, number[]>;
        metadata: Record<string, Record<string, any>>;
        writtenAt: Record<string, number>;
        merkleRootAtWrite: Record<string, string>;
      };

      if (data.vectors && Object.keys(data.vectors).length > 0) {
        // Restore vectors into the collection
        const records = Object.entries(data.vectors).map(([id, values]) => ({
          id,
          values,
          metadata: data.metadata?.[id] ?? {},
        }));
        await collection.upsert(records);
        console.log(`Restored ${records.length} vectors for ${userId}:${name} from Redis`);
      }
    }
  } catch (err) {
    console.warn('Redis restore failed — starting fresh:', err);
  }

  cache.set(key, collection);
  return collection;
}

export async function saveCollection(
  userId: string,
  name: string,
  collection: any
): Promise<void> {
  try {
    const redis = getRedis();
    const redisKey = collectionKey(userId, name);

    // Serialize the collection state
    const snapshot = JSON.stringify({
      vectors: collection._vectors ?? {},
      metadata: collection._metadata ?? {},
      writtenAt: collection._written_at ?? {},
      merkleRootAtWrite: collection._merkle_root_at_write ?? {},
    });

    // Store with 7 day TTL — refreshed on every write
    await redis.set(redisKey, snapshot, { ex: 60 * 60 * 24 * 7 });
  } catch (err) {
    console.warn('Redis save failed:', err);
    // Never crash a write operation because Redis failed
  }
}

export async function deleteCollection(
  userId: string,
  name: string
): Promise<void> {
  const key = `${userId}:${name}`;
  cache.delete(key);

  try {
    const redis = getRedis();
    await redis.del(collectionKey(userId, name));
  } catch (err) {
    console.warn('Redis delete failed:', err);
  }
}
