"use client";

import { useState } from "react";
import { CodeBlock } from "@/components/iconiq/code-block";
import styles from "@/components/landing/landing.module.css";

const examples = {
  openapi: {
    label: "OpenAPI",
    filename: "openapi.yaml",
    language: "yaml",
    code: `openapi: 3.1.0\ninfo:\n  title: Example API\n  version: 1.4.0\nservers:\n  - url: https://api.example.com\npaths:\n  /v1/patients:\n    get:\n      summary: List patients\n      responses:\n        '200':\n          description: Patient list`,
  },
  repository: {
    label: "Repository",
    filename: "package.json",
    language: "json",
    code: `{
  "name": "example-api-client",
  "private": true,
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "openapi-fetch": "^0.14.0"
  }
}`,
  },
} as const;

type ExampleKey = keyof typeof examples;

export default function SourceWorkbench() {
  const [active, setActive] = useState<ExampleKey>("openapi");
  const example = examples[active];

  return (
    <section className={styles.workbench} aria-label="Illustrative source review workspace">
      <div className={styles.workbenchTopbar}>
        <div className={styles.projectIdentity}>
          <span className={styles.projectGlyph} aria-hidden="true">MW</span>
          <span>acme / patient-api</span>
          <span className={styles.branchName}>main</span>
        </div>
        <p className={styles.sampleNotice}>Illustrative workspace · source checks only</p>
      </div>

      <div className={styles.workbenchBody}>
        <aside className={styles.fileRail} aria-label="Example source files">
          <p className={styles.railHeading}>SOURCES</p>
          <button
            className={`${styles.fileItem} ${active === "openapi" ? styles.fileItemActive : ""}`}
            type="button"
            aria-pressed={active === "openapi"}
            onClick={() => setActive("openapi")}
          >
            <span className={styles.fileGlyph} aria-hidden="true">{`{ }`}</span>
            <span>openapi.yaml</span>
          </button>
          <button
            className={`${styles.fileItem} ${active === "repository" ? styles.fileItemActive : ""}`}
            type="button"
            aria-pressed={active === "repository"}
            onClick={() => setActive("repository")}
          >
            <span className={styles.fileGlyph} aria-hidden="true">JS</span>
            <span>package.json</span>
          </button>
          <div className={styles.railDivider} />
          <span className={styles.railMeta}>2 public sources</span>
        </aside>

        <div className={styles.editorPane}>
          <div className={styles.editorTabs} aria-label="Example source tabs">
            {(Object.keys(examples) as ExampleKey[]).map((key) => (
              <button
                className={`${styles.editorTab} ${active === key ? styles.editorTabActive : ""}`}
                type="button"
                key={key}
                aria-pressed={active === key}
                onClick={() => setActive(key)}
              >
                {examples[key].label}
              </button>
            ))}
            <span className={styles.editorTabMeta}>EXAMPLE</span>
          </div>
          <div className={styles.codeStage}>
            <CodeBlock
              key={active}
              code={example.code}
              filename={example.filename}
              language={example.language}
              showLineNumbers
              className={styles.sourceCodeBlock}
            />
          </div>
        </div>

        <aside className={styles.sourceRail} aria-label="Example source readiness">
          <div className={styles.statusHeading}>
            <span className={styles.statusSignal} aria-hidden="true" />
            <span>Sources ready</span>
          </div>
          <p className={styles.statusSubhead}>Example state</p>
          <div className={styles.sourceRecord}>
            <span className={styles.sourceType}>OPENAPI CONTRACT</span>
            <strong>openapi.yaml</strong>
            <span className={styles.sourceAddress}>api.example.com</span>
            <span className={styles.sourceResult}>URL validated</span>
          </div>
          <div className={styles.sourceRecord}>
            <span className={styles.sourceType}>GIT REPOSITORY</span>
            <strong>patient-api-client</strong>
            <span className={styles.sourceAddress}>github.com/acme/…</span>
            <span className={styles.sourceResult}>URL validated</span>
          </div>
          <p className={styles.railFootnote}>A ready status confirms these sources. It does not analyze API changes.</p>
        </aside>
      </div>
      <div className={styles.workbenchFooter}>
        <span>MONITOR / SOURCES</span>
        <span>Read-only · Public HTTPS</span>
      </div>
    </section>
  );
}
