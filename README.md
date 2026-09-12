# sicp-pwa

SICP, on your phone, with a REPL. A from-scratch Scheme in Rust/WASM plus a mobile-first reader.

    just setup   # toolchains + deps
    just book    # fetch the CC BY-SA text and build chunks
    just build   # wasm + app
    just dev     # vite dev server
    just test    # rust tests incl. book snapshot cases

See `CLAUDE.md` for the plan and `docs/SPEC.md` for the details.

## The text

The book itself is not in this repository; `just book` fetches it. It is *Structure and
Interpretation of Computer Programs*, second edition, by Abelson, Sussman and Sussman, published
by The MIT Press at <https://mitpress.mit.edu/sicp> and licensed CC BY-SA 4.0. This app reads the
HTML5 edition prepared by Andres Raba, <https://sarabander.github.io/sicp>
(<https://github.com/sarabander/sicp>). The reader opens on a cover that says so, and everything
here derived from the text carries the same licence — see `book/ATTRIBUTION.md`.
