import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleClients } from "../../src/adapters/google-auth.js";
import { WorkerError } from "../../src/worker/errors.js";

test("createGoogleClients rejects missing service account", () => {
  assert.throws(() => createGoogleClients({}), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "configuration");
    return true;
  });
});

test("createGoogleClients rejects malformed JSON", () => {
  assert.throws(() => createGoogleClients({ serviceAccountJson: "{nope" }), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "configuration");
    return true;
  });
});

test("createGoogleClients rejects accounts without client_email", () => {
  assert.throws(
    () => createGoogleClients({ serviceAccountJson: JSON.stringify({ private_key: "x" }) }),
    (error) => {
      assert.ok(error instanceof WorkerError);
      assert.equal(error.type, "configuration");
      return true;
    }
  );
});
