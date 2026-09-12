# Book text attribution

*Structure and Interpretation of Computer Programs*, second edition, by Harold Abelson and
Gerald Jay Sussman with Julie Sussman, © 1996 Massachusetts Institute of Technology, is licensed
by The MIT Press under the Creative Commons Attribution-ShareAlike 4.0 International License
(https://creativecommons.org/licenses/by-sa/4.0/).

This app adapts the HTML5/EPUB edition prepared by Andres Raba (https://github.com/sarabander/sicp),
also CC BY-SA 4.0.

Changes made for this app: text re-chunked by section and exercise; navigation replaced; code
blocks made executable; figures and math re-rendered for small screens.

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
