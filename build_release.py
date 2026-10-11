"""Package adapter source only; never include a game or career file."""
import hashlib,json,zipfile
from pathlib import Path
import argparse
ROOT=Path(__file__).resolve().parent
def build(version):
    dest=ROOT/'dist';dest.mkdir(exist_ok=True)
    files={}
    for p in (ROOT/'football-life').iterdir():
        if p.is_file() and p.suffix in ('.py','.js','.lua') and not p.name.startswith('test_'):
            files['football-life/'+p.name]=p.read_bytes()
    manifest={'version':version.removeprefix('v'),'files':{name:hashlib.sha256(raw).hexdigest() for name,raw in files.items()}}
    with zipfile.ZipFile(dest/'FL26-adapter-update.zip','w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('patch-manifest.json',json.dumps(manifest,indent=2))
        for name,raw in files.items():z.writestr(name,raw)
    print('Adapter modules:',len(files),'Version:',manifest['version'])
    complete={}
    for base in ('football-life','analysis'):
        for p in (ROOT/base).rglob('*'):
            if not p.is_file() or '__pycache__' in p.parts or p.name.startswith('test_'):continue
            rel=p.relative_to(ROOT).as_posix()
            if base=='football-life':
                if len(p.relative_to(ROOT/base).parts)==1 and p.suffix not in ('.py','.js','.lua','.md'):continue
                if len(p.relative_to(ROOT/base).parts)>1 and p.relative_to(ROOT/base).parts[0] not in ('engine','economy-data','tools','runtime'):continue
            if base=='analysis' and p.suffix not in ('.py','.md','.txt') and p.name!='LICENSE':continue
            if '/economy-data/' in rel and p.name not in ('player-economy.json','economy-models.json','published-wage-overrides.json'):continue
            complete[rel]=p.read_bytes()
    for p in ROOT.iterdir():
        if p.suffix in ('.cmd','.ps1'):complete[p.name]=p.read_bytes()
    meta={'version':version.removeprefix('v'),'kind':'complete','runtime':'runtime/py312-r1','files':{name:hashlib.sha256(raw).hexdigest() for name,raw in complete.items()}}
    with zipfile.ZipFile(dest/'FL26-complete-update.zip','w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('patch-manifest.json',json.dumps(meta,indent=2))
        for name,raw in complete.items():z.writestr(name,raw)
    print('Complete program files:',len(complete))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('version');build(parser.parse_args().version)
