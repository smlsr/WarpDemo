# Import

## Jira

Jira Cloud → Settings → System → External system import → JSON.

File: `tickets/jira-import.json`. Project key **WVIEW**. Links are Blocks. `sourceId` blocks `destinationId`, so the destination is the blocked ticket. Labels `size:S` and `size:M` are auto-merge. `size:L` and `size:XL` need approval.

## Linear

Linear's CSV importer does not keep blockers. `tickets/linear-import.json` is the API batch: create each issue with `tempId`, then `issueRelationCreate` type `blocks` from each `blockedBy` id to the issue.

Priority 1 is urgent (XL), 4 is low (S). Estimates are 1, 2, 3, 5.
