# KSeF Canvas for Make

A Make (make.com) custom app for KSeF Canvas: issue Polish e-invoices in KSeF from Make scenarios. It is a thin client of
the KSeF Canvas public API v1 and follows [../docs/DESIGN.md](../docs/DESIGN.md) (feature set, labels, fields, rules) and
the contract [../docs/openapi-v1.json](../docs/openapi-v1.json).

## What the app does

| Component | Key | Label | API call |
| --- | --- | --- | --- |
| Connection | `ksefcanvas` | KSeF Canvas | `GET /v1/key` (API Key + Environment: Production or Test) |
| Instant trigger | `invoiceAccepted` | Invoice Accepted in KSeF | webhook `invoice.accepted`, then `GET /v1/issues/{id}` |
| Instant trigger | `invoiceRejected` | Invoice Rejected by KSeF | webhook `invoice.rejected`, then `GET /v1/issues/{id}` |
| Action | `createDraft` | Create Draft | `POST /v1/drafts` |
| Action | `getDraft` | Get Draft | `GET /v1/drafts/{id}` |
| Action | `validateDraft` | Validate Draft | `POST /v1/drafts/{id}/validate` |
| Action | `previewDraft` | Preview Draft PDF | `POST /v1/drafts/{id}/preview` (file) |
| Action | `issueDraft` | Issue Invoice in KSeF | `POST /v1/drafts/{id}/issue` (see below) |
| Action | `getIssue` | Get Issue Status | `GET /v1/issues/{id}` |
| Action | `downloadDocument` | Download Invoice Document | `GET /v1/issues/{id}/pdf`, `/xml` or `/upo` (file) |
| Search | `findClient` | Find Client | `GET /v1/clients?q=` |
| Search | `findProduct` | Find Product | `GET /v1/products?q=` |
| Search | `listDrafts` | List Drafts | `GET /v1/drafts` |
| Search | `listIssues` | List Issued Invoices | `GET /v1/issues` |
| Universal | `makeApiCall` | Make an API Call | any path relative to the API host |
| RPC | `listDraftOptions`, `listIssueOptions` | | `GET /v1/drafts`, `GET /v1/issues` (the Draft ID / Issue ID dropdowns) |
| Webhooks | `invoiceAccepted`, `invoiceRejected` | | attach `POST /v1/webhooks`, detach `DELETE /v1/webhooks/{id}` |

- **Base**: the host comes from the connection's environment (`live` → `https://api.ksefcanvas.pl`, `test` →
  `https://staging-api.ksefcanvas.pl`), the key goes in `Authorization: Bearer`, and the header is masked in Make's logs.
- **Errors**: every module turns the API's `application/problem+json` into one message: an English summary chosen by
  `code`, then the API's Polish `detail`, the 422 `errors[]` as `field: message`, the `code` and `traceId`. A 403
  `insufficient_scope` names the scope the module needs; a 429 says `Retry-After`. No generic error type is set, so Make
  keeps treating 429 as a rate-limit error and 5xx as a connection error.
- **Triggers**: each trigger has its own dedicated webhook. Creating the webhook in Make registers its URL with
  `POST /v1/webhooks` (only the trigger's event) and stores the returned `id`, `secret` and API host; deleting it lists
  the firm's API webhooks and calls `DELETE /v1/webhooks/{id}` only if it still exists (a webhook already removed in
  KSeF Canvas counts as gone). The webhook drops `ping` and every other event type. Each delivery becomes one bundle with
  the event fields (`eventId`, `eventType`, `livemode`, `createdAt`, `issueId`, `draftId`, `invoiceNumber`, `state`,
  `ksefNumber`, `rejection`) and the full issue from `GET /v1/issues/{issueId}` under `issue`.
- **Issue Invoice in KSeF**: without a Draft Version it reads the draft first. If the draft is already issued (`Queued`,
  `Submitting`, `Processing`, `Accepted`, `ManualReview`) it does not issue again: it finds the draft's issue in
  `GET /v1/issues` (up to 5 pages of 100) and returns `{issueId, draftId, state, replay: true, alreadyIssued: true}`.
  Otherwise it sends `{"version"}` with `Idempotency-Key: <draftId>:<version>` (or the advanced Idempotency Key). In a
  scenario, map **Version** from Create Draft into **Draft Version**: a retried run then sends the same key and gets the
  first result back (`replay: true`).
