import { toCsv } from '../domain/csv.js';
import { aggregate, collectItems, mondayOf, toResearchRow } from '../domain/metrics.js';
import type { Store, Tracker } from '../domain/ports.js';
import { log } from '../log.js';
import type { Tenant, TenantRegistry } from '../tenants.js';
import { weeklyReport } from './weekly.js';

export interface ReportDeps {
  tenants: () => Promise<TenantRegistry>;
  runtime: (t: Tenant) => { tracker: Tracker };
  store: Pick<Store, 'putBlob'>;
}
export interface ReportResult { week: string; reports: Array<{ tenant: string; url: string }>; researchRows: number }

/**
 * Weekly job. Per tenant: last complete week's metrics, filed as an issue in that tenant's repo.
 * Across tenants that opted in: one anonymised, item-level research snapshot — a tenant pseudonym
 * and timestamps, never text, contact or links — written to `research/<week>.csv`.
 */
export async function runWeeklyReports(deps: ReportDeps, now = new Date()): Promise<ReportResult> {
  const week = mondayOf(new Date(now.getTime() - 7 * 86400_000));
  const reports: ReportResult['reports'] = [];
  const research: Array<ReturnType<typeof toResearchRow>> = [];
  for (const t of (await deps.tenants()).all()) {
    if (!t.enabled) continue;
    try {
      const { tracker } = deps.runtime(t);
      const items = await collectItems(tracker);
      const { url } = await tracker.createIssue(weeklyReport(aggregate(items), week, t.name));
      reports.push({ tenant: t.slug, url });
      if (t.research && t.pseudonym) research.push(...items.map((i) => toResearchRow(t.pseudonym!, i)));
      log('info', 'weekly_report_posted', { tenant: t.slug, week, url });
    } catch (err) {
      log('error', 'weekly_report_failed', { tenant: t.slug, week, err: String(err) }); // one tenant's outage must not skip the rest
    }
  }
  if (research.length) await deps.store.putBlob(`research/${week}.csv`, Buffer.from(toCsv(research)), 'text/csv');
  return { week, reports, researchRows: research.length };
}
