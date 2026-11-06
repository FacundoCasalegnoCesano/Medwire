import "server-only";

import { createHash } from "node:crypto";
import * as ts from "typescript";
import type { CheckFinding } from "@/lib/monitor-check-types";
import type { ImpactCoverage, ImpactEvidence } from "@/lib/impact-types";

const MAX_FILES = 30;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_EVIDENCE = 80;
const MAX_SNIPPET = 900;
const MAX_ANALYSIS_MS = 1_500;
const SUPPORTED_EXT = /\.(?:[cm]?js|[cm]?jsx|tsx?)$/i;
const OTHER_HTTP_CLIENTS = new Set(["got", "ky", "superagent", "node-fetch", "undici", "wretch"]);

type Source = { path: string; content: string };
type ApiBase = { url: URL; absolute: boolean };
type RequestUse = {
  node: ts.CallExpression;
  client: "fetch" | "axios";
  method: string | null;
  rawUrl: string | null;
  dynamicUrl: boolean;
  baseUrl: string | null;
  allowConfirmed: boolean;
};
type OperationFinding = CheckFinding & { method: string; path: string };
const OPERATION_REMOVAL_CODES = new Set(["api-removed-without-deprecation", "api-path-removed-without-deprecation"]);

function safeText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function isString(node: ts.Expression | undefined): node is ts.StringLiteralLike {
  return Boolean(node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)));
}

function propertyName(node: ts.PropertyName | undefined): string | null {
  return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
    ? node.text : null;
}

function stringConstants(source: ts.SourceFile): Map<string, string> {
  const values = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && isString(declaration.initializer)) {
        values.set(declaration.name.text, declaration.initializer.text);
      }
    }
  }
  return values;
}

function staticString(
  node: ts.Expression | undefined,
  constants: Map<string, string>,
  source?: ts.SourceFile,
  call?: ts.CallExpression,
): string | null {
  if (!node) return null;
  if (isString(node)) return node.text;
  if (ts.isIdentifier(node)) return source && call && !hasLocalShadow(source, call, node.text, true)
    ? constants.get(node.text) ?? null
    : source || call ? null : constants.get(node.text) ?? null;
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression, constants, source, call);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left, constants, source, call);
    const right = staticString(node.right, constants, source, call);
    return left === null || right === null ? null : `${left}${right}`;
  }
  return null;
}

function namedBindings(source: ts.SourceFile): {
  axiosNames: Set<string>;
  axiosNamedMethods: Map<string, string>;
  axiosNamespaceNames: Set<string>;
  axiosTypeOnlyNames: Set<string>;
} {
  const axiosNames = new Set<string>();
  const axiosNamedMethods = new Map<string, string>();
  const axiosNamespaceNames = new Set<string>();
  const axiosTypeOnlyNames = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "axios") continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) {
      axiosNames.add(clause.name.text);
      if (clause.isTypeOnly) axiosTypeOnlyNames.add(clause.name.text);
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      axiosNames.add(clause.namedBindings.name.text);
      axiosNamespaceNames.add(clause.namedBindings.name.text);
      if (clause.isTypeOnly) axiosTypeOnlyNames.add(clause.namedBindings.name.text);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.propertyName?.text === "default" && element.name.text) {
          axiosNames.add(element.name.text);
          if (clause.isTypeOnly || element.isTypeOnly) axiosTypeOnlyNames.add(element.name.text);
        }
        const importedName = element.propertyName?.text ?? element.name.text;
        if (["get", "post", "put", "patch", "delete", "request"].includes(importedName)) {
          axiosNamedMethods.set(element.name.text, importedName);
        }
      }
    }
  }
  return { axiosNames, axiosNamedMethods, axiosNamespaceNames, axiosTypeOnlyNames };
}

