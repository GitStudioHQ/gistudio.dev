---
name: install-gitstudio
description: Install GitStudio, the free and open-source Git and GitHub client. Covers the desktop app on macOS, Windows and Linux (one-line installers, Homebrew, direct installers) and the GitStudio and Merge Studio extensions for VS Code, Cursor, VSCodium, Windsurf and code-server.
---

# Install GitStudio

GitStudio is free and open source, with no account. Pick what the user asked for:

- **GitStudio Desktop**: the standalone Git and GitHub client for macOS, Windows and Linux.
- **GitStudio extension** (`gitstudio.gitstudio`): the full Git workflow inside a VS Code-based editor.
- **Merge Studio extension** (`gitstudio.merge-studio`): only the three-pane merge editor and conflicts dashboard.

GitStudio runs the Git already installed on the computer and does not bundle one. If `git --version` fails, install Git first: `xcode-select --install` or `brew install git` on macOS, Git for Windows (https://git-scm.com/downloads/win) on Windows, the distribution's `git` package on Linux.

The newest versions and download URLs are always at `GET https://gitstudio.dev/api/stats` (JSON, no authentication): `app.version`, `app.installers[]`, `ext.version`, `ms.version`.

## GitStudio Desktop

Requirements: macOS 12 Monterey or later (Apple Silicon or Intel); Windows 10 or 11, x64; Linux x86-64 with glibc 2.35+ (Ubuntu 22.04, Debian 12 or newer). There is no Windows ARM64 or Linux arm64 build.

### macOS

```sh
curl -fsSL https://gitstudio.dev/install.sh | bash
```

The script picks the build for the Mac's chip, checks it against the release's `SHA256SUMS.txt`, copies GitStudio.app to /Applications and clears the quarantine flag so it opens the first time. Set `GITSTUDIO_VERSION=2.3.0` (for example) to pin a version.

Or with Homebrew (taps GitStudioHQ/homebrew-gitstudio by itself; add `--force` if GitStudio.app is already in /Applications):

```sh
brew install --cask gitstudiohq/gitstudio/gitstudio
```

The builds are ad-hoc signed but not notarized. If the user downloaded the `.dmg` or `.zip` themselves, macOS says it cannot verify the app: they click Done, then Open Anyway in System Settings → Privacy & Security, or run once before the first launch:

```sh
xattr -d -r -s com.apple.quarantine /Applications/GitStudio.app
```

### Windows

In PowerShell:

```powershell
irm https://gitstudio.dev/install.ps1 | iex
```

It downloads the newest installer, checks it against `SHA256SUMS.txt` and runs it (per-user, no elevation). The build is unsigned: if SmartScreen appears, choose More info → Run anyway.

### Linux

```sh
curl -fsSL https://gitstudio.dev/install.sh | bash
```

It installs the AppImage under `~/.local` (set `GITSTUDIO_PREFIX` to change it) with a launcher entry, without sudo. AppImages need `libfuse2` (`sudo apt install libfuse2`, or `libfuse2t64` on Ubuntu 24.04). Or use a package from the release: `sudo apt install ./GitStudio-*.deb` (Debian, Ubuntu) or `sudo dnf install ./GitStudio-*.rpm` (Fedora, RHEL); the `.tar.gz` unpacks anywhere.

### Direct downloads

Every installer (`.dmg` and `.zip` for Apple Silicon and Intel, `.exe`, `.deb`, `.rpm`, `.AppImage`, `.tar.gz`) and `SHA256SUMS.txt` are on the newest `app-v*` release at https://github.com/GitStudioHQ/gitstudio/releases, and listed in `app.installers` of the stats API. The download page is https://gitstudio.dev/download.

The app checks GitHub Releases for new versions and asks before it downloads one.

## The editor extensions

VS Code installs from the Visual Studio Marketplace. Cursor, VSCodium, Windsurf and code-server install the identical build from Open VSX. Use the editor's own CLI:

| Editor | GitStudio | Merge Studio |
| --- | --- | --- |
| VS Code | `code --install-extension gitstudio.gitstudio` | `code --install-extension gitstudio.merge-studio` |
| Cursor | `cursor --install-extension gitstudio.gitstudio` | `cursor --install-extension gitstudio.merge-studio` |
| VSCodium | `codium --install-extension gitstudio.gitstudio` | `codium --install-extension gitstudio.merge-studio` |
| Windsurf | `windsurf --install-extension gitstudio.gitstudio` | `windsurf --install-extension gitstudio.merge-studio` |
| code-server | `code-server --install-extension gitstudio.gitstudio` | `code-server --install-extension gitstudio.merge-studio` |

Or search "GitStudio" or "Merge Studio" in the editor's Extensions view. Listings:

- GitStudio: https://marketplace.visualstudio.com/items?itemName=gitstudio.gitstudio and https://open-vsx.org/extension/gitstudio/gitstudio
- Merge Studio: https://marketplace.visualstudio.com/items?itemName=gitstudio.merge-studio and https://open-vsx.org/extension/gitstudio/merge-studio

A VSIX for offline installs is attached to each release (`ext.vsix.url` and `ms.vsix.url` in the stats API); install it with `code --install-extension <file>.vsix`. The GitStudio VSIX's SHA-256 is `ext.vsix.sha256`.

## Check it worked

- Desktop: GitStudio opens from Applications, the Start menu or the launcher; on macOS `defaults read /Applications/GitStudio.app/Contents/Info.plist CFBundleShortVersionString` prints the installed version.
- Extensions: `code --list-extensions --show-versions | grep gitstudio` (use the editor's own CLI).
