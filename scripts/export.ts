/**
 * Paper data export straight from GitHub. Usage:
 *   GITHUB_TOKEN=… GITHUB_REPO=Scaled-AIOps/feedback npm run export  > feedback.csv   (anonymised per-item rows)
 *   GITHUB_TOKEN=… GITHUB_REPO=Scaled-AIOps/feedback npm run metrics > metrics.csv    (per kind × week)
 */
import { githubTracker } from '../src/adapters/githubTracker.js';
import { toCsv } from '../src/domain/csv.js';
import { aggregate, collectItems, toExportRow } from '../src/domain/metrics.js';

const token = process.env['GITHUB_TOKEN'], repo = process.env['GITHUB_REPO'];
if (!token || !repo) { console.error('GITHUB_TOKEN and GITHUB_REPO are required'); process.exit(2); }
const items = await collectItems(githubTracker(repo, token));
const rows = process.argv[2] === 'metrics' ? aggregate(items) : items.map(toExportRow);
process.stdout.write(toCsv(rows as unknown as Array<Record<string, unknown>>));
