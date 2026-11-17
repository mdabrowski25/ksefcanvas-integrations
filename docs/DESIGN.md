# KSeF Canvas for n8n, Make and Zapier: design

One feature set, three platforms. Each module is a thin client of the KSeF Canvas public API v1. The API decides
everything (validation, numbering, KSeF readiness, limits); a module only maps fields, calls the API and shows its errors.
The contract is [openapi-v1.json](openapi-v1.json) (a copy of `GET https://api.ksefcanvas.pl/v1/openapi.json`).

## KSeF Canvas API v1 in short

- **Environments.** Production is `https://api.ksefcanvas.pl` (production KSeF, keys `kc_live_…`). Test is
  `https://staging-api.ksefcanvas.pl` (KSeF Test, keys `kc_test_…`; invoices there have no legal effect). A key works only in
  its own environment, so every connection asks for the environment and defaults to production.
- **Auth.** Send `Authorization: Bearer <key>`. The firm owner creates keys in KSeF Canvas under
  *Ustawienia → Integracje → API*. A key belongs to exactly one firm. `GET /v1/key` is the connection test; it returns the
  firm's name and NIP, the environment and the key's scopes.
- **Scopes.** `invoices:read` (drafts, issues, documents, clients, products), `drafts:write` (create, update, validate,
  preview), `invoices:issue` (send to KSeF), `webhooks:write` (register and remove webhooks, needed by the triggers together with `invoices:read`, which they use to add the invoice status).
  A call outside the key's scopes gets `403 insufficient_scope`: say which scope is missing.
- **Errors.** `application/problem+json` with `status`, `title`, `detail` (Polish, human-readable), `code` (stable) and,
  for 422, `errors[]` of `{code, field, message}`. Show `detail` and `code` (and the `errors[]` messages) to the user.
  Branch on `code` only. 429 `rate_limited` comes with `Retry-After` in seconds.
- **Limits.** 120 requests a minute per key, 300 per firm, 30 issue calls a minute per firm.
- **Money and dates.** Amounts are integers in grosz (1 PLN = 100 grosz). Dates are `YYYY-MM-DD` in Polish time.
- **States.** An issue goes `Queued → Submitting → Processing → Accepted | Rejected | ManualReview`.
  Treat unknown states as not final.

## Common feature set

**Language.** The UI is in English on every platform: n8n verifies only English-language nodes, and Zapier and Make
review their directories in English. Keep Polish invoicing terms in parentheses in help texts where users know them
better (for example "Draft (szkic)", "Supply date (data dostawy lub wykonania usługi)"). Use the same names, order and
help texts on every platform. The API's own error `detail` is Polish: show it as it is, after an English summary.

### Connection (credentials)

| Field | Label | Notes |
| --- | --- | --- |
| apiKey | API Key | Secret. Help: "Create a key in KSeF Canvas under Ustawienia → Integracje → API. Triggers need the webhooks:write and invoices:read scopes; issuing invoices needs invoices:issue." |
| environment | Environment | `live` "Production" (default) → `https://api.ksefcanvas.pl`; `test` "Test (KSeF Test, no legal effect)" → `https://staging-api.ksefcanvas.pl` |

Test the connection with `GET /v1/key`. Where the platform shows a connection label, use `{firm.name} ({firm.nip})`.

### Triggers (instant, REST hooks)

| Key | Label | Event |
| --- | --- | --- |
| invoiceAccepted | Invoice Accepted in KSeF | `invoice.accepted` |
| invoiceRejected | Invoice Rejected by KSeF | `invoice.rejected` |

- **Subscribe** when the workflow starts listening:
  `POST /v1/webhooks {"url": "<platform hook URL>", "events": ["invoice.accepted"]}` returns 201
  `{id, url, events, enabled, disabledReason, createdAt, secret}`. Store `id` and `secret` with the subscription. The
  `secret` is returned only here.
