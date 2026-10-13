# WarpView

Read-only single HTML file. It starts with no data. Load a Warp export (`kind: warp-plan`). Save writes that file back and must not change ticket status.

Show every timestamp the beam can carry: `exportedAt`, `updatedAt`, `pr.openedAt`, `pr.reviewedAt`, `pr.approvedAt`, `pr.mergedAt`, `jira.lastCommentAt`, `gate.greenAt`. A missing value is an em dash.

Show utilization: token sum, minute sum, active tickets over `estimate.maxAgents`, agent hours spent against `estimate.agentHours`, counts by phase and by size.

Interactive means filter, hover, click, sort, and scrub. It does not mean edit. Resetting a merged ticket is WarpEdit.

Phases displayed: queued, claimed, planning, coding, review, fix, awaiting_approval, merging, merged, done, blocked, alarm, skipped.

Sample file: `fixtures/WARP_PLAN.sample.json`.
