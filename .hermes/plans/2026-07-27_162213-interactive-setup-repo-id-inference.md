# Interactive Setup Repository-ID Inference Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make `atlas setup` prefill the canonical repository ID after a user chooses **Local Git**, using the current checkout’s `origin` remote, while preserving an editable prompt and giving a useful fallback when inference is unavailable.

**Architecture:** Reuse one Git-remote-to-canonical-repo-ID parser for both general target resolution and setup’s local-Git defaults. Extend the local Git discovery result with an optional canonical `repoId`; thread that default into the Repository ID prompt only after the user selects `local-git`. Explicit `--repo-id` remains the highest-priority value, and an unparseable/no-origin repository still uses an empty but format-guided prompt.

**Tech Stack:** TypeScript, Bun, Commander, `@clack/prompts`, `bun:test`.

---

## Current context and assumptions

- The active checkout is `github.com/moxellabs/atlas` on `fix/stability-hardening`, with `origin` set to `https://github.com/moxellabs/atlas.git`.
- Current setup flow calls `resolveRepoConfigInput()` from `apps/cli/src/commands/init.command.ts:354` after the user confirms “Add the first repository now?”.
- `apps/cli/src/commands/shared.ts:274-286` currently prompts `Repository ID` with no default and immediately throws `CLI_REPO_ID_REQUIRED` when the user submits the empty field.
- `apps/cli/src/commands/shared.ts:753-771` already discovers the local Git root, branch, and `origin` URL for the later local-Git prompts.
- `apps/cli/src/commands/repo-target.ts:267-315` separately parses an origin remote for other commands. Its parser is private and only accepts `git@host:owner/repo.git` and HTTP(S), so setup cannot reuse it and `ssh://git@host/owner/repo.git` is not currently canonicalized there.
- This plan intentionally addresses **interactive Local Git setup**. It must not change non-interactive validation, force a remote onto non-Git directories, or silently configure a new GHES host.

## Acceptance criteria

1. In a Git checkout with origin `https://github.com/moxellabs/atlas.git`, interactive `atlas setup` → Yes → Local Git displays `github.com/moxellabs/atlas` as the editable Repository ID default.
2. The same behavior works for SCP-style SSH (`git@github.com:moxellabs/atlas.git`) and URL-style SSH (`ssh://git@github.com/moxellabs/atlas.git`) remotes.
3. `--repo-id host/owner/name` overrides any inferred default.
4. Outside a Git checkout, or with an unsupported/local `file://` remote, setup does not invent an ID; it prompts with a clear canonical-format example and retains the existing required-input error if the user leaves it blank.
5. Existing repo-target inference keeps its current behavior for HTTPS and SCP-style SSH remotes and gains coverage for URL-style SSH if the shared parser supports it.
6. The implementation uses a single parser rather than duplicating remote parsing rules across `shared.ts` and `repo-target.ts`.

## Non-goals

- Do not auto-accept or skip the Repository ID prompt; users must be able to review/edit the inferred identity.
- Do not infer an ID from a directory name, cache path, or an arbitrary non-origin remote.
- Do not change the setup runtime directory flow, config schema, MCP configuration, host-registration policy, or artifact/indexing behavior.
- Do not add token setup or GitHub API calls.

## Proposed approach

Create a small command-layer utility that converts a supported Git remote into a canonical `host/owner/name` string. Move the parsing responsibility out of `repo-target.ts` so `shared.ts` can consume it without a circular import. Update `detectLocalGitDefaults()` to populate an optional `repoId`, and resolve the repository ID only after mode selection so that this inference is used exclusively for the Local Git choice.

### Task 1: Extract and test canonical Git-remote parsing

**Objective:** Create one reusable, deterministic parser for the remote formats Atlas supports.

**Files:**
- Create: `apps/cli/src/commands/git-remote.ts`
- Modify: `apps/cli/src/commands/repo-target.ts:267-315`
- Test: `apps/cli/src/cli.test.ts` (near existing `repo target inference supports cwd, git origin...` coverage around line 733)

**Step 1: Write failing parser/target-resolution tests**

Add cases that exercise the shared behavior through `init`/repo-target resolution:

