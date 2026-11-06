# Local demo API

The demo API serves fictional, read-only widget data. It is disabled unless `MENDWIRE_DEMO_API_REVISION` is set to `baseline` or `breaking`. It does not read account data or expose monitor/auth routes.

Set these values in the app process before starting it:

```powershell
$env:MENDWIRE_DEMO_API_REVISION = "baseline"
$env:MENDWIRE_DEMO_API_ORIGIN = "http://127.0.0.1:3000"
npm run dev
```

Inspect the data and stable OpenAPI URL:

```powershell
curl.exe -i http://127.0.0.1:3000/api/demo/widgets
curl.exe -i http://127.0.0.1:3000/api/demo/openapi
```

To simulate the breaking revision, stop the app, set `MENDWIRE_DEMO_API_REVISION` to `breaking`, then start it again. Keep `/api/demo/openapi` unchanged. The widget route returns 410 while the OpenAPI document removes `GET /api/demo/widgets`:

```powershell
$env:MENDWIRE_DEMO_API_REVISION = "breaking"
npm run dev
curl.exe -i http://127.0.0.1:3000/api/demo/widgets
curl.exe -i http://127.0.0.1:3000/api/demo/openapi
```

The committed consumer example is `examples/demo-api/fetch-client.ts`. If the pinned oasdiff 1.35.0 binary is missing, run `npm run install:oasdiff` or set `OASDIFF_PATH` to an audited 1.35.0 binary. After committing the example, run `npm run demo:verify` to compare both contract revisions with oasdiff and feed the actual breaking findings to the impact analyzer. The proof checks out immutable source from `HEAD` and reports `LOCAL_ONLY`; it does not claim a public GitHub download or deployment.

The monitor fetcher needs a public HTTPS OpenAPI document and a public Git source. It reads the contract document; it does not call the API server, so the demo API itself can stay local. To try the monitor, copy the active spec to one stable JSON path in a public GitHub repository's default branch, then use that file's `raw.githubusercontent.com` URL as the contract URL. Keep that raw URL unchanged when you replace the file with the `breaking` revision. The repository must also contain `examples/demo-api/fetch-client.ts` on its default branch before **Analyze impact** can find the usage. Changing a repository's visibility or exposing its source is an operator action; this feature does neither.

With the local app serving the baseline revision, export the current document with:

```powershell
curl.exe --fail --silent http://127.0.0.1:3000/api/demo/openapi --output examples/demo-api/openapi.json
```

Add that JSON document and the consumer source to a public demo repository's default branch. After the local app is switched to `breaking`, export the document again to the same path and update that file in the public repository. Keep using the same raw GitHub URL so the monitor compares revisions at one contract address. This exports a contract file; it does not publish or change repository visibility.

The OpenAPI endpoint uses server configuration only and does not derive its origin from request headers. Keep `MENDWIRE_DEMO_API_ORIGIN` and the consumer's `API_BASE` identical. The local default is `http://127.0.0.1:3000`; use the actual HTTPS API origin only if you choose to host the API publicly.
