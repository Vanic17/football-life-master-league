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
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('version');build(parser.parse_args().version)
