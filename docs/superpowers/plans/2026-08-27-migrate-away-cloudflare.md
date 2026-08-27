# [Migrate Away from Cloudflare Workers] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the gold-news-bot from Cloudflare Workers deployment to a standard Node.js server, replacing KV storage with SQLite and removing all Cloudflare-specific dependencies.

**Architecture:** The existing local runner (`src/index.ts`) already uses SQLite (`db_path: ./data/seen.sqlite`) for dedup storage. The Cloudflare Worker (`worker/`) adds Cloudflare-specific layers (KVNamespace, wrangler.toml triggers, Cloudflare Analytics). This plan replaces the Worker with a standard Node.js HTTP server that uses the same SQLite-based dedup logic, keeping the core logic in `src/` intact.

**Tech Stack:** Node.js 22 + TypeScript · vitest · sqlite3 · standard HTTP server (no Cloudflare bindings)

**Spec:** `docs/spec-design.md` — the plan argues from this spec; the spec travels with it

---
## Global Constraints
- Use SQLite for dedup state (already `db_path: ./data/seen.sqlite` in config.yaml)
- Keep the same Gemini AI scoring and Telegram delivery logic
- Maintain the same cycle interval (5 minutes default)
- Preserve `--dry-run` and `--once` modes
- Keep the same feed sources and keyword filtering
- No Cloudflare bindings (no `wrangler`, no KVNamespace, no Worker Types reference)

---
### Task 1: Remove Cloudflare Worker files and update package.json

**Files:**
- Remove: `worker/` directory (all 6 files + .wrangler)
- Modify: `package.json` — remove `worker` field/scripts tied to Cloudflare
- Modify: `tsconfig.json` — remove worker-specific paths if any

**Interfaces:**
- Consumes: none
- Produces: `package.json` without Cloudflare deployment scripts

- [ ] **Step 1: Remove worker directory**
  
  ```bash
  rm -rf worker/
  ```

- [ ] **Step 2: Update package.json to remove worker scripts**
  
  Remove or comment out:
  - `"worker": "./worker"`
  - Scripts: `wrangler:login`, `wrangler:kv:create`, `wrangler:secret:put`, `wrangler:deploy`
  - Any `build:worker` or similar

- [ ] **Step 3: Verify package.json still has essential scripts**
  
  ```json
  {
    "scripts": {
      "test": "vitest",
      "tsc": "tsc --noEmit"
    }
  }
  ```

---
### Task 2: Update config.yaml to use local path (confirm already correct)

**Files:**
- Modify: `config.yaml` — verify `db_path: ./data/seen.sqlite` is correct local path

**Interfaces:**
- Consumes: none
- Produces: `config.yaml` with correct local SQLite path

- [ ] **Step 1: Verify config.yaml db_path**
  
  The `db_path: ./data/seen.sqlite` is already correct for local usage. No changes needed.

---
### Task 3: Verify data directory exists

**Files:**
- Create: `data/seen.sqlite` (empty initial SQLite database)

**Interfaces:**
- Consumes: none
- Produces: `data/seen.sqlite` empty SQLite file

- [ ] **Step 1: Create data directory and initial SQLite file**
  
  ```bash
  mkdir -p data
  touch data/seen.sqlite
  ```

---
### Task 4: Update CLAUDE.md to reflect new deployment

**Files:**
- Modify: `CLAUDE.md` — update deployment section, remove Cloudflare references

**Interfaces:**
- Consumes: current `CLAUDE.md`
- Produces: updated `CLAUDE.md` without Cloudflare deployment instructions

- [ ] **Step 1: Update deployment section in CLAUDE.md**
  
  Remove the "Deploy: Cloudflare Workers" section (lines 43-56) and update to describe local Node.js server deployment instead.

- [ ] **Step 2: Update any Cloudflare-specific notes**
  
  Remove references to `wrangler`, KV namespace, `MANUAL_TRIGGER_SECRET`, etc.

---
### Task 5: Create simple Node.js server entry point

**Files:**
- Create: `server.js` — simple HTTP server that runs one cycle on POST or scheduled

**Interfaces:**
- Consumes: none
- Produces: `server.js` that can start a local server

- [ ] **Step 1: Create server.js with minimal setup**
  
  ```javascript
  #!/usr/bin/env node
  import { runCycle } from './src/index.js';
  import express from 'express';
  
  const app = express();
  const port = process.env.PORT || 3000;
  
  app.post('/cycle', async (req, res) => {
    try {
      await runCycle();
      res.json({ status: 'ok' });
    } catch (err) {
      console.error('[cycle] error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  app.listen(port, () => {
    console.log(`gold-news-bot server running on port ${port}`);
  });
  ```

- [ ] **Step 2: Add express as dev dependency if needed**
  
  ```bash
  npm install express --save-dev
  ```

---
### Task 6: Update .github/workflows if Cloudflare-specific

**Files:**
- Modify: any GitHub Actions workflows that reference Cloudflare deployment
- Remove or replace Cloudflare deployment steps

**Interfaces:**
- Consumes: current workflow files
- Produces: workflows without Cloudflare steps

- [ ] **Step 1: Check .github/ for Cloudflare references**
  
  Search for `wrangler`, `cloudflare`, `kv` in `.github/` directory.

---
### Task 7: Test the migration works end-to-end

**Files:**
- Run: `npm test` to verify vitest tests pass
- Run: `npm run once -- --dry-run` to verify local cycle works without Telegram

**Interfaces:**
- Consumes: modified codebase
- Produces: passing test suite, working dry-run cycle

- [ ] **Step 1: Run vitest tests**
  
  ```bash
  npm test
  ```

- [ ] **Step 2: Run a dry-run cycle**
  
  ```bash
  npm run once -- --dry-run
  ```
  Expected: Console output shows fetching, filtering, ranking, but no Telegram sends

- [ ] **Step 3: Verify SQLite dedup works**
  
  Check that `data/seen.sqlite` is created/updated after a cycle run

---
## Verification

After completing all tasks:

1. `rm -rf worker/` — Cloudflare Worker code gone
2. `package.json` — no Cloudflare deployment scripts
3. `config.yaml` — `db_path: ./data/seen.sqlite` confirmed for local use
4. `data/seen.sqlite` — exists and used by dedup logic
5. `npm test` — all vitest tests pass
6. `npm run once -- --dry-run` — cycle runs, prints to console, no Telegram sends
7. `data/seen.sqlite` — grows with each cycle, proving dedup works

**Execution choice:**

**Plan complete and saved to `docs/superpowers/plans/2026-08-27-migrate-away-cloudflare.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**