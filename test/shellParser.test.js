import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { createShellParser } = createRequire(import.meta.url)("../electron/shellParser.cjs");

const TOKEN = "abc123";
const C = `\x1b]133;C;${TOKEN}\x07`;
const D = (exit, cwd) => `\x1b]133;D;${TOKEN};${exit};${cwd}\x07`;
const A = `\x1b]133;A;${TOKEN};/usr/bin\x07`;

function feed(parser, ...chunks) {
  return chunks.flatMap((chunk) => parser.write(chunk));
}
const output = (events) => events.filter((e) => e.type === "output").map((e) => e.data).join("");

test("only text between start and finish is output; the prompt and echo are dropped", () => {
  const parser = createShellParser(TOKEN);
  const events = feed(parser, `motd\r\n${D(0, "/home")}${A}❯ prompt`, `ls\r\n${C}a.txt\r\n${D(0, "/home")}${A}❯ prompt`);
  assert.equal(output(events), "a.txt\r\n");
  assert.deepEqual(events.filter((e) => e.type === "ready").map((e) => e.path), ["/usr/bin", "/usr/bin"]);
});

test("finish reports the exit code and a cwd that may contain semicolons", () => {
  const parser = createShellParser(TOKEN);
  const finish = feed(parser, `${C}${D(3, "/tmp/a;b")}`).find((e) => e.type === "finish");
  assert.equal(finish.exit, 3);
  assert.equal(finish.cwd, "/tmp/a;b");
});

test("a marker split across chunks is still recognized", () => {
  const parser = createShellParser(TOKEN);
  const whole = `${C}hello${D(0, "/x")}${A}`;
  const events = [...whole].flatMap((char) => parser.write(char));
  assert.equal(output(events), "hello");
  assert.ok(events.some((e) => e.type === "finish"));
  assert.ok(events.some((e) => e.type === "ready"));
});

test("a program can't fake a marker without the token", () => {
  const parser = createShellParser(TOKEN);
  const fake = "\x1b]133;D;wrong;0;/evil\x07";
  const events = feed(parser, `${C}before${fake}after`);
  assert.ok(!events.some((e) => e.type === "finish"));
  assert.equal(output(events), `before${fake}after`);
});

test("entering and leaving the alternate screen is reported in order", () => {
  const parser = createShellParser(TOKEN);
  const events = feed(parser, `${C}pre\x1b[?1049hfull\x1b[?1049lpost${D(0, "/x")}`);
  assert.deepEqual(events.filter((e) => e.type !== "start" && e.type !== "finish").map((e) => e.type === "alt" ? e.on : e.data), ["pre", true, "full", false, "post"]);
});

test("a program that dies in the alternate screen still leaves it", () => {
  const parser = createShellParser(TOKEN);
  const events = feed(parser, `${C}\x1b[?1049hfull${D(137, "/x")}`);
  assert.deepEqual(events.filter((e) => e.type === "alt").map((e) => e.on), [true, false]);
});

test("a command the shell rejects before running still shows its error", () => {
  const parser = createShellParser(TOKEN);
  parser.commandSent();
  const events = feed(parser, `oops )\r\nzsh: parse error near ')'\r\n${D(1, "/x")}${A}`);
  assert.equal(output(events), "zsh: parse error near ')'\r\n");
});

test("the echo of a normal command doesn't count as a rejection", () => {
  const parser = createShellParser(TOKEN);
  parser.commandSent();
  const events = feed(parser, `ls\r\n${C}file\r\n${D(0, "/x")}`);
  assert.equal(output(events), "file\r\n");
});

test("terminal queries get replies outside the alternate screen, even while drawing the prompt", () => {
  const parser = createShellParser(TOKEN);
  assert.deepEqual(feed(parser, "\x1b[6n").filter((e) => e.type === "reply").map((e) => e.data), ["\x1b[1;1R"]);
  const inAlt = feed(parser, `${C}\x1b[?1049h\x1b[6n`);
  assert.ok(!inAlt.some((e) => e.type === "reply")); // xterm.js answers these
});
