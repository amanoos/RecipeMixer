# Using your own fonts

RecipeMixer ships with two open fonts that are bundled in the app: **Fredoka** (headings) and **Geist** (text), both under the SIL Open Font Licence. You can swap in other fonts for your own copy without changing any tracked file.

## How it works

`web/src/main.tsx` loads `web/src/local-fonts.css` **if it exists**. That file and the folder `web/src/assets/local-fonts/` are listed in `.gitignore`, so fonts you put there stay on your machine and are never committed. If they are missing (a fresh clone, CI), the app uses Fredoka and Geist and nothing breaks or logs an error.

The font stacks in `web/src/index.css` try your fonts first and fall back to the bundled ones:

| Use | Font family name tried first | Fallback |
|---|---|---|
| Text, buttons, form fields | `Luthon Southard Serif` | Geist |
| Section headings, card titles | `Luthon Southard Serif` | Fredoka |
| Page titles and the logo | `Luthon Southard Script` | Fredoka |

## Setting up Luthon Southard (what this copy of the project uses)

1. Copy `Luthon Southard Serif.ttf` and `Luthon Southard Script.ttf` into `web/src/assets/local-fonts/` as `luthon-southard-serif.ttf` and `luthon-southard-script.ttf`.
2. Create `web/src/local-fonts.css`:
   ```css
   @font-face {
     font-family: 'Luthon Southard Serif';
     src: url('./assets/local-fonts/luthon-southard-serif.ttf') format('truetype');
     font-display: swap;
   }
   @font-face {
     font-family: 'Luthon Southard Script';
     src: url('./assets/local-fonts/luthon-southard-script.ttf') format('truetype');
     font-display: swap;
   }
   ```
3. Rebuild (`docker compose up -d --build`, or `npm run build`). The fonts are served by your own server, so the Content-Security-Policy is unchanged.

## Licence: please read

Luthon Southard (Lemonthe, 2021) is a **demo font for personal use only**. Its README forbids commercial use without written permission, including websites, apps and anything that generates income, and grants no right to redistribute the files. That is why they are **not** in this repository and must never be committed: the project is MIT-licensed and public, and everything in it has to be redistributable.

Using it in your own private copy of RecipeMixer is personal use. If you ever run RecipeMixer as a business or share a build that contains the font files (including a Docker image you publish), you would need a commercial licence from the author first.

## Chinese, Japanese and Korean titles

Neither Luthon Southard nor the bundled fonts contain those characters, so the browser picks another font for them. `--font-cjk` in `web/src/index.css` lists light serif system fonts to prefer (Songti SC, Noto Serif CJK SC, Source Han Serif SC, SimSun, Yu Mincho, Batang) so they sit better beside the script and serif than the browser's heavy default sans. Names that are not installed are skipped, so what you see depends on the fonts on the device: Chinese is covered by SimSun on Windows, while kana and Hangul fall back to a sans font unless a Japanese or Korean serif is installed. No font is downloaded.

To use another font the same way, change the two `@font-face` names and the family names in `web/src/index.css` (`--font-sans`, `--font-heading`, `--font-script`).
