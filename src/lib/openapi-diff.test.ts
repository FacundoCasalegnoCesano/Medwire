import { describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { OpenApiDiffError, parseBreakingChanges, verifyOasdiffVersion } from "@/lib/openapi-diff";

describe("parseBreakingChanges", () => {
  it("keeps the affected operation, path, explanation, and severity from oasdiff", () => {
    expect(parseBreakingChanges(JSON.stringify([{
      id: "api-path-removed-without-deprecation",
      text: "api path removed without deprecation",
      level: 3,
      operation: "GET",
      path: "/pets",
      section: "paths",
    }]))).toEqual([{
      code: "api-path-removed-without-deprecation",
      location: "GET /pets",
      method: "GET",
      path: "/pets",
      summary: "api path removed without deprecation",
      severity: "BREAKING",
    }]);
  });

  it("classifies warnings separately and gives schema findings a readable location", () => {
    expect(parseBreakingChanges(JSON.stringify([{
      id: "request-property-became-required",
      text: "request property became required",
      level: 2,
      section: "components/schemas",
      schema: "CreatePet",
    }]))).toEqual([{
      code: "request-property-became-required",
      location: "components/schemas/CreatePet",
      method: null,
      path: null,
      summary: "request property became required",
      severity: "POTENTIAL",
    }]);
  });

  it("returns no findings for no-op and rejects output that is not the expected JSON array", () => {
    expect(parseBreakingChanges("[]")).toEqual([]);
    expect(() => parseBreakingChanges("not json")).toThrow(OpenApiDiffError);
    expect(() => parseBreakingChanges("{} ")).toThrow(OpenApiDiffError);
  });

  it("accepts only the pinned oasdiff release", () => {
    expect(() => verifyOasdiffVersion("oasdiff version 1.35.0\n")).not.toThrow();
    expect(() => verifyOasdiffVersion("oasdiff version 1.34.2\n")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_VERSION" }),
    );
    expect(() => verifyOasdiffVersion("not oasdiff\n")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_VERSION" }),
    );
  });
});
