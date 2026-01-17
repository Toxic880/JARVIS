import { getDatabase, initDatabase, closeDatabase } from './init';
import { logger } from '../services/logger';

async function migrate() {
  try {
    logger.info('Starting database migration...');

    // Ensure DB is initialized
    await initDatabase();
    const db = getDatabase();

    // Migration 1: Add embedding column to jarvis_persistent_memory
    try {
      // Check if column exists
      const tableInfo = db.prepare("PRAGMA table_info(jarvis_persistent_memory)").all() as any[];
      const hasEmbedding = tableInfo.some(col => col.name === 'embedding');

      if (!hasEmbedding) {
        logger.info('Adding embedding column to jarvis_persistent_memory...');
        db.exec("ALTER TABLE jarvis_persistent_memory ADD COLUMN embedding BLOB");
        logger.info('Added embedding column.');
      } else {
        logger.info('embedding column already exists.');
      }
    } catch (error) {
      // Table might not exist yet (handled by init), or other error
      logger.warn('Migration step check failed (may be new install)', { error });
    }

    logger.info('Migration completed successfully.');
  } catch (error) {
    logger.error('Migration failed', { error });
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

migrate();
