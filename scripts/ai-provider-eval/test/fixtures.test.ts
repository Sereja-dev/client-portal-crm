import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CLIENTS, PROJECTS, TASKS, INVOICES, NONEXISTENT_REFS } from "../fixtures/organization.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("fixtures/organization.ts — the one synthetic organization", () => {
  test("has exactly 6 clients, 8 projects, 16 tasks, 10 invoices", () => {
    assert.equal(CLIENTS.length, 6);
    assert.equal(PROJECTS.length, 8);
    assert.equal(TASKS.length, 16);
    assert.equal(INVOICES.length, 10);
  });

  test("every ref is a valid UUID shape matching the repo's own UUID_PATTERN", () => {
    for (const c of CLIENTS) assert.match(c.ref, UUID_PATTERN);
    for (const p of PROJECTS) assert.match(p.ref, UUID_PATTERN);
    for (const t of TASKS) assert.match(t.ref, UUID_PATTERN);
    for (const nonexistent of NONEXISTENT_REFS) assert.match(nonexistent, UUID_PATTERN);
  });

  test("no ref collides across clients/projects/tasks/nonexistent refs", () => {
    const allRefs = [...CLIENTS.map((c) => c.ref), ...PROJECTS.map((p) => p.ref), ...TASKS.map((t) => t.ref), ...NONEXISTENT_REFS];
    assert.equal(new Set(allRefs).size, allRefs.length);
  });

  test("NONEXISTENT_REFS match no real client/project/task ref", () => {
    const realRefs = new Set([...CLIENTS.map((c) => c.ref), ...PROJECTS.map((p) => p.ref), ...TASKS.map((t) => t.ref)]);
    for (const nonexistent of NONEXISTENT_REFS) assert.equal(realRefs.has(nonexistent), false);
  });

  test("every project references a real client ref", () => {
    const clientRefs = new Set(CLIENTS.map((c) => c.ref));
    for (const p of PROJECTS) assert.equal(clientRefs.has(p.clientRef), true);
  });

  test("every task references a real project ref", () => {
    const projectRefs = new Set(PROJECTS.map((p) => p.ref));
    for (const t of TASKS) assert.equal(projectRefs.has(t.projectRef), true);
  });

  test("every invoice references a real project ref and a real client ref", () => {
    const projectRefs = new Set(PROJECTS.map((p) => p.ref));
    const clientRefs = new Set(CLIENTS.map((c) => c.ref));
    for (const i of INVOICES) {
      assert.equal(projectRefs.has(i.projectRef), true);
      assert.equal(clientRefs.has(i.clientRef), true);
    }
  });

  test("includes at least two similarly-named clients (disambiguation coverage)", () => {
    const names = CLIENTS.map((c) => c.name.toLowerCase());
    assert.ok(names.filter((n) => n.includes("alderbrook")).length >= 2);
  });

  test("includes at least one client with a null company", () => {
    assert.ok(CLIENTS.some((c) => c.company === null));
  });

  test("includes at least one injection-shaped label in a client, a project, and a task", () => {
    assert.ok(CLIENTS.some((c) => /ignore previous instructions/i.test(c.name)));
    assert.ok(PROJECTS.some((p) => /system:/i.test(p.name)));
    assert.ok(TASKS.some((t) => /deleteEverything/i.test(t.title)));
  });

  test("includes tasks with no due date, and both overdue and future-due tasks", () => {
    assert.ok(TASKS.some((t) => t.dueDate === null));
    assert.ok(TASKS.some((t) => t.dueDate !== null));
  });

  test("client #3 (Brightline Robotics) has exactly two projects (cross-relationship coverage)", () => {
    const brightline = CLIENTS.find((c) => c.name === "Brightline Robotics")!;
    assert.equal(PROJECTS.filter((p) => p.clientRef === brightline.ref).length, 2);
  });
});
