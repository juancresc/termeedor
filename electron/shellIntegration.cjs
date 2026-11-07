// Starts the user's own shell, with their rc files, plus hooks that report when a command
// starts and finishes and where it ended up. Supports zsh and bash; anything else falls back.

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Hooks run after the user's rc files, so they still work whatever those files set up.
const ZSH_HOOKS = `
typeset -g _tm_token="$TERMEEDOR_TOKEN"
ZDOTDIR="$_tm_user_zdotdir"
unset TERMEEDOR_TOKEN TERMEEDOR_ZDOTDIR TERMEEDOR_USER_ZDOTDIR _tm_user_zdotdir
_tm_precmd() {
  local code=$?
  printf '\\e]133;D;%s;%s;%s\\a\\e]133;A;%s;%s\\a' "$_tm_token" "$code" "$PWD" "$_tm_token" "$PATH"
}
_tm_preexec() { printf '\\e]133;C;%s\\a' "$_tm_token"; }
precmd_functions=(_tm_precmd $precmd_functions)
preexec_functions+=(_tm_preexec)
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
_tm_precmd() {
  local code=$?
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

module.exports = { chooseShell, removeIntegrationFiles, shellLaunch };
