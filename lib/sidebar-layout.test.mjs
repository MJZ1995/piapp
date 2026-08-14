import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTopEntries,
  createGroup,
  deleteGroup,
  EMPTY_LAYOUT,
  groupMembers,
  moveSessionToGroup,
  moveTopEntry,
  moveWithinGroup,
  pruneLayout,
} from "./sidebar-layout.ts";

function layout() {
  return structuredClone(EMPTY_LAYOUT);
}

test("new sessions stay on top, manual order follows, groups collapse members", () => {
  const l = layout();
  createGroup(l, "g1", "PRDs");
  moveSessionToGroup(l, "prd1", "g1");
  moveSessionToGroup(l, "prd2", "g1");
  moveTopEntry(l, "s:proto", "g:g1", false);

  const entries = computeTopEntries(["new1", "proto", "prd1", "prd2", "old"], l);
  assert.deepEqual(entries, [
    { type: "session", id: "new1" },
    { type: "session", id: "old" },
    { type: "group", id: "g1" },
    { type: "session", id: "proto" },
  ]);
  assert.deepEqual(groupMembers(l.groups.g1, ["prd1", "prd2", "x"]), ["prd1", "prd2"]);
});

test("reorder top entries and within group", () => {
  const l = layout();
  moveTopEntry(l, "s:a", null, false);
  moveTopEntry(l, "s:b", null, false);
  moveTopEntry(l, "s:c", "s:a", true);
  assert.deepEqual(l.order, ["s:c", "s:a", "s:b"]);

  createGroup(l, "g1", "G");
  moveSessionToGroup(l, "m1", "g1");
  moveSessionToGroup(l, "m2", "g1");
  moveWithinGroup(l, "m2", "g1", "m1", true);
  assert.deepEqual(l.groups.g1.order, ["m2", "m1"]);
});

test("moving a grouped session to top level ungroups it; deleting group releases members", () => {
  const l = layout();
  createGroup(l, "g1", "G");
  moveSessionToGroup(l, "x", "g1");
  moveTopEntry(l, "s:x", null, false);
  assert.deepEqual(l.groups.g1.order, []);
  assert.deepEqual(l.order.filter((k) => !k.startsWith("g:")), ["s:x"]);

  moveSessionToGroup(l, "y", "g1");
  deleteGroup(l, "g1");
  const entries = computeTopEntries(["y"], l);
  assert.deepEqual(entries, [{ type: "session", id: "y" }]);
});

test("prune drops stale session and group references", () => {
  const l = layout();
  createGroup(l, "g1", "G");
  moveSessionToGroup(l, "gone", "g1");
  moveTopEntry(l, "s:stale", null, false);
  pruneLayout(l, ["keep"]);
  assert.deepEqual(l.order, ["g:g1"]);
  assert.deepEqual(l.groups.g1.order, []);
});
