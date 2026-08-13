# Git Workflow Notes — Smart Farm DSS

A step-by-step record of how this project was pushed to GitHub.

---

## 1. Initialize the Repository

The project had no git history, so we started fresh.

```bash
git init
```

This creates a hidden `.git` folder in the project root — that's what makes it a git repo.

---

## 2. Create .gitignore and .gitattributes

Before staging anything, we created two housekeeping files:

- `.gitignore` — tells git which files to never track (secrets, build outputs, node_modules, etc.)
- `.gitattributes` — normalizes line endings to LF so the code looks consistent across Windows/Mac/Linux

---

## 3. Stage All Files

```bash
git add .
```

The `.` means "stage everything in the current directory", but git automatically skips anything listed in `.gitignore`.
At this point the files are staged (tracked) but not yet saved into git history.

---

## 4. Make the First Commit

```bash
git commit -m "backend fixing"
```

This saves a permanent snapshot of all staged files into git history.
`-m` sets the commit message. The output confirmed **61 files, 27,568 insertions**.

---

## 5. Create a New Branch

```bash
git checkout -b smart-farm-dss
```

- `checkout` switches branches
- `-b` creates the branch if it doesn't exist yet
- `smart-farm-dss` is the name we chose

At this point we're on the new branch with the full commit history from `main`.

---

## 6. Add the GitHub Remote

```bash
git remote add origin https://github.com/aadarshdubey637/HackInMotion-RICR-HIM-1104.git
```

- `remote add` links a name (`origin`) to a GitHub URL
- `origin` is the conventional name for your primary remote
- From now on `origin` is shorthand for that full GitHub URL

---

## 7. Push the Branch to GitHub

```bash
git push -u origin smart-farm-dss
```

- `push` uploads commits to GitHub
- `-u` sets up tracking, so future `git push` / `git pull` on this branch know where to go automatically
- `origin smart-farm-dss` means "push to the remote named origin, into a branch called smart-farm-dss"

GitHub printed a link to create a Pull Request from this branch.

---

## 8. Merge into Main

### Step 1 — Switch to main

```bash
git checkout main
```

### Step 2 — Pull the remote main first

The GitHub repo already had some files on `main` (e.g. an existing README or package.json),
so we had to sync before merging to avoid rejections.

```bash
git pull origin main --allow-unrelated-histories
```

- `--allow-unrelated-histories` is needed when two repos have no common ancestor commit
- This triggered **merge conflicts** on `.gitignore` and `frontend/package.json`

### Step 3 — Resolve Conflicts

Git couldn't automatically decide which version to keep, so we chose ours manually:

```bash
git checkout --ours .gitignore
git checkout --ours frontend/package.json
```

- `--ours` = keep our local version (the smart-farm-dss code)
- `--theirs` = keep the remote version (we used this briefly then switched to `--ours`)

### Step 4 — Commit the Merge Resolution

```bash
git add .gitignore frontend/package.json
git commit -m "merge: resolve conflicts, keep smart-farm-dss code"
```

### Step 5 — Push Main to GitHub

```bash
git push origin main
```

This uploads the merged `main` branch to GitHub. Output confirmed:
```
72226b2..36f816e  main -> main
```

---

## Quick Reference — Commands Used

| Command | What it does |
|---|---|
| `git init` | Start a new git repo in current folder |
| `git add .` | Stage all files for commit |
| `git commit -m "message"` | Save a snapshot with a message |
| `git checkout -b <name>` | Create and switch to a new branch |
| `git remote add origin <url>` | Link your local repo to GitHub |
| `git push -u origin <branch>` | Push branch to GitHub and set tracking |
| `git checkout main` | Switch to the main branch |
| `git pull origin main --allow-unrelated-histories` | Sync remote main into local |
| `git checkout --ours <file>` | Keep your version during a conflict |
| `git checkout --theirs <file>` | Keep the remote version during a conflict |
| `git push origin main` | Push main branch to GitHub |

---

## Final State

- **Repository**: https://github.com/aadarshdubey637/HackInMotion-RICR-HIM-1104
- **Main branch**: contains all 61 project files
- **smart-farm-dss branch**: still exists on remote as a reference
