# Brand assets

The mark is three bars at descending lengths with the shortest in green: three
prices for one product, and the one worth taking. It encodes what the extension
does rather than decorating it, and it survives being 16 pixels wide.

| File | Use |
|---|---|
| `icon.svg` | Source for 48px and above |
| `icon-small.svg` | Source for 32px and below — two thicker bars, tighter padding, because three bars turn to mush at that size |
| `promo-440x280.png` | Chrome Web Store small promotional tile |
| `render.sh` | Renders an SVG to PNG at a given size using headless Chrome |
| `screenshots/` | Store screenshots, generated from the shipped panel |

Regenerate the extension icons after editing a source:

```bash
./brand/render.sh brand/icon-small.svg 16  public/icons/icon-16.png
./brand/render.sh brand/icon-small.svg 32  public/icons/icon-32.png
./brand/render.sh brand/icon.svg       48  public/icons/icon-48.png
./brand/render.sh brand/icon.svg      128  public/icons/icon-128.png
npm run build
```

Colours match the extension UI: ink `#101614`, muted `#64736D`, accent
`#4ADE80` on dark and `#0B6B3A` on light.

## Store screenshots

```bash
./brand/screenshots/shoot.sh          # light (what the store listing uses)
./brand/screenshots/shoot.sh --dark   # dark-mode set, into out-dark/
```

Writes `screenshots/out/<scene>.png` at exactly 1280x800, the size the Chrome
Web Store wants.

These are rendered, not captured. `screenshots/harness.html` imports the real
`src/content/modal.js` and the real `public/styles.css`, and each scene in
`screenshots/scenes.js` is a response shape the Worker actually returns, with
the headline chosen by the shipped `chooseHeadline`. Nothing in a screenshot
can claim behaviour the extension does not have, and a change to the panel
shows up in the next run rather than leaving the listing quietly stale.

Two details worth knowing before editing:

- **Light is forced.** The panel honours `prefers-color-scheme` and headless
  Chrome reports dark, which renders a dark card on a dark scrim and loses the
  subject. `shoot.sh` pins `preferredColorScheme=1`.
- **Scaling is done with a device pixel ratio**, not a CSS transform. The
  harness lays out at 1000x625 and renders at 1.28x. A `transform: scale` on
  the card promotes it to its own compositing layer and leaves an artifact
  along the bottom edge of the frame.

To composite a scene over a real retailer page, drop a 1000px-wide capture at
`screenshots/backdrops/<scene-id>.png`; that scene picks it up automatically on
the next run. Scenes without one render on the brand backdrop.
