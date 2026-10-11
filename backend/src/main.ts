import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/http-exception.filter';
import { bootstrapEnv } from './install/bootstrap-env';

async function bootstrap() {
  // 未安装时的首启动兜底：补 .env 与 JWT_SECRET，之后安装向导才有地方写数据库配置
  bootstrapEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // 支付 webhook 验签需要原始请求体（重序列化 JSON 会破坏 HMAC）
    rawBody: true,
  });
  // 验签密钥缺失即拒绝启动（不允许用兜底默认值跑起来）；此时 ConfigModule 已加载 .env
  if (!String(process.env.JWT_SECRET || '').trim()) {
    throw new Error('JWT_SECRET 未配置，拒绝启动（见 backend/.env.example）');
  }
  app.set('trust proxy', 1);
  const originPatterns = (
    process.env.CORS_ORIGIN_PATTERNS || 'http://localhost:3000'
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  app.enableCors({
    origin: originPatterns.includes('*') ? true : originPatterns,
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Accept-Language',
      'Origin',
      'X-Locale',
      'X-Requested-With',
      'x-api-key',
      'anthropic-version',
    ],
    exposedHeaders: ['ETag'],
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  const port = Number(process.env.PORT || 1690);
  await app.listen(port);
}

void bootstrap();
