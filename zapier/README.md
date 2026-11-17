# KSeF Canvas for Zapier

A Zapier Platform CLI integration (JavaScript, `zapier-platform-core` 19.3.0) for [KSeF Canvas](https://ksefcanvas.pl),
the Polish B2B invoicing service on top of KSeF, the national e-invoice system. It is a thin client of the KSeF Canvas
public API v1 (`../docs/openapi-v1.json`); the feature set, labels and rules are in `../docs/DESIGN.md`.

## What it does

Connection: an API key (`kc_live_…` or `kc_test_…`, created in KSeF Canvas under *Ustawienia → Integracje → API*) and
the environment, **Production** (`https://api.ksefcanvas.pl`, production KSeF) or **Test** (`https://staging-api.ksefcanvas.pl`,
KSeF Test, no legal effect). The connection test is `GET /v1/key`; the connection is labelled `<firm name> (<NIP>)`, with
` [Test]` for test keys.

| Type | Key | Label | API |
| --- | --- | --- | --- |
| Instant trigger | `invoice_accepted` | Invoice Accepted in KSeF | REST hook, event `invoice.accepted` |
| Instant trigger | `invoice_rejected` | Invoice Rejected by KSeF | REST hook, event `invoice.rejected` |
| Action | `create_draft` | Create Draft | `POST /v1/drafts` |
| Action | `get_draft` | Get Draft | `GET /v1/drafts/{id}` |
| Action | `validate_draft` | Validate Draft | `POST /v1/drafts/{id}/validate` |
| Action | `preview_draft` | Preview Draft PDF | `POST /v1/drafts/{id}/preview` (file) |
| Action | `issue_draft` | Issue Invoice in KSeF | `POST /v1/drafts/{id}/issue` |
| Action | `get_issue` | Get Issue Status | `GET /v1/issues/{id}` |
| Action | `download_document` | Download Invoice Document | `GET /v1/issues/{id}/pdf`, `/xml`, `/upo` (file) |
| Search | `find_client` | Find Client | `GET /v1/clients?q=` |
| Search | `find_product` | Find Product | `GET /v1/products?q=` |
| Search | `find_issue` | Find Issued Invoice | `GET /v1/issues/{id}` (404 = not found) |
| Hidden trigger | `draft_list`, `issue_list`, `client_list` | dropdowns | `GET /v1/drafts`, `/v1/issues`, `/v1/clients` |

How it behaves:

- **Triggers** subscribe with `POST /v1/webhooks {url: <Zapier hook URL>, events: [<event>]}` when a Zap is turned on and
  keep `{id, secret}` in Zapier's subscription data; turning the Zap off calls `DELETE /v1/webhooks/{id}` (404 counts as
  already removed). Each delivery is checked before anything else: `KsefCanvas-Signature` (Zapier passes it as
  `Http-Ksefcanvas-Signature` in `bundle.rawRequest.headers`) must be an HMAC-SHA256 of `"<t>.<raw body>"` with the
  subscription's secret, compared in constant time, with `t` within 300 seconds. A delivery without a signature, raw body or
  stored secret, or with a wrong or expired signature, returns no items and so starts no Zap. `ping` and other event types
  are ignored. The item is the event's `data` plus `eventId`, `eventType`, `livemode`, `createdAt` and the full issue from
  `GET /v1/issues/{issueId}` under `issue` (`null` if the key cannot read it); `id` is the issue id. Sample data
  (`performList`) comes from the 10 newest issues in the trigger's state, in the same shape.
- A firm has at most 3 webhook addresses including the ones added in the app; a fourth Zap gets `webhook_limit_reached`
  with a hint to remove unused webhooks in KSeF Canvas.
- **Create Draft** sends only the fields the user filled in. Prices are typed in the invoice currency (`123.45` or
  `123,45`) and sent as `netUnitPriceGrosz = round(value × 100)`; the NIP loses spaces and dashes; line defaults
  (quantity 1, unit `szt.`, VAT 23%, discount 0) are applied here because the API does not default them. Line items are a
  Zapier line-item group, so they can be mapped from another app's line items. *Saved Client* fills the buyer from a
  client saved in KSeF Canvas. *Draft Data (JSON)* sends a raw API `data` object instead of the form.
- **Issue Invoice in KSeF** reads the draft's current version when none is given and sends `Idempotency-Key:
  <draftId>:<version>` unless the user sets one. If the draft it reads is already issued (`Queued`, `Submitting`,
  `Processing`, `Accepted` or `ManualReview`, for example when Zapier retries the step), it does not call issue again: it
  finds the draft's newest issue in `GET /v1/issues` (100 per page, up to 5 pages) and returns it with `replay: true,
  alreadyIssued: true`. A `Rejected` draft is issued again normally.
- **Files** (preview, PDF, XML, UPO) are stored with `z.stashFile`, named `FV_2026_11_0042.pdf`, `FV_2026_11_0042.xml` or
  `UPO-FV_2026_11_0042.xml`.
- **Errors**: `application/problem+json` becomes an English summary followed by the API's Polish `detail`, its `code`, the
  `errors[]` messages (422) and the trace id. 401 becomes an expired-auth error (reconnect, no refresh), 429 a
  `ThrottledError` with `Retry-After`, a 403 `insufficient_scope` names the scope the route needs.
- No runtime dependencies besides `zapier-platform-core`. The API key goes only to the API of the chosen environment.

## Develop and test

Requires Node 22 or newer and npm.

```bash
npm ci
npm test            # jest + nock, offline
npm run validate    # zapier-platform validate --without-style (schema only, offline)
```

The tests never reach a network: nock mocks every HTTP call (KSeF Canvas, and Zapier's RPC and S3 for `z.stashFile`), and
`test/no-network.js` replaces `net.Socket#connect` so any request that escapes the mocks fails instead of reaching a real
host. Keys in the tests are fake.

