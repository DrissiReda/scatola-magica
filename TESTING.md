# Testing

Everything runs in Docker containers; nothing is built or run on the host.
Two layers: unit tests inside the image's `test` stage, and a headless-browser
suite that drives a real HA stack built from the image. Every attempt, finding and result of building that suite
is logged in [FULL_DIVE.md](FULL_DIVE.md).

## Unit tests

```bash
docker build --target test .   # typecheck + lint + unit tests
```

| File | Covers |
| :--- | :----- |
| `tests/shares.test.ts` | share ids, read-only vs edit, protected share root, recipient root listing, renames/deletes, public links |
| `tests/office.test.ts` | one document key per real file, key rotation, WOPI tokens, SSRF guard on saved files, Collabora discovery |
| `tests/search.test.ts` | background build, content + metadata + diacritics, per-user roots, incremental updates, query injection |

## End-to-end suite

```bash
e2e/run.sh                              # OnlyOffice
OFFICE_PROVIDER=collabora e2e/run.sh    # Collabora
e2e/run.sh office.spec.ts -g read-only  # any playwright args
```

`run.sh` builds the `test` stage first, wipes `e2e/data`, builds the image and starts the stack below, then
runs Playwright (Chromium, headless) inside the compose network. The Docker
socket is mounted so specs can stop/restart instances, Valkey, the load balancer
and the office server.

```
browser ──► lb (nginx, round robin) ──► scatola ─┐
        ├─► scatola (direct)                     ├─ ./data (shared volume)
        └─► scatola2 (direct) ───────────────────┘   valkey (pub/sub + cache)
office server (OnlyOffice | Collabora) ──► lb        dex (OIDC)
```

| Spec | Variations |
| :--- | :--------- |
| `shares.spec.ts` | read-only folder (badge for owner and recipient, browse subfolders, download, writes refused), no re-share, outsiders/traversal 403, unknown user error, editable (upload/delete inside, root protected), live refresh across instances, single-file share, rename followed, stop sharing |
| `public-links.spec.ts` | link from the dialog, anonymous browsing on A/B/LB with subfolders and downloads, file link, traversal and bad tokens refused, anonymous writes refused, revoke on every instance |
| `search.spec.ts` | txt/docx/xlsx/pptx/pdf content, name prefix, folder, MIME, diacritics, index in sync across instances, deletions, per-user scope before/after sharing, search during boot |
| `ha.spec.ts` | session on both instances, live refresh A→B and B→A, cache invalidation, chunks split across instances, LB with an instance down, Valkey down then back |
| `office.spec.ts` | owner on A + recipient on B type and see each other live, both edits saved; reopen shows saved text; same user in two tabs via LB; admin path + owner path in one session; read-only recipient follows live but cannot edit; spreadsheet co-edit; presentation; file changed outside the editor; app instance killed mid-session; office server down; forged callbacks/WOPI calls |
| `auth-pwa.spec.ts` | OIDC login/provisioning via Dex, OIDC logout, manifest, service worker, offline fallback |

Not automated (run by hand, results in FULL_DIVE.md):

```bash
docker run --rm --entrypoint id scatola:e2e -u    # 1001: image is non-root
docker run --rm -u 4242 scatola:e2e               # any UID boots, data writable
```
