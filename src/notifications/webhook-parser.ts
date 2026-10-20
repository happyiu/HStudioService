import { json } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';

export function installWebhookParser(app: NestExpressApplication): void {
  // Apply before the shared 2 MiB parser used by world uploads.
  app.use('/api/v1/webhooks', json({ limit: '64kb' }));
}
