# Portfolio Maintenance

`portfolio/works-source.json` is the editable source of truth for works on the
website. Do not edit `portfolio/works.json` or `portfolio/works-data.js`
directly; both are generated for the browser.

## Media Layout

- `assets/audio/` contains public MP3 excerpts encoded at constant `128 kbps`.
- `assets/images/` contains public WebP images, limited to a `1920 px` long
  edge and encoded at quality `80`.
- `/Users/steviesutanto/Documents/PersonalWebsite-source-assets/` is outside
  this repository and holds source-quality media. The first migration retained
  originals in `images/` and `portfolio/works/`; newly imported works are
  archived in `works/<work-slug>/`.

Keep source-quality media in the external archive. The GitHub Pages repository
should contain only optimized site assets.

## Required Tools

The maintenance scripts require:

- Node.js
- `ffmpeg` and `ffprobe`
- `cwebp`

On macOS with Homebrew, these tools are provided by:

```bash
brew install node ffmpeg webp
```

## Add A New Work

From the website project root, run:

```bash
npm run portfolio:add
```

The command asks for the work title, year, instrumentation, category,
description, comma-separated tags, optional primary link, source audio path,
and optional source image path. It then:

1. Rejects duplicate titles/slugs and unreadable source media.
2. Copies source media into the external source archive.
3. Creates an MP3 excerpt in `assets/audio/` at constant `128 kbps`.
4. Creates a WebP image in `assets/images/` when an image is supplied, or uses
   the default site image.
5. Adds an entry to `portfolio/works-source.json`.
6. Regenerates the two browser data files.

The source audio should already be trimmed to the excerpt duration intended for
the public website. The importer encodes it; it does not edit its length.

## Refine A Work

After importing, edit the new entry in `portfolio/works-source.json` as needed:

- `category`, `description`, and `tags` control display metadata and similarity
  connections.
- `primaryLink` can be a full URL or `null`.
- `imageSrc` selects an existing public WebP image.
- `position` controls the constellation location; set it to `null` for an
  automatically selected initial position.
- `audioRadius` and `audioCoreRadius` tune spatial listening behavior.

Regenerate browser data after any metadata edit:

```bash
npm run portfolio:build
```

The build command validates source entries and public assets, preserves chosen
positions, assigns a position to new works, and recalculates similarity links.
Adding a web work no longer requires updating or parsing the CV PDF.

## Preview And Publish

Preview the site over HTTP:

```bash
npx --yes serve .
```

Open the printed local URL and check the work label, image transition, audio
playback, and outbound link. Once confirmed, publish the content update:

```bash
git add portfolio assets
git commit -m "Add <work title>"
git push
```
