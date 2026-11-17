# KSeF Canvas integrations

Connectors for [KSeF Canvas](https://ksefcanvas.pl), Polish B2B invoicing on KSeF (Krajowy System e-Faktur, the national
e-invoicing system), for the most common automation platforms:

| Folder | Platform | Package or app |
| --- | --- | --- |
| [`n8n/`](n8n/) | n8n | Community node `n8n-nodes-ksefcanvas` on npm |
| [`zapier/`](zapier/) | Zapier | Zapier Platform CLI app |
| [`make/`](make/) | Make | Make custom app |

All three offer the same feature set, described in [docs/DESIGN.md](docs/DESIGN.md):

- **Triggers**: invoice accepted in KSeF, invoice rejected by KSeF. These are instant, through signed webhooks that the
  platform registers with the API.
- **Actions**: create, get, validate and preview drafts; issue an invoice in KSeF; get an invoice's status; download the
  invoice PDF, XML or UPO.
- **Searches**: clients, products, drafts and issued invoices.

Each connector is a thin client of the [KSeF Canvas public API v1](https://api.ksefcanvas.pl/v1/openapi.json) (snapshot
in [docs/openapi-v1.json](docs/openapi-v1.json)). The firm owner creates the API key in KSeF Canvas under
**Ustawienia → Integracje → API**. The API is available on the Studio and Firma plans.

## Support

Questions and problems with a connector: support@ksefcanvas.pl, or an issue in this repository. Quote the trace ID from
the error message.

## License

[MIT](LICENSE)
