# Contributing

The shared rules are in [AGENTS.md](AGENTS.md). They apply to people and coding
assistants. The root README explains the project; component READMEs explain
the web app and contracts. Every `CLAUDE.md` imports its local `AGENTS.md`, so
Claude and other agents use the same written rules. Write all repository
Markdown documentation in English, including new or updated README files.

## Branches and pull requests

```text
origin/dev → feat/... or fix/... or docs/... → PR → dev → release PR → main
```

`dev` integrates reviewed work. `main` is production and triggers Railway when
app files change. There is currently no Railway staging deployment for `dev`.

Start from an up-to-date `dev` with a clean working tree:

```sh
git fetch origin
git switch -c feat/short-description origin/dev
# Make the change and run the relevant checks.
git add <changed-files>
git commit -m "feat: describe the change"
git push -u origin feat/short-description
gh pr create --base dev --head feat/short-description
```

Use one focused branch per task. Do not commit/push directly to either
long-lived branch. A hotfix follows the same route through `dev`. To incorporate
new team changes into a shared work branch, merge `origin/dev` into it; do not
rewrite commits another person is using. Never overwrite another contributor's
work to resolve a conflict.

The PR author describes the problem, resulting behavior, tests and known limits.
The reviewer checks the diff and relevant CI results. Human maintainers merge;
an agent may merge only when explicitly instructed to do so.

When `dev` is ready for release:

```sh
gh pr create --base main --head dev --title "Release: describe the changes"
```

Merge the release PR using **Create a merge commit**, preserving shared history.
Do not squash/rebase this PR or delete `dev` afterward. Feature PRs cannot target
`main`. Production operations outside this path require an explicit instruction.

## Authorship

Use your own configured Git name/email. AI tools must not become commit authors
or co-authors. Do not include tool `Co-Authored-By` trailers or generated-by
footers in commits and PRs. Real human co-authors may be credited when applicable.

`.claude/settings.json` sets both `attribution.commit` and `attribution.pr` to
empty strings. Do not override them with personal settings. Other assistants
must follow `AGENTS.md`; there is no universal configuration switch for every
tool. Inspect new commit messages with `git log origin/dev..HEAD --format=full`
before pushing.

Markdown instructions describe the workflow; GitHub branch rules and required
checks provide enforcement. Recommended settings for both `dev` and `main` are:
require a pull request and passing CI, disallow force pushes/deletion, and apply
the rules to administrators. A required teammate approval can be enabled when
the team wants it. Do not bypass these rules when they are enabled.

## Validation

Run commands from the monorepo root after the setup in [README.md](README.md).

| Change | Checks |
| --- | --- |
| Documentation | Review relative links, examples and `git diff --check` |
| Web logic | `npm test`, `npm run build` |
| Browser behavior or iPad terminal | Above plus `npm run test:browser` |
| Solidity | `npm run test:contracts` |
| ABI, events, payout or transaction lifecycle | Foundry tests plus `npm run test:chain`, web tests and build |
| Railway configuration | Type/config validation and read-only `railway config plan` against the intended environment |

Report failures accurately, including intermittent failures that pass on retry.
Do not execute scripts under `apps/web/scripts/live-*` as ordinary tests: they
contact real Privy infrastructure. Real contract deployments and transactions
also need explicit authorization.

## Local files and credentials

Keep web credentials in ignored `apps/web/.env.local` and contract credentials
in ignored `contracts/.env`. Follow the matching `.env.example`. Never copy a
production private key into a test fixture or expose it in terminal output.

`CLAUDE.local.md` and `.claude/settings.local.json` are personal, ignored files;
they must not override the shared workflow or attribution rules. Changes to
shared instructions belong in a normal PR into `dev`.
