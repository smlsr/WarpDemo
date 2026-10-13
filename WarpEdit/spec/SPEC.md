# WarpEdit

WarpView is the read-only map. This pack adds reset and keeps the same timestamps and utilization.

From merged, done, or skipped, a person can put the ticket back on queued, claimed, planning, coding, review, fix, awaiting_approval, merging, blocked, or alarm. Confirm names the from phase and the to phase. Same phase is a no-op.

Reset does not delete timestamps. It appends `{from, to, at, note}` on the ticket. Tokens and minutes stay. Dependents leave the ready set. Utilization counts update. Save writes `status` and the reset log. Reload shows both.

The viewer file must not grow this control.
