# Book text attribution

*Structure and Interpretation of Computer Programs*, second edition, by Harold Abelson and
Gerald Jay Sussman with Julie Sussman, © 1996 Massachusetts Institute of Technology, is licensed
by The MIT Press under the Creative Commons Attribution-ShareAlike 4.0 International License
(https://creativecommons.org/licenses/by-sa/4.0/).

## Where the text comes from

| | |
|---|---|
| The book, published by The MIT Press | https://mitpress.mit.edu/sicp |
| The HTML5/EPUB edition this app is built from, by Andres Raba | https://sarabander.github.io/sicp |
| …and its source | https://github.com/sarabander/sicp |
| The licence both carry | https://creativecommons.org/licenses/by-sa/4.0/ |

Those links are not filed away in this repository only: the reader opens on a cover that names
them, `book/scripts/build_chunks.mjs` keeps them in one `SOURCE` constant, and `just book` writes
them into `app/public/book/toc.json` so anything else in the app can cite the source too.

Changes made for this app: text re-chunked by section and exercise; navigation replaced; code
blocks made executable; figures and math re-rendered for small screens; a cover generated as the
first chunk from the edition's own cover plate and title page.

## Cover

The cover plate is Agostino Ramelli's bookwheel of 1588, taken from this edition's cover page
(`html/fig/bookwheel.jpg`). Per the edition's colophon, that scan of the engraving is hosted by
J. E. Johnson of New Gottland (http://newgottland.com/2012/02/09/before-the-ereader-there-was-the-wheelreader/).

## Fonts

The app ships the webfonts of that edition so the reader is set in the same faces offline
(`app/public/book/fonts/`, copied by `just book`):

- Linux Libertine O and Linux Biolinum O — GPL with the font exception, and OFL 1.1
  (Philipp H. Poll, http://www.linuxlibertine.org).
- Inconsolata LGC — OFL 1.1 (Raph Levien; LGC extension by Mikhail Bayandin).
- DejaVu Sans Mono — Bitstream Vera / DejaVu licence.
- STIX — OFL 1.1 (STI Pub Companies), used for the MathML.

The licence texts travel with the fonts in that directory.

All adapted text, generated chunks, and code examples extracted from the book are distributed
under CC BY-SA 4.0. The app's own source code is separately licensed (see /LICENSE).

The in-app "About" screen must show this notice and link to both licenses.
