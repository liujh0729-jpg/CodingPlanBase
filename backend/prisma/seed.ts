import { PrismaClient } from '../generated/prisma';
import { randomBytes, scrypt } from 'node:crypto';

/** 与 src/auth/password.ts 同格式：scrypt$N$r$p$saltHex$hashHex */
function hashPassword(plain: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16);
    scrypt(
      Buffer.from(plain, 'utf8'),
      salt,
      32,
      { N: 16384, r: 8, p: 1 },
      (error, derived) => {
        if (error) return reject(error);
        resolve(`scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`);
      },
    );
  });
}

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  // 超管口令优先取环境变量；未配置时用初始口令并提醒尽快修改（开源默认值，不是秘密）
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    await prisma.user.create({
      data: {
        username,
        passwordHash: await hashPassword(password),
        displayName: '超级管理员',
        role: 100,
        affCode: randomBytes(8).toString('hex'),
      },
    });
    console.log(`已创建超级管理员 ${username}，请登录后立即修改密码`);
  } else {
    console.log(`超级管理员 ${username} 已存在，跳过`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
