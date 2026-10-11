import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };

function scryptAsync(
  password: Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    ),
  );
}

/** 存储格式 scrypt$N$r$p$saltHex$hashHex */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(
    Buffer.from(plain, 'utf8'),
    salt,
    PARAMS.keylen,
    { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p },
  );
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(
    Buffer.from(plain, 'utf8'),
    salt,
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    },
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
