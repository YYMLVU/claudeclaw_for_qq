import { describe, expect, test } from "bun:test";
import { homedir } from "os";
import { resolveTaskWorkDir } from "./runner";

describe("resolveTaskWorkDir", () => {
  test("returns explicit task cwd when provided", () => {
    expect(resolveTaskWorkDir("/home/xiao/claudeclaw_for_qq")).toBe("/home/xiao/claudeclaw_for_qq");
  });

  test("falls back to home directory when no task cwd is provided", () => {
    expect(resolveTaskWorkDir()).toBe(homedir());
  });

  test("falls back to home directory when task cwd is outside home", () => {
    expect(resolveTaskWorkDir("/etc")).toBe(homedir());
  });

  test("falls back to home directory when task cwd is blank", () => {
    expect(resolveTaskWorkDir("   ")).toBe(homedir());
  });
});
