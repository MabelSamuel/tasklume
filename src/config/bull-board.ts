import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { taskEnrichmentQueue } from '../queues/task-enrichment.queue';
import { digestQueue } from '../queues/digest.queue';
import { deadLetterQueue } from '../queues/dead-letter.queue';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

// Register every queue you add here so it shows up in the dashboard
createBullBoard({
  queues: [
    new BullMQAdapter(taskEnrichmentQueue),
    new BullMQAdapter(digestQueue),
    new BullMQAdapter(deadLetterQueue),
  ],
  serverAdapter,
});

export { serverAdapter as bullBoardAdapter };
