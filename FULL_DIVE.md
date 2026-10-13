# Full dive: how every feature was tested

This is the log of building and running the test suite for this fork: what was
tried, what broke, what it revealed, and the final results. How to run things is
in [TESTING.md](TESTING.md).

Environment for every run: a shared dev host with a load average of 25–60 and
~115/125 GB RAM in use by other workloads. Timeouts in the suite are sized for
that, not for a quiet laptop.

## Final results

| Run | Command | Result |
| :-- | :------ | :----- |
| Unit tests (Docker `test` stage) | `docker build --target test .` | 11/11 pass (typecheck clean, lint 0 errors, warnings 103 → 68) |
| E2E, Collabora CODE 25.04.5.2 | `OFFICE_PROVIDER=collabora e2e/run.sh` | 43/43 pass (7.8 min, fresh stack, Docker only) |
| E2E, OnlyOffice 9.4.1 | `e2e/run.sh` | 43/43 pass (7.5 min, fresh stack, Docker only) |
| Non-root image | manual, see §1 | pass |

Earlier full runs that did not pass, and why (details in the sections below):

| Run | Result | Cause | Fixed in |
| :-- | :----- | :---- | :------- |
| OnlyOffice #1 (new suite) | 37 pass, 1 fail, 5 skipped | xlsx inline strings not indexed (6.4) | product: `feat/search` |
| Collabora #1 (new suite) | 40 pass, 1 fail, 2 skipped | LB kept routing `PutFile` to a stopped instance (4.19) | LB config + docs: `feat/ha` |
| OnlyOffice, first Docker-only run | 37 pass, 1 fail, 5 skipped | xlsx edit not found by search after save; cause not proven, most likely load from contexts that were never closed (9.5) | suite: contexts closed after each test |
| Collabora, first Docker-only run | 32 pass, 1 fail, 10 skipped | recipient did not see the owner's word within 60 s, same leaked contexts (9.5) | same |
| Collabora, second Docker-only run | 33 pass, 1 fail, 9 skipped | a keystroke dropped under load: saved `emu-mv6o9ze`, one character short (4.20) | suite: typing verified and retried |

## Test architecture

- **Two app instances on one volume, Valkey, nginx round robin.** Browsers hit
  either instance directly (deterministic cross-instance cases) or the load
  balancer (realistic case). The office server always calls back through the
  load balancer (`APP_URL=http://lb`), like a production HA setup.
- **Browsers inside the compose network.** Every URL uses compose hostnames, so
  Playwright's own image runs on that network; nothing is published on the host.
- **Chaos through the Docker socket.** Specs stop/start `scatola`, `valkey`,
  `lb` and the office server with plain HTTP calls on the mounted socket
  (`docker()` in `e2e/helpers.ts`), no extra tooling.
- **Reading what each user's editor shows.** Live collaboration is only proven
  if user B's editor contains what user A just typed *before anyone saves*:
  - OnlyOffice: `editor.asc_EditSelectAll()` + `asc_GetSelectedText()` inside
    the `frameEditor` iframe (works in view mode too).
  - Collabora: `uno .uno:ExecuteSearch` sent on the editor's websocket; the
    server answers `searchnotfound:` or a non-empty `textselection:`. Works in
    view mode, where select-all + `gettextselection` returns nothing.
- **Proving a single session.** Both users type different words and both words
  must end up in the saved file. Two separate sessions would make the last save
  overwrite the other user's edit.

## 1. Non-root container

| # | Attempt | Result |
| - | ------- | ------ |
| 1.1 | Built upstream-based image, `id` in container | `1001`. Upstream image created `/data/...` while the app writes `/app/data`, so with no volumes `mkdir /app/data` failed (EACCES). Fixed in `feat/non-root`. |
| 1.2 | Compose `user: 1000:1000` + share save from the UI | **Found a 30 s hang**: `/app/data/audit-logs` belonged to 1001, so the audit log lock retried for ~31 s before giving up. Fixed: `chmod -R 1777` on image-created data dirs. |
| 1.3 | `docker run -u 4242` without volumes | boots, registers a user in 1 s, files owned by 4242. Pass. |

## 2. Shares

| # | Attempt | Result |
| - | ------- | ------ |
| 2.1 | First UI run: share then assert badge | Failed: assertion ran while the dialog was still saving. Spec now waits for the dialog to close. |
| 2.2 | Typing a username before the user list loaded | **Product bug**: the chip was rejected as "unknown". Validation moved to the server (`Unknown user: x`), client just adds chips. Covered by "unknown user is rejected in the dialog". |
| 2.3 | Rename through the context menu | Upstream quirk: a `prompt()` appears, then an inline input. Spec accepts the prompt and fills the inline input. |
| 2.4 | Recipient sees the share (first run of the new suite) | Failed with a 20 s timeout on the loaded host while the page was correct (checked with curl on both instances). Expect timeout raised to 60 s. |
| 2.5 | Read-only: upload into root and subfolder, delete root, re-share menu, outsider, `..` traversal, unknown share id | All refused (403 / no menu entry). Pass. |
| 2.6 | Editable: upload into root and subfolder, delete inside, delete the share root | Inside works, root delete refused, owner's files intact. Pass. |
| 2.7 | Owner uploads on A while recipient watches on B | Recipient listing refreshes within 2–3 s via Valkey. Pass. |
| 2.8 | Rename shared folder, stop sharing | Share follows the rename; stop removes item and access (403) everywhere. Pass. |

