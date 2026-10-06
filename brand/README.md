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