function hasUnmodeledAxiosConfig(config: { known: boolean; values: Map<string, ts.Expression> } | null): boolean {
  if (config?.known === false) return true;
  if (!config) return false;
  if (["adapter", "transformRequest", "socketPath", "transport", "httpAgent", "httpsAgent"].some((key) => config.values.has(key))) return true;
  const allowAbsoluteUrls = config.values.get("allowAbsoluteUrls");
  return Boolean(allowAbsoluteUrls && !(allowAbsoluteUrls.kind === ts.SyntaxKind.TrueKeyword));
}

function hasUnsupportedHttpClient(source: ts.SourceFile): boolean {
  let found = false;
  const axiosNamespaces = new Set<string>();
  const typeOnlyAxiosNames = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "axios" &&
      statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings)) {
      axiosNamespaces.add(statement.importClause.namedBindings.name.text);
      found = true;
    }
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "axios" &&
      statement.importClause?.isTypeOnly) {
      if (statement.importClause.name) typeOnlyAxiosNames.add(statement.importClause.name.text);
      if (statement.importClause.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings)) {
        typeOnlyAxiosNames.add(statement.importClause.namedBindings.name.text);
      }
    }
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "axios" &&
      statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.isTypeOnly && element.propertyName?.text === "default") typeOnlyAxiosNames.add(element.name.text);
      }
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (OTHER_HTTP_CLIENTS.has(node.moduleSpecifier.text)) found = true;
      if (node.moduleSpecifier.text === "axios" && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.some((element) => ["get", "post", "put", "patch", "delete", "request"].includes(element.propertyName?.text ?? element.name.text))) {
        found = true;
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
      axiosNamespaces.has(node.expression.expression.text) &&
      ["get", "post", "put", "patch", "delete", "head", "options", "request"].includes(node.expression.name.text.toLowerCase())) found = true;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
      typeOnlyAxiosNames.has(node.expression.expression.text) &&
      ["get", "post", "put", "patch", "delete", "head", "options", "request"].includes(node.expression.name.text.toLowerCase())) found = true;
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "XMLHttpRequest") found = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function declaresName(node: ts.Node, name: string): boolean {
  const bindingHasName = (binding: ts.BindingName): boolean => {
    if (ts.isIdentifier(binding)) return binding.text === name;
    return binding.elements.some((element) => ts.isBindingElement(element) && bindingHasName(element.name));
  };
  if (ts.isParameter(node) || ts.isVariableDeclaration(node)) return bindingHasName(node.name);
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isImportClause(node)) {
    return Boolean(node.name && ts.isIdentifier(node.name) && node.name.text === name);
  }
  if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) {
    return node.name.text === name;
  }
  return false;
}

function hasLocalShadow(source: ts.SourceFile, call: ts.CallExpression, name: string, allowRootConst = false): boolean {
  for (let scope: ts.Node | undefined = call.parent; scope; scope = scope.parent) {
    if (!ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isFunctionLike(scope) && !ts.isCatchClause(scope)) continue;
    let found = false;
    const visit = (node: ts.Node) => {
      if (node !== call && declaresName(node, name)) {
        const isRootConst = allowRootConst && ts.isVariableDeclaration(node) &&
          node.parent.parent.parent === source && Boolean(node.parent.flags & ts.NodeFlags.Const);
        if (!isRootConst) found = true;
      }
      if (node !== scope && (ts.isFunctionLike(node) || ts.isBlock(node) || ts.isClassLike(node))) return;
      ts.forEachChild(node, visit);
    };
    visit(scope);
    if (!found && (ts.isFunctionLike(scope) || ts.isSourceFile(scope))) {
      const findHoistedVar = (node: ts.Node) => {
        if (node !== scope && ts.isFunctionLike(node)) return;
        if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) &&
          !(node.parent.flags & ts.NodeFlags.BlockScoped) && declaresName(node, name)) found = true;
        ts.forEachChild(node, findHoistedVar);
      };
      findHoistedVar(scope);
    }
    // Top-level Axios imports are recognized separately; imports themselves are not shadowing.
    if (found) {
      const imported = source.statements.some((statement) => {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "axios") return false;
        const clause = statement.importClause;
        return clause?.name?.text === name ||
          (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === name) ||
          (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.some((item) => item.name.text === name));
      });
      if (ts.isSourceFile(scope) && imported) continue;
      return true;
    }
  }
  return false;
}

