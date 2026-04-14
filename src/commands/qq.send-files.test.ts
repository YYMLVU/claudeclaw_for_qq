import { describe, expect, test } from "bun:test";
import { homedir } from "os";
import { buildPrompt, extractDeclaredSendFiles, isAllowedSendFilePath, stripDeclaredSendFilesBlock } from "./qq";

const home = homedir();

describe("extractDeclaredSendFiles", () => {
  test("returns absolute file paths from qq-send-files block", () => {
    const result = extractDeclaredSendFiles(`done\n<qq-send-files>\n${home}/tmp/a.pdf\n${home}/work/b.txt\n</qq-send-files>`);
    expect(result).toEqual([`${home}/tmp/a.pdf`, `${home}/work/b.txt`]);
  });

  test("returns empty array when block is missing", () => {
    expect(extractDeclaredSendFiles("done")).toEqual([]);
  });

  test("ignores blank lines and trims whitespace", () => {
    const result = extractDeclaredSendFiles(`\n<qq-send-files>\n  ${home}/tmp/a.pdf  \n\n ${home}/tmp/b.txt \n</qq-send-files>\n`);
    expect(result).toEqual([`${home}/tmp/a.pdf`, `${home}/tmp/b.txt`]);
  });
});

describe("isAllowedSendFilePath", () => {
  test("allows files under home directory", () => {
    expect(isAllowedSendFilePath(`${home}/tmp/a.pdf`)).toBe(true);
  });

  test("rejects files outside home directory", () => {
    expect(isAllowedSendFilePath("/etc/passwd")).toBe(false);
  });
});

describe("buildPrompt", () => {
  test("instructs Claude to emit qq-send-files block with absolute paths", () => {
    const prompt = buildPrompt("user:test", "send me the report");
    expect(prompt).toContain("If you want QQ to send files, write the real file to disk first.");
    expect(prompt).toContain("Then append a <qq-send-files> block to your final response.");
    expect(prompt).toContain("Inside that block, put one absolute file path per line.");
    expect(prompt).toContain("Only list files that already exist under ~/.");
  });
});

describe("stripDeclaredSendFilesBlock", () => {
  test("removes qq-send-files block from displayed text", () => {
    const text = `Summary here\n<qq-send-files>\n${home}/tmp/report.pdf\n</qq-send-files>`;
    expect(stripDeclaredSendFilesBlock(text)).toBe("Summary here");
  });

  test("leaves plain text unchanged", () => {
    expect(stripDeclaredSendFilesBlock("Summary here")).toBe("Summary here");
  });
});