- **Create Draft**: Input Mode "Fields" (the DESIGN fields, in DESIGN order) or "Draft Data (JSON)" (sent as `data`
  unchanged). Only filled fields are sent; NIP spaces and dashes are removed; Net Unit Price is sent as
  `netUnitPriceGrosz = round(value × 100)`; dates use Make's date picker and are sent as `YYYY-MM-DD` in Polish time.
- **Files**: Preview Draft PDF and Download Invoice Document return Make files (`fileName` + `data`), named
  `FV_2026_11_0042.pdf`, `FV_2026_11_0042.xml`, `UPO-FV_2026_11_0042.xml` and `draft-preview-<draftId>.pdf`.

Five small custom IML functions (`src/functions/`) do what IML expressions cannot: `ksefErrorMessage`, `ksefDraftData`,
`ksefFileName`, `ksefFindIssue` and `ksefExistingIssueId`. Each has a Make test file (`*.test.js`, Make's
"Run IML test" format), which `npm test` also runs.

### Webhook signatures are not verified

KSeF Canvas signs every delivery (`KsefCanvas-Signature: t=…,v1=HMAC-SHA256(secret, "<t>.<raw body>")`). Make's IML has
the primitive (`sha256(text, encoding, key)` returns an HMAC), but a custom-app webhook receives the delivery already
parsed into `body`: Make documents no access to the raw request bytes, and does not list the values stored by attach
(`webhook.*`, where the secret is kept) among the variables of the webhook's incoming-data step. Re-serialising the
parsed JSON does not reproduce the signed bytes (escaping of Polish characters, number formatting), so a check would
drop genuine events. The app therefore does **not** check the signature. What protects the triggers:

- the dedicated webhook URL is unguessable and known only to Make and KSeF Canvas;
- the trigger re-reads the issue with the connection's key (`GET /v1/issues/{issueId}`), so `issue.*` comes from the
  API, not from the delivery; a forged delivery with an unknown issue ID fails with 404 instead of starting the
  scenario with invented data. Map `issue.state`, `issue.ksefNumber` and `issue.rejection` when it matters.

The secret is still stored with the webhook, as DESIGN asks, so a future Make capability can use it.

## Format: Make Apps Editor local project (`makecomapp.json`)