`zapier-platform validate` without `--without-style` also runs Zapier's style checks, which works without logging in
but uploads the app definition to Zapier; run it when you are ready to share the definition.

## Try it against the test environment

Use a `kc_test_…` key from staging (`https://staging-app.ksefcanvas.pl`, *Ustawienia → Integracje → API*), never a live
key. Invoices issued there go to KSeF Test and have no legal effect. `zapier-platform invoke` runs the code locally without
publishing anything. Put the auth data in `zapier/.env` (git-ignored):

```dotenv
authData_apiKey=kc_test_…
authData_environment=test
```

Then, from `zapier/` (`DISABLE_ZAPIER_ANALYTICS=1` stops the CLI from sending usage analytics):

```bash
export DISABLE_ZAPIER_ANALYTICS=1
npx zapier-platform-cli@19.3.0 invoke auth test
npx zapier-platform-cli@19.3.0 invoke trigger draft_list
npx zapier-platform-cli@19.3.0 invoke search find_client -i '{"q":"Odbiorca"}'
npx zapier-platform-cli@19.3.0 invoke create create_draft --non-interactive -i @draft.json
npx zapier-platform-cli@19.3.0 invoke create validate_draft -i '{"draftId":"<draft id>"}'
npx zapier-platform-cli@19.3.0 invoke create issue_draft -i '{"draftId":"<draft id>"}'
npx zapier-platform-cli@19.3.0 invoke create get_issue -i '{"issueId":"<issue id>"}'
```

with, for example, `draft.json`:

```json
{
  "buyerName": "Odbiorca sp. z o.o.",
  "buyerNip": "525-224-84-81",
  "buyerAddress": "ul. Przykładowa 1, 00-001 Warszawa",
  "paymentMethod": "Transfer",
  "lines": [{ "name": "Usługa", "netUnitPrice": "100.00" }]
}
```

Locally, `invoke` cannot run REST hook triggers (subscribe, unsubscribe, deliveries), file stashing (`preview_draft`,
`download_document`) or the function-based connection label. Test those in the Zap editor after a private `push`
(below): connect with the test key and the Test environment, turn on a Zap with *Invoice Accepted in KSeF* (the address
appears in KSeF Canvas, marked as added by a key), issue a test invoice, check the Zap run, then turn the Zap off and
check that the address is gone. The staging API answers webhooks routes only once `/v1/webhooks` is deployed there.

## Publishing (owner)

These steps need the owner's Zapier account and publish to Zapier; nothing in this repository runs them.

1. `npx zapier-platform-cli@19.3.0 login` (add `--sso` for a single sign-on account). This stores a deploy key in
   `~/.zapierrc`.
2. `npx zapier-platform-cli@19.3.0 register "KSeF Canvas" -D "KSeF Canvas is a Polish e-invoicing service that issues invoices through KSeF." -u https://ksefcanvas.pl -a private -r employee -c invoices`.
   This creates the integration and writes `.zapierapprc` (its id); commit that file.
3. `npx zapier-platform-cli@19.3.0 push` builds and uploads version `1.0.0` (from `package.json`). Bump the version for
   every later push that users already have; `zapier-platform promote <version>` makes a version the default and
   `zapier-platform migrate <from> <to>` moves existing users.
4. Test every trigger, action and search in a real Zap (Zapier's review requires each one to have a successful run) and
   check *Monitoring* in the developer platform for errors.
5. Invite testers: `npx zapier-platform-cli@19.3.0 users:add someone@example.com 1.0.0` (one person, one version) or
   `users:links` for a shareable invite link; `team:add` adds collaborators who can edit the integration.
6. Public listing: submit the integration from the developer platform (*Publishing*). Zapier's
   [publishing requirements](https://docs.zapier.com/integrations/publish/integration-publishing-requirements) currently
   ask for, among others: an English-only UI (labels, help text and error messages); a name and a description that starts
   "KSeF Canvas is a…", the marketing homepage, a logo and API documentation links; an admin with an `@ksefcanvas.pl`
   address (or another proof of ownership); **production endpoints only** ("integrations using sandbox/test/dev
   endpoints will not be published"); and a non-expiring test account on `integration-testing@zapier.com` with every
   feature the triggers and actions need, including paid ones. Run `zapier-platform validate` with style checks first.
