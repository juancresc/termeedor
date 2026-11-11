// Splits a shell's raw PTY stream into what the app needs. The shell's hooks (see
// shellIntegration.cjs) print hidden markers carrying a per-session token, so a program
// can't fake one by printing the same bytes unless it knows the token:
//
//   C                the command is starting: output begins
//   T;<hex>          keys typed during the command that it never read, sent just before D
//   D;<exit>;<cwd>   the command finished: output ends
//   A;<PATH>         the shell is ready for input
//
// Everything outside C..D is the shell drawing its prompt and echoing what it was sent, and is
// dropped. The exception is a command the shell rejects before running it (a syntax error):
// no C is sent, so the error has to be recovered from the text between sending and D. Bash reads
// a multi-line command one line at a time, so there the error can also come before a C.

const ESC = "\x1b";
const ALT_SCREEN = /\x1b\[\?(?:1049|1047|47)([hl])/;
const QUERIES = [
  [/\x1b\[6n/g, "\x1b[1;1R"], // cursor position
  [/\x1b\[0?c/g, "\x1b[?1;2c"], // device attributes
  [/\x1b\[5n/g, "\x1b[0n"], // device status
];
const MAX_HELD = 8192; // an unfinished escape sequence longer than this is not one of ours
const EDITOR_DONE = "\x1b[?2004l"; // zsh and bash turn bracketed paste off as they leave their line editor
const STYLING = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** How much of the end of `text` might be the start of a sequence split across chunks. */
function heldTail(text) {
  const start = text.lastIndexOf(ESC);
  if (start === -1) return "";
  const tail = text.slice(start);
  if (tail.length > MAX_HELD) return "";
  if (tail.length === 1) return tail;
  if (tail[1] === "]") return tail.includes("\x07") || tail.includes(`${ESC}\\`) ? "" : tail; // OSC
  if (tail[1] === "[") return /^\x1b\[[0-9;?]*$/.test(tail) ? tail : ""; // CSI
  return "";
}

/**
 * What a shell said after it took a command and before it ran anything. Most shells announce
 * leaving the line editor, which is the end of the echo however it was drawn. With that turned
 * off, the echo ends on the line after the command's last line.
 */
function complaintAfterEcho(text, lastLine) {
  const done = text.lastIndexOf(EDITOR_DONE);
  if (done !== -1) return text.slice(done + EDITOR_DONE.length).replace(/^\r*\n?/, "");
  if (lastLine === null) {
    const newline = text.indexOf("\n");
    return newline === -1 ? "" : text.slice(newline + 1);
  }
  const plain = text.replace(STYLING, "");
  const echoed = plain.lastIndexOf(lastLine);
  const newline = plain.indexOf("\n", echoed === -1 ? 0 : echoed + lastLine.length);
  return echoed === -1 || newline === -1 ? "" : plain.slice(newline + 1);
}

function createShellParser(token) {
  const marker = new RegExp(`\\x1b\\]133;([ACDT]);${token}(?:;([^\\x07]*))?\\x07`);
  let held = "";
  let inOutput = false;
  let inAlt = false;
  let awaitingRejected = false; // a command was sent and hasn't started yet
  let rejected = "";
  let lastLine = null; // a multi-line command's last line; null for a one-line command
  let typeahead = "";

  function answerQueries(text, events) {
    for (const [pattern, reply] of QUERIES) {
      for (const _ of text.matchAll(pattern)) events.push({ type: "reply", data: reply });
    }
  }

  /** Handles text with no markers in it. */
  function plain(text, events) {
    if (!text) return;
    if (!inOutput) {
      answerQueries(text, events);
      if (awaitingRejected) rejected += text;
      return;
    }
    let rest = text;
    const emit = (data) => {
      if (!data) return;
      if (!inAlt) answerQueries(data, events); // in the alternate screen, xterm.js answers
      events.push({ type: "output", data });
    };
    for (let match = rest.match(ALT_SCREEN); match; match = rest.match(ALT_SCREEN)) {
      emit(rest.slice(0, match.index));
      inAlt = match[1] === "h";
      events.push({ type: "alt", on: inAlt });
      rest = rest.slice(match.index + match[0].length);
    }
    emit(rest);
  }

  function reportRejected(events) {
    const error = complaintAfterEcho(rejected, lastLine);
    if (error) events.push({ type: "output", data: error });
  }

  function onMarker(kind, payload, events) {
    if (kind === "T") {
      if (/^(?:[0-9a-f]{2})*$/.test(payload)) typeahead += Buffer.from(payload, "hex").toString("utf8");
    } else if (kind === "C") {
      inOutput = true;
      // Without the announcement this is only the echo. With it, whatever follows was really said.
      if (awaitingRejected && rejected.includes(EDITOR_DONE)) reportRejected(events);
      awaitingRejected = false;
      rejected = "";
      events.push({ type: "start" });
    } else if (kind === "D") {
      if (inAlt) {
        inAlt = false;
        events.push({ type: "alt", on: false });
      }
      if (awaitingRejected) reportRejected(events);
      awaitingRejected = false;
      rejected = "";
      inOutput = false;
      const separator = payload.indexOf(";");
      const finish = { type: "finish", exit: Number.parseInt(payload, 10) || 0, cwd: payload.slice(separator + 1) };
      if (typeahead) finish.typeahead = typeahead;
      typeahead = "";
      events.push(finish);
    } else {
      events.push({ type: "ready", path: payload });
    }
  }

  return {
    /** Call when a command is sent to the shell. */
    commandSent(command = "") {
      awaitingRejected = true;
      rejected = "";
      lastLine = command.includes("\n") ? command.slice(command.lastIndexOf("\n") + 1) : null;
    },
    /** Takes a chunk of PTY output, returns events in order. */
    write(chunk) {
      const events = [];
      let text = held + chunk;
      held = heldTail(text);
      if (held) text = text.slice(0, text.length - held.length);
      for (let match = text.match(marker); match; match = text.match(marker)) {
        plain(text.slice(0, match.index), events);
        onMarker(match[1], match[2] ?? "", events);
        text = text.slice(match.index + match[0].length);
      }
      plain(text, events);
      return events;
    },
  };
}

module.exports = { createShellParser };