## 3. Public links

| # | Attempt | Result |
| - | ------- | ------ |
| 3.1 | Turn on "Public link (view only)" in the dialog | Link appears in the dialog after Save (24-char token), copy button. Pass. |
| 3.2 | Anonymous browser on A, B and LB: list, open subfolder, download | Pass on all three. |
| 3.3 | File link `/api/public/<token>` | Streams the file. Pass. |
| 3.4 | `..%2F` traversal, `../` sibling, bad token, `/s/bad`, anonymous upload init | 403 / not served / 403 / 404 / 401. Pass. |
| 3.5 | Revoke, then hit the old link on A and B | 404 page, 403 download on both. Pass. |

## 4. Live collaboration (OnlyOffice and Collabora)

| # | Attempt | Result |
| - | ------- | ------ |
| 4.1 | Round 1: users-counter check only | Too weak: a counter does not prove edits are merged. Replaced by the "both words saved" check. |
| 4.2 | Collabora, instances with different `APP_URL` | **Sessions split**: Collabora groups by WOPI URL. `OFFICE_APP_URL` must be identical on all instances (documented); the stack now uses the LB URL. |
| 4.3 | Collabora opened from `scatola2` | Blocked by `frame-ancestors` (only the WOPI host is allowed). `extra_params` splits on spaces, so a list of hosts breaks it; tests use `--o:net.frame_ancestors=*`. Documented for production. |
| 4.4 | Collabora CODE welcome dialog | `--o:welcome.enable=false` is ignored by CODE. Spec removes the overlay before clicking. |
| 4.5 | Fresh OnlyOffice container | Tests started while DocService was still generating fonts. Added healthchecks, `up --wait`. |
| 4.6 | Probing how to read the document text | OnlyOffice: `WordControl.m_oLogicDocument` is not exposed; `asc_GetSelectedText` is. Collabora: `map.search` doesn't exist; `gettextselection` works only when editing; UNO `ExecuteSearch` over the socket works everywhere. |
| 4.7 | OnlyOffice, single user, close right after typing | **Product bug (data loss)**: edits typed in the last ~2 s were still unsent; closing produced status 4 (no changes). Close now waits for `onDocumentStateChange(false)` (max 10 s). Covered by "reopening after the save". |
| 4.8 | Collabora calc, typing into a cell | First keystrokes swallowed / autocorrected (`quoll-x` saved as `Ll-x`). Spec asserts on the unique suffix. |
| 4.9 | OnlyOffice endpoints while running Collabora | **Product fix**: `/api/office/callback` and `/api/office/file` answered (403) under Collabora because `OFFICE_JWT_SECRET` was set. They now 404 unless the provider is OnlyOffice. |
| 4.10 | Owner on A + recipient on B, each types, each reads the other's word live | Pass on both providers; saved file contains both words. |
| 4.11 | Same user, two tabs, through the LB | One session. Pass. |
| 4.12 | Admin path (`alice/...`) + owner path | One session (same real-path key). Pass. |
| 4.13 | Read-only recipient | View mode, sees owner's word live; their own typing never reaches the file. Pass. |
| 4.14 | Spreadsheet co-edit, presentation open by both | Pass. |
| 4.15 | File replaced outside the editor, then opened | New key, opens the new content. Pass. |
| 4.16 | Stop app instance A while A's user and B's user are editing | Editors keep working (they talk to the office server), the save callback reaches B via the LB, nothing lost. Pass. |
| 4.17 | Office server stopped | Page shows "The office server could not be reached."; editing works again after restart. Pass. |
| 4.18 | Forged OnlyOffice callback (unsigned, wrong secret), file fetch without JWT, WOPI without/forged token | 403 / 403 / 403 / 401 (OnlyOffice); 404 for OnlyOffice routes and 401 for WOPI under Collabora. Pass. |
| 4.20 | Collabora, second Docker-only run, single-user edit then reopen | Saved file held `emu-mv6o9ze`, one character short of the typed word: the editor dropped a keystroke while the host was loaded. `typeIn` now checks the typer's own editor and retypes until the word is there. Re-run: pass. |
| 4.19 | Collabora full run: app instance A stopped mid-session | **HA data loss found**: nginx kept sending Collabora's `PutFile` to the stopped container's IP (default 60 s connect timeout); Collabora gave up after 32 s, flagged a conflict and dropped the document. Production requirement documented (LB must skip dead instances within seconds); e2e nginx uses `proxy_connect_timeout 2s`. Re-run: pass. OnlyOffice was not affected (DocService retries callbacks). |

## 5. HA (shared volume + Valkey)

