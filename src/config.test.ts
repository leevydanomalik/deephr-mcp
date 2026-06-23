import { loadConfig } from "./config";
import { describe, expect, test } from "bun:test";

describe("loadConfig", () => {
  test("returns config when required env present", () => {
    const cfg = loadConfig({
      DEEPHR_EMAIL: "svc@deephealth.id",
      DEEPHR_PASSWORD: "password123",
    });
    expect(cfg.email).toBe("svc@deephealth.id");
    expect(cfg.password).toBe("password123");
    expect(cfg.apiUrl).toBe("http://localhost:4445"); // default
  });

  test("honors DEEPHR_API_URL override", () => {
    const cfg = loadConfig({
      DEEPHR_EMAIL: "a@b.c",
      DEEPHR_PASSWORD: "x",
      DEEPHR_API_URL: "http://host:9000",
    });
    expect(cfg.apiUrl).toBe("http://host:9000");
  });

  test("throws when email missing", () => {
    expect(() => loadConfig({ DEEPHR_PASSWORD: "x" })).toThrow(/DEEPHR_EMAIL/);
  });

  test("throws when password missing", () => {
    expect(() => loadConfig({ DEEPHR_EMAIL: "a@b.c" })).toThrow(/DEEPHR_PASSWORD/);
  });
});
