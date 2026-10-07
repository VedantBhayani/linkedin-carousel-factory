import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkerPorts } from "../../src/worker/ports.js";

test("assertWorkerPorts rejects missing JobQueue methods", () => {
  const badPorts = {
    JobQueue: { findEligible: () => {} },
    PayloadStore: { download: () => {} },
    CarouselRenderer: { render: () => {} },
    AssetStore: { findManifest: () => {}, store: () => {}, loadManifest: () => {} },
    DraftService: { findDraft: () => {}, createDraft: () => {} }
  };
  
  assert.throws(
    () => assertWorkerPorts(badPorts),
    /JobQueue missing methods: persistClaim, persistState/
  );
});

test("assertWorkerPorts rejects missing PayloadStore methods", () => {
  const badPorts = {
    JobQueue: { findEligible: () => {}, persistClaim: () => {}, persistState: () => {} },
    PayloadStore: {},
    CarouselRenderer: { render: () => {} },
    AssetStore: { findManifest: () => {}, store: () => {}, loadManifest: () => {} },
    DraftService: { findDraft: () => {}, createDraft: () => {} }
  };
  
  assert.throws(
    () => assertWorkerPorts(badPorts),
    /PayloadStore missing methods: download/
  );
});

test("assertWorkerPorts rejects missing CarouselRenderer methods", () => {
  const badPorts = {
    JobQueue: { findEligible: () => {}, persistClaim: () => {}, persistState: () => {} },
    PayloadStore: { download: () => {} },
    CarouselRenderer: {},
    AssetStore: { findManifest: () => {}, store: () => {}, loadManifest: () => {} },
    DraftService: { findDraft: () => {}, createDraft: () => {} }
  };
  
  assert.throws(
    () => assertWorkerPorts(badPorts),
    /CarouselRenderer missing methods: render/
  );
});

test("assertWorkerPorts rejects missing AssetStore methods", () => {
  const badPorts = {
    JobQueue: { findEligible: () => {}, persistClaim: () => {}, persistState: () => {} },
    PayloadStore: { download: () => {} },
    CarouselRenderer: { render: () => {} },
    AssetStore: { findManifest: () => {} },
    DraftService: { findDraft: () => {}, createDraft: () => {} }
  };
  
  assert.throws(
    () => assertWorkerPorts(badPorts),
    /AssetStore missing methods: store, loadManifest/
  );
});

test("assertWorkerPorts rejects missing DraftService methods", () => {
  const badPorts = {
    JobQueue: { findEligible: () => {}, persistClaim: () => {}, persistState: () => {} },
    PayloadStore: { download: () => {} },
    CarouselRenderer: { render: () => {} },
    AssetStore: { findManifest: () => {}, store: () => {}, loadManifest: () => {} },
    DraftService: { findDraft: () => {} }
  };
  
  assert.throws(
    () => assertWorkerPorts(badPorts),
    /DraftService missing methods: createDraft/
  );
});

test("assertWorkerPorts accepts complete ports", () => {
  const goodPorts = {
    JobQueue: { findEligible: () => {}, persistClaim: () => {}, persistState: () => {} },
    PayloadStore: { download: () => {} },
    CarouselRenderer: { render: () => {} },
    AssetStore: { findManifest: () => {}, store: () => {}, loadManifest: () => {} },
    DraftService: { findDraft: () => {}, createDraft: () => {} }
  };
  
  assert.doesNotThrow(() => assertWorkerPorts(goodPorts));
});