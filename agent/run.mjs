#!/usr/bin/env node
/**
 * FFRS agentic Respond stage — wrapper around Claude Code (headless).
 * Owns everything with side effects (git, PRs, comments, labels); the agent only edits files and runs tests.
 *
 * Env: GITHUB_TOKEN (comment/label on tracker repo; the workflow token), FFRS_AGENT_TOKEN (push + PR on the target repo),
 *      TRACKER_REPO (owner/repo), TARGET_REPO (owner/repo), TARGET_DIR (checkout path), ANTHROPIC_API_KEY (used by claude),
 *      MAX_ITEMS (default 3), MODE=respond|execute, ISSUE_NUMBER (execute mode).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const env = (k, d) => process.env[k] ?? d ?? (() => { throw new Error(`missing env ${k}`); })();
const TRACKER = env('TRACKER_REPO'), TARGET = env('TARGET_REPO'), DIR = env('TARGET_DIR', '.');
const MODE = env('MODE', 'respond'), MAX = Number(env('MAX_ITEMS', '3'));
const LABELS = { responded: 'ffrs:responded', pr: 'agent:pr', proposal: 'agent:proposal', executed: 'agent:executed', skipped: 'agent:skipped', accepted: 'requester:accepted', confirmed: 'reviewer:confirmed' };
const REF = /<!--\s*ffrs:(FB-[A-Z0-9]{6})\s*-->/;

const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_TOKEN: opts.token ?? env('GITHUB_TOKEN') }, ...opts }).trim();
const ghJson = (args, opts) => JSON.parse(gh(args, opts));
const log = (m, o = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), m, ...o }));

function candidates() {
  if (MODE === 'execute') return [ghJson(['issue', 'view', env('ISSUE_NUMBER'), '--repo', TRACKER, '--json', 'number,title,body,labels,url,comments'])];
  const open = ghJson(['issue', 'list', '--repo', TRACKER, '--label', 'ffrs', '--state', 'open', '--limit', '50', '--json', 'number,title,body,labels,url,comments']);
  return open.filter((i) => {
    const l = i.labels.map((x) => x.name);
    return l.some((x) => x.startsWith('kind:')) && !l.includes(LABELS.responded) && !l.some((x) => x.startsWith('agent:')) && !l.includes('ffrs-report');
  }).slice(0, MAX);
}

function runAgent(issue) {
  const labels = issue.labels.map((x) => x.name);
  const kind = labels.find((x) => x.startsWith('kind:'))?.slice(5) ?? 'unknown';
  const severity = labels.find((x) => x.startsWith('severity:'))?.slice(9) ?? '—';
  const ref = REF.exec(issue.body ?? '')?.[1] ?? `#${issue.number}`;
  const executeNote = MODE === 'execute'
    ? `A maintainer confirmed the proposal below (see the issue comments). Implement it now via path "pr" if it is a repository change; if it is a reply, output path "proposal" with the final reply text as "proposal".\n${issue.comments?.map((c) => `> ${c.author.login}: ${c.body}`).join('\n') ?? ''}`
    : '';
  const prompt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prompt.md'), 'utf8')
    .replace('{{MODE}}', MODE).replace('{{EXECUTE_NOTE}}', executeNote).replace('{{REF}}', ref).replace('{{KIND}}', kind).replace('{{SEVERITY}}', severity)
    .replace('{{ISSUE_URL}}', issue.url).replace('{{TITLE}}', issue.title).replace('{{BODY}}', (issue.body ?? '').replace(REF, '').trim());
  const r = spawnSync('claude', ['-p', prompt, '--output-format', 'json', '--max-turns', '60',
    '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash(./build.sh),Bash(npm run test:local),Bash(npm run build),Bash(ls*),Bash(cat*)'],
    { cwd: DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env });
  if (r.status !== 0) throw new Error(`claude exited ${r.status}: stderr=${(r.stderr || '').slice(-800)} stdout=${(r.stdout || '').slice(0, 1200)}`);
  const out = JSON.parse(r.stdout);
  const text = typeof out.result === 'string' ? out.result : JSON.stringify(out);
  const line = text.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error('agent produced no verdict JSON');
  return { ref, verdict: JSON.parse(line), cost: out.total_cost_usd, turns: out.num_turns };
}

function git(args) { return execFileSync('git', args, { cwd: DIR, encoding: 'utf8' }).trim(); }

function openPr(issue, ref, v) {
  if (!git(['status', '--porcelain'])) return null; // agent said pr but changed nothing
  const branch = `ffrs/${ref.toLowerCase()}`;
  git(['checkout', '-B', branch]);
  git(['add', '-A']);
  git(['-c', 'user.name=ffrs-agent', '-c', 'user.email=feedback@scaledaiops.org', 'commit', '-q', '-m', `${v.title}\n\nFFRS ${ref} — ${issue.url}`]);
  const token = env('FFRS_AGENT_TOKEN');
  git(['push', '-f', `https://x-access-token:${token}@github.com/${TARGET}.git`, `HEAD:${branch}`]);
  const body = [`Resolves ${TRACKER}#${issue.number} (FFRS \`${ref}\`).`, '', '### What changed', v.summary, '', '### Tests', v.tests, '',
    '_Opened by the FFRS response agent. Review, then merge to close the loop; the requester is notified automatically._'].join('\n');
  return gh(['pr', 'create', '--repo', TARGET, '--head', branch, '--title', v.title, '--body', body], { token });
}

const comment = (n, body) => gh(['issue', 'comment', String(n), '--repo', TRACKER, '--body', body]);
const label = (n, ...ls) => gh(['issue', 'edit', String(n), '--repo', TRACKER, ...ls.flatMap((l) => ['--add-label', l])]);

for (const issue of candidates()) {
  try {
    git(['checkout', '-q', '-f', 'main']); git(['clean', '-fdq']);
    const { ref, verdict: v, cost, turns } = runAgent(issue);
    log('verdict', { ref, path: v.path, cost, turns });
    if (v.path === 'pr') {
      const url = openPr(issue, ref, v);
      if (url) {
        comment(issue.number, `🤖 **FFRS agent — pull request opened:** ${url}\n\n${v.summary}\n\n**Tests:** ${v.tests}\n\nA maintainer will review; merging closes this item and notifies you.`);
        label(issue.number, LABELS.responded, MODE === 'execute' ? LABELS.executed : LABELS.pr);
      } else {
        comment(issue.number, `🤖 **FFRS agent:** I judged this a repository change but produced no diff. Summary of what I found:\n\n${v.summary}\n\nA maintainer will pick this up.`);
        label(issue.number, LABELS.responded, LABELS.proposal);
      }
    } else if (v.path === 'proposal') {
      const how = MODE === 'execute' ? '' : `\n\n**How to proceed:** the requester replies \`/accept\` if this solves it; a maintainer replies \`/confirm\` to have it executed (or \`/reject <reason>\`). If the requester has no GitHub account, a maintainer's \`/confirm\` is sufficient.`;
      comment(issue.number, `🤖 **FFRS agent — proposal**\n\n${v.proposal}\n\n**Needs:** ${v.needs}\n**Risk:** ${v.risk ?? 'none'}${how}`);
      label(issue.number, LABELS.responded, MODE === 'execute' ? LABELS.executed : LABELS.proposal);
    } else {
      comment(issue.number, `🤖 **FFRS agent:** skipped — ${v.reason}. A maintainer will confirm.`);
      label(issue.number, LABELS.skipped);
    }
  } catch (err) {
    log('agent_failed', { issue: issue.number, err: String(err).slice(0, 500) });
    process.exitCode = 1;
  }
}
