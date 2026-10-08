import assert from "node:assert/strict";
import test from "node:test";
import { createBufferDraftService } from "../../src/adapters/buffer-drafts.js";
import { WorkerError, AmbiguousExternalError } from "../../src/worker/errors.js";

function makeFetch(responses = []) {
  const calls = [];
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  };
}

const jsonResponse = (data) => ({
  ok: true,
  status: 200,
  json: async () => data
});

function makeService(fetch, overrides = {}) {
  return createBufferDraftService({ fetch, apiKey: "key", channelId: "channel-1", ...overrides });
}

test("findDraft returns null without a stored draft id", async () => {
  const { fetch, calls } = makeFetch([]);
  const service = makeService(fetch);
  assert.equal(await service.findDraft({ runKey: "job-1:abc", storedDraftId: "" }), null);
  assert.equal(calls.length, 0);
});

test("findDraft reconciles an existing channel draft by exact caption", async () => {
  const { fetch, calls } = makeFetch([
    jsonResponse({ data: { account: { organizations: [{ id: "org-1" }] } } }),
    jsonResponse({
      data: {
        posts: {
          edges: [
            { node: { id: "other", text: "different", status: "draft", externalLink: null, channelId: "channel-1" } },
            { node: { id: "draft-1", text: "exact caption", status: "draft", externalLink: null, channelId: "channel-1" } }
          ]
        }
      }
    })
  ]);
  const service = makeService(fetch);

  const draft = await service.findDraft({ runKey: "job-1:abc", storedDraftId: "", caption: "exact caption" });

  assert.equal(draft.id, "draft-1");
  assert.equal(calls.length, 2);
  const postsRequest = JSON.parse(calls[1].options.body);
  assert.ok(postsRequest.query.includes("status: [draft]"));
  assert.equal(postsRequest.variables.organizationId, "org-1");
  assert.equal(postsRequest.variables.channelId, "channel-1");
});

test("findDraft verifies a stored draft id through the post query", async () => {
  const { fetch, calls } = makeFetch([
    jsonResponse({ data: { post: { id: "stored-1", status: "draft", externalLink: null } } })
  ]);
  const service = makeService(fetch);

  const draft = await service.findDraft({ runKey: "job-1:abc", storedDraftId: "stored-1" });
  assert.equal(draft.id, "stored-1");
  assert.equal(draft.url, "");
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.ok(body.query.includes("post("));
  assert.equal(body.variables.id, "stored-1");
});

test("findDraft returns null when the stored post is gone", async () => {
  const { fetch } = makeFetch([jsonResponse({ data: { post: null } })]);
  const service = makeService(fetch);
  assert.equal(await service.findDraft({ runKey: "job-1:abc", storedDraftId: "gone" }), null);
});

test("findDraft propagates verification failures instead of duplicating", async () => {
  const { fetch } = makeFetch([new Error("socket hang up")]);
  const service = makeService(fetch);
  await assert.rejects(service.findDraft({ runKey: "job-1:abc", storedDraftId: "stored-1" }), /socket hang up/);
});

test("createDraft sends a document draft mutation with caption, pdf, and cover", async () => {
  const { fetch, calls } = makeFetch([
    jsonResponse({ data: { createPost: { __typename: "PostActionSuccess", post: { id: "post-1", status: "draft", externalLink: null } } } })
  ]);
  const service = makeService(fetch);

  const draft = await service.createDraft({
    runKey: "job-1:abc",
    caption: "exact caption",
    pdfUrl: "https://cloudinary.com/x/carousel.pdf",
    coverUrl: "https://cloudinary.com/x/cover.jpg"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.buffer.com");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer key");
  const body = JSON.parse(calls[0].options.body);
  assert.ok(body.query.includes("createPost"));
  assert.ok(body.query.includes("__typename"));
  assert.equal(body.variables.input.text, "exact caption");
  assert.equal(body.variables.input.channelId, "channel-1");
  assert.equal(body.variables.input.schedulingType, "automatic");
  assert.equal(body.variables.input.mode, "addToQueue");
  assert.equal(body.variables.input.saveToDraft, true);
  assert.equal(body.variables.input.assets[0].document.url, "https://cloudinary.com/x/carousel.pdf");
  assert.equal(body.variables.input.assets[0].document.thumbnailUrl, "https://cloudinary.com/x/cover.jpg");
  assert.ok(body.variables.input.assets[0].document.title.length > 0);
  assert.equal(draft.id, "post-1");
  assert.equal(draft.url, "");
});

test("createDraft preserves top-level GraphQL errors", async () => {
  const { fetch } = makeFetch([
    jsonResponse({ errors: [{ message: "channel does not support documents" }] })
  ]);
  const service = makeService(fetch);

  await assert.rejects(
    service.createDraft({ runKey: "r", caption: "c", pdfUrl: "https://x/y.pdf", coverUrl: "https://x/c.jpg" }),
    (error) => {
      assert.ok(error instanceof WorkerError);
      assert.equal(error.code, "buffer_graphql_error");
      assert.match(error.message, /channel does not support documents/);
      return true;
    }
  );
});

test("createDraft maps MutationError to recoverable errors", async () => {
  const { fetch } = makeFetch([
    jsonResponse({ data: { createPost: { __typename: "MutationError", message: "rate limited" } } })
  ]);
  const service = makeService(fetch);

  await assert.rejects(
    service.createDraft({ runKey: "r", caption: "c", pdfUrl: "https://x/y.pdf", coverUrl: "https://x/c.jpg" }),
    (error) => {
      assert.ok(error instanceof WorkerError);
      assert.equal(error.type, "external");
      assert.equal(error.code, "buffer_create_failed");
      return true;
    }
  );
});

test("createDraft maps network failures to ambiguous errors", async () => {
  const { fetch } = makeFetch([new Error("socket hang up")]);
  const service = makeService(fetch);

  await assert.rejects(
    service.createDraft({ runKey: "r", caption: "c", pdfUrl: "https://x/y.pdf", coverUrl: "https://x/c.jpg" }),
    (error) => {
      assert.ok(error instanceof AmbiguousExternalError);
      return true;
    }
  );
});

test("createDraft rejects missing credentials as configuration errors", async () => {
  const { fetch } = makeFetch([]);
  const args = { runKey: "r", caption: "c", pdfUrl: "https://x/y.pdf", coverUrl: "https://x/c.jpg" };
  const noKey = createBufferDraftService({ fetch, channelId: "channel-1" });
  await assert.rejects(noKey.createDraft(args), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "configuration");
    return true;
  });

  const noChannel = createBufferDraftService({ fetch, apiKey: "key" });
  await assert.rejects(noChannel.createDraft(args), (error) => {
    assert.ok(error instanceof WorkerError);
    assert.equal(error.type, "configuration");
    return true;
  });
});

test("createDraft rejects empty captions and non-https asset urls", async () => {
  const { fetch } = makeFetch([]);
  const service = makeService(fetch);

  await assert.rejects(service.createDraft({ runKey: "r", caption: "  ", pdfUrl: "https://x/y.pdf", coverUrl: "https://x/c.jpg" }), /caption/);
  await assert.rejects(service.createDraft({ runKey: "r", caption: "c", pdfUrl: "http://x/y.pdf", coverUrl: "https://x/c.jpg" }), /pdfUrl/);
  await assert.rejects(service.createDraft({ runKey: "r", caption: "c", pdfUrl: "https://x/y.pdf", coverUrl: "" }), /coverUrl/);
});
