"""Razdvajanje PIK/OLX shopova po kantonima, sa oglasima i bez oglasa.

Ulaz je snimak shopova (xlsx sa listom "SVI - zbirno").
Izlaz je novi xlsx: po jedan list za svaki kanton, unutar lista prvo shopovi sa
oglasima pa prazni, a u svakom bloku Platinum prije Golda.

Originalni fajl se samo cita, nikad ne mijenja.

Upotreba:
    python3 razdvoji.py <snimak.xlsx> [izlaz.xlsx]

Bez zadatog izlaza pravi <folder snimka>/shopovi-razdvojeno-<datum iz imena>.xlsx
"""
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

MASTER = "SVI - zbirno"

KOL = {
    "shop": "Shop (username)",
    "naziv": "Puni naziv / Firma",
    "paket": "PIK paket",
    "grad": "Grad / Opština",
    "kanton": "Kanton / Regija",
    "entitet": "Entitet",
    "oglasi": "Broj oglasa",
    "web": "Web stranica",
    "partner": "OLX partner",
    "reg": "Registrovan",
    "link": "Link",
}

# Redoslijed paketa pri sortiranju. Sve izvan ovoga ide na kraj bloka.
PAKET_RANG = {"Platinum": 0, "Gold": 1, "Silver": 2, "Bronze": 3}

RE_FIRMA_DOSLOVNO = re.compile(r"d\.o\.o\.?|s\.p\.?|d\.d\.?", re.IGNORECASE)
# Kratke oznake se traze kao samostalne rijeci, da "sp" ne pokupi Sport/Spektar.
RE_FIRMA_RIJEC = re.compile(r"(?<![\wčćžšđ])(doo|sp|dd|obrt)(?![\wčćžšđ])", re.IGNORECASE)
RE_DOMEN = re.compile(r"\.[A-Za-z]{2,}(?![A-Za-z])")
SMECE_PODNIZ = ("test", "qwerty", "asdf", "PUNI NAZIV", "Nezanam")
SMECE_TACNO = {"olx", "olx.ba", "pik.ba", "sve", "prodaja", "razno"}
NEDOZVOLJENO_U_IMENU = re.compile(r"[:\\/?*\[\]]")


def datum_iz_imena(putanja: Path) -> str:
    m = re.search(r"(\d{4}-\d{2}-\d{2})", putanja.name)
    return m.group(1) if m else date.today().isoformat()


def velicina(n: int) -> str:
    if n == 0:
        return "nula"
    if n <= 9:
        return "mali"
    if n <= 99:
        return "srednji"
    if n <= 999:
        return "veliki"
    return "vrlo veliki"


def je_firma(naziv, web) -> bool:
    n = "" if pd.isna(naziv) else str(naziv)
    if RE_FIRMA_DOSLOVNO.search(n) or RE_FIRMA_RIJEC.search(n):
        return True
    w = "" if pd.isna(web) else str(web).strip()
    return bool(w) and bool(RE_DOMEN.search(w))


def je_smece(naziv) -> bool:
    n = "" if pd.isna(naziv) else str(naziv).strip()
    if n.lower() in SMECE_TACNO:
        return True
    return any(p.lower() in n.lower() for p in SMECE_PODNIZ)


def ucitaj(src: Path) -> pd.DataFrame:
    listovi = pd.ExcelFile(src, engine="openpyxl").sheet_names
    if MASTER not in listovi:
        sys.exit(f"GRESKA: nema lista {MASTER!r} u {src.name}. Postojeci: {listovi}")
    df = pd.read_excel(src, sheet_name=MASTER, engine="openpyxl")
    nedostaju = [v for v in KOL.values() if v not in df.columns]
    if nedostaju:
        sys.exit(f"GRESKA: nedostaju kolone {nedostaju}\nPostojece: {list(df.columns)}")
    df[KOL["oglasi"]] = pd.to_numeric(df[KOL["oglasi"]], errors="coerce").fillna(0).astype(int)
    return df


