# Gotova poruka klijentu za token

Posalji je klijentu kad je ugovor potpisan. Nista se u njoj ne mijenja osim potpisa i imena
firme. Lozinku klijenta ne trazimo nikad: token dobija sam, kod sebe.

Ako korisnik trazi poruku, kopiraj tekst u clipboard i javi mu da je kopirano.

---

Poštovani,

za analizu vašeg OLX/PIK shopa treba nam pristupni token vašeg naloga. Molimo vas da NE šaljete lozinku, nego samo token. Postupak traje par minuta.

1. Preduslov
Provjerite da vaš shop ima odobren API pristup. Obično ga imaju Gold i Platinum shopovi, uz odobrenje OLX/PIK podrške. Ako niste sigurni, javite nam pa ćemo zajedno provjeriti.

2. Kako dobiti token
Otvorite Terminal (Mac) ili PowerShell (Windows) i zalijepite ovu komandu, s tim da umjesto KORISNICKO_IME i LOZINKA upišete svoje podatke:

curl -s -X POST https://api.olx.ba/auth/login -H "Content-Type: application/json" -d "{\"username\":\"KORISNICKO_IME\",\"password\":\"LOZINKA\",\"device_name\":\"analiza\"}"

Kao odgovor dobijete tekst koji počinje sa {"token":"..."}. Treba nam samo taj niz znakova između navodnika iza riječi token.

3. Kako nam ga poslati
Nemojte slati token običnim mailom ni porukom. Otvorite https://onetimesecret.com, zalijepite token, kliknite Create secret link i pošaljite nam link koji dobijete. Link se poništava nakon prvog otvaranja.

4. Šta token omogućava
Token daje pun pristup nalogu, uključujući izmjenu i objavu oglasa te trošenje kredita. Mi ga koristimo isključivo za čitanje i analizu. Ništa nećemo mijenjati niti trošiti bez vaše izričite potvrde za svaku pojedinu radnju.

5. Ako želite prekinuti pristup
Promjena lozinke na vašem nalogu poništava token. Javite nam kad želite da pristup prestane.

Hvala,

---

## Napomene za nas, ne za klijenta

- Token se cuva samo u lokalnom `.env` klona tog klijenta, kao `OLX_TOKEN`. Nikad u git, nikad u chat, nikad
  u dokument koji se dijeli.
- Ako klijent posalje username i lozinku umjesto tokena, ne koristi ih za sebe: uputi ga natrag
  na korak 2, ili pokreni login sa njim uzivo pa mu odmah reci da promijeni lozinku ako je
  procurila.
- Promjena lozinke ponistava token. Kad klijent prijavi da mu "bot ne radi", prvo provjeri
  `olx_whoami`; 401 ili 403 najcesce znaci da je mijenjao lozinku.
