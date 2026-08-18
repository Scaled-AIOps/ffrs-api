import type { Config } from '../config.js';
import { mondayOf } from '../domain/metrics.js';
import type { FeedbackRepo } from '../domain/repo.js';
import { githubClient } from '../effects/github.js';
import { log } from '../log.js';
import { weeklyReport } from './weekly.js';

/** Weekly job: report the last complete week as a GitHub issue. Without GitHub config it just logs the report. */
export async function runWeeklyReport(repo: FeedbackRepo, cfg: Config, now = new Date(), fetchImpl?: typeof fetch): Promise<{ week: string; url?: string }> {
  const lastWeek = mondayOf(new Date(now.getTime() - 7 * 86400_000));
  const report = weeklyReport(await repo.metrics(), lastWeek, cfg.SITE_NAME);
  if (!cfg.GITHUB_REPO || !cfg.GITHUB_TOKEN) {
    log('info', 'weekly_report', { week: lastWeek, body: report.body });
    return { week: lastWeek };
  }
  const url = await githubClient(cfg.GITHUB_REPO, cfg.GITHUB_TOKEN, fetchImpl).createIssue(report);
  log('info', 'weekly_report_posted', { week: lastWeek, url });
  return { week: lastWeek, url };
}