- **Unsubscribe** when the workflow stops listening: `DELETE /v1/webhooks/{id}` returns 204. Treat a 404 as already gone.
- `GET /v1/webhooks` lists, and `GET /v1/webhooks/{id}` reads, only webhooks created through the API, without secrets.
- **Limit.** A firm has at most 3 webhook addresses in total, including the ones its owner added in the app. A fourth
  gets `409 webhook_limit_reached`. Show its `detail` and suggest removing unused webhooks in KSeF Canvas.
- **Address rules.** The URL must be `https://`, port 443, with a public host name (`422 invalid_webhook_url`
  otherwise). n8n behind plain http or on another port cannot receive events: say so in the error.
- **Delivery.** Each delivery is a `POST` with JSON
  `{"id":"evt_…","type":"invoice.accepted","createdAt":"…","livemode":true,"data":{"issueId","draftId","invoiceNumber","state","ksefNumber","rejection":{"code","message"}|null}}`
  and the headers `KsefCanvas-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`,
  `KsefCanvas-Event-Id` and `KsefCanvas-Event-Type`. Answer 2xx within 10 s. Failed deliveries are retried for about
  2 hours with the same event id.
- **Verify** the signature whenever the platform gives access to the raw body and headers: compute the HMAC over the raw
  bytes (not re-serialized JSON), compare in constant time, and reject timestamps more than 300 s from now. A delivery
  that fails verification must not start the workflow.
