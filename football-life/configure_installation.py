"""Bind a portable copy to a compatible game and its own EDIT, read-only to game."""
import argparse,dataclasses,hashlib,json,os,shutil,struct,sys
from datetime import datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'analysis/fldailyedit'))
import config
from editor import crypto
from editor.editfile import EditFile
from editor.roster import GAME_PLAN_ENTRY_SIZE,GP_TEAM_ID,GP_LINEUP
from tools.cpk_extract import read_file
config.DECRYPTER_BIN=ROOT/'tools/decrypter/decrypter21.exe'
config.ENCRYPTER_BIN=ROOT/'tools/decrypter/encrypter21.exe'
ORDER=('data_s2526','data_s2526a','data_s2526b','data_s2526c','data_s2526d','data_s25262','data_s25262a','data_s25262b')

def digest(p):
    with Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def inspect_edit(edit,snapshot):
    folder=crypto.decrypt(edit)
    try:
        ef=EditFile(folder/'data.dat');ef.load()
        valid=ef.validate_integrity()
        if not valid['valid']:raise ValueError('EDIT non valido: '+str(valid['errors'][:3]))
        from edit_player_import import import_players
        edited_players=import_players(ef,snapshot)
        rosters=ef.get_all_rosters();teams=ef.get_all_team_info()
        expected=json.loads((ROOT/'portable-compatibility.json').read_text(encoding='utf8'))
        if sorted(sorted(r) for r in ef.get_league_divisions())!=expected['league_divisions']:
            raise ValueError('La composizione dei campionati di questo EDIT e diversa: richiede un importatore delle competizioni.')
        if set(map(int,snapshot['teams']))!=set(teams):raise ValueError('Gli ID delle squadre sono diversi dal database supportato.')
        unknown={pid for r in rosters.values() for pid in r.roster if str(pid) not in snapshot['players']}
        if unknown:raise ValueError('EDIT con giocatori non presenti nel database compatibile: '+str(sorted(unknown)[:10]))
        slots={}
        for i in range(ef.game_plan_count):
            off=ef.game_plan_start+i*GAME_PLAN_ENTRY_SIZE
            tid=struct.unpack_from('<I',ef._data,off+GP_TEAM_ID)[0]
            slots[str(tid)]=list(ef._data[off+GP_LINEUP:off+GP_LINEUP+40])
        return {'counts':{'players':ef.player_count,'teams':len(teams),'rosters':len(rosters)},
                'teams':{str(k):dataclasses.asdict(v) for k,v in teams.items()},
                'players':edited_players,'rosters':{str(k):dataclasses.asdict(v) for k,v in rosters.items()},
                'lineup_slots':slots,'club_ids':sorted(ef.get_club_team_ids())}
    finally:crypto.cleanup_temp(folder)

def validate_game(game):
    expected=json.loads((ROOT/'portable-compatibility.json').read_text(encoding='utf8'))
    if digest(game/'FL_2026.exe')!=expected['exe_sha256']:
        raise ValueError('Versione FL_2026.exe diversa da quella verificata. Non posso usare gli stessi offset di lettura.')
    actual_archives={p.stem for p in (game/'download').glob('data_s2526*.cpk')}
    if actual_archives!=set(expected['archives']):raise ValueError('Serie di archivi della patch diversa: occorre verificare e importare il nuovo database.')
    for table,info in expected['tables'].items():
        raw=read_file(game/'download'/(info['archive']+'.cpk'),'common/etc/pesdb/'+table)
        if hashlib.sha256(raw).hexdigest()!=info['sha256']:
            raise ValueError('Database '+table+' diverso da quello supportato: nessun file del gioco modificato.')

def configure(game,edit,new_career=False):
    game=Path(game).resolve();edit=Path(edit).resolve()
    config.GAME_ROOT=game
    import psutil
    if any((p.info.get('name') or '').lower()=='fl_2026.exe' for p in psutil.process_iter(['name'])):
        raise ValueError('Chiudi Football Life prima della configurazione.')
    validate_game(game)
    snapshot=json.loads((ROOT/'native-snapshot.json').read_text(encoding='utf8'))
    base_players=ROOT/'native-base-players.json'
    if base_players.exists():snapshot['players']=json.loads(base_players.read_text(encoding='utf8'))
    inspected=inspect_edit(edit,snapshot)
    if not base_players.exists():base_players.write_text(json.dumps(snapshot['players'],ensure_ascii=False),encoding='utf8')
    # Validate all candidates before changing even the local program's baseline.
    original_bytes=edit.read_bytes();original_hash=hashlib.sha256(original_bytes).hexdigest()
    stamp=datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backups=ROOT/'backups';backups.mkdir(exist_ok=True)
    for name in ('native-snapshot.json','edit-inspect.json','installation.json'):
        p=ROOT/name
        if p.exists():shutil.copy2(p,backups/(stamp+'-'+name))
    original=backups/'EDIT00000000.original'
    if original.exists():shutil.copy2(original,backups/(stamp+'-previous-original'))
    # Fresh careers use THIS computer's roster. A carried career retains its own.
    for key in ('teams','rosters','lineup_slots'):snapshot[key]=inspected[key]
    snapshot['players'].update(inspected['players'])
    snapshot['source']='Football Life 2026 compatible database + local EDIT original'
    original.write_bytes(original_bytes)
    (ROOT/'edit-inspect.json').write_text(json.dumps(inspected,ensure_ascii=False),encoding='utf8')
    (ROOT/'native-snapshot.json').write_text(json.dumps(snapshot,ensure_ascii=False),encoding='utf8')
    settings={'schema':1,'game_dir':str(game),'edit_file':str(edit),'original_edit_sha256':original_hash,
              'configured_at':stamp,'computer':os.environ.get('COMPUTERNAME','')}
    (ROOT/'installation.json').write_text(json.dumps(settings,indent=2),encoding='utf8')
    profile=ROOT/'sider-profile'
    sider_ini=profile/'sider.ini'
    if sider_ini.exists():shutil.move(str(sider_ini),str(backups/(stamp+'-previous-sider.ini')))
    content=profile/'content'
    if os.path.isjunction(content):os.rmdir(content) # Remove the junction, never its target.
    elif content.is_symlink():content.unlink()
    elif content.exists():shutil.move(str(content),str(backups/(stamp+'-previous-content')))
    for name in ('fl-link-state.json','expected-match.json','sider-live.json','native-live.json','launch-diagnostic.json','native-reader-status.json','match-settings.lua'):
        (ROOT/name).unlink(missing_ok=True)
    if new_career:(ROOT/'fl-saves/active.txt').unlink(missing_ok=True)
    print('Configurazione completata. EDIT del gioco invariato; backup locale:',original)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--game',required=True);p.add_argument('--edit',required=True);p.add_argument('--new-career',action='store_true')
    a=p.parse_args()
    try:configure(a.game,a.edit,a.new_career)
    except Exception as e:print('Configurazione non applicata:',e);sys.exit(1)
