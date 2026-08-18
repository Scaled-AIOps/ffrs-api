import type { Config } from '../config.js';
import { aggregate, collectItems, mondayOf } from '../domain/metrics.js';
import type { Tracker } from '../domain/ports.js';
import { log } from '../log.js';
import { weeklyReport } from './weekly.js';

/** Weekly job: last complete week's metrics, filed as a GitHub issue (label `ffrs-report`). */
export async function runWeeklyReport(tracker: Tracker, cfg: Pick<Config, 'SITE_NAME'>, now = new Date()): Promise<{ week: string; url: string }> {
  const lastWeek = mondayOf(new Date(now.getTime() - 7 * 86400_000));
  const rows = aggregate(await collectItems(tracker));
  const { url } = await tracker.createIssue(weeklyReport(rows, lastWeek, cfg.SITE_NAME));
  log('info', 'weekly_report_posted', { week: lastWeek, url });
  return { week: lastWeek, url };
}