- **Ignore** `ping` (the owner's "Wyślij test" in the app) and any type the subscription did not ask for.
- **Output.** One item per event: the event's `data` fields plus `eventId`, `eventType`, `livemode`, `createdAt`, and the
  full issue from `GET /v1/issues/{issueId}` under `issue` when the platform can make that call. Sample data for the
  editor comes from `GET /v1/issues?pageSize=10`, filtered to the trigger's state (`Accepted` or `Rejected`).

### Actions

| Key | Label | Call |
| --- | --- | --- |
| createDraft | Create Draft | `POST /v1/drafts` |
| getDraft | Get Draft | `GET /v1/drafts/{id}` |
| validateDraft | Validate Draft | `POST /v1/drafts/{id}/validate` |
| previewDraft | Preview Draft PDF | `POST /v1/drafts/{id}/preview` (binary PDF) |
| issueDraft | Issue Invoice in KSeF | `POST /v1/drafts/{id}/issue` |
| getIssue | Get Issue Status | `GET /v1/issues/{id}` |
| downloadDocument | Download Invoice Document | `GET /v1/issues/{id}/pdf`, `/xml` or `/upo` (binary) |

Searches (where the platform has them) or list actions:

| Key | Label | Call |
| --- | --- | --- |
| findClient | Find Client | `GET /v1/clients?q=` (client = kontrahent) |
| findProduct | Find Product | `GET /v1/products?q=` |
| listDrafts | List Drafts | `GET /v1/drafts` |
| listIssues | List Issued Invoices | `GET /v1/issues` |

List endpoints are paged (`page`, `pageSize` ≤ 100, response `{items, page, pageSize, total}`), newest first.

#### Create draft fields

Everything is optional except the payment method and at least one line. Empty seller fields come from the firm's profile,
the dates default to today, the currency to PLN and the invoice number is assigned when the invoice is issued. Send only
fields the user filled in; never send `invoiceNumber`, the seller fields or `ksefOptionsJson` unless the user set them
(they are advanced options).

| Field | Label | Notes |
| --- | --- | --- |
| buyerName | Buyer Name | Buyer (nabywca) |
| buyerNip | Buyer NIP | 10 digits; strip spaces and dashes before sending |
| buyerAddress | Buyer Address | Street, postal code and city |
| issueDate | Issue Date | Data wystawienia, YYYY-MM-DD; default today |
| supplyDate | Supply Date | Data dostawy lub wykonania usługi, YYYY-MM-DD; default today |
| paymentMethod | Payment Method | Forma płatności. Required. Options below |
| paymentDate | Payment Due Date | Termin płatności, YYYY-MM-DD |
| bankAccount | Bank Account | For bank transfer; default the firm's account |
| currency | Currency | ISO 4217; default PLN |
| notes | Notes | Uwagi, printed on the invoice |
| lines[] | Line Items | Pozycje. At least one |
| lines[].name | Name | Product or service name |
| lines[].quantity | Quantity | Decimal, default 1 |
| lines[].unit | Unit | Default `szt.` |
| lines[].netUnitPrice | Net Unit Price | Decimal in the invoice currency, e.g. 123.45; send `netUnitPriceGrosz = round(value × 100)` |
| lines[].vatRate | VAT Rate | Options below; default 23 |
| lines[].discountPercent | Discount (%) | 0–100, default 0 |
| lines[].pkwiu | PKWiU | Optional classification code |

Also offer "Draft Data (JSON)" as an advanced alternative: a JSON object sent as the API's `data` unchanged, for users who
need every field.

Payment methods (`paymentMethod`): Bank Transfer `Transfer` (default), Cash `Cash`, Card `Card`, Mobile Payment
`Mobile`, Credit `Credit`, Cheque `Cheque`, Voucher `Voucher`, Other `Other`.

VAT rates (`vatRate`): 23% `23`, 8% `8`, 5% `5`, 0% `0`, Exempt (zw) `-1`, Reverse Charge (oo) `-2`,
Outside Poland (np I) `-3`, Outside Poland, Art. 100 (np II) `-4`, 0% Intra-EU Supply (WDT) `-5`, 0% Export `-6`.

#### Issue

- Inputs: draft id (required), draft version (optional), idempotency key (optional, advanced).
- Without a version, read the draft first (`GET /v1/drafts/{id}`) and use its `version`.
- Send `{"version": <version>}` with the header `Idempotency-Key`. The default key is `<draftId>:<version>`, so a retry of
  the same step returns the first result (`replay: true`) instead of a second invoice. Allowed characters:
  `A-Za-z0-9._:-`, 1–64.
- Issuing assigns the invoice number and moves the draft's `version` on (for example 2 → 3), so a retry of a step that read
  the version would build a different key and get `409 resource_conflict`. Therefore, when no version was given and the
  draft read in the first step is already issued (`state` is `Queued`, `Submitting`, `Processing`, `Accepted` or
  `ManualReview`), do not call issue again: find its issue in `GET /v1/issues` (newest first, `pageSize=100`, up to 5
  pages, match `draftId`) and return it as `{issueId, draftId, state, replay: true, alreadyIssued: true}`. A `Rejected`
  draft may be fixed and issued again, so issue it normally.
- Response 202 `{issueId, draftId, state, replay}`. Issuing is asynchronous: the result in KSeF arrives through the triggers
  or `getIssue`.
- Help text: "Irreversible: an invoice accepted by KSeF cannot be withdrawn, only corrected with a correction invoice
  (faktura korygująca). The key needs the invoices:issue scope."

#### Documents

`documentType`: Invoice PDF `pdf` (with the KSeF number and QR code), Invoice XML `xml` (FA(3) sent to KSeF), UPO `upo`
(KSeF's official receipt, urzędowe poświadczenie odbioru). Ready once KSeF accepted the invoice; before that
`404 document_not_ready`. Return the file as the platform's binary or file object, named
`<invoiceNumber with / replaced by _>.<pdf|xml>` or `UPO-<invoiceNumber…>.xml`.

## Engineering rules

- No runtime dependencies beyond what the platform provides, where the platform allows it (n8n verified nodes must have
  none). Pin exact dev dependency versions and commit the lockfile.
- Never log or echo keys or webhook secrets. Store them only in the platform's credential or subscription storage.
- Unit tests run offline with mocked HTTP. Nothing in this repository calls production KSeF Canvas from tests.
- Each module has its own README in English with setup, local testing against the test environment and the owner's
  publishing steps.
