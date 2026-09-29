# GitStudio stats API

`GET https://gitstudio.dev/api/stats` returns the current facts about GitStudio as JSON: the newest versions of GitStudio Desktop, the GitStudio extension and Merge Studio, their install and download counts, and the URLs of the newest installers and VSIX files. The gitstudio.dev pages read it to keep their numbers current between deploys.

- **Public and read-only.** No authentication, no API key, no parameters. `GET` and `HEAD` only; any other method returns `405` with `Allow: GET, HEAD`.
- **CORS:** `Access-Control-Allow-Origin: *`, so a browser page on any origin can read it.
- **Caching:** the CDN keeps an answer for 15 minutes (2 minutes when a source was unreachable) and serves the last one for up to a day while it refreshes. Please do not poll it more often than that.
- **Sources:** GitHub Releases, Open VSX and the Visual Studio Marketplace. It never fails because a source is down: those values fall back to hand-checked numbers, the source is `false` under `live`, and the affected keys are listed in `stale`. A fallback count in `text` ends in `+`.
- **Machine-readable description:** [OpenAPI 3.1](https://gitstudio.dev/openapi.json), listed in the [API catalog](https://gitstudio.dev/.well-known/api-catalog).

## Example

```sh
curl -s https://gitstudio.dev/api/stats
```

```json
{
  "fetchedAt": "2026-09-29T22:24:31.529Z",
  "live": { "github": true, "mergeStudioGithub": true, "openVsx": true, "marketplace": true, "manifest": true },
  "ext": {
    "version": "1.16.0",
    "marketplaceInstalls": 548,
    "openVsxDownloads": 8792,
    "rating": 5,
    "ratingCount": 2,
    "commands": 137,
    "minVsCode": "1.78",
    "vsix": {
      "url": "https://github.com/GitStudioHQ/gitstudio/releases/download/ext-v1.16.0/gitstudio.vsix",
      "file": "gitstudio.vsix",
      "sizeMb": "3.1",
      "sha256": "e394b79f86bdfacb0457fa7c6cee274523c92d38dd8fb4714c304b2320d1f80f",
      "tag": "ext-v1.16.0"
    }
  },
  "ms": {
    "version": "1.1.0",
    "marketplaceInstalls": 584,
    "openVsxDownloads": 2830,
    "rating": 5,
    "ratingCount": 3,
    "commands": 13,
    "minVsCode": "1.82",
    "vsix": {
      "url": "https://github.com/GitStudioHQ/merge-studio/releases/download/v1.1.0/merge-studio.vsix",
      "sizeMb": "3.2",
      "tag": "v1.1.0"
    }
  },
  "app": {
    "version": "2.3.0",
    "minor": "2.3",
    "tag": "app-v2.3.0",
    "releaseUrl": "https://github.com/GitStudioHQ/gitstudio/releases/tag/app-v2.3.0",
    "sumsUrl": "https://github.com/GitStudioHQ/gitstudio/releases/download/app-v2.3.0/SHA256SUMS.txt",
    "downloads": 495,
    "installers": [
      {
        "os": "macOS",
        "arch": "Apple Silicon",
        "format": ".dmg",
        "key": "arm64.dmg",
        "url": "https://github.com/GitStudioHQ/gitstudio/releases/download/app-v2.3.0/GitStudio-2.3.0-arm64.dmg"
      }
    ]
  },
  "text": { "ext.version": "1.16.0", "ext.installs": "548", "app.downloads": "495" },
  "href": { "ext.vsix": "https://github.com/GitStudioHQ/gitstudio/releases/download/ext-v1.16.0/gitstudio.vsix" },
  "stale": []
}
```

The example is shortened: `app.installers` lists every installer (macOS `.dmg` and `.zip` for Apple Silicon and Intel, the Windows `.exe`, and the Linux `.deb`, `.rpm`, `.AppImage` and `.tar.gz`), and `text` and `href` carry every key.

## Fields

| Field | Meaning |
| --- | --- |
| `fetchedAt` | When the sources were read (ISO 8601). |
| `live` | Which sources answered. |
| `ext` | The GitStudio extension (`gitstudio.gitstudio`): version, Marketplace installs, Open VSX downloads, rating, command count, lowest supported VS Code, and the VSIX with its SHA-256. |
| `ms` | Merge Studio (`gitstudio.merge-studio`): the same, without the VSIX checksum. |
| `app` | GitStudio Desktop: version, release tag and page, `SHA256SUMS.txt`, installer downloads summed over every release, and one entry per installer. |
| `text` | The same facts formatted for display, keyed like `ext.version`. |
| `href` | Download links keyed like `ext.vsix`, `app.sums` or `app.asset.arm64.dmg`. |
| `stale` | Keys of `text` and `href` whose value is a fallback. |

Open VSX counts every VSIX download, updates included, so its number is "downloads"; the Marketplace number is "installs".
