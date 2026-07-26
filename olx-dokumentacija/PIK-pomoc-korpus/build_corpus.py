import json, re, os, datetime
from markdownify import markdownify as md

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "out")
os.makedirs(OUT, exist_ok=True)

cats = {c["id"]: c for c in json.load(open(f"{BASE}/categories.json"))["categories"]}
secs = {s["id"]: s for s in json.load(open(f"{BASE}/sections.json"))["sections"]}
arts = json.load(open(f"{BASE}/articles.json"))["articles"]


def slug(t):
    t = t.lower()
    repl = {"č": "c", "ć": "c", "ž": "z", "š": "s", "đ": "dj"}
    for a, b in repl.items():
        t = t.replace(a, b)
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t[:70]


def clean(html):
    if not html:
        return ""
    text = md(html, heading_style="ATX", strip=["img"])
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip()


# grupiranje po kategoriji i sekciji
tree = {}
for a in arts:
    sec = secs.get(a["section_id"])
    cat = cats.get(sec["category_id"]) if sec else None
    ck = cat["name"] if cat else "Bez kategorije"
    sk = sec["name"] if sec else "Bez sekcije"
    tree.setdefault(ck, {}).setdefault(sk, []).append(a)

today = datetime.date.today().isoformat()

# 1) Jedan veliki fajl
parts = [
    "# PIK.ba / OLX.ba zvanicna pomoc, kompletan sadrzaj",
    "",
    f"Izvor: https://pomoc.olx.ba/hc/bs (Zendesk Help Center API, jezik bs)",
    f"Povuceno: {today}  |  Kategorija: {len(cats)}  |  Sekcija: {len(secs)}  |  Clanaka: {len(arts)}",
    "",
    "Napomena: ovo je doslovan sadrzaj zvanicne pomoci, sluzi kao izvor istine za interni",
    "knowledgebase. Ne dijeliti klijentima kao vlastiti materijal.",
    "",
    "---",
    "",
    "## Sadrzaj",
    "",
]

for ck in tree:
    parts.append(f"- {ck}")
    for sk in tree[ck]:
        parts.append(f"  - {sk} ({len(tree[ck][sk])})")
parts.append("")
parts.append("---")
parts.append("")

index_rows = []
for ck, sections in tree.items():
    parts.append(f"# {ck}")
    parts.append("")
    for sk, items in sections.items():
        parts.append(f"## {sk}")
        parts.append("")
        for a in sorted(items, key=lambda x: x.get("position", 0)):
            parts.append(f"### {a['title']}")
            parts.append("")
            parts.append(f"Izvor: {a['html_url']}")
            parts.append(f"Azurirano: {a['updated_at'][:10]}  |  ID: {a['id']}")
            parts.append("")
            parts.append(clean(a.get("body")))
            parts.append("")
            index_rows.append((ck, sk, a["title"], a["updated_at"][:10], a["html_url"]))

full = "\n".join(parts)
open(f"{OUT}/PIK-pomoc-kompletno.md", "w", encoding="utf-8").write(full)

# 2) Pojedinacni fajlovi po clanku
per_dir = os.path.join(OUT, "clanci")
os.makedirs(per_dir, exist_ok=True)
for a in arts:
    sec = secs.get(a["section_id"])
    cat = cats.get(sec["category_id"]) if sec else None
    fm = [
        "---",
        f"naslov: \"{a['title']}\"",
        f"kategorija: \"{cat['name'] if cat else ''}\"",
        f"sekcija: \"{sec['name'] if sec else ''}\"",
        f"izvor: {a['html_url']}",
        f"azurirano: {a['updated_at'][:10]}",
        f"id: {a['id']}",
        "---",
        "",
        f"# {a['title']}",
        "",
        clean(a.get("body")),
        "",
    ]
    open(f"{per_dir}/{slug(a['title'])}-{a['id']}.md", "w", encoding="utf-8").write("\n".join(fm))

# 3) CSV index
import csv
with open(f"{OUT}/index.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["kategorija", "sekcija", "naslov", "azurirano", "url"])
    w.writerows(sorted(index_rows))

# 4) JSON za masinsku obradu
compact = []
for a in arts:
    sec = secs.get(a["section_id"])
    cat = cats.get(sec["category_id"]) if sec else None
    compact.append({
        "id": a["id"],
        "naslov": a["title"],
        "kategorija": cat["name"] if cat else None,
        "sekcija": sec["name"] if sec else None,
        "url": a["html_url"],
        "azurirano": a["updated_at"],
        "tekst": clean(a.get("body")),
    })
json.dump(compact, open(f"{OUT}/pik-pomoc.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)

print("Fajlova u clanci/:", len(os.listdir(per_dir)))
print("Velicina kompletnog md:", round(len(full) / 1024, 1), "KB")
print("Rijeci ukupno:", len(full.split()))