| # | Attempt | Result |
| - | ------- | ------ |
| 5.1 | Round 1 design: stamp file on the shared volume polled every 2 s | Worked, but replaced as requested: polling and periodic rescans are gone, Valkey pub/sub is the only trigger. |
| 5.2 | Live refresh test right after `goto` | Flaky: the upload sometimes happened before the browser opened `/api/events`. Spec waits for that response first. |
| 5.3 | Session cookie from A on B | Same user. Pass. |
| 5.4 | Live refresh A→B, B→A | Within 2–3 s both ways. Pass. |
| 5.5 | Listing cached on B, write on A, reload B | New file shown (Valkey epochs bumped). Pass. |
| 5.6 | Upload init on A, chunk on B, finalize on A | File assembled correctly. Pass. |
| 5.7 | `scatola` stopped, browse + upload through the LB | Served by `scatola2`; file visible on A after restart. Pass. |
| 5.8 | Valkey stopped | Uploads/downloads keep working on both instances (local fallback); after restart live refresh resumes on its own. Pass. |
| 5.9 | Observed in logs | Upstream disk watcher can die on an `ENOENT` race inside `uploads/temp` and falls back to TTL. Only affects changes made outside the app; app writes still publish through Valkey. Not changed. |

## 6. Search

| # | Attempt | Result |
| - | ------- | ------ |
| 6.1 | First absence assertions | **Passed for the wrong reason**: counted before the results replaced the loader. Helper now waits for the "N files" header / empty state. |
| 6.2 | "N files •" regex | Header drops the bullet when there are no folders; regex fixed. |
| 6.3 | Shared words across specs | Absence checks now use per-run unique words. |
| 6.4 | Fresh run: `wallaby` in an openpyxl-made xlsx | **Product gap**: inline strings live in `xl/worksheets/sheetN.xml`, only `sharedStrings.xml` was read. Extractor fixed + unit test. |
| 6.5 | txt, docx, xlsx, pptx, pdf content; name prefix; folder; MIME; diacritics | Pass. |
| 6.6 | Write on A, search on B (and back) | Indexed within seconds via Valkey. Pass. |
| 6.7 | Delete on B, search on A | Gone. Pass. |
| 6.8 | Bob before/after alice shares the folder | Not found → found; unshared file never found. Pass. |
| 6.9 | Restart `scatola2`, search immediately | Answers (name fallback while the index rebuilds). Pass. |
| 6.10 | `node --test` never exited once the index started the file watcher | Recursive `fs.watch` keeps the loop alive (`FSWatcher.unref()` returned `undefined` and did not help); tests run with `--test-force-exit`. |

## 7. OIDC

| # | Attempt | Result |
| - | ------- | ------ |
| 7.1 | Dex static user with a remembered bcrypt hash | Invalid credentials: the hash was wrong. Regenerated with bcryptjs. |
| 7.2 | Login through the LB | User `carol` provisioned, session valid. Pass. |
| 7.3 | Logout | Goes through Dex end-session back to login. Pass. |

## 8. PWA

| # | Attempt | Result |
| - | ------- | ------ |
| 8.1 | `navigator.serviceWorker` in headless shell | Undefined: the insecure-origin flag is ignored by the headless shell. Suite uses full Chromium (`channel: "chromium"`). |
| 8.2 | `context.setOffline(true)` to test the offline page | Got the real page: Playwright's offline mode does not apply to service-worker fetches. The spec stops the load balancer instead. |
| 8.3 | Manifest, SW ready, offline fallback with LB down | Pass. |

## 9. Tooling issues hit along the way

- Host had a compose project already named `e2e`: the first `up` joined its network (its containers were not touched). The stack is now `name: scatola-e2e`.
- `npx @playwright/test` could not be resolved from the spec file: `e2e/package.json`.
- Host `docker compose` cannot build (buildx < 0.17): `run.sh` uses `docker build`.
- zsh `noclobber` silently skipped a log redirect once (`>|` needed).
- Testing moved to Docker only: unit tests, typecheck and lint run in the image's `test` stage (`run.sh` builds it first), and the host `node_modules` was deleted.
- (9.5) Failure snapshots showed the PWA "You're Offline" page in office tests: Playwright snapshotted the never-closed context left by the offline test. Contexts opened by `pageAs` were never closed, so open editors and SSE streams piled up across the run. An auto fixture now closes every context after each test.

## 10. Dead code removed

`knip` + `eslint` unused-vars pass on the whole app: 5 unused components
(`FolderCreator`, `FilesPage/FolderTree`, `TorrentPasswordModal`,
`FolderSelector`, `FAB`), the `FolderTree` wrapper, an unused web worker, 9
unused functions/constants/types, dead state (`pendingUpload`,
`hasStoredPassword`, `isAddModalOpen`, ...) and dead props
(`showSettingsButton`, `showCreate`, `folderPath`). 737 lines removed, typecheck
and tests unchanged. Remaining knip findings are false positives (`sw.ts` is
loaded by Serwist, `COLLABORA` is used through `Object.values`).
