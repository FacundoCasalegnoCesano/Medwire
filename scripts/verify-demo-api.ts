import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

import { analyzeContractImpact } from "@/lib/impact-analyzer";
import { compareOpenApiDocuments } from "@/lib/openapi-diff";
import { demoOpenApiDocument, readDemoApiOrigin } from "@/lib/demo-api";
import type { ImpactCoverage } from "@/lib/impact-types";

async function main() {
  const sourcePath = "examples/demo-api/fetch-client.ts";
  const committedBlob = spawnSync("git", ["cat-file", "-e", `HEAD:${sourcePath}`]);
  if (committedBlob.status !== 0) throw new Error(`Cannot read ${sourcePath} from HEAD. Commit that file before running this proof.`);
  const sourceDiff = spawnSync("git", ["diff", "--quiet", "HEAD", "--", sourcePath]);
  if (sourceDiff.status === 1) throw new Error(`Working copy of ${sourcePath} differs from HEAD. Commit or discard its changes before running this proof.`);
  if (sourceDiff.status !== 0) throw new Error(`Could not verify whether ${sourcePath} differs from HEAD.`);
  const sourceResult = spawnSync("git", ["show", `HEAD:${sourcePath}`], { encoding: "utf8" });
  if (sourceResult.status !== 0) throw new Error(`Could not read committed ${sourcePath} from HEAD.`);
  const committedSource = sourceResult.stdout;

  const origin = readDemoApiOrigin();
  assert.ok(origin, "Set MENDWIRE_DEMO_API_ORIGIN to the demo server origin (local default is http://127.0.0.1:3000).");
  const previousContract = demoOpenApiDocument("baseline", origin);
  const nextContract = demoOpenApiDocument("breaking", origin);
  const findings = await compareOpenApiDocuments(previousContract, nextContract);
  const breakingRemoval = findings.find((finding) =>
    finding.severity === "BREAKING" && finding.method === "GET" && finding.path === "/api/demo/widgets");
  assert.ok(breakingRemoval, "Pinned oasdiff did not report GET /api/demo/widgets as BREAKING.");

  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const coverage: ImpactCoverage = {
    source: "PARTIAL",
    filesDiscovered: 1,
    filesAnalyzed: 1,
    filesSkipped: 0,
    reasons: ["Local proof analyzes only the declared demo client file; it does not scan the repository tree."],
  };
  const analysis = analyzeContractImpact({
    previousContract,
    nextContract,
    repositoryUrl: "local://demo-proof",
    contractUrl: `${origin}/api/demo/openapi`,
    commitSha,
    findings,
    files: [{ path: sourcePath, content: committedSource }],
    coverage,
  });
  const evidence = analysis.evidence.find((item) =>
    item.classification === "CONFIRMED" && item.method === "GET" && item.requestPath === "/api/demo/widgets");
  assert.ok(evidence, "Analyzer did not confirm the committed fetch usage against the breaking operation removal.");

  console.log(`LOCAL_ONLY commit=${commitSha}`);
  console.log(`oasdiff=${breakingRemoval.code} ${breakingRemoval.location}: ${breakingRemoval.summary}`);
  console.log(`analyzer=${evidence.classification} ${evidence.filePath}:${evidence.startLine}-${evidence.endLine} ${evidence.method} ${evidence.requestPath}`);
  console.log(`coverage=${analysis.coverage.source} discovered=${analysis.coverage.filesDiscovered} analyzed=${analysis.coverage.filesAnalyzed} skipped=${analysis.coverage.filesSkipped}`);
  for (const reason of analysis.coverage.reasons) console.log(`coverage-note=${reason}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo API proof failed.");
  process.exitCode = 1;
});
