# `external:unknown` on launch-video-001

## What the logs show

All three runs are manual `workflow_dispatch` runs of `Render LinkedIn Carousel` on `master`. The excerpts are copied from `gh run view <id> --log` (production worker step only). GitHub replaced the secret-derived cloud name with `***`; nothing else was edited.

| Run | Started (UTC) | Commit | Worker output |
|---|---|---|---|
| 37656274317 | 2026-10-07 17:05 | 0c54633 | `{"outcome":"failed","error":"unknown"}`. No diagnostic line existed yet. |
| 37658107781 | 2026-10-07 17:19 | c32c6be | `[worker] stage=render outcome=failed type=external code=unknown thrown=Object message=` |
| 37660483439 | 2026-10-07 17:37 | 2b83f58 | see below |

Run 37660483439 (the line ends where the 500-character log cap cut it):

```
[worker] stage=render outcome=failed type=external code=unknown thrown=Object message= shape={"request_options":{"protocol":"https:","hostname":"api.cloudinary.com","path":"/v1_1/***/resources/image/upload/carousel%2Flaunch-video-001%2Fc75d4ace13fc18679f251309b221fec5faba434c042a7c7b7244167fae2a6640%2Fcarousel-manifest", ... "headers":{"Content-Type":"application/x-www-form-urlencoded","User-Agent"
```

## Cause

1. At that time, `findManifest` looked the manifest up through the Cloudinary **Admin API**, as an `image` resource with no `.json` extension (`resources/image/upload/.../carousel-manifest`). The manifest is a `raw` resource. This is visible in the logged request path.
2. The Cloudinary Admin API does not reject with an `Error`. It rejects with `{ request_options, query_params, error: { message, http_code } }` (`node_modules/cloudinary/lib/api_client/execute_request.js`, the `deferred.reject(Object.assign({ request_options, query_params }, result))` branch).
3. `run-worker.js` turned every non-`WorkerError` into `external:unknown` using `error.message`, which is `undefined` on that object, so the Sheet got an empty message.
4. The diagnostic line logged the whole object but cut it at 500 characters. `request_options` comes first, so `error.http_code` and `error.message` were cut off.

The actual HTTP status of that call is **not recorded** in any log. It was cut off. A 404 is likely, because the resource type and public ID were both wrong, but it was not observed.

## Already fixed in history

The lookup was corrected by 830787a, 24c1e30, 379bf3a (raw public IDs keep their extension) and db7f132 (manifests are now read from the public delivery URL). The current code does not call the Admin API to find manifests.

## Fixed now

- `describeThrown` reads the status and message from Cloudinary's nested shape, its flat uploader shape (`{ message, http_code }`), and googleapis errors (`status`).
- `toWorkerError` keeps the status in the code (`external:http_404`) and keeps the message.
- The Cloudinary adapter wraps SDK rejections as `external:cloudinary_http_<status>`. The Drive adapter maps 404 to the terminal `configuration:drive_file_not_found` and other statuses to `external:drive_http_<status>`.
- The diagnostic line now puts `job=`, `status=` and `message=` before the truncated shape.
- Credential values loaded from the environment (Cloudinary key and secret, Buffer key, service-account private key and key ID) are removed verbatim from Sheet errors and log lines. Pattern-based scrubbing misses short or numeric keys.

Tests: `tests/worker/error-classification.test.js` and the new cases in `tests/adapters/drive-payload.test.js` and `tests/adapters/cloudinary-assets.test.js`.
