import { Router } from 'express';
import { verifyWebhookSignature } from '../middleware/verifyWebhook';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { logger, serializeError } from '../lib/logger';

// Mounted under /webhooks with express.raw(), so req.rawBody holds the
// exact bytes the provider signed. Do not put express.json() in front.

const router = Router();

router.post(
  '/example',
  verifyWebhookSignature(config.WEBHOOK_SECRET, 'X-Webhook-Signature'),
  async (req, res) => {
    let event: { id: string; type: string; [key: string]: unknown };
    try {
      event = JSON.parse(req.rawBody!.toString());
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    // Idempotency check: providers retry, so the same event can arrive twice
    const existing = await prisma.webhookEvent.findUnique({
      where: { id: event.id },
    });

    if (existing?.processedAt) {
      // Already processed. Acknowledge without re-processing.
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Record receipt (or keep the existing half-processed record)
    await prisma.webhookEvent.upsert({
      where: { id: event.id },
      update: {},
      create: {
        id: event.id,
        provider: 'example',
        eventType: event.type,
        payload: JSON.stringify(event),
      },
    });

    // ACKNOWLEDGE FAST. Process after responding.
    res.status(202).json({ received: true });

    try {
      await processWebhookEvent(event, req.correlationId);
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      // processedAt stays null; a provider retry (or a replay job
      // scanning for unprocessed rows) will pick it up again.
      logger.error('Webhook processing failed', {
        correlationId: req.correlationId,
        webhookEventId: event.id,
        eventType: event.type,
        error: serializeError(error),
      });
    }
  }
);

async function processWebhookEvent(
  event: { id: string; type: string },
  correlationId?: string,
) {
  // Route to the right handler based on event type
  switch (event.type) {
    // case 'something.happened':
    //   await queueSomething(...);
    //   break;
    default:
      logger.info('Unhandled webhook event type', {
        correlationId,
        webhookEventId: event.id,
        eventType: event.type,
      });
  }
}

export { router as webhookRoutes };
