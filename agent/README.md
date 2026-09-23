# FFRS agentic Respond stage

**Runner: a hosted coding-agent routine**, `FFRS agent`. It runs hourly on the maintainers' agent subscription, with no API key, over checkouts of `Scaled-AIOps/scaledaiops.org` and `Scaled-AIOps/feedback`. Its prompt is [`routine-prompt.md`](routine-prompt.md), the versioned source; the routine scheduler is only the runtime, so edit the file first and then apply it to the routine.

- **Respond:** up to three open `ffrs` issues with a `kind:*` label and no response yet, oldest first. For each, the agent opens a PR on the site repo (`agent:pr`), posts a proposal (`agent:proposal`) or skips (`agent:skipped`), and labels the issue `ffrs:responded`.
- **Execute:** an `agent:proposal` issue whose newest `/confirm` comes from an OWNER, MEMBER or COLLABORATOR gets the proposal implemented (`agent:executed`).
- **Commands:** [`workflows/ffrs-commands.yml`](workflows/ffrs-commands.yml), installed in the tracker repo, turns `/accept` into `requester:accepted` and `/reject <reason>` into `agent:rejected`. A rejected item returns to the human queue.

The agent never pushes to `main` (a repository rule enforces it) and uses one `ffrs/fb-xxxxxx` branch per item. Its comments start with 🤖, so they count towards TTFR but not the human metrics.
