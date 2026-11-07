# Termeedor

A desktop terminal with tab groups, closed-tab history, themes and plugins, for macOS and Linux. Built with Electron.

> **Early prototype.** Expect rough edges. Windows build settings exist, but Windows isn't released or supported yet.

## Shell

On macOS and Linux, each tab runs your own zsh or bash (4.4 or newer) with your usual startup files. If your default is another shell, such as fish, Termeedor falls back to zsh or bash.

On Windows, commands show a "no supported shell" message. The browser version (`docker compose up`) only simulates commands.

## Install

### Script (macOS and Linux)

```sh
curl -fsSL https://raw.githubusercontent.com/juancresc/termeedor/master/scripts/install.sh | bash
```

| System | What it installs | Where |
| --- | --- | --- |
| macOS | `.app` | `/Applications`, or `~/Applications` if that isn't writable |
| Debian, Ubuntu | `.deb`, using `sudo apt-get` | `/opt/Termeedor`, run with `termeedor` |
| Other Linux | AppImage | `~/.local/bin/termeedor` |

### Homebrew (macOS)

This repo is also its own Homebrew tap:

```sh
brew tap juancresc/termeedor https://github.com/juancresc/termeedor
brew install --cask termeedor
```

To update:

```sh
brew upgrade --cask --greedy termeedor
```

The cask always points at the latest release, so `brew upgrade` skips it without `--greedy`.

### Manual download

Download a file from [Releases](https://github.com/juancresc/termeedor/releases/latest):

| System | Apple Silicon / ARM | Intel / x64 |
| --- | --- | --- |
| macOS | `termeedor-mac-arm64.dmg` | `termeedor-mac-x64.dmg` |
| Debian, Ubuntu | `termeedor-linux-arm64.deb` | `termeedor-linux-amd64.deb` |
| Other Linux | `termeedor-linux-arm64.AppImage` | `termeedor-linux-x86_64.AppImage` |

### From source

You need the tools listed under [Development](#development). Clone this repo and build the installers for your system:

```sh
git clone https://github.com/juancresc/termeedor.git
cd termeedor
npm install
npm run dist
```

Then open or install the matching file from `dist/`, using the names in the table above. To run the app without installing it, use `npm start` instead of `npm run dist`.

## Good to know

**macOS: the app isn't notarized yet.** It has only an ad-hoc signature. The script and Homebrew installs skip the Gatekeeper warning; Homebrew does this by removing the quarantine flag. If you download the `.dmg` yourself and macOS blocks it, run:

```sh
xattr -dr com.apple.quarantine /Applications/Termeedor.app
```

Only do this if you trust the download.

**Linux AppImage**

- It needs FUSE 2 (`libfuse2` or `fuse-libs`).
- The ARM64 AppImage also looks for `libz.so`, which usually comes from your distro's zlib development package. Use the `.deb` if you can.

## Your data

Settings, open tabs, closed tabs and plugins live in `~/.termeedor`. Saved tabs include their scrollback, which can contain anything a command printed, so the folder is only readable by your user. Set `TERMEEDOR_DATA_DIR` to keep settings and tabs somewhere else.

## Uninstall

The commands below leave `~/.termeedor` in place, except `--zap`. To delete it yourself, run `rm -rf ~/.termeedor`.

```sh
# Homebrew (--zap also deletes your settings, saved tabs and plugins)
brew uninstall --cask --zap termeedor

# Debian, Ubuntu
sudo apt-get remove termeedor

# AppImage
rm ~/.local/bin/termeedor ~/.local/share/applications/termeedor.desktop

# macOS, if installed with the script
rm -rf /Applications/Termeedor.app
```

## Plugins

Put plugins in `~/.termeedor/plugins`. See [docs/plugins.md](docs/plugins.md) for how to write one.

Plugins can run code on your computer, so only install ones you trust.

## Development

You need Node.js 22 or newer. `node-pty` is a native module, and on Linux it's compiled during `npm install`, so you need Python and a C/C++ compiler (`build-essential` on Debian and Ubuntu). On macOS, it may need Xcode Command Line Tools if no prebuilt version fits.

```sh
npm install
npm start          # run the app
npm test           # run the tests
npm run dist       # build installers for this system into dist/
```

## Releasing

Push a version tag:

```sh
npm version patch
git push --follow-tags
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) then builds every installer and publishes a GitHub Release. File names don't include the version, so the install script and the Homebrew cask always get the latest release.
