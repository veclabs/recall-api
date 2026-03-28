import crypto from 'crypto';

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const key = `vl_live_${raw}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.slice(0, 12);
  return { key, hash, prefix };
}

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}
