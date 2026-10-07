const REQUIRED_PORTS = {
  JobQueue: ["findEligible", "persistClaim", "persistState"],
  PayloadStore: ["download"],
  CarouselRenderer: ["render"],
  AssetStore: ["findManifest", "store", "loadManifest"],
  DraftService: ["findDraft", "createDraft"]
};

export function assertWorkerPorts(ports) {
  if (!ports || typeof ports !== "object") {
    throw new Error("ports must be an object");
  }

  for (const [portName, methods] of Object.entries(REQUIRED_PORTS)) {
    const port = ports[portName];
    if (!port || typeof port !== "object") {
      throw new Error(`Missing required port: ${portName}`);
    }

    const missing = methods.filter((method) => typeof port[method] !== "function");
    if (missing.length > 0) {
      throw new Error(`${portName} missing methods: ${missing.join(", ")}`);
    }
  }
}