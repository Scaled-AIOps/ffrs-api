# FFRS agentic Respond stage

**Production runner (scaledaiops.org): a hosted coding-agent routine** — `FFRS agent`, hourly, sources `Scaled-AIOps/scaledaiops.org` + `Scaled-AIOps/feedback`, prompt = the protocol below; managed in the agent provider's routine scheduler. Billed to the maintainers' existing agent subscription, no API key. The files here are the **self-hosted alternative** (GitHub Actions + any headless coding-agent CLI configured via `AGENT_CMD`), same protocol and labels.

`run.mjs` wraps a headless coding-agent CLI (`AGENT_CMD`, e.g. any agent that accepts a prompt argument and prints its final answer as JSON with a `result` field) to perform the FFRS **Respond** stage on tracker issues. Runs from GitHub Actions in the tracker repo (see `workflows/`), against a checkout of the target repo.

- **respond mode** (schedule / dispatch): for up to `MAX_ITEMS` open `ffrs` issues with a `kind:*` label and no response yet → the agent picks `pr` (edits files, runs `./build.sh` + `npm run test:local`; wrapper opens a PR on the target repo, comments, labels `agent:pr ffrs:responded`), `proposal` (comment with `/accept` · `/confirm` protocol, label `agent:proposal`) or `skip`.
- **execute mode** (`issue_comment` containing `/confirm` by OWNER/MEMBER/COLLABORATOR on an `agent:proposal` issue): agent implements the confirmed proposal → PR or final reply; label `agent:executed`. `/accept` by anyone adds `requester:accepted`; `/reject <reason>` adds `agent:rejected` and returns the item to the human queue.

The agent never runs git, never pushes to `main`, never sees secrets beyond its own API key. Only the wrapper creates branches (`ffrs/fb-xxxxxx`), commits and PRs.

Configuration (Actions, tracker repo): repository variables `AGENT_PACKAGE` (npm package of the agent CLI) and `AGENT_CMD` (command + flags; the prompt is appended as the last argument); secret `AGENT_API_KEY` (rename the `env:` key in the workflow to whatever variable your CLI expects); `FFRS_AGENT_TOKEN` = token with contents + pull-requests write on the target repo. Comments/labels on the tracker use the workflow's `GITHUB_TOKEN` (author `github-actions[bot]`, so agent responses are excluded from the *human* metrics).
