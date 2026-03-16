import { NestFactory }                   from '@nestjs/core';
import { ValidationPipe }                from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule }                     from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── Validation ────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:            true,   // strip unknown fields
      forbidNonWhitelisted: true,   // reject requests with extra fields
      transform:            true,   // auto-cast (e.g. string → number)
    }),
  );

  // ── Swagger / OpenAPI ─────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('Wallet Topup API')
    .setDescription(
      'REST API for creating wallet topup requests, initiating UPI payments, ' +
      'processing payment webhooks, and querying wallet balances.',
    )
    .setVersion('1.0')
    .addTag('wallet',   'Wallet & topup management')
    .addTag('payments', 'Payment webhook processing')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // ── Listen ────────────────────────────────────────────────────
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Server running on  http://localhost:${port}`);
  console.log(`Swagger docs at    http://localhost:${port}/api/docs`);
}
bootstrap();