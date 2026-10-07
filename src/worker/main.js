import { assertWorkerPorts } from "./ports.js";
import { runWorker } from "./run-worker.js";

export function createWorkerRunner({ ports, clock, createWorkerId }) {
  return async () => {
    assertWorkerPorts(ports);
    if (!clock || typeof clock.now !== "function") {
      throw new Error("clock with now() is required");
    }
    if (typeof createWorkerId !== "function") {
      throw new Error("createWorkerId function is required");
    }
    return runWorker({ ports, clock, createWorkerId });
  };
}