function objectProperties(node: ts.Expression | undefined): { known: boolean; values: Map<string, ts.Expression> } {
  if (!node || !ts.isObjectLiteralExpression(node)) return { known: false, values: new Map() };
  const values = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    // A spread, computed name, shorthand, method, or accessor can change the
    // effective configuration. Do not infer defaults from a partial object.
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) return { known: false, values: new Map() };
    const key = propertyName(property.name);
    if (key === null || values.has(key)) return { known: false, values: new Map() };
    values.set(key, property.initializer);
  }
  return { known: true, values };
}

function objectValue(node: ts.Expression | undefined, key: string): ts.Expression | undefined {
  const properties = objectProperties(node);
  return properties.known ? properties.values.get(key) : undefined;
}

function fetchMethod(init: ts.Expression | undefined, constants: Map<string, string>, source: ts.SourceFile, call: ts.CallExpression): string | null {
  if (!init) return "GET";
  const properties = objectProperties(init);
  if (!properties.known) return null;
  const value = properties.values.get("method");
  return value ? staticString(value, constants, source, call)?.toUpperCase() ?? null : "GET";
}

function importedFetchCall(node: ts.CallExpression, source: ts.SourceFile): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "fetch" && !hasLocalShadow(source, node, "fetch");
}

function extractRequests(source: ts.SourceFile): RequestUse[] {
  const constants = stringConstants(source);
  const { axiosNames, axiosNamedMethods, axiosNamespaceNames, axiosTypeOnlyNames } = namedBindings(source);
  const axiosInstances = new Map<string, string | null>();
  const uncertainAxiosNames = new Set<string>(axiosTypeOnlyNames);
  const uncertainAxiosInstances = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      const init = declaration.initializer;
      if (!ts.isPropertyAccessExpression(init.expression) || !axiosNames.has(init.expression.expression.getText(source)) ||
        init.expression.name.text !== "create" || !init.arguments[0]) continue;
      const createConfig = objectProperties(init.arguments[0]);
      const base = createConfig.known
        ? staticString(createConfig.values.get("baseURL"), constants, source, init)
        : null;
      const semanticsAreUnmodeled = hasUnmodeledAxiosConfig(createConfig);
      axiosInstances.set(declaration.name.text, semanticsAreUnmodeled ? null : base);
      if (semanticsAreUnmodeled || axiosTypeOnlyNames.has(init.expression.expression.getText(source))) {
        uncertainAxiosInstances.add(declaration.name.text);
      }
    }
  }
  {
    const findMutation = (node: ts.Node) => {
      // Any access to defaults makes the instance's effective configuration
      // uncertain. This also catches compound/computed writes and mutation APIs
      // such as Object.assign(api.defaults, ...), without trying to model JS.
      if ((ts.isPropertyAccessExpression(node) && ["defaults", "interceptors"].includes(node.name.text) &&
          ts.isIdentifier(node.expression) && (axiosInstances.has(node.expression.text) || axiosNames.has(node.expression.text))) ||
        (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && (axiosInstances.has(node.expression.text) || axiosNames.has(node.expression.text)))) {
        // Computed access through an instance can alias `defaults`; invalidate
        // even when the key is an identifier instead of modeling its value.
        if (axiosInstances.has(node.expression.text)) uncertainAxiosInstances.add(node.expression.text);
        if (axiosNames.has(node.expression.text)) uncertainAxiosNames.add(node.expression.text);
      }
      ts.forEachChild(node, findMutation);
    };
    findMutation(source);
    for (const name of uncertainAxiosInstances) if (axiosInstances.has(name)) axiosInstances.set(name, null);
  }

  const requests: RequestUse[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (importedFetchCall(node, source)) {
        const raw = staticString(node.arguments[0], constants, source, node);
        const method = fetchMethod(node.arguments[1], constants, source, node);
        requests.push({ node, client: "fetch", method, rawUrl: raw, dynamicUrl: raw === null, baseUrl: null, allowConfirmed: true });
      } else {
        const expression = node.expression;
        if (ts.isPropertyAccessExpression(expression)) {
          const receiver = expression.expression.getText(source);
          const methodName = expression.name.text.toLowerCase();
          const isVerb = ["get", "delete", "head", "options", "post", "put", "patch"].includes(methodName);
          const isRequest = methodName === "request";
          const isInstance = axiosInstances.has(receiver);
          const isAxios = axiosNames.has(receiver) || isInstance;
          if (isAxios && !hasLocalShadow(source, node, receiver, isInstance) && (isVerb || isRequest)) {
            const config = isRequest ? node.arguments[0] : ["post", "put", "patch"].includes(methodName) ? node.arguments[2] : node.arguments[1];
            const urlExpr = isRequest ? objectValue(config, "url") : node.arguments[0];
            const rawUrl = staticString(urlExpr, constants, source, node);
            const callConfig = config === undefined ? null : objectProperties(config);
            const configuredBaseExpr = callConfig?.values.get("baseURL");
            const configuredBase = config === undefined
              ? axiosInstances.get(receiver) ?? null
              : callConfig?.known
                ? configuredBaseExpr
                  ? staticString(configuredBaseExpr, constants, source, node)
                  : axiosInstances.get(receiver) ?? null
                : null;
            const method = (isRequest
              ? staticString(objectValue(config, "method"), constants, source, node)
              : methodName)?.toUpperCase() ?? null;
            const semanticsAreUnmodeled = hasUnmodeledAxiosConfig(callConfig);
            requests.push({ node, client: "axios", method, rawUrl, dynamicUrl: rawUrl === null,
              baseUrl: configuredBase, allowConfirmed: !semanticsAreUnmodeled && !uncertainAxiosInstances.has(receiver) &&
                !uncertainAxiosNames.has(receiver) && !uncertainAxiosNames.has(expression.expression.getText(source)) &&
                !axiosNamespaceNames.has(receiver) });
          }
        } else if (ts.isIdentifier(expression) && axiosNamedMethods.has(expression.text) && !hasLocalShadow(source, node, expression.text)) {
          const method = axiosNamedMethods.get(expression.text)!;
          const rawUrl = staticString(node.arguments[0], constants, source, node);
          const configIndex = ["post", "put", "patch"].includes(method) ? 2 : method === "request" ? 0 : 1;
          const config = node.arguments[configIndex];
          const callConfig = config === undefined ? null : objectProperties(config);
          requests.push({ node, client: "axios", method: method === "request" ?
            staticString(objectValue(node.arguments[0], "method"), constants, source, node)?.toUpperCase() ?? null : method.toUpperCase(),
          rawUrl: method === "request" ? staticString(objectValue(node.arguments[0], "url"), constants, source, node) : rawUrl,
          dynamicUrl: method === "request" ? staticString(objectValue(node.arguments[0], "url"), constants, source, node) === null : rawUrl === null,
          baseUrl: callConfig?.known ? staticString(callConfig.values.get("baseURL"), constants, source, node) : null,
          allowConfirmed: false });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return requests;
}

function parseServerList(servers: unknown, contractUrl: string): ApiBase[] {
  if (!Array.isArray(servers)) return [];
  const output: ApiBase[] = [];
  for (const server of servers) {
    const raw = server && typeof server === "object" ? (server as { url?: unknown }).url : null;
    if (typeof raw !== "string" || /[{}]/.test(raw)) continue;
    try {
      const absolute = /^https?:\/\//i.test(raw);
      const url = new URL(raw, contractUrl);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
        output.push({ url, absolute });
      }
    } catch { /* Ignore unusable server templates. */ }
  }
  return output;
}

function operationBases(contract: unknown, finding: OperationFinding, contractUrl: string): ApiBase[] {
  if (!contract || typeof contract !== "object") return [];
  const document = contract as { servers?: unknown; paths?: unknown };
  const paths = document.paths && typeof document.paths === "object" ? document.paths as Record<string, unknown> : {};
  const pathItem = paths[finding.path] && typeof paths[finding.path] === "object" ? paths[finding.path] as Record<string, unknown> : null;
  const operation = pathItem?.[finding.method.toLowerCase()] && typeof pathItem[finding.method.toLowerCase()] === "object"
    ? pathItem[finding.method.toLowerCase()] as Record<string, unknown> : null;
  if (operation && Object.hasOwn(operation, "servers")) return parseServerList(operation.servers, contractUrl);
  if (pathItem && Object.hasOwn(pathItem, "servers")) return parseServerList(pathItem.servers, contractUrl);
  return parseServerList(document.servers, contractUrl);
}

function matchingOperationBase(contract: unknown, finding: OperationFinding, url: URL | null, contractUrl: string): ApiBase | undefined {
  if (!url) return undefined;
  return operationBases(contract, finding, contractUrl).find((base) => apiMatches(url, base, contractUrl));
}

function resolveRequestUrl(use: RequestUse): URL | null {
  try {
    if (use.rawUrl && /^https?:\/\//i.test(use.rawUrl)) return new URL(use.rawUrl);
    const base = use.baseUrl ?? null;
    if (base && /^https?:\/\//i.test(base)) {
      if (!use.rawUrl) return null;
      const combined = `${base.replace(/\/+$/, "")}/${use.rawUrl.replace(/^\/+/, "")}`;
      return new URL(combined);
    }
    return null;
  } catch { return null; }
}

function normalizedPath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] || "/";
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/$/, "") : withoutQuery;
}

