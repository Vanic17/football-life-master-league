"""Machine-local installation paths; program files always resolve from __file__."""
import json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parent
CONFIG=ROOT/'installation.json'

def documents():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,r'Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders') as key:
            return Path(os.path.expandvars(winreg.QueryValueEx(key,'Personal')[0]))
    except OSError:return Path.home()/'Documents'

def load():
    if CONFIG.exists():return json.loads(CONFIG.read_text(encoding='utf8'))
    candidates=[Path(os.environ.get('ProgramFiles(x86)',r'C:\Program Files (x86)'))/'SP Football Life 2026',
                Path(os.environ.get('ProgramFiles',r'C:\Program Files'))/'SP Football Life 2026']
    game=next((p for p in candidates if (p/'FL_2026.exe').exists()),candidates[0])
    return {'game_dir':str(game),'edit_file':str(documents()/'KONAMI/eFootball PES 2021 SEASON UPDATE/2026/save/EDIT00000000')}

SETTINGS=load()
GAME=Path(SETTINGS['game_dir']).expanduser().resolve()
EDIT=Path(SETTINGS['edit_file']).expanduser().resolve()

def relocated_active(save_dir):
    """Old absolute active.txt paths must never load the source PC's career."""
    p=Path(save_dir)/'active.txt'
    if p.exists():
        name=Path(p.read_text(encoding='utf8').strip()).name
        target=Path(save_dir)/name
        if target.exists():p.write_text(str(target.resolve()),encoding='utf8')
        else:p.unlink()
