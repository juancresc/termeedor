cask "termeedor" do
  arch arm: "arm64", intel: "x64"

  version :latest
  sha256 :no_check

  url "https://github.com/juancresc/termeedor/releases/latest/download/termeedor-mac-#{arch}.dmg"
  name "Termeedor"
  desc "Terminal with tab groups and plugins"
  homepage "https://github.com/juancresc/termeedor"

  depends_on :macos

  app "Termeedor.app"

  # The app isn't notarized yet, so macOS would otherwise refuse to open it.
  postflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/Termeedor.app"]
  end

  zap trash: [
    "~/.termeedor",
    "~/Library/Application Support/Termeedor",
    "~/Library/Preferences/com.termeedor.app.plist",
    "~/Library/Saved Application State/com.termeedor.app.savedState",
  ]
end
