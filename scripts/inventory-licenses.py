from pathlib import Path
import json,subprocess,shutil
source=Path(__file__).resolve().parents[1]
licenses=source/'licenses';licenses.mkdir(exist_ok=True)
inventory=[]

def texts(root,kind,name,version):
    found=[]
    # Licences at the package root, and those of bundled data (fonts, colour profiles, CMaps, decoders) in the
    # folders that carry them (hayro's assets, pdf.js's wasm and standard_fonts).
    for folder in [root,root/'assets',root/'wasm',root/'standard_fonts']:
      if not folder.is_dir():continue
      for p in folder.iterdir():
        upper=p.name.upper()
        if p.is_file() and (upper.startswith(('LICENSE','LICENCE','COPYING','NOTICE','COPYRIGHT')) or (folder!=root and 'LICEN' in upper)):
            target=licenses/'texts'/kind/(name.replace('/','_')+'-'+version)/((folder.name+'-' if folder!=root else '')+p.name)
            target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
            found.append(target.relative_to(licenses).as_posix())
    return found
metadata=json.loads(subprocess.check_output(['cargo','metadata','--locked','--format-version','1','--manifest-path',str(source/'src-tauri/Cargo.toml')]))
for package in metadata['packages']:
    if package['name']=='vera':continue
    root=Path(package['manifest_path']).parent
    inventory.append({'ecosystem':'Rust','name':package['name'],'version':package['version'],
                      'declaredLicense':package.get('license'),'repository':package.get('repository'),
                      'texts':texts(root,'rust',package['name'],package['version'])})
lock=json.loads((source/'package-lock.json').read_text(encoding='utf-8'))
for name,entry in lock['packages'].items():
    if not name:continue
    root=source/name
    if not root.is_dir():continue
    actual=json.loads((root/'package.json').read_text(encoding='utf-8'))
    inventory.append({'ecosystem':'npm','name':actual.get('name',name),'version':entry['version'],
                      'declaredLicense':actual.get('license',entry.get('license')),
                      'texts':texts(root,'npm',actual.get('name',name),entry['version'])})
(licenses/'third-party.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf-8')
print('Dependency inventory:',len(inventory))