```ts
// `origin` remote -> expected canonical repo ID
["https://github.com/moxellabs/atlas.git", "github.com/moxellabs/atlas"]
["git@github.com:moxellabs/atlas.git", "github.com/moxellabs/atlas"]
["ssh://git@github.com/moxellabs/atlas.git", "github.com/moxellabs/atlas"]
```

Also add unsupported remote coverage:

```ts
expect(parseGitRemoteRepoId("file:///tmp/atlas")).toBeUndefined();
```

**Step 2: Run the focused test before implementation**

Run:

```sh
mise exec -- bun test apps/cli/src/cli.test.ts --test-name-pattern 'repo target inference'
```

Expected: the URL-style SSH assertion fails before parser support is added.

**Step 3: Add the reusable parser**

Export a narrow utility from `apps/cli/src/commands/git-remote.ts`:

```ts
export function repoIdFromGitRemote(remote: string): string | undefined
```

Implementation requirements:
- Accept `git@host:owner/name[.git]`.
- Accept `ssh://[user@]host/owner/name[.git]`.
- Accept `http://` and `https://` URL remotes.
- Normalize host, owner, and name to lower case; remove one trailing `.git` from the name.
- Return `undefined` for `file://`, relative paths, remotes without both owner and repository path segments, and malformed URLs.
- Do not validate host configuration here; parsing must remain pure.

**Step 4: Refactor repo target resolution to use the utility**

In `apps/cli/src/commands/repo-target.ts`, replace the private `parseGitRemote()` implementation with an import of `repoIdFromGitRemote()`. Preserve the current host-status validation and `CLI_REPO_HOST_UNKNOWN` behavior after parsing.

**Step 5: Run focused tests**

Run:

```sh
mise exec -- bun test apps/cli/src/cli.test.ts --test-name-pattern 'repo target inference|init auto-configures detected enterprise host'
```

Expected: all selected cases pass.

**Step 6: Commit**

```sh
git add apps/cli/src/commands/git-remote.ts apps/cli/src/commands/repo-target.ts apps/cli/src/cli.test.ts
git commit -m "refactor(cli): share git remote repository parsing"
```

### Task 2: Thread the inferred ID into the Local Git setup prompt

**Objective:** Give the interactive Local Git Repository ID prompt an editable canonical default from `origin`.

**Files:**
- Modify: `apps/cli/src/commands/shared.ts:193-243, 274-286, 747-771`
- Test: `apps/cli/src/cli.test.ts`

**Step 1: Write failing setup-resolution tests**

Add tests around the existing setup tests that create a temporary Git checkout with an origin remote. Exercise `resolveRepoConfigInput()` through `setup` where practical, or add a focused unit seam only if interactive prompt injection is required by the current CLI architecture.

Required assertions:

```ts
// Local Git + https origin
expect(repo.repoId).toBe("github.com/moxellabs/atlas");

// Explicit input remains authoritative
expect(repo.repoId).toBe("github.com/override/repo");

// Non-Git/unsupported origin yields no inferred default
expect(gitDefaults?.repoId).toBeUndefined();
```

For the actual prompt behavior, extend the prompt abstraction/test harness only enough to capture `input(question, fallback)` arguments. Assert:

```ts
expect(promptInputs).toContainEqual({
  question: "Repository ID",
  fallback: "github.com/moxellabs/atlas",
});
```

**Step 2: Run the new focused test before implementation**

Run the exact new test name, for example:

```sh
mise exec -- bun test apps/cli/src/cli.test.ts --test-name-pattern 'setup pre-fills repository ID from local Git origin'
```

Expected: FAIL because `resolveRepoConfigRepoId()` currently passes no fallback.

**Step 3: Extend local Git defaults**

Update `LocalGitDefaults` in `shared.ts` to include:

```ts
repoId?: string;
```

Update `detectLocalGitDefaults()` to derive it from the configured `origin` remote via `repoIdFromGitRemote()`. Preserve the existing fallback remote (`pathToFileURL(rootPath).href`) for local checkout configuration; it must not become an inferred repo ID.

**Step 4: Resolve mode before choosing the repository-ID default**

Change `resolveRepoConfigInput()` so `resolveRepoConfigRepoId()` receives the selected `mode` and the discovered local Git defaults (or an equivalent dependency-free resolved value). This avoids prompting or inferring from Git for the GHES API mode.

