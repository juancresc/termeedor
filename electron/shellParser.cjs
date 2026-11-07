// Splits a shell's raw PTY stream into what the app needs. The shell's hooks (see
// shellIntegration.cjs) print hidden markers carrying a per-session token, so a program
// can't fake one by printing the same bytes unless it knows the token:
//
//   C                the command is starting: output begins
//   D;<exit>;<cwd>   the command finished: output ends
//   A;<PATH>         the shell is ready for input
//
// Everything outside C..D is the shell drawing its prompt and echoing what it was sent, and is
// dropped. The exception is a command the shell rejects before running it (a syntax error):
// no C is sent, so the error has to be recovered from the text between sending and D.

const ESC = "\x1b";
const ALT_SCREEN = /\x1b\[\?(?:1049|1047|47)([hl])/;
const QUERIES = [
  [/\x1b\[6n/g, "\x1b[1;1R"], // cursor position
  [/\x1b\[0?c/g, "\x1b[?1;2c"], // device attributes
  [/\x1b\[5n/g, "\x1b[0n"], // device status
];
const MAX_HELD = 8192; // an unfinished escape sequence longer than this is not one of ours

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

function createShellParser(token) {
  const marker = new RegExp(`\\x1b\\]133;([ACD]);${token}(?:;([^\\x07]*))?\\x07`);
  let held = "";
  let inOutput = false;
  let inAlt = false;
  let awaitingRejected = false; // a command was sent and hasn't started yet
  let rejected = "";

  /** Handles text with no markers in it. */
  function plain(text, events) {
    if (!text) return;
    if (!inAlt) {
      for (const [pattern, reply] of QUERIES) {
        if (text.match(pattern)?.forEach(() => events.push({ type: "reply", data: reply }))) continue;
      }
    }
    if (!inOutput) {
      if (awaitingRejected) rejected += text;
      return;
    }
    let rest = text;
    for (let match = rest.match(ALT_SCREEN); match; match = rest.match(ALT_SCREEN)) {
      const before = rest.slice(0, match.index);
      if (before) events.push({ type: "output", data: before });
      inAlt = match[1] === "h";
      events.push({ type: "alt", on: inAlt });
      rest = rest.slice(match.index + match[0].length);
    }
    if (rest) events.push({ type: "output", data: rest });
  }

  function onMarker(kind, payload, events) {
    if (kind === "C") {
      inOutput = true;
      awaitingRejected = false;
      rejected = "";
      events.push({ type: "start" });
    } else if (kind === "D") {
      if (inAlt) {
        inAlt = false;
        events.push({ type: "alt", on: false });
      }
      if (awaitingRejected) {
        // The first line is the shell echoing the command; what follows is its complaint.
        const newline = rejected.indexOf("\n");
        const error = newline === -1 ? "" : rejected.slice(newline + 1);
        if (error) events.push({ type: "output", data: error });
      }
      awaitingRejected = false;
      rejected = "";
      inOutput = false;
      const separator = payload.indexOf(";");
      events.push({ type: "finish", exit: Number.parseInt(payload, 10) || 0, cwd: payload.slice(separator + 1) });
    } else {
      events.push({ type: "ready", path: payload });
    }
  }

  return {
    /** Call when a command is sent to the shell. */
    commandSent() {
      awaitingRejected = true;
      rejected = "";
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