function pathsMatch(requestPath: string, contractPath: string): boolean {
  const pattern = normalizedPath(contractPath).split("/").map((segment) => {
    if (/^\{[^{}]+\}$/.test(segment)) return "[^/]+";
    return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  try { return new RegExp(`^${pattern}/?$`).test(normalizedPath(requestPath)); }
  catch { return false; }
}

function operationFindings(findings: CheckFinding[]): OperationFinding[] {
  return findings.filter((finding): finding is OperationFinding => finding.severity === "BREAKING" &&
    typeof finding.method === "string" && typeof finding.path === "string" && finding.method.length > 0 && finding.path.startsWith("/"));
}

function operationStillExists(contract: unknown, method: string, path: string): boolean {
  const paths = contract && typeof contract === "object" ? (contract as { paths?: unknown }).paths : null;
  if (!paths || typeof paths !== "object") return false;
  const item = (paths as Record<string, unknown>)[path];
  return Boolean(item && typeof item === "object" && Object.hasOwn(item, method.toLowerCase()));
}

function operationRemovalProven(contract: unknown, finding: OperationFinding): boolean {
  const paths = contract && typeof contract === "object" ? (contract as { paths?: unknown }).paths : null;
  if (!paths || typeof paths !== "object") return false;
  const pathItems = paths as Record<string, unknown>;
  const pathExists = Object.hasOwn(pathItems, finding.path);
  if (finding.code === "api-path-removed-without-deprecation") return !pathExists;
  if (finding.code !== "api-removed-without-deprecation" || !pathExists) return false;
  const item = pathItems[finding.path];
  if (!item || typeof item !== "object" || Array.isArray(item) || Object.hasOwn(item, "$ref")) return false;
  return !Object.hasOwn(item, finding.method.toLowerCase());
}

function hasMatchingUnresolvedPathItem(contract: unknown, actualPath: string): boolean {
  const paths = contract && typeof contract === "object" ? (contract as { paths?: unknown }).paths : null;
  if (!paths || typeof paths !== "object") return false;
  return Object.entries(paths as Record<string, unknown>).some(([path, item]) =>
    Boolean(item && typeof item === "object" && Object.hasOwn(item, "$ref") && pathsMatch(actualPath, path)));
}

function operationRemovedByFinding(contract: unknown, finding: OperationFinding, actualPath: string): boolean {
  if (operationStillExists(contract, finding.method, finding.path)) return false;
  const paths = contract && typeof contract === "object" ? (contract as { paths?: unknown }).paths : null;
  if (!paths || typeof paths !== "object") return false;
  return Object.entries(paths as Record<string, unknown>).some(([path, item]) => {
    const operation = item && typeof item === "object" ? (item as Record<string, unknown>)[finding.method.toLowerCase()] : null;
    return Boolean(operation && pathsMatch(actualPath, path));
  });
}

function apiMatches(url: URL, base: ApiBase, contractUrl: string): boolean {
  const contractOrigin = new URL(contractUrl).origin;
  if (url.origin !== base.url.origin) return false;
  if (!base.absolute && url.origin !== contractOrigin) return false;
  const prefix = normalizedPath(base.url.pathname);
  return prefix === "/" || normalizedPath(url.pathname) === prefix || normalizedPath(url.pathname).startsWith(`${prefix}/`);
}

function requestPath(url: URL, base: ApiBase): string {
  const path = normalizedPath(url.pathname);
  const prefix = normalizedPath(base.url.pathname);
  if (prefix !== "/" && (path === prefix || path.startsWith(`${prefix}/`))) return path.slice(prefix.length) || "/";
  return path;
}

function snippet(source: ts.SourceFile, node: ts.Node): { text: string; start: number; end: number } {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const end = source.getLineAndCharacterOfPosition(Math.max(node.getStart(source), node.getEnd() - 1)).line + 1;
  const lines = source.text.split(/\r?\n/);
  const from = Math.max(0, start - 2);
  const to = Math.min(lines.length, Math.max(end + 1, start + 1));
  return { text: safeText(lines.slice(from, to).join(" "), MAX_SNIPPET), start: from + 1, end: to };
}

function evidence(input: {
  classification: ImpactEvidence["classification"];
  repositoryUrl: string;
  commitSha: string;
  filePath: string;
  source: ts.SourceFile;
  use: RequestUse;
  finding: OperationFinding | null;
  requestPath: string | null;
  reason: string;
}): ImpactEvidence {
  const part = snippet(input.source, input.use.node);
  const startLine = input.source.getLineAndCharacterOfPosition(input.use.node.getStart(input.source)).line + 1;
  const endLine = input.source.getLineAndCharacterOfPosition(Math.max(input.use.node.getStart(input.source), input.use.node.getEnd() - 1)).line + 1;
  const changeKey = input.finding ? `${input.finding.code}:${input.finding.method}:${input.finding.path}` : "schema-change";
  const id = createHash("sha256").update(`${input.commitSha}:${input.filePath}:${startLine}:${input.classification}:${changeKey}`).digest("hex").slice(0, 24);
  return {
    id,
    classification: input.classification,
    repositoryUrl: input.repositoryUrl,
    commitSha: input.commitSha,
    filePath: input.filePath,
    startLine,
    endLine,
    snippet: part.text.slice(0, MAX_SNIPPET),
    client: input.use.client,
    method: input.use.method,
    requestPath: input.requestPath,
    contractElement: input.finding ? { method: input.finding.method, path: input.finding.path, changeCode: input.finding.code } : null,
    reason: safeText(input.reason, 240),
  };
}

export function analyzeContractImpact(input: {
  previousContract: unknown;
  nextContract: unknown;
  repositoryUrl: string;
  contractUrl: string;
  commitSha: string;
  findings: CheckFinding[];
  files: ReadonlyArray<Source>;
  coverage: ImpactCoverage;
}): { evidence: ImpactEvidence[]; coverage: ImpactCoverage } {
  const coverage: ImpactCoverage = { ...input.coverage, reasons: [...input.coverage.reasons] };
  const evidenceList: ImpactEvidence[] = [];
  const operations = operationFindings(input.findings);
  const hasSchemaFinding = input.findings.some((finding) => finding.severity === "BREAKING" && finding.method === null && finding.path === null);
  if (!coverage.reasons.includes("Only direct global fetch and statically imported Axios calls are analyzed; custom wrappers, cross-file client configuration, and other HTTP clients are unsupported.")) {
    coverage.reasons.push("Only direct global fetch and statically imported Axios calls are analyzed; custom wrappers, cross-file client configuration, and other HTTP clients are unsupported.");
  }
  let filesWithUnsupportedClients = 0;
  let analyzed = 0;
  let skipped = coverage.filesSkipped;
  const deadline = Date.now() + MAX_ANALYSIS_MS;
  let timedOut = false;

  const filesToAnalyze = input.files.slice(0, MAX_FILES);
  for (let fileIndex = 0; fileIndex < filesToAnalyze.length; fileIndex += 1) {
    if (Date.now() >= deadline) {
      skipped += filesToAnalyze.length - fileIndex;
      timedOut = true;
      break;
    }
    const file = filesToAnalyze[fileIndex];
    if (!SUPPORTED_EXT.test(file.path) || Buffer.byteLength(file.content, "utf8") > MAX_FILE_BYTES) {
      skipped += 1;
      coverage.source = "PARTIAL";
      coverage.reasons.push("Some files were outside the supported JS/TS source limits.");
      continue;
    }
    const kind = /\.tsx$/i.test(file.path) ? ts.ScriptKind.TSX : /\.ts$/i.test(file.path) ? ts.ScriptKind.TS : /\.jsx$/i.test(file.path) ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, kind);
    const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (parseDiagnostics.length > 0) {
      skipped += 1;
      coverage.source = "PARTIAL";
      if (!coverage.reasons.includes("Some JavaScript or TypeScript files could not be parsed.")) coverage.reasons.push("Some JavaScript or TypeScript files could not be parsed.");
      continue;
    }
    analyzed += 1;
    if (hasUnsupportedHttpClient(source)) filesWithUnsupportedClients += 1;
    const uses = extractRequests(source);
    const evidenceStart = evidenceList.length;
    let fileComplete = true;
    if (Date.now() >= deadline) {
      analyzed -= 1;
      skipped += filesToAnalyze.length - fileIndex;
      timedOut = true;
      fileComplete = false;
    }
    for (const use of uses) {
      if (!fileComplete) break;
      if (Date.now() >= deadline) {
        evidenceList.length = evidenceStart;
        analyzed -= 1;
        skipped += filesToAnalyze.length - fileIndex;
        timedOut = true;
        fileComplete = false;
        break;
      }
      if (operations.length === 0) {
        if (hasSchemaFinding) evidenceList.push(evidence({
          classification: "CANDIDATE", repositoryUrl: input.repositoryUrl, commitSha: input.commitSha,
          filePath: file.path, source, use, finding: null, requestPath: null,
          reason: "A breaking schema change exists, but no specific request property usage could be proven.",
        }));
        continue;
      }
      const url = resolveRequestUrl(use);
      if (hasSchemaFinding) evidenceList.push(evidence({
        classification: "CANDIDATE", repositoryUrl: input.repositoryUrl, commitSha: input.commitSha,
        filePath: file.path, source, use, finding: null, requestPath: null,
        reason: "A breaking schema change exists, but this request does not prove use of the changed property.",
      }));

      for (const finding of operations) {
        if (use.method && use.method.toUpperCase() !== finding.method.toUpperCase()) continue;
        const endpointRemoved = OPERATION_REMOVAL_CODES.has(finding.code) && operationRemovalProven(input.nextContract, finding);
        const previousBases = operationBases(input.previousContract, finding, input.contractUrl);
        const previousBase = matchingOperationBase(input.previousContract, finding, url, input.contractUrl);
        const nextBase = matchingOperationBase(input.nextContract, finding, url, input.contractUrl);
        const knownBase = endpointRemoved ? previousBase : previousBase ?? nextBase;
        const hasAnyBase = endpointRemoved ? previousBases.length > 0 : previousBases.length > 0 ||
          operationBases(input.nextContract, finding, input.contractUrl).length > 0;
        const explicitDifferent = url && !knownBase && hasAnyBase &&
          ((use.rawUrl && /^https?:\/\//i.test(use.rawUrl)) || (use.baseUrl && /^https?:\/\//i.test(use.baseUrl)));
        if (explicitDifferent) continue; // A different explicitly identified API is not a match.
        const relativePath = url && knownBase ? requestPath(url, knownBase) : use.rawUrl && !/^[a-z]+:\/\//i.test(use.rawUrl)
          ? normalizedPath(use.rawUrl) : null;
        if (relativePath && !pathsMatch(relativePath, finding.path)) continue;
        if (relativePath && operationRemovedByFinding(input.nextContract, finding, relativePath)) continue;
        const confirmed = Boolean(use.allowConfirmed && previousBase && relativePath && use.method && endpointRemoved &&
          !hasMatchingUnresolvedPathItem(input.nextContract, relativePath));
        const reason = confirmed
          ? `The statically linked API origin ${knownBase!.url.origin}, method, and path match an operation removed by this contract change.`
          : url && knownBase
            ? "The request targets the contract API, but the breaking operation change cannot be proven from this call alone."
            : use.dynamicUrl
              ? "The request URL is dynamic and cannot be linked reliably to the contract operation."
              : "The request method or API base is not sufficiently established for a confirmed impact.";
        evidenceList.push(evidence({
          classification: confirmed ? "CONFIRMED" : "CANDIDATE",
          repositoryUrl: input.repositoryUrl,
          commitSha: input.commitSha,
          filePath: file.path,
          source,
          use,
          finding,
          requestPath: relativePath,
          reason,
        }));
      }
    }
    if (!fileComplete) break;
  }

  if (input.files.length > MAX_FILES) {
    skipped += input.files.length - MAX_FILES;
    coverage.source = "PARTIAL";
    coverage.reasons.push("Analyzer file limit reached (30 files per analysis).");
  }
  if (timedOut) {
    coverage.source = "PARTIAL";
    coverage.reasons.push("Analysis time limit reached; remaining source files or requests were not fully analyzed.");
  }
  coverage.filesAnalyzed = analyzed;
  coverage.filesSkipped = skipped;
  coverage.filesDiscovered = Math.max(coverage.filesDiscovered, analyzed + skipped);
  if (filesWithUnsupportedClients > 0) {
    coverage.source = "PARTIAL";
    coverage.reasons.push(`Detected unsupported HTTP client patterns, including named Axios method imports and namespace Axios imports (including .default access), in ${filesWithUnsupportedClients} analyzed file(s); those requests were not confirmed.`);
  }
  if (coverage.reasons.length > 0 && coverage.source === "SUPPORTED") coverage.source = "PARTIAL";
  coverage.reasons = [...new Set(coverage.reasons)].slice(0, 12);
  const bounded = evidenceList.slice(0, MAX_EVIDENCE);
  if (evidenceList.length > bounded.length) {
    coverage.source = "PARTIAL";
    coverage.reasons.push("Evidence result limit reached (80 findings).");
    coverage.reasons = [...new Set(coverage.reasons)].slice(0, 12);
  }
  return { evidence: bounded, coverage };
}
