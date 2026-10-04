# WarpEdit

WarpView is the shipped read-only map (WV-13 merged). This pack turns that map into an editor.

A person can change a summary, a dependency, a lock path, and a size, then save a beam and a Warp plan. Save must refuse a cycle and a missing dep. Dragging a timeline bar cannot violate a blocker.

S and M still auto-merge in Warp. L and XL, including the save writer and the drag editor, wait for approval. That split is the harness for Warp's merge policy.
