// In-memory store — each collection lives for the lifetime of the serverless function.
// For production scale this should use Redis. For MVP this works.

import { SolVec } from '@veclabs/solvec';
import type { DistanceMetric, SolVecCollection } from '@veclabs/solvec';

let _sv: SolVec | null = null;

function getSolVec(): SolVec {
  if (!_sv) {
    _sv = new SolVec({ network: 'mainnet-beta' });
  }
  return _sv;
}

const stores = new Map<string, SolVecCollection>();

export function getCollection(userId: string, name: string, dimensions: number, metric: string = 'cosine'): SolVecCollection {
  const key = `${userId}:${name}`;
  if (!stores.has(key)) {
    const collection = getSolVec().collection(name, { dimensions, metric: metric as DistanceMetric });
    stores.set(key, collection);
  }
  return stores.get(key)!;
}

export function deleteCollection(userId: string, name: string) {
  stores.delete(`${userId}:${name}`);
}
