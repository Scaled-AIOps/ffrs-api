/**
 * Paper data export. Usage:
 *   DATABASE_URL=… npm run export   > feedback.csv     (anonymised per-item rows)
 *   DATABASE_URL=… npm run metrics  > metrics.csv      (weekly ffrs_metrics view)
 * Nothing personal leaves the database: no body, email or screenshot.
 */
import { neonRepo } from '../src/db/neonRepo.js';
import { toCsv } from '../src/domain/csv.js';

const url = process.env['DATABASE_URL'];
if (!url) { console.error('DATABASE_URL is required'); process.exit(2); }
const repo = neonRepo(url);
const which = process.argv[2] === 'metrics' ? 'metrics' : 'export';
const rows = which === 'metrics' ? await repo.metrics() : await repo.exportAll();
process.stdout.write(toCsv(rows as unknown as Array<Record<string, unknown>>));
