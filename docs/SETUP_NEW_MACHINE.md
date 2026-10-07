# Setting up JevOps on a new machine

Step-by-step setup for a fresh development machine (the personal laptop). Each step has a
check; do not move on until it passes.

**For Claude:** follow these steps in order and run the checks yourself. Steps marked
**(human)** need the owner — browser logins or secrets. Ask for those, never guess them.
Never write API keys into tracked files; only `.env.local`, which git ignores.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| git | any recent | `git --version` |
| nvm (or fnm / volta) | any | `command -v nvm` |
| Node.js | 24 (from `.nvmrc`) | `node -v` |
| GitHub CLI (optional) | any | `gh --version` |

macOS install, if missing:

```bash
xcode-select --install                 # git
brew install nvm gh                    # or: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
```

After installing nvm, follow its printed instructions to add it to `~/.zshrc`, then open a
new terminal.

## 2. Accounts (human)

Use **personal** accounts only — no company email, SSO, or credentials anywhere in this project.

```bash
gh auth login                          # GitHub, as nishant-ranjan28
```

Check: `gh auth status` shows `nishant-ranjan28`.

## 3. Clone

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/nishant-ranjan28/jevops.git
cd jevops
```

Pick the branch:

- If the open-source PR is **not merged yet**: `git checkout chore/open-source-readiness`
- If it **is merged**: stay on `main`.

Check: `ls LICENSE docs/LAUNCH_PLAN.md` both exist.

## 4. Git identity for this repo

```bash
git config user.name  "Nishant Ranjan"
git config user.email "nishantranjan78@gmail.com"
```

Check: `git config user.email` prints the personal address. Every commit in this repo must
use it.

## 5. Node and dependencies

```bash
nvm install                            # reads .nvmrc → Node 24
nvm use
npm ci
```

Check: `node -v` prints `v24.x`, and `npm ci` finishes with no `ERR!` lines.

## 6. Verify the build

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected:

- lint: no output after `> eslint`
- typecheck: `✓ Types generated successfully`, no `tsc` errors
- test: `ℹ pass 99`, `ℹ fail 0` (the real-PR tests may show as skipped if GitHub is
  unreachable or rate-limited — that is fine)
- build: route table listing `/`, `/api/analyze`, `/api/status`

## 7. Run it

```bash
npm run dev
```

Open <http://localhost:3000>. No configuration is needed — it runs on the deterministic
mock model.

Check:

- The header badge says **MOCK**.
- Click **Error rate breach** in the demo rail → the conflict banner names `DEP-ERR-001`
  and Jev returns **ROLLBACK**.
- `curl -s localhost:3000/api/status` returns JSON whose provider chain ends in `mock`.

## 8. Optional: live models and GitHub token (human)

Only needed to test against real LLMs or to raise the GitHub rate limit. Create **new**
keys on personal accounts — do not reuse keys from the old machine (revoke those).

```bash
cp env.example .env.local
```

Then the owner fills in any of these in `.env.local`:

| Variable | Where to get it |
|---|---|
| `OPENROUTER_API_KEY` | <https://openrouter.ai/keys> |
| `GROQ_API_KEY` | <https://console.groq.com/keys> |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → Fine-grained tokens; public repositories, read-only |

Restart `npm run dev`. Check: the header badge says **LIVE** and names the provider;
`git status` does **not** list `.env.local`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm error ... EACCES` / "run `sudo chown -R`" | npm cache has root-owned files: `sudo chown -R "$(id -u):$(id -g)" ~/.npm` |
| Tests fail with syntax errors on `.mts` files | Node is older than 24 — run `nvm use` |
| `fetch failed` behind a corporate or VPN proxy | Set `HTTPS_PROXY` and run with `NODE_USE_ENV_PROXY=1` (the `test` script already does) |
| Real-PR tests skipped | GitHub unreachable or rate-limited; set `GITHUB_TOKEN` in the shell to raise the quota |
| Port 3000 in use | `npm run dev -- -p 3001` |
| `AGENTS.md` shows as modified after `npm run dev` | Next.js rewrites its block in that file; commit it or discard with `git checkout AGENTS.md` |

## Done

Setup is complete when steps 1–7 all pass. Continue with `docs/LAUNCH_PLAN.md`, section 1
("Left for me").
