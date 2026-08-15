#!/usr/bin/env bash
# Tanki omotac zbog navike i postojecih referenci: sva logika je u
# scripts/pokreni-klijenta.mjs, koji radi i na Windowsu (PowerShell: bun scripts/pokreni-klijenta.mjs).
exec bun "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pokreni-klijenta.mjs" "$@"