The priority must be:

```ts
input.repoId
  ?? (mode === "local-git" ? gitDefaults?.repoId : undefined)
  ?? interactive prompt result
```

Do **not** bypass the prompt when a default exists. Supply the inferred ID as `promptIfInteractive(context, "Repository ID", inferredRepoId)` so Clack displays it and users can edit/confirm it.

**Step 5: Improve the no-default prompt copy**

When no local repository ID can be inferred, use a question that describes the accepted input format, for example:

```ts
"Repository ID (for example github.com/owner/repo)"
```

Keep the error code and error semantics unchanged if the response is blank. Ensure tests assert the field remains required rather than silently producing an invalid config.

**Step 6: Avoid duplicate Git probing**

Pass the already-discovered `LocalGitDefaults` into `resolveLocalGitRepoConfig()` so Git root/ref/remote are read once during a setup flow. Do not change default ref/local-path/remote behavior.

**Step 7: Run focused tests**

Run:

```sh
mise exec -- bun test apps/cli/src/cli.test.ts --test-name-pattern 'setup pre-fills repository ID|repo target inference|add-repo prefers origin remote|add-repo still requires a remote'
```

Expected: all selected tests pass.

**Step 8: Commit**

```sh
git add apps/cli/src/commands/shared.ts apps/cli/src/cli.test.ts
git commit -m "fix(cli): infer repository ID during local setup"
```

### Task 3: Validate the shipped Bun-linked interactive UX

**Objective:** Prove the normal user path works through the built and linked executable, without replacing it with flags.

**Files:**
- No production-file changes expected.

**Step 1: Run project quality gates**

```sh
mise exec -- bun run lint
mise exec -- bun run typecheck
mise exec -- bun test apps/cli/src/cli.test.ts
```

Expected: clean lint/typecheck and passing CLI tests. If the known unrelated `repo add alias preserves add-repo JSON result shape` timeout recurs, record its test name, received shape, and duration separately; do not attribute it to repository-ID inference or weaken its assertion in this change.

**Step 2: Rebuild the Bun-linked package**

```sh
mise exec -- bun run build:package
```

Expected: `dist/` and `bin/` are refreshed so `~/.bun/bin/atlas` executes the modified checkout.

**Step 3: Perform manual interactive smoke testing**

From a disposable Git checkout with a GitHub origin, run:

```sh
atlas setup
```

Choose the normal path:
1. accept or choose the runtime directory;
2. answer **Yes** to adding the first repository;
3. choose **Local Git**;
4. verify the Repository ID field visibly prepopulates `github.com/<owner>/<repo>`;
5. accept it, complete the ref/path/remote prompts, and inspect the generated config.

Repeat with a non-Git directory or a `file://` origin. Verify Atlas asks for the explicit canonical ID with the example instead of producing an invisible/defaultless field.

**Step 4: Verify diff and history**

```sh
git diff --check
git status --short
git log --oneline -2
```

Expected: only the planned files are changed/committed; no user-home Hermes/Atlas configuration or generated `dist/` output is committed unless project policy explicitly tracks it.

## Risks and tradeoffs

- **Remote URL grammar:** Git URLs are diverse. This plan deliberately supports the three standard user-facing remote forms and returns `undefined` for anything ambiguous rather than guessing.
- **Host policy:** Canonicalization is intentionally separate from whether a host is configured. Existing GHES host validation must continue at its current boundary.
- **Prompt testing:** Current tests primarily use non-interactive `runWithCapture`. A small injectable prompt seam may be required to observe the fallback value without introducing a TTY-dependent integration test. Keep that seam narrow and test-only where possible.
- **Setup versus `init`:** `atlas init` already has a separate repo-target resolver and should keep using it; avoid replacing it with the setup-specific resolver.

## Open questions

- Should the generic fallback label use `host/owner/name` or the more concrete `github.com/owner/repo` example? Recommendation: show both if Clack label length remains readable: `Repository ID (host/owner/name, e.g. github.com/owner/repo)`.
- Should an inferred ID be shown in the prompt as the standard Clack default, or should the UI explicitly state its source (for example `Repository ID (from origin)`)? Recommendation: start with the standard default to minimize noise; add source labeling only if user testing shows ambiguity.
