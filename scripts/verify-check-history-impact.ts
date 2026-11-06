import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

import { analyzeContractImpact } from "@/lib/impact-analyzer";
import { compareOpenApiDocuments } from "@/lib/openapi-diff";
import type { ImpactCoverage } from "@/lib/impact-types";

async function main() {
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  function readCommittedFile(path: string) {
    const committedBlob = spawnSync("git", ["cat-file", "-e", `${commitSha}:${path}`]);
    if (committedBlob.status !== 0) throw new Error(`Cannot read ${path} from ${commitSha}. Commit that file before running this proof.`);
    const sourceDiff = spawnSync("git", ["diff", "--quiet", commitSha, "--", path]);
    if (sourceDiff.status === 1) throw new Error(`Working copy of ${path} differs from HEAD. Commit or discard its changes before running this proof.`);
    if (sourceDiff.status !== 0) throw new Error(`Could not verify whether ${path} differs from HEAD.`);
    const sourceResult = spawnSync("git", ["show", `${commitSha}:${path}`], { encoding: "utf8" });
    if (sourceResult.status !== 0) throw new Error(`Could not read committed ${path} from ${commitSha}.`);
    return sourceResult.stdout as string;
  }

  const sourcePath = "src/components/monitor-check-panel.tsx";
  const committedSource = readCommittedFile(sourcePath);

  const contractPath = "docs/contracts/check-history.baseline.openapi.json";
  const previousContract = JSON.parse(readCommittedFile(contractPath)) as Record<string, unknown>;
  const previousPaths = previousContract.paths as Record<string, Record<string, unknown>>;
  const nextContract = structuredClone(previousContract);
  delete ((nextContract.paths as Record<string, Record<string, unknown>>)["/api/monitors/{id}/checks"]).get;
  const findings = await compareOpenApiDocuments(previousContract, nextContract);
  const breakingRemoval = findings.find((finding) => finding.severity === "BREAKING" &&
    finding.method === "GET" && finding.path === "/api/monitors/{id}/checks");
  assert.ok(breakingRemoval, "Pinned oasdiff did not report the simulated GET operation removal as BREAKING.");
  assert.ok(previousPaths["/api/monitors/{id}/checks"]?.get, "The baseline contract must include the actual GET operation.");

  const coverage: ImpactCoverage = {
    source: "PARTIAL", filesDiscovered: 1, filesAnalyzed: 1, filesSkipped: 0,
    reasons: ["Local proof analyzes only src/components/monitor-check-panel.tsx; it does not scan the repository tree."],
  };
  const analysis = analyzeContractImpact({
    previousContract, nextContract, repositoryUrl: "local://medwire-check-history-proof",
    contractUrl: "http://127.0.0.1:3000/openapi.json", commitSha, findings,
    files: [{ path: sourcePath, content: committedSource }], coverage,
  });
  const candidates = analysis.evidence.filter((item) => item.classification === "CANDIDATE" &&
    item.method === "GET" && item.contractElement?.method === "GET" && item.contractElement.path === "/api/monitors/{id}/checks");
  assert.ok(candidates.length > 0, "Analyzer did not identify the existing dynamic GET call as a candidate.");
  assert.equal(analysis.evidence.some((item) => item.classification === "CONFIRMED"), false,
    "Dynamic monitor IDs must not be reported as confirmed evidence.");

  const evidence = candidates[0];
  const excerpt = committedSource.split(/\r?\n/).slice(evidence.startLine - 1, evidence.endLine).join(" ").trim();
  console.log(`LOCAL_ONLY SIMULATED_CONTRACT_CHANGE commit=${commitSha}`);
  console.log(`oasdiff=${breakingRemoval.code} ${breakingRemoval.location}: ${breakingRemoval.summary}`);
  console.log(`analyzer=${evidence.classification} ${evidence.filePath}:${evidence.startLine}-${evidence.endLine} method=${evidence.method} requestPath=${evidence.requestPath ?? "dynamic"}`);
  console.log(`source=${excerpt}`);
  console.log(`reason=${evidence.reason}`);
  console.log(`coverage=${analysis.coverage.source} discovered=${analysis.coverage.filesDiscovered} analyzed=${analysis.coverage.filesAnalyzed} skipped=${analysis.coverage.filesSkipped}`);
  for (const reason of analysis.coverage.reasons) console.log(`coverage-note=${reason}`);
  console.log("The application endpoint and consumer were not changed; only the in-memory comparison contract removes GET.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Check history API proof failed.");
  process.exitCode = 1;
});
