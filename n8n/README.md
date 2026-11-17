# n8n-nodes-ksefcanvas

n8n nodes for [KSeF Canvas](https://ksefcanvas.pl): create invoice drafts, issue them in KSeF (Krajowy System
e-Faktur, the Polish national e-invoicing system) and start workflows when KSeF accepts or rejects an invoice.

- **KSeF Canvas** (action node): drafts, issuing, invoice status and documents, saved clients and products.
- **KSeF Canvas Trigger**: *Invoice Accepted in KSeF* and *Invoice Rejected by KSeF*, delivered instantly through
  signed webhooks.

The nodes call the [KSeF Canvas public API v1](https://api.ksefcanvas.pl/v1/openapi.json). KSeF Canvas validates every
invoice against the FA(3) schema, numbers it and sends it to KSeF with the firm's own KSeF credentials.

## Installation

In n8n, open **Settings → Community Nodes → Install** and enter `n8n-nodes-ksefcanvas`. See the
[n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/) for self-hosted setups.

## Credentials

1. In KSeF Canvas, the firm owner opens **Ustawienia → Integracje → API** and creates a key. The API is available on the
   Studio and Firma plans.
2. Pick the scopes the workflow needs:
   - `invoices:read`: drafts, invoice status and documents, clients and products;
   - `drafts:write`: create, validate and preview drafts;
   - `invoices:issue`: issue invoices in KSeF (irreversible, never preselected);
   - `webhooks:write`: needed by the KSeF Canvas Trigger to register its webhook.
3. In n8n, create a **KSeF Canvas API** credential with the key and its environment:
   - **Production**: `api.ksefcanvas.pl` with production KSeF, keys `kc_live_…`;
   - **Test**: `staging-api.ksefcanvas.pl` with KSeF Test (invoices have no legal effect), keys `kc_test_…`.

The credential test calls `GET /v1/key`.

## Operations

| Resource | Operation | What it does |
| --- | --- | --- |
| Draft | Create | Creates a draft from fields (buyer, payment method, line items, dates) or from the API's JSON. Nothing is sent to KSeF. |
| Draft | Get / Get Many | Reads a draft with its lines, totals and version, or lists drafts not issued yet. |
| Draft | Validate | Runs the same checks as the KSeF Canvas editor and returns the issues and totals. |
| Draft | Preview PDF | Renders the PDF exactly as it would be issued, as binary data. |
| Draft | Issue in KSeF | Issues the draft. Optionally waits for the KSeF result. **Irreversible.** |
| Invoice | Get Status / Get Many | Reads the status of an issued invoice (Queued → Submitting → Processing → Accepted, Rejected or ManualReview) with its KSeF number. |
| Invoice | Download Document | Downloads the invoice PDF (with the KSeF number and QR code), its FA(3) XML or the UPO, as binary data. |
| Client | Get / Get Many | Reads or searches saved clients (kontrahenci) by name or NIP. |
| Product | Get / Get Many | Reads or searches saved products by name or PKWiU. |

### Field notes

- Prices are entered in złoty (or the invoice currency), e.g. `123.45`; the node sends grosz to the API.
- VAT rates include 23%, 8%, 5%, 0%, Exempt (zw), Reverse Charge (oo), Outside Poland (np I and np II),
  0% Intra-EU Supply (WDT) and 0% Export.
- Dates are `YYYY-MM-DD` (an ISO date-time also works). Issue and supply dates default to today in Polish time.
- Seller details come from the firm's profile and the invoice number is assigned when the invoice is issued.
- **Draft Input → JSON** sends the API's draft object unchanged for advanced fields (amounts in grosz).

### Issuing safely

- **Draft Version** `0` reads the current version first.
- Each issue call carries an `Idempotency-Key`. The default is `<draftId>:<version>`, so a retry returns the first result
  (`replay: true`) instead of issuing a second invoice.
- When the draft is already issued, a retry returns its existing issue with `alreadyIssued: true`, because issuing moves
  the draft's version on.
- KSeF answers asynchronously. Use **Wait for KSeF Result**, the trigger, or **Invoice → Get Status**.
- An invoice accepted by KSeF cannot be withdrawn, only corrected with a correction invoice (faktura korygująca).

## Trigger

The trigger registers a webhook in KSeF Canvas when the workflow is activated, or while you listen for a test event, and
removes it when the workflow is deactivated. Each delivery is checked against its `KsefCanvas-Signature` HMAC and
timestamp before the workflow starts. The output carries the event (`issueId`, `invoiceNumber`, `state`, `ksefNumber`,
`rejection`) and, with **Include Invoice Status**, the full status under `issue`.

Requirements:

- n8n must be reachable at a public `https://` address on port 443. KSeF Canvas does not send to http, other ports or
  private networks. On a self-hosted instance, set `WEBHOOK_URL` to the public address.
- The key needs the `webhooks:write` scope, and `invoices:read` for **Include Invoice Status**.
- A firm can have at most 3 webhooks, counting the ones added in the app. Remove unused ones in
  **Ustawienia → Integracje → API**, where webhooks added by n8n are marked as added by an API key.

## Example workflows

- **Issue an invoice for a paid order.** Webhook or shop trigger → KSeF Canvas *Create* (buyer and lines mapped from
  the order) → *Validate* → IF `valid` → *Issue in KSeF* with **Wait for KSeF Result** → *Download Document* (PDF) →
  e-mail the PDF to the buyer.
- **File accepted invoices.** KSeF Canvas Trigger (*Invoice Accepted in KSeF*) → *Download Document* (PDF and UPO) →
  Google Drive *Upload*.
- **Alert on rejections.** KSeF Canvas Trigger (*Invoice Rejected by KSeF*) → Slack or e-mail with `rejection.message`.

## Errors

Errors show an English summary with the API's stable `code`, for example
`The API key lacks the scope this operation needs (insufficient_scope)`. The description holds the API's own message (in
Polish), field-level validation issues and the trace ID to quote to support@ksefcanvas.pl. The
[developer guide](https://github.com/mdabrowski25/ksefcanvas-integrations/blob/main/docs/DESIGN.md) lists the codes.

## Development

```bash
npm install
npm test          # builds, then runs the offline tests in test/
npm run lint      # n8n's community node lint rules
npm run dev       # starts n8n locally with these nodes
```

## Release

Releases are published to npm with provenance by `.github/workflows/n8n-publish.yml` when a version tag is pushed. Run
`npm run release` in this folder to bump the version, update the changelog, tag and push. Before the first release, set
up npm trusted publishing for this repository (see the comments in the workflow), then submit the package for
verification in the [n8n Creator Portal](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/).

## License

[MIT](../LICENSE)