def provjeri_zbir(src: Path, df: pd.DataFrame) -> None:
    listovi = pd.ExcelFile(src, engine="openpyxl").sheet_names
    pomocni = {MASTER, "Sažetak", "Sazetak"}
    po_lokaciji = [s for s in listovi if s not in pomocni]
    zbir = sum(len(pd.read_excel(src, sheet_name=s, engine="openpyxl")) for s in po_lokaciji)
    if zbir != len(df):
        print(f"  UPOZORENJE: zbir po listovima {zbir}, master {len(df)}, razlika {zbir-len(df):+d}")
    else:
        print(f"  Zbir po {len(po_lokaciji)} listova odgovara masteru ({zbir}).")


def oznake(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    o, p, n, w = KOL["oglasi"], KOL["paket"], KOL["naziv"], KOL["web"]
    df["ima_oglase"] = df[o].gt(0).map({True: "DA", False: "NE"})
    df["velicina"] = df[o].map(velicina)
    df["tip_naloga"] = "nejasno"
    df.loc[df[n].map(je_smece), "tip_naloga"] = "smece"
    df.loc[df.apply(lambda r: je_firma(r[n], r[w]), axis=1), "tip_naloga"] = "firma"
    df["godina_registracije"] = pd.to_datetime(df[KOL["reg"]], errors="coerce").dt.year
    df["_akt"] = df[o].eq(0).astype(int)
    df["_pak"] = df[p].map(PAKET_RANG).fillna(len(PAKET_RANG)).astype(int)
    return df


def pregled(df: pd.DataFrame, grupa: str, min_shopova: int = 0) -> pd.DataFrame:
    o, p = KOL["oglasi"], KOL["paket"]
    redovi = []
    for kljuc, g in df.groupby(grupa, dropna=False):
        if len(g) < min_shopova:
            continue
        bez = int(g[o].eq(0).sum())
        nenula = g.loc[g[o] > 0, o]
        redovi.append({
            grupa: kljuc if pd.notna(kljuc) else "(prazno)",
            "broj shopova": len(g),
            "sa oglasima": len(g) - bez,
            "bez oglasa": bez,
            "procenat bez oglasa": round(bez / len(g) * 100, 1),
            "Gold": int(g[p].eq("Gold").sum()),
            "Platinum": int(g[p].eq("Platinum").sum()),
            "ukupno oglasa": int(g[o].sum()),
            "medijana oglasa (svi)": float(g[o].median()),
            "medijana oglasa (bez nula)": float(nenula.median()) if len(nenula) else 0.0,
        })
    return pd.DataFrame(redovi).sort_values("broj shopova", ascending=False)


def formatiraj(dst: Path) -> None:
    sivo = PatternFill("solid", fgColor="F2F2F2")
    wb = load_workbook(dst)
    for ws in wb.worksheets:
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        zaglavlje = [c.value for c in ws[1]]
        for c in ws[1]:
            c.font = Font(bold=True)
        if KOL["link"] in zaglavlje:
            i = zaglavlje.index(KOL["link"]) + 1
            for r in range(2, ws.max_row + 1):
                c = ws.cell(row=r, column=i)
                if isinstance(c.value, str) and c.value.startswith("http"):
                    c.hyperlink = c.value
                    c.font = Font(color="0563C1", underline="single")
        if "ima_oglase" in zaglavlje:
            i = zaglavlje.index("ima_oglase") + 1
            for r in range(2, ws.max_row + 1):
                if ws.cell(row=r, column=i).value == "NE":
                    for c in range(1, ws.max_column + 1):
                        ws.cell(row=r, column=c).fill = sivo
        for i, naslov in enumerate(zaglavlje, start=1):
            duzine = [len(str(naslov))]
            for r in range(2, min(ws.max_row, 300) + 1):
                v = ws.cell(row=r, column=i).value
                if v is not None:
                    duzine.append(len(str(v)))
            ws.column_dimensions[get_column_letter(i)].width = min(max(duzine) + 2, 50)
    wb.save(dst)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1]).expanduser().resolve()
    if not src.exists():
        sys.exit(f"GRESKA: nema fajla {src}")
    datum = datum_iz_imena(src)
    dst = Path(sys.argv[2]).expanduser().resolve() if len(sys.argv) > 2 \
        else src.parent / f"shopovi-razdvojeno-{datum}.xlsx"

    print(f"Snimak: {src.name} (datum {datum})")
    df = ucitaj(src)
    print(f"  Master: {len(df)} redova, kolone se poklapaju.")
    provjeri_zbir(src, df)

    dup = df[KOL["shop"]].duplicated(keep=False)
    if dup.any():
        print(f"  UPOZORENJE: {int(dup.sum())} duplih redova po usernameu, "
              f"{df.loc[dup, KOL['shop']].nunique()} imena. Nijedan nije obrisan.")
    else:
        print("  Duplikata po usernameu nema.")

    df = oznake(df)
    van = sorted(set(df.loc[df["_pak"] >= len(PAKET_RANG), KOL["paket"]].dropna().astype(str)))
    if van:
        print(f"  NAPOMENA: paketi izvan poznatih idu na kraj bloka: {van}")
    poznati = df[KOL["paket"]].value_counts(dropna=False)
    print("  Paketi: " + ", ".join(f"{k} {v}" for k, v in poznati.items()))

    pk = pregled(df, KOL["kanton"])
    pg = pregled(df, KOL["grad"], min_shopova=5)
    firme_bez = df[df[KOL["oglasi"]].eq(0) & df["tip_naloga"].eq("firma")].sort_values(
        [KOL["kanton"], KOL["grad"]], na_position="last")

    info = pd.DataFrame({
        "polje": ["Datum snimka", "Izvorni fajl", "Ukupno shopova", "Sa oglasima",
                  "Bez oglasa", "Procenat bez oglasa", "Firmi bez oglasa",
                  "Medijana oglasa (svi)", "Medijana oglasa (bez nula)", "Generisano"],
        "vrijednost": [
            datum, src.name, len(df), int(df[KOL["oglasi"]].gt(0).sum()),
            int(df[KOL["oglasi"]].eq(0).sum()),
            f"{df[KOL['oglasi']].eq(0).mean()*100:.1f}%", len(firme_bez),
            float(df[KOL["oglasi"]].median()),
            float(df.loc[df[KOL["oglasi"]] > 0, KOL["oglasi"]].median()),
            date.today().isoformat(),
        ],
    })

    izlazne = [c for c in df.columns if not c.startswith("_")]
    zauzeta = {"Info", "Pregled kantoni", "Pregled gradovi", "Firme bez oglasa"}

    def ime_lista(kanton: str) -> str:
        osnova = NEDOZVOLJENO_U_IMENU.sub("-", str(kanton))[:31].strip() or "Bez naziva"
        ime, i = osnova, 2
        while ime in zauzeta:
            suf = f" {i}"
            ime = osnova[: 31 - len(suf)] + suf
            i += 1
        zauzeta.add(ime)
        return ime

    ukupno = 0
    with pd.ExcelWriter(dst, engine="openpyxl") as w:
        info.to_excel(w, sheet_name="Info", index=False)
        pk.to_excel(w, sheet_name="Pregled kantoni", index=False)
        pg.to_excel(w, sheet_name="Pregled gradovi", index=False)
        for kanton in pk[KOL["kanton"]]:
            g = df[df[KOL["kanton"]].isna()] if kanton == "(prazno)" \
                else df[df[KOL["kanton"]] == kanton]
            g = g.sort_values(["_akt", "_pak", KOL["oglasi"]], ascending=[True, True, False])
            ukupno += len(g)
            g[izlazne].to_excel(w, sheet_name=ime_lista(kanton), index=False)
        firme_bez[izlazne].to_excel(w, sheet_name="Firme bez oglasa", index=False)

    formatiraj(dst)
    print(f"  Zbir po kantonskim listovima: {ukupno} "
          f"({'odgovara' if ukupno == len(df) else 'NE ODGOVARA'} masteru)")
    print(f"\nSnimljeno: {dst}")


if __name__ == "__main__":
    main()
