import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerRunner } from "../../src/worker/main.js";
import {
  createFakeQueue,
  createFakePayloadStore,
  createFakeRenderer,
  createFakeAssetStore,
  createFakeDraftService,
  createTestClock
} from "../helpers/fake-adapters.js";
import { renderCarousel } from "../../src/render.js";

function fullPorts() {
  return {
    JobQueue: createFakeQueue([]),
    PayloadStore: createFakePayloadStore(),
    CarouselRenderer: createFakeRenderer(renderCarousel),
    AssetStore: createFakeAssetStore(),
    DraftService: createFakeDraftService()
  };
}

test("createWorkerRunner rejects missing ports before any claim", async () => {
  const ports = fullPorts();
  delete ports.DraftService.createDraft;
  const queue = ports.JobQueue;

  const run = createWorkerRunner({
    ports,
    clock: createTestClock(),
    createWorkerId: () => "worker-test"
  });

  await assert.rejects(run(), /DraftService missing methods/);
  assert.equal(queue.calls.findEligible, 0);
  assert.equal(queue.calls.persistClaim, 0);
});

test("createWorkerRunner invokes one worker run when ports are complete", async () => {
  const ports = fullPorts();
  const queue = ports.JobQueue;

  const run = createWorkerRunner({
    ports,
    clock: createTestClock(),
    createWorkerId: () => "worker-test"
  });

  const result = await run();
  assert.equal(result.outcome, "idle");
  assert.equal(queue.calls.findEligible, 1);
  assert.equal(queue.calls.persistClaim, 0);
});
