-- FFRS metrics: one view, all paper numbers. P50/P90 per kind per week.
create or replace view ffrs_metrics as
select kind, date_trunc('week', created_at) as wk, count(*) as n,
  percentile_cont(0.5) within group (order by acknowledged_at - created_at) as tta_p50,
  percentile_cont(0.5) within group (order by routed_at - created_at)       as ttr_p50,
  percentile_cont(0.5) within group (order by responded_at - created_at)    as ttfr_p50,
  percentile_cont(0.9) within group (order by responded_at - created_at)    as ttfr_p90,
  percentile_cont(0.5) within group (order by closed_at - created_at)       as ttc_p50,
  count(*) filter (where closed_at is not null)::float / nullif(count(*), 0)                        as loop_closure,
  count(*) filter (where status not in ('spam','duplicate'))::float / nullif(count(*), 0)           as signal_ratio
from feedback group by 1, 2;
