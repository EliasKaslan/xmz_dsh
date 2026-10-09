# EXCLUDED - items deliberately kept out of the snapshot

- generated (utc): 2026-10-09T09:57:25Z
- generator: sync-dsh-repos.ps1
- relative paths and byte sizes only. No file content is recorded in this file.
- counts are a point-in-time measurement; the sessions trees grow while DSH runs.

## Directory-level exclusions (whole subtree pruned, name-matched at any depth)
## rule: robocopy /XD sessions node_modules .git .pnpm-store .secrets storages
## "sessions" is the DSH session-record tree (session.v4.jsonl.zstd transcripts,
## raw conversation data) and is excluded as a whole.
## "storages" holds the session project cache (session_projcache\sessions).
## ".secrets" is the whole credential store (tokens, MS365 token cache,
## selected-account metadata); the directory is pruned as a unit.
## node_modules is the npm dependency tree (hundreds of MB, reproducible).

DIR | .secrets | files=4 | bytes=9251
DIR | launcher\runtime\node_modules | files=26621 | bytes=475341646
DIR | profiles\headless\node_modules | files=0 | bytes=0
DIR | profiles\web\node_modules | files=4 | bytes=2182
DIR | sessions | files=680 | bytes=265249876
DIR | storages | files=669 | bytes=12268219

## File-level exclusions (name patterns, matched at any depth)
## rule: robocopy /XF *credentials* *.key *.pem *.token .credentials.yaml *.zstd
## GAP CLOSED: *.token never matched .secrets\ms365\.token-cache.json, but the whole
## .secrets directory is now pruned by /XD .secrets, so no credential file can
## survive by pattern accident.

FILE | .credentials.yaml | bytes=279
FILE | skills\ascend-env\credentials.txt | bytes=2011

## Root-level special handling (not expressible as a glob rule)
FILE | cordis.patch.yml | REMOVED from the snapshot with Remove-Item: this file holds
     a plaintext credential literal as the value of GITHUB_PERSONAL_ACCESS_TOKEN.
     The value is never copied, never logged and never written anywhere.
FILE | cordis.patch.redacted.yml | WRITTEN in its place: every value whose key matches
     (?i)(token|secret|password|api_key|webhook) is replaced with <redacted>, keys and
     structure preserved, UTF-8 without BOM. A residual-credential guard re-scans the
     result and aborts the run (exit 5) if any credential literal survives.

## Preset bundle exclusions
## source: D:\workspace\agent\dsh_base\artifacts\presets\orchestrator-bundle
## rule: robocopy /XD node_modules .git
(nothing excluded in the preset bundle)
