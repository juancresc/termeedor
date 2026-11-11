// Starts the user's own shell, with their rc files, plus hooks that report when a command
// starts and finishes and where it ended up. Supports zsh and bash; anything else falls back.

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Hooks run after the user's rc files, so they still work whatever those files set up.
// Keys typed while a command ran that it never read would otherwise wait in the terminal and
// join the front of the next command; before saying it finished, the shell hands them back (T).
// Each shell reads them its own way into $typed; they go as hex, which no marker can be made of.
const REPORT_TYPEAHEAD = `[[ -n $typed ]] && printf '\\e]133;T;%s;%s\\a' "$_tm_token" "$(printf %s "$typed" | od -An -tx1 | tr -d ' \\n')"`;
const ZSH_HOOKS = `
typeset -g _tm_token="$TERMEEDOR_TOKEN"
ZDOTDIR="$_tm_user_zdotdir"
unset TERMEEDOR_TOKEN TERMEEDOR_ZDOTDIR TERMEEDOR_USER_ZDOTDIR _tm_user_zdotdir
_tm_typeahead() {
  local key typed=
  while read -r -s -t 0 -k 1 key 2>/dev/null; do typed+=$key; done
  ${REPORT_TYPEAHEAD}
}
_tm_precmd() {
  local code=$?
  _tm_typeahead
  printf '\\e]133;D;%s;%s;%s\\a\\e]133;A;%s;%s\\a' "$_tm_token" "$code" "$PWD" "$_tm_token" "$PATH"
}
_tm_preexec() { printf '\\e]133;C;%s\\a' "$_tm_token"; }
precmd_functions=(_tm_precmd $precmd_functions)
preexec_functions+=(_tm_preexec)
unsetopt PROMPT_SP PROMPT_CR # these draw before the finish marker, so they would land in the output
`;

// Each startup file runs the user's file of the same name, keeping ZDOTDIR pointed here
// so that zsh goes on to read the next one from this folder.
const zshStartupFile = (name, after = "") => `_tm_user_zdotdir="\${_tm_user_zdotdir:-\${TERMEEDOR_USER_ZDOTDIR:-$HOME}}"
ZDOTDIR="$_tm_user_zdotdir"
[[ -r "$ZDOTDIR/${name}" ]] && . "$ZDOTDIR/${name}"
_tm_user_zdotdir="$ZDOTDIR"
ZDOTDIR="$TERMEEDOR_ZDOTDIR"
${after}`;

const BASH_RC = `
if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r ~/.bash_profile ]; then . ~/.bash_profile
elif [ -r ~/.bash_login ]; then . ~/.bash_login
elif [ -r ~/.profile ]; then . ~/.profile
elif [ -r ~/.bashrc ]; then . ~/.bashrc
fi
_tm_token="$TERMEEDOR_TOKEN"
unset TERMEEDOR_TOKEN
_tm_typeahead() {
  local key typed=
  while IFS= read -r -s -N 1 -t 0.001 key 2>/dev/null; do typed+=$key; done
  ${REPORT_TYPEAHEAD}
}
_tm_precmd() {
  local code=$?
  _tm_typeahead
  printf '\\e]133;D;%s;%s;%s\\a\\e]133;A;%s;%s\\a' "$_tm_token" "$code" "$PWD" "$_tm_token" "$PATH"
}
PROMPT_COMMAND="_tm_precmd\${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
PS0=$'\\e]133;C;'"$_tm_token"$'\\a'
`;

let integrationDir = null;

/** Hook files go in a private temp folder, written once per app run. */
function ensureIntegrationFiles() {
  if (integrationDir) return integrationDir;
  integrationDir = fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-shell-"));
  const write = (name, content) => fs.writeFileSync(path.join(integrationDir, name), content, { mode: 0o600 });
  write(".zshenv", zshStartupFile(".zshenv"));
  write(".zprofile", zshStartupFile(".zprofile"));
  write(".zshrc", zshStartupFile(".zshrc"));
  write(".zlogin", zshStartupFile(".zlogin", ZSH_HOOKS));
  write("bashrc", BASH_RC);
  return integrationDir;
}

