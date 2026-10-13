# Import WarpEdit tickets

Project **WAR** (Warp Demo), component **WarpEdit**. 14 issues.

## Jira (recommended): JSON importer

1. Jira settings → System → External system import → JSON. Upload `tickets/jira-import.json`.
2. Map the custom field **External ID** (text). If the site has no such field, the labels `ext:<id>` and `warp:<id>` carry the plan id; Warp finds issues by External ID first, then by the `warp:<id>` label.
3. The importer creates the **Blocks** links listed under `links` (blocker → blocked).
4. Cross-run blocker: view:WV-15 lives in the other pack. Import `WARPDEMO/JIRA_IMPORT.json` instead (both packs and that link), or add the link by hand after importing both.

Already imported the old WarpView/WarpEdit packs into WAR? Those issues carry the same External IDs with old summaries. Archive or delete them first, or Warp will map the plan ids to the old issues.

## Jira: CSV fallback

`tickets/JIRA_IMPORT.csv`: one row per ticket; repeated **Labels** and **Blocked By** columns; External ID and the full description. Map Issue ID to the issue id column so Blocked By resolves.

## Linear

`tickets/linear-import.json`: issueCreate for each issue, then issueRelationCreate (type blocks) for each relation. Linear's CSV import drops blockers.

## After import

Nothing to assign: Warp dispatches by plan, not by person. Run `/warp-init edit`, `/warp-scan WARPDEMO/WarpEdit`, then `/warp-start` (see `WARPDEMO/README.md`).
