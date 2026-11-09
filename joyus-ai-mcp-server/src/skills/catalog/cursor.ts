import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { z } from 'zod';

const payloadSchema = z
  .object({
    version: z.literal(2),
    actor: z.string().min(1).max(256),
    workspace: z.string().min(1).max(256),
    source: z.literal('skills'),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    policy: z.string().uuid(),
    commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i),
    offset: z.number().int().nonnegative().max(1000),
  })
  .strict();
export type ProtectedCursor = z.infer<typeof payloadSchema>;
const AAD = Buffer.from('org_skills.cursor.v2');
export function cursorKey(value: string | undefined): Buffer {
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error('Invalid catalog cursor key configuration');
  return Buffer.from(value, 'hex');
}
export function encodeCursor(payload: ProtectedCursor, key: Buffer): string {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payloadSchema.parse(payload)), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from([2]), nonce, cipher.getAuthTag(), ciphertext]).toString(
    'base64url'
  );
}
export function decodeCursor(token: string, key: Buffer): ProtectedCursor {
  if (token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid cursor');
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length < 30 || bytes[0] !== 2 || bytes.toString('base64url') !== token)
    throw new Error('Invalid cursor');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13));
  decipher.setAAD(AAD);
  decipher.setAuthTag(bytes.subarray(13, 29));
  return payloadSchema.parse(
    JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8')
    )
  );
}