The app is a **local development project of the Make Apps Editor**, Make's VS Code extension
([integromat/vscode-apps-sdk](https://github.com/integromat/vscode-apps-sdk), 2.9.0). Why this format:

- it is Make's official file format for keeping a custom app in Git: one `makecomapp.json` lists the components and
  their code files, and every Make "code" (communication, parameters, interface, …) is its own file;
- the owner can deploy it with the official tooling, either **Deploy to Make** in VS Code or Make's CLI
  (`@integromat/make-cli`, built from the same repository), which creates missing components and records their remote
  names in `makecomapp.json`;
- the files are exactly what Make stores, so the editor's JSON schemas apply to them (the tests use those schemas).

The alternatives were a script against the SDK Apps API (`/api/v2/sdk/apps/...`) or Make's TypeScript SDK
(`@makehq/sdk`, which Make's own app-building skill uses). Both would need a home-made uploader with its own create /
update / pairing logic, which the extension and CLI already provide.

Sources: [Local development for apps](https://developers.make.com/custom-apps-documentation/make-apps-editor/apps-sdk/local-development-for-apps),
[Develop app in a local workspace](https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/local-development-for-apps/develop-app-in-a-local-workspace-offline),
[Deploy changes to Make](https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/local-development-for-apps/deploy-changes-from-local-app-to-make-app),
[Create a new app origin](https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk/local-development-for-apps/create-a-new-app-origin),
[README-local-development-for-apps.md](https://github.com/integromat/vscode-apps-sdk/blob/master/README-local-development-for-apps.md),
the `makecomapp.json` schema (`syntaxes/local-development/schemas/makecomapp.schema.json` in that repository) and Make's
example project [integromat/make-oss-test](https://github.com/integromat/make-oss-test) (`make-cli deploy --local-dir`).

Code files use the strict-JSON `*.iml.json` names (the extension's newer default is `*.iml.jsonc`; both deploy
identically). `.vscode/settings.json` keeps new components on `*.iml.json` when `make/` is opened as the workspace.

```
make/
  src/                       the Make local project (deployed)
    makecomapp.json          components, code files, origins (target app in Make)
    README.md                app documentation shown in Make
    general/base.iml.json    Base
    connections/ksefcanvas/  connection (API Key, Environment)
    webhooks/<id>/           communication (incoming data), params, attach, detach, update, required-scope
    modules/<id>/            communication, static-params, mappable-params, interface, samples, scope
    modules/groups.json      module groups
    rpcs/<id>/               communication, params
    functions/<id>/          code.js, test.js (custom IML functions)
  scripts/deploy.mjs         dry-run-first wrapper around make-cli deploy
  test/                      offline checks (npm test); test/editor-schemas = Make's editor schemas (MIT, Celonis)
```

## Create the app in Make (once)

1. In Make, open **Custom Apps** → **+ Create app**: Name `ksef-canvas` (lowercase, unique; Make shows the final app
   ID), Label `KSeF Canvas`, a short description, Theme `#0f6d42` (the brand accent in
   `packages/brand/mark.json` of the main repository), Language English. Upload a 512 × 512 PNG logo.
   **Ask Make support to enable custom IML functions for the app.** They are off by default
   ([IML functions](https://developers.make.com/custom-apps-documentation/app-components/iml-functions)), and this
   app needs its five functions (`src/functions/`) for the draft data, error messages, file names and the
   already-issued lookup. Until they are enabled, the app has no **Functions** tab and those modules fail.
2. Create a Make API token: profile → **API access** → **+ Add token**, scopes `sdk-apps:read` and `sdk-apps:write`.
   It is shown once.
3. In `src/makecomapp.json`, replace the three `-FILL-ME-` values in `origins[0]`: `label` (for example
   `KSeF Canvas`), `baseUrl` = your Make zone's API URL (`https://eu1.make.com/api`, `https://eu2.make.com/api`, …) and
   `appId` = the app ID from step 1. Leave `apikeyFile` as `../.secrets/apikey` (that is `make/.secrets/apikey`,
   ignored by Git). To keep a separate test app in Make, add a second origin (the extension offers
   **Deploy into another app**).

## Deploy and update

Run `npm ci` and `npm test` in `make/` first.

**VS Code (recommended the first time):** install **Make Apps Editor** (`Integromat.apps-sdk`), open the `make/` folder
as the workspace, right-click `src/makecomapp.json` → **Deploy to Make**. On the first deploy the extension asks how to
pair each local component; choose **Deploy as new remote … (and Apply for all unmapped)**. If `make/.secrets/apikey`
does not exist, the extension asks for the token and saves it there. Later changes: edit the files and deploy again
(the whole project, a component folder or a single file). **Compare with Make** shows what differs.

**Command line:** `scripts/deploy.mjs` wraps Make's CLI (`npx @integromat/make-cli@2.4.7 deploy --local-dir make
--src-prefix src`). It is a dry run unless you pass `--apply`, reads the token only from `MAKE_API_TOKEN`, and refuses to
run while the origin still has placeholders.

```bash
npm run deploy                                  # dry run: checks the project, prints the plan and the command
MAKE_API_TOKEN=… npm run deploy -- --apply      # deploys (asks about unmapped components)
MAKE_API_TOKEN=… npm run deploy -- --apply --no-prompt
```

make-cli reads `make/.secrets/apikey` before `MAKE_API_TOKEN` when the file exists. Use the interactive form for the
first deploy so that you see the pairing questions; `--no-prompt` accepts make-cli's defaults.

After any deploy, **commit `src/makecomapp.json`**: the tools write the remote component names into
`origins[0].idMapping`. Then, in Make, open each custom IML function and run its test (**Run IML test** in VS Code)
to confirm the functions work in Make's runtime.

## Test against the KSeF Canvas test environment

1. In the KSeF Canvas test app (`https://staging-app.ksefcanvas.pl`), as the firm owner, create a key under
   **Ustawienia → Integracje → API** (it starts with `kc_test_`) with the scopes `invoices:read`, `drafts:write`,
   `invoices:issue` and `webhooks:write`. Test invoices go to KSeF Test and have no legal effect.
2. In a Make scenario, add any KSeF Canvas module, create a connection with that key and Environment **Test (KSeF
   Test, no legal effect)**. The connection is named `<firm name> (<NIP>)`. A `kc_test_` key with Environment
   Production fails with `api_key_environment_mismatch`.
3. Actions: run **Create Draft** (Fields mode, one line item) → **Validate Draft** → **Preview Draft PDF** → **Issue
   Invoice in KSeF** (map the draft ID and Version from Create Draft) → **Get Issue Status** → **Download Invoice
   Document** (PDF, XML, UPO once `Accepted`). Re-run the issue step with the same inputs: it returns `replay: true`.
   Run it again without a version: it returns `alreadyIssued: true` and no second invoice. Also run **Create Draft** in
   Draft Data (JSON) mode, the searches (Limit above 100 to see pagination), **Make an API Call** with `/v1/key`, and a
   failing call (for example Validate Draft on a draft with no lines, or a key without `invoices:issue`) to see the
   error text.
4. Triggers: add **Invoice Accepted in KSeF**, click **Create a webhook**, pick the connection and save. KSeF Canvas
   now lists a webhook "added by a key" next to the keys. Turn the scenario on (or **Run once**) and issue a test invoice;
   the bundle arrives when KSeF Test accepts it. **Wyślij test** (ping) in KSeF Canvas must not start the scenario.
   Delete the webhook in Make (**Webhooks**): it disappears from KSeF Canvas. Repeat with **Invoice Rejected by KSeF**
   (an invoice KSeF Test rejects). A firm has at most 3 webhook addresses in total; a fourth fails with
   `webhook_limit_reached`.

## Offline checks: `npm test`

`npm ci && npm test` (Node 22 or later, one pinned dev dependency, `ajv@8.17.1`, for Make's editor schemas). Nothing
calls Make or KSeF Canvas. The checks:

- every JSON file parses; `makecomapp.json` passes the extension's `makecomapp.schema.json`; every code file passes the
  Make editor schema for its code type (Base, api, parameters, scope, samples, groups); file names follow the editor
  layout and no file is orphaned;
- every request's method, path, query parameters, headers and body fields exist in `../docs/openapi-v1.json`, list
  calls use `pageSize` ≤ 100 and page to the end, downloads parse `200` as binary;
- the app matches `../docs/DESIGN.md`: module keys, labels and calls; trigger events and outputs; connection fields,
  options and help text; every Create Draft field and label; payment methods, VAT rates and document types in order;
  the issue rules (read version, already-issued lookup, idempotency key);
- every `rpc://` and custom function reference resolves; the functions' Make test files pass, prices convert to whole
  grosz for every cent value, and Polish dates agree with and without time zone data;
- no keys, webhook secrets or tokens in the files; the key is a password field and only sent as `Authorization`, which
  every request masks in logs; absolute URLs point only to the two KSeF Canvas hosts;
- the deploy script is a dry run by default and refuses `--apply` without a token or with placeholders.

The IML itself is not executed (Make's IML engine is not published), so the first test run in Make is the real check.

## Publishing: private, public, approved

- **Private** (after the first deploy): usable by the owner and in the owner's Make organization.
- **Public** (invite link): anyone with the link can install it. Publishing cannot be undone: the app cannot be made
  private or deleted, and its modules, webhooks, connections, RPCs and functions cannot be deleted afterwards (only
  relabelled and hidden). Remove anything temporary before publishing.
- **Approved** (listed for every Make user): request Make's app review. Make's prerequisites
  ([app review prerequisites](https://developers.make.com/custom-apps-documentation/app-review/prerequisites)) include:
  a service Make does not already integrate; a connection that asks only for what is needed and fails on wrong
  credentials; sanitised logs and error handling in Base and connection; a universal module; correct labels,
  descriptions and interfaces; `limit` and pagination on searches and RPCs; and **test scenarios that use every module**
  (related modules chained, searches at the end of separate routes with logs showing pagination, a separate scenario
  that produces an error), run right before the request, with no personal data in scenarios or logs. Reviewers also need
  the API documentation link (`https://api.ksefcanvas.pl/v1/openapi.json`) and access to a KSeF Canvas test firm with a
  `kc_test_` key. After approval, every change (new components, code, logo, theme) goes through Make's change review.

## Not confirmed about Make (check in the first test)

- That modules and the instant trigger's single request inherit Base (the docs say modules and RPCs do). Attach,
  detach and the connection do not rely on it: they carry the full URL, the key and their own error messages.
- That the instant trigger's request may use a relative URL and `payload.*` as documented for instant triggers.
- That a request's `condition` object with `default` (used by Issue Invoice in KSeF to return the existing issue) can
  call a custom IML function, and that a function's thrown error becomes the module's error message.
- How Make's automatic response parsing treats `application/problem+json`; `ksefErrorMessage` accepts both a parsed
  object and text, and the connection and attach force JSON parsing.
- What answer Make gives KSeF Canvas for a delivery its condition drops (`ping`); Make's default is a 2xx `Accepted`.
- Whether detach can complete when the key was revoked meanwhile: the API then answers 401 and Make reports the error;
  remove the webhook in KSeF Canvas by hand.
- `make-cli deploy --no-prompt` defaults for unmapped components (the source shows it skips prompts; the default
  pairing choice is not documented).
