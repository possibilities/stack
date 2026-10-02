import assert from "node:assert/strict";
import test from "node:test";
import { contentListenerOrigin, contentPublicOrigins, contentTransportConfig } from "../src/content-transport.js";

test("Content listeners share defaults, current-over-legacy precedence and resolved public origins", () => {
  const defaults = contentTransportConfig({});
  assert.deepEqual(defaults, { host: "127.0.0.1", port: 8777, artifactPort: 8778 });
  assert.deepEqual(contentPublicOrigins(defaults), { document: "http://127.0.0.1:8777", artifact: "http://127.0.0.1:8778" });
  const legacy = { STACK_WIKI_PORT: "9001", STACK_WIKI_ARTIFACT_PORT: "9002" };
  assert.deepEqual(contentPublicOrigins(contentTransportConfig(legacy)), { document: "http://127.0.0.1:9001", artifact: "http://127.0.0.1:9002" });
  assert.deepEqual(contentPublicOrigins(contentTransportConfig({ ...legacy, STACK_CONTENT_PORT: "9003", STACK_CONTENT_ARTIFACT_PORT: "9004" })),
    { document: "http://127.0.0.1:9003", artifact: "http://127.0.0.1:9004" });
  assert.throws(() => contentTransportConfig({ ...legacy, STACK_CONTENT_PORT: "" }), /STACK_CONTENT_PORT/);
  assert.throws(() => contentTransportConfig({ ...legacy, STACK_CONTENT_ARTIFACT_PORT: "" }), /STACK_CONTENT_ARTIFACT_PORT/);
});

test("Content accepts ephemeral listeners without fabricating addresses, and keeps public origins separate from backends", () => {
  for (const env of [{ STACK_CONTENT_PORT: "0" }, { STACK_CONTENT_ARTIFACT_PORT: "0" }, { STACK_CONTENT_PORT: "0", STACK_CONTENT_ARTIFACT_PORT: "0" }]) {
    assert.equal(contentPublicOrigins(contentTransportConfig(env)), null);
  }
  assert.equal(contentListenerOrigin(0), null);
  assert.equal(contentListenerOrigin(80), "http://127.0.0.1", "the default HTTP port has one canonical origin");
  const config = contentTransportConfig({ STACK_CONTENT_PORT: "0", STACK_CONTENT_ARTIFACT_PORT: "0",
    STACK_CONTENT_DOCUMENT_ORIGIN: "https://docs.example", STACK_CONTENT_ARTIFACT_ORIGIN: "http://assets.example:8080" });
  assert.deepEqual(contentPublicOrigins(config), { document: "https://docs.example", artifact: "http://assets.example:8080" });
  assert.equal(contentListenerOrigin(config.port), null, "public origins cannot resolve a backend's ephemeral port");
  assert.deepEqual(contentPublicOrigins({ ...contentTransportConfig({ STACK_CONTENT_PORT: "0", STACK_CONTENT_ARTIFACT_PORT: "0" }), port: 9101, artifactPort: 9102 }),
    { document: "http://127.0.0.1:9101", artifact: "http://127.0.0.1:9102" });
});

test("Content rejects remote hosts, invalid ports and non-isolated origins", () => {
  for (const host of ["", "localhost", "::1", "0.0.0.0", "docs.example"]) {
    assert.throws(() => contentTransportConfig({ STACK_CONTENT_HOST: host }), /must bind 127/);
  }
  for (const name of ["STACK_CONTENT_PORT", "STACK_WIKI_PORT", "STACK_CONTENT_ARTIFACT_PORT", "STACK_WIKI_ARTIFACT_PORT"]) {
    for (const value of ["", " ", "not-a-port", "-1", "65536", "1.5"]) {
      assert.throws(() => contentTransportConfig({ [name]: value }), new RegExp(`${name} must be a port`));
    }
  }
  assert.throws(() => contentTransportConfig({ STACK_CONTENT_PORT: "9001", STACK_CONTENT_ARTIFACT_PORT: "9001" }), /ports must differ/);
  assert.throws(() => contentTransportConfig({ STACK_CONTENT_DOCUMENT_ORIGIN: "https://docs.example" }), /configured together/);
  assert.throws(() => contentTransportConfig({ STACK_CONTENT_ARTIFACT_ORIGIN: "https://assets.example" }), /configured together/);
  assert.throws(() => contentTransportConfig({ STACK_CONTENT_DOCUMENT_ORIGIN: "https://same.example", STACK_CONTENT_ARTIFACT_ORIGIN: "https://same.example" }), /origins must differ/);
  for (const value of ["", "not-a-url", "ftp://docs.example", "https://docs.example/", "https://docs.example/path", "https://user@docs.example",
    "https://docs.example?query", "https://docs.example#hash", "https://DOCS.example", "https://docs.example:443", "http://docs.example:0"]) {
    for (const name of ["STACK_CONTENT_DOCUMENT_ORIGIN", "STACK_CONTENT_ARTIFACT_ORIGIN"]) {
      assert.throws(() => contentTransportConfig({ STACK_CONTENT_DOCUMENT_ORIGIN: "https://docs.example", STACK_CONTENT_ARTIFACT_ORIGIN: "https://assets.example", [name]: value }), /HTTP\(S\) origin/);
    }
  }
});
