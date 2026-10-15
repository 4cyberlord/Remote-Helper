# Remote Helper for Council Editor

A separate **macOS terminal-only capture and cloud-submission helper** for [Council Editor](https://github.com/4cyberlord/code-auditor). It uses your existing Council Editor username and PIN and queues jobs to its existing authenticated cloud agents. The full solutions and the `(R)` remote designation belong in the Council Editor desktop app—not the terminal.

## Install on your Mac

Requires **macOS**, **Node.js 24 or later**, and the Xcode Command Line Tools (`xcode-select --install`).

```bash
git clone https://github.com/4cyberlord/Remote-Helper.git
cd Remote-Helper
./install.sh
```

The installer compiles a small native macOS helper, adds `00` through `04` to `~/.local/bin`, and **prompts immediately for your Council Editor username and 4-digit PIN** when run in an interactive terminal. If `~/.local/bin` is not on your PATH, add this to your `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

No Supabase service-role key or AI provider key is installed. The helper uses the **public deployment URL and publishable key** already compiled into Council Editor. Your token is stored in the **macOS Keychain**, not a file. The PIN is entered without echo, checked by the same remote `auth.login` operation as Council Editor, and is never stored by the helper. A revoked or expired sign-in requests authentication again. To log out and revoke the token, use `council-remote logout`.

Grant **Screen & System Audio Recording** permission to your Terminal app in macOS System Settings → Privacy & Security if prompted by macOS. Screenshots happen only after you type `01`, `02`, or `03`.

## Your complete numeric command sequence

| Command | Operation |
| --- | --- |
| `00` | Create a **new, separate session folder** (every time). |
| `01` | Capture the **entire display under the pointer** as a PNG. |
| `02` | Capture the **left half** of that display as a PNG. |
| `03` | Capture the **right half** of that display as a PNG. |
| `04` | **Upload and queue** that session for your cloud Council agents; return control to the terminal. |

If a previous `04` failed and you have already started a new session with `00`, recover the older saved session without switching the active captures:

```bash
council-remote retry <previous-session-uuid>
```

Use the session UUID printed by the previous `00` (or in its `session.json`). This named recovery operation does not add another numeric capture command or mix the sessions. It reuses the original submission ID and cloud job if already created.

You can run the numeric commands directly from Terminal or run `council-remote` for an interactive `remote>` prompt that accepts those same five commands. Typing `00` after `04` does **not** overwrite or mix with the previous session; it creates a new folder, UUID, upload paths, and submission ID.

**Only these five numeric commands are installed.** There is no terminal history viewer, interactive region selection, diagnostics numbered command, or separate submit command.

## Isolation and correctness

- Each `00` creates `~/Library/Application Support/Council Remote Helper/sessions/<session-uuid>/`, containing its PNGs and `session.json` manifest. Folder and manifest are created with owner-only permissions. Original captures remain on disk even after successful upload; manage these local copies as sensitive information.
- `01`–`03` fetch live Core Graphics display geometry each time (including offsets for external monitors) and use native `screencapture -R` with **unscaled logical coordinates**. Left/right halves fit together with no gap or overlap, including odd-width displays. Image metadata captures actual physical pixel dimensions.
- The maximum is **10 screenshots per cloud job**, matching Council Editor. After `04` begins submission, the session is sealed against new screenshots. Start `00` to capture the next problem.
- `04` sends screenshots to the existing **private** Supabase Storage bucket via owner-scoped signed upload URLs. It creates an owned remote session and screenshot records before queueing the existing `jobs.create` cloud-worker operation. No AI processing or credentials live locally.
- A **durable per-session submission journal** records its UUID, image paths and progress after each step. If the network fails, typing `04` again retries with the **same** submission ID. Calling `04` after successful submission returns the original job ID instead of creating a duplicate. You can independently use `00` for the next session at any time.
- The terminal does **not** print solutions or poll job history. Council Editor's cloud worker performs the existing agent selection, verification, and report persistence. The remote origin is explicitly recorded as `settingsSnapshot.origin = 'remote-terminal'` and session names begin with `(R)`.
- A matching History-view integration is required in the Council Editor app for remote cloud jobs to appear as `(R)` alongside regular runs. Its ordinary history and cloud-job reports use different database tables; uploading a job alone does not populate the ordinary desktop-run history table.

## Quality checks

```bash
npm run check
```

These tests validate crop coordinates, API contracts, session isolation, idempotent retries and the command surface. The macOS CI job checks Swift compilation. Actual capture permissions and connectivity to the production cloud worker require a macOS machine and a valid account to verify end to end. The CLI never treats queue acceptance as proof that agent processing finished.

## Optional deployment override (developers only)

The helper targets the same Council Editor production API by default. For staging integration tests, the two **non-secret** environment variables `COUNCIL_REMOTE_API_URL` and `COUNCIL_REMOTE_PUBLISHABLE_KEY` may override that deployment. Do not set these to service-role or secret keys.
