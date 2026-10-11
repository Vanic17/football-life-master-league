"""Download adapter-only GitHub releases. Preserve installation, EDIT and careers."""
import hashlib,io,json,shutil,tempfile,time,urllib.request,zipfile
from datetime import datetime
from pathlib import Path,PurePosixPath
REPOSITORY='Vanic17/football-life-master-league'
ROOT=Path(__file__).resolve().parent
VERSION='0.0.0'

def read_url(url):
    req=urllib.request.Request(url,headers={'User-Agent':'FL-Master-League-Updater','Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(req,timeout=30) as r:return r.read()

def install_patch(payload,root=ROOT):
    root=Path(root).resolve()
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        manifest=json.loads(z.read('patch-manifest.json'))
        files=manifest['files']
        # Patches can update adapter scripts, not user data or game content.
        for name,sha in files.items():
            p=PurePosixPath(name)
            if len(p.parts)!=2 or p.parts[0]!='football-life' or p.suffix not in ('.py','.js','.lua') or p.name.startswith('test_'):
                raise ValueError('Percorso patch non consentito: '+name)
            if hashlib.sha256(z.read(name)).hexdigest()!=sha:raise ValueError('Verifica patch fallita: '+name)
        backup=root/'backups'/('update-'+datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        backup.mkdir(parents=True)
        originals={}
        ui=root/'engine/web/app.js'
        if ui.exists():originals[ui]=ui.read_bytes();shutil.copy2(ui,backup/'app.js')
        try:
            for name in files:
                target=root/PurePosixPath(name).name
                originals[target]=target.read_bytes() if target.exists() else None
                if target.exists():shutil.copy2(target,backup/target.name)
                temp=target.with_suffix(target.suffix+'.update-tmp');temp.write_bytes(z.read(name));temp.replace(target)
            import importlib.util
            spec=importlib.util.spec_from_file_location('fl_ui_update',root/'apply_ui_patch.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.apply(root)
        except Exception:
            for target,old in originals.items():
                if old is None:target.unlink(missing_ok=True)
                else:target.write_bytes(old)
            raise
        (root/'adapter-version.json').write_text(json.dumps({'version':manifest['version'],'repository':REPOSITORY}),encoding='utf8')
        return manifest['version'],backup

def main():
    local=ROOT/'adapter-version.json'
    version=json.loads(local.read_text(encoding='utf8')).get('version',VERSION) if local.exists() else VERSION
    release=json.loads(read_url('https://api.github.com/repos/'+REPOSITORY+'/releases/latest'))
    tag=release['tag_name'].removeprefix('v')
    if tag==version:print('Gestionale gia aggiornato:',version);return
    asset=next(a for a in release['assets'] if a['name']=='FL26-adapter-update.zip')
    payload=read_url(asset['browser_download_url'])
    # Close only this installation's own local server.
    try:
        status=json.loads(read_url('http://127.0.0.1:8770/fl/status'))
    except Exception:status=None
    if status:
        if Path(status.get('program_root','')).resolve()!=ROOT:raise ValueError('Chiudi il gestionale aperto da un altra cartella prima di aggiornare.')
        req=urllib.request.Request('http://127.0.0.1:8770/fl/shutdown',data=b'{}',headers={'Content-Type':'application/json'},method='POST')
        urllib.request.urlopen(req,timeout=5).close()
        time.sleep(2)
    installed,backup=install_patch(payload)
    print('Aggiornamento installato:',installed,'Backup:',backup)

if __name__=='__main__':
    try:main()
    except Exception as exc:print('Aggiornamento non applicato:',exc);raise SystemExit(1)
