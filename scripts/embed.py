#!/usr/bin/env python3
"""Reference embedding worker for Agency OS Intelligence (docs/08).

Embeds texts with bge-small-en-v1.5 (384-dim) locally — client data never
leaves the box. Input/output are JSON files:
    in:  {"texts": ["..."]}
    out: {"embeddings": [[...384 floats...]]}

Deps (installed in Dockerfile.worker):
    pip install sentence-transformers
"""
import argparse
import json


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    with open(args.input) as f:
        texts = json.load(f)["texts"]

    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer("BAAI/bge-small-en-v1.5")
    embeddings = model.encode(texts, normalize_embeddings=True).tolist()

    with open(args.output, "w") as f:
        json.dump({"embeddings": embeddings}, f)


if __name__ == "__main__":
    main()