function removeIntegrationFiles() {
  if (integrationDir) fs.rmSync(integrationDir, { recursive: true, force: true });
  integrationDir = null;
}

/** PS0, which marks a command starting, needs bash 4.4. macOS ships 3.2. */
function bashIsSupported(file) {
  const { stdout } = spawnSync(file, ["-c", "echo ${BASH_VERSINFO[0]} ${BASH_VERSINFO[1]}"], { encoding: "utf8", timeout: 3000 });
  const [major, minor] = (stdout ?? "").trim().split(" ").map(Number);
  return major > 4 || (major === 4 && minor >= 4);
}

/** The shell to use: the given one if it is supported, otherwise zsh, then bash. */
function chooseShell(preferred = process.env.SHELL) {
  const usable = (file) => {
    if (!file || !path.isAbsolute(file) || !fs.existsSync(file)) return false;
    const name = path.basename(file);
    return name === "zsh" || (name === "bash" && bashIsSupported(file));
  };
  return [preferred, "/bin/zsh", "/usr/bin/zsh", "/bin/bash", "/usr/bin/bash"].find(usable) ?? null;
}

/** The hidden completion shell's startup files, in their own folder: it gets none of the command hooks. */
function ensureCompletionFiles() {
  const dir = path.join(ensureIntegrationFiles(), "completion");
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(dir, { mode: 0o700 });
  const write = (name, content) => fs.writeFileSync(path.join(dir, name), content, { mode: 0o600 });
  write(".zshenv", zshStartupFile(".zshenv"));
  write(".zprofile", zshStartupFile(".zprofile"));
  write(".zshrc", zshStartupFile(".zshrc"));
  write(".zlogin", zshStartupFile(".zlogin", '. "$TERMEEDOR_ZDOTDIR/hooks.zsh"\n'));
  write("hooks.zsh", fs.readFileSync(path.join(__dirname, "zshCompletion.zsh"), "utf8"));
  return dir;
}

/** The same shell as a tab's, with the same startup files, reporting to a socket instead of a terminal. */
function completionLaunch(shell, baseEnv, socketPath) {
  const dir = ensureCompletionFiles();
  const { file, args, env } = shellLaunch(shell, baseEnv);
  delete env.TERMEEDOR_TOKEN;
  Object.assign(env, {
    TERMEEDOR_ZDOTDIR: dir,
    ZDOTDIR: dir,
    TERMEEDOR_COMPLETE_SOCKET: socketPath,
    TERMEEDOR_COMPLETER: "1", // so that a startup file can skip what makes no sense here
    GIT_OPTIONAL_LOCKS: "0",
    DISABLE_AUTO_UPDATE: "true", // Oh My Zsh would ask, and no one could answer
  });
  return { file, args, env };
}

/** Short and private: a socket's path has a low length limit. */
const completionSocketPath = () => path.join(ensureIntegrationFiles(), `c${crypto.randomBytes(4).toString("hex")}`);

/** Everything needed to start a shell: { file, args, env, token }. */
function shellLaunch(shell, baseEnv = process.env) {
  const dir = ensureIntegrationFiles();
  const token = crypto.randomBytes(16).toString("hex");
  const env = { ...baseEnv };
  for (const name of Object.keys(env)) if (name.startsWith("ELECTRON_")) delete env[name];

  Object.assign(env, {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "Termeedor",
    TERMEEDOR_TOKEN: token,
    // The output area already scrolls. A pager would just get in the way.
    PAGER: "cat",
    GIT_PAGER: "cat",
    LANG: baseEnv.LANG || "en_US.UTF-8", // apps opened from the Finder don't get one
  });

  if (path.basename(shell) === "zsh") {
    if (baseEnv.ZDOTDIR) env.TERMEEDOR_USER_ZDOTDIR = baseEnv.ZDOTDIR;
    env.TERMEEDOR_ZDOTDIR = dir;
    env.ZDOTDIR = dir;
    return { file: shell, args: ["-il"], env, token };
  }
  return { file: shell, args: ["--rcfile", path.join(dir, "bashrc"), "-i"], env, token };
}

module.exports = { chooseShell, completionLaunch, completionSocketPath, removeIntegrationFiles, shellLaunch };
