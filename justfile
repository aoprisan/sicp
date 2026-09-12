set shell := ["bash", "-uc"]

default:
    @just --list

setup:
    rustup target add wasm32-unknown-unknown
    cargo install wasm-pack --locked || true
    cd app && npm install

check:
    cd scheme && cargo check --all-targets

test:
    cd scheme && cargo test

# Run a .scm file through the native CLI runner
run file:
    cd scheme && cargo run --quiet --bin sicp-scheme -- ../{{file}}

wasm:
    cd scheme && wasm-pack build --target web --release --out-dir ../app/src/wasm --features wasm

book:
    bash book/scripts/fetch.sh
    node book/scripts/build_chunks.mjs

build: wasm
    cd app && npm run build

dev:
    cd app && npm run dev -- --host

deploy: build
    @echo "handled by .github/workflows/pages.yml on push to main"
