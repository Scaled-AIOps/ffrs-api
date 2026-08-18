import type { Config } from '../config.js';
import type { BlobStore } from '../domain/repo.js';
import { log } from '../log.js';
import { githubClient } from './github.js';
import type { Mailer } from './mailer.js';
import { sesMailer } from './mailer.js';
import { ackMail, alertMail, closeMail, issueBody, type Branding } from './templates.js';
import type { Effect, EffectRegistry } from './types.js';

const SCREENSHOT_LINK_TTL_S = 7 * 24 * 3600;

export const ackEmail = (b: Branding, mail: Mailer): Effect => async (f) => {
  if (!f.email) return; // consent withdrawn or anonymous — nothing to send
  await mail(ackMail(b, f));
};

export const closeEmail = (b: Branding, mail: Mailer): Effect => async (f) => {
  if (!f.email) return;
  await mail(closeMail(b, f));
};

export const alertEmail = (b: Branding, mail: Mailer, to: string): Effect => async (f) => {
  await mail(alertMail(b, f, to));
};

export const githubIssue = (b: Branding, repo: string, token: string, blobs?: BlobStore, fetchImpl: typeof fetch = fetch): Effect => async (f) => {
  const shot = f.screenshotKey && blobs ? await blobs.url(f.screenshotKey, SCREENSHOT_LINK_TTL_S) : undefined;
  return { githubIssueUrl: await githubClient(repo, token, fetchImpl).createIssue(issueBody(b, f, shot)) };
};

/** Wire effects from config. Missing settings → effect absent (outbox parks its rows) and a warning at startup. */
export function buildEffects(cfg: Config, deps: { blobs?: BlobStore; mailer?: Mailer; fetch?: typeof fetch } = {}): EffectRegistry {
  const b: Branding = { siteName: cfg.SITE_NAME, siteUrl: cfg.SITE_URL };
  const reg: EffectRegistry = {};
  const mail = deps.mailer ?? (cfg.FROM_EMAIL ? sesMailer(cfg.FROM_EMAIL) : undefined);

  if (mail) { reg.ack_email = ackEmail(b, mail); reg.close_email = closeEmail(b, mail); }
  else log('warn', 'effect_disabled', { effect: 'ack_email, close_email', need: 'FROM_EMAIL' });

  if (mail && cfg.ALERT_EMAIL) reg.alert_email = alertEmail(b, mail, cfg.ALERT_EMAIL);
  else log('warn', 'effect_disabled', { effect: 'alert_email', need: 'FROM_EMAIL, ALERT_EMAIL' });

  if (cfg.GITHUB_REPO && cfg.GITHUB_TOKEN) reg.github_issue = githubIssue(b, cfg.GITHUB_REPO, cfg.GITHUB_TOKEN, deps.blobs, deps.fetch);
  else log('warn', 'effect_disabled', { effect: 'github_issue', need: 'GITHUB_REPO, GITHUB_TOKEN' });

  return reg;
}
