/**
 * Fill missing secrets from SSM (`${prefix}/<lower_snake_env_name>`) before config parses.
 * Secrets never pass through Terraform state or Lambda env definitions this way.
 */
const SSM_BACKED = ['DATABASE_URL', 'TURNSTILE_SECRET', 'GITHUB_TOKEN', 'GITHUB_WEBHOOK_SECRET'] as const;

export async function loadSecretsFromSsm(prefix: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const missing = SSM_BACKED.filter((k) => !env[k]);
  if (!missing.length) return;
  const { SSMClient, GetParametersCommand } = await import('@aws-sdk/client-ssm');
  const names = missing.map((k) => `${prefix}/${k.toLowerCase()}`);
  const out = await new SSMClient({}).send(new GetParametersCommand({ Names: names, WithDecryption: true }));
  for (const p of out.Parameters ?? []) {
    const key = missing.find((k) => p.Name === `${prefix}/${k.toLowerCase()}`);
    if (key && p.Value) env[key] = p.Value;
  }
  // Optional ones (turnstile, github) may legitimately be absent; DATABASE_URL is enforced by config.
}
