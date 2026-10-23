"""Turns a PC copy of a real KoboReader.sqlite into tests/fixtures/kobo-schema.sql: the firmware's structure only
(tables, indexes, triggers, schema and database versions) plus one fictional sideloaded book. No title, shelf,
highlight or reading data of the real liseuse is kept, so the simulator tests can run anywhere, GitHub included.
Usage: python tests/make-kobo-fixture.py <copy of KoboReader.sqlite>"""
import sqlite3,sys
from pathlib import Path
source=sqlite3.connect(f'file:{Path(sys.argv[1]).resolve()}?mode=ro',uri=True)
lines=['-- Structure of a real Kobo catalogue (firmware schema), no personal data. Made by tests/make-kobo-fixture.py.',
       f'PRAGMA user_version={source.execute("PRAGMA user_version").fetchone()[0]};']
order={'table':0,'index':1,'view':2,'trigger':3}
for kind,name,sql in sorted(source.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"),key=lambda r:(order.get(r[0],9),r[1])):
    lines.append(sql.strip()+';')
if source.execute("SELECT 1 FROM sqlite_master WHERE name='DbVersion'").fetchone():
    for (version,) in source.execute('SELECT version FROM DbVersion'):lines.append(f'INSERT INTO DbVersion(version) VALUES({int(version)});')
# One fictional sideloaded book: every NOT NULL column without a default gets an empty value of its type.
values={'ContentID':"'file:///mnt/onboard/Livres/recit-fictif.epub'",'ContentType':'6','BookID':'NULL','Title':"'Récit fictif'",'Attribution':"'Autrice fictive'",'MimeType':"'application/epub+zip'",'ReadStatus':'0'}
for _,name,kind,notnull,default,_ in source.execute('PRAGMA table_info(content)'):
    if name not in values and notnull and default is None:values[name]="''" if 'CHAR' in kind.upper() or 'TEXT' in kind.upper() or not kind else '0'
lines.append(f"INSERT INTO content({','.join(chr(34)+n+chr(34) for n in values)}) VALUES({','.join(values.values())});")
target=Path(__file__).parent/'fixtures/kobo-schema.sql';target.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(target,len(lines),'lignes')
