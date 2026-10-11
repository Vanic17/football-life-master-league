import hashlib,io,json,tempfile,zipfile
from pathlib import Path
from update_manager import install_patch
def patch(files):
    result=io.BytesIO()
    with zipfile.ZipFile(result,'w') as z:
        z.writestr('patch-manifest.json',json.dumps({'version':'1.0.0','files':{p:hashlib.sha256(b).hexdigest() for p,b in files.items()}}))
        for p,b in files.items():z.writestr(p,b)
    return result.getvalue()
with tempfile.TemporaryDirectory() as folder:
    root=Path(folder)
    (root/'fl-saves').mkdir();(root/'fl-saves/career.json').write_bytes(b'USER CAREER')
    (root/'installation.json').write_bytes(b'USER PATHS')
    ui=root/'engine/web/app.js';ui.parent.mkdir(parents=True);ui.write_text('USER UI')
    (root/'module.py').write_text('OLD')
    source=Path(__file__).parent/'apply_ui_patch.py'
    files={'football-life/module.py':b'NEW','football-life/apply_ui_patch.py':source.read_bytes()}
    v,backup=install_patch(patch(files),root)
    assert (root/'module.py').read_text()=='NEW'
    assert (root/'fl-saves/career.json').read_bytes()==b'USER CAREER'
    assert (root/'installation.json').read_bytes()==b'USER PATHS'
    assert (backup/'module.py').read_text()=='OLD'
    for path in ('football-life/../installation.json','football-life/installation.json','football-life/native-snapshot.json','football-life/C:\\escaped.py'):
        try:install_patch(patch({path:b'BAD'}),root)
        except ValueError:pass
        else:raise AssertionError(path)
    broken=dict(files);broken['football-life/apply_ui_patch.py']=b'raise ValueError("bad")'
    (root/'module.py').write_text('RESTORE ME')
    try:install_patch(patch(broken),root)
    except ValueError:pass
    assert (root/'module.py').read_text()=='RESTORE ME'
print('PASS: patch, hash, percorsi sicuri, preservazione carriera/config, backup e rollback')
