import { WorkerError, AmbiguousExternalError } from "../worker/errors.js";

const API_URL = "https://api.buffer.com";

const CREATE_DRAFT_MUTATION = `mutation CreateDraftPost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess {
      post { id status externalLink }
    }
    ... on MutationError {
      message
    }
  }
}`;

const FIND_POST_QUERY = `query FindPost($id: PostId!) {
  post(input: { id: $id }) {
    id status externalLink
  }
}`;

const FIND_ORGANIZATIONS_QUERY = `query FindOrganizations {
  account {
    organizations { id }
  }
}`;

const FIND_CHANNEL_DRAFTS_QUERY = `query FindChannelDrafts($organizationId: OrganizationId!, $channelId: ChannelId!, $after: String) {
  posts(after: $after, input: {
    organizationId: $organizationId
    sort: [{ field: createdAt, direction: desc }]
    filter: { status: [draft], channelIds: [$channelId] }
  }) {
    edges {
      node { id text status externalLink channelId }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

// Upper bound on pages read while reconciling, so a cursor that never ends cannot loop forever.
const MAX_DRAFT_PAGES = 50;

export function createBufferDraftService({ fetch: fetchImpl = fetch, apiKey, channelId } = {}) {
  if (!fetchImpl) throw new WorkerError("configuration", "missing_fetch", "A fetch implementation is required");

  async function postGraphql(query, variables) {
    let response;
    try {
      response = await fetchImpl(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, variables })
      });
    } catch (error) {
      throw new AmbiguousExternalError("buffer_ambiguous", `Buffer request outcome unknown: ${error.message}`);
    }
    if (!response.ok) {
      throw new WorkerError("external", "buffer_http_error", `Buffer HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      const message = payload.errors.map((error) => error?.message).filter(Boolean).join("; ") || "unknown GraphQL error";
      throw new WorkerError("external", "buffer_graphql_error", `Buffer GraphQL error: ${message}`);
    }
    return payload;
  }

  function requireCredentials() {
    if (!apiKey) throw new WorkerError("configuration", "missing_buffer_key", "Buffer API key is required");
    if (!channelId) throw new WorkerError("configuration", "missing_buffer_channel", "Buffer channel ID is required");
  }

  function toDraftResult(post) {
    return { id: post.id, url: post.externalLink ?? "" };
  }

  return {
    async findDraft({ runKey, storedDraftId, caption }) {
      if (!storedDraftId && !caption) return null;
      requireCredentials();
      if (storedDraftId) {
        const data = await postGraphql(FIND_POST_QUERY, { id: storedDraftId });
        const post = data?.data?.post;
        if (!post) return null;
        return toDraftResult(post);
      }

      // Buffer has no idempotency key or run-key field on posts, so an unrecorded draft can
      // only be recognised by its exact text. Every page is read and more than one match is
      // refused rather than guessed.
      const accountData = await postGraphql(FIND_ORGANIZATIONS_QUERY, {});
      const organizations = accountData?.data?.account?.organizations ?? [];
      const matches = [];
      for (const organization of organizations) {
        let after = null;
        for (let page = 0; ; page += 1) {
          if (page >= MAX_DRAFT_PAGES) {
            throw new AmbiguousExternalError("buffer_draft_scan_incomplete", `Buffer draft list exceeded ${MAX_DRAFT_PAGES} pages`);
          }
          const data = await postGraphql(FIND_CHANNEL_DRAFTS_QUERY, {
            organizationId: organization.id,
            channelId,
            after
          });
          const posts = (data?.data?.posts?.edges ?? []).map((edge) => edge?.node).filter(Boolean);
          matches.push(...posts.filter((post) =>
            post.status === "draft" && post.channelId === channelId && post.text === caption
          ));
          const pageInfo = data?.data?.posts?.pageInfo;
          if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
          after = pageInfo.endCursor;
        }
      }
      if (matches.length > 1) {
        throw new WorkerError(
          "data_integrity",
          "multiple_matching_drafts",
          `${matches.length} Buffer drafts have this caption; a human must keep one and record its id`
        );
      }
      return matches.length === 1 ? toDraftResult(matches[0]) : null;
    },

    async createDraft({ runKey, caption, pdfUrl, coverUrl }) {
      requireCredentials();
      if (typeof caption !== "string" || caption.trim().length === 0) {
        throw new WorkerError("validation", "invalid_caption", "Draft caption must be a non-empty string");
      }
      if (typeof pdfUrl !== "string" || !pdfUrl.startsWith("https://")) {
        throw new WorkerError("validation", "invalid_pdf_url", "Draft pdfUrl must be a public https URL");
      }
      if (typeof coverUrl !== "string" || !coverUrl.startsWith("https://")) {
        throw new WorkerError("validation", "invalid_cover_url", "Draft coverUrl must be a public https URL");
      }

      const data = await postGraphql(CREATE_DRAFT_MUTATION, {
        input: {
          text: caption,
          channelId,
          schedulingType: "automatic",
          mode: "addToQueue",
          saveToDraft: true,
          assets: [
            {
              document: {
                url: pdfUrl,
                thumbnailUrl: coverUrl,
                title: caption.slice(0, 120)
              }
            }
          ]
        }
      });

      const result = data?.data?.createPost;
      if (result?.post) {
        return toDraftResult(result.post);
      }
      const message = result?.message ?? "unknown Buffer error";
      throw new WorkerError("external", "buffer_create_failed", `Buffer rejected draft: ${message}`);
    }
  };
}
