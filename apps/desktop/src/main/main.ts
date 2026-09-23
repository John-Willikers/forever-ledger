import { createLogger } from '@forever-ledger/uploader/lib';
import { app } from 'electron';

// Placeholder until Task 4.4: proves the uploader library bundles into the main process, then quits.
const logger = createLogger();
void app.whenReady().then(() => {
  logger.info({ version: app.getVersion() }, 'Forever Ledger desktop scaffold');
  app.quit();
});
