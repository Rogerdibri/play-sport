import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { accountWebOrigins } from './modules/accounts/account-http';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: 1024 * 1024 });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: accountWebOrigins(), credentials: true });
  await app.listen(process.env.PORT ?? 4000);
}

bootstrap();
