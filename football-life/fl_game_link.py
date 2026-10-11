"""Verified EDIT/Player.bin preparation and FL26 launch, without eFootball."""
import sys,json,os,struct,hashlib,shutil,time,subprocess,datetime,threading
from pathlib import Path
import psutil
ROOT=Path(__file__).resolve().parent
from fl_paths import GAME,EDIT
ORIGINAL=ROOT/'backups/EDIT00000000.original'
SOURCE_SIDER=GAME/'SiderAddons/sider.ini'
PROFILE=ROOT/'sider-profile'
SIDER=PROFILE/'sider.ini'
STATE=ROOT/'fl-link-state.json'
sys.path.insert(0,str(ROOT.parent/'analysis/fldailyedit'))
import config
config.GAME_ROOT=GAME
from editor import crypto
from editor.editfile import EditFile
from editor.playerbin import PlayerBinDatabase
from editor.wesys import decompress_wesys
sys.path.insert(0,str(ROOT.parent/'analysis/FootballLife-new-leagues/tools'))
import playeredit as F,pesdb
_setf_original=F.setf
def _checked_setf(rec,name,value):
    lo,hi=F.LIMITS[name]
    if not isinstance(value,int) or not lo<=value<=hi:raise ValueError(f'Valore {name} non valido: {value}')
    _setf_original(rec,name,value)
F.setf=_checked_setf
config.DECRYPTER_BIN=ROOT/'tools/decrypter/decrypter21.exe'
config.ENCRYPTER_BIN=ROOT/'tools/decrypter/encrypter21.exe'
for key in ('CURRENT_PLAYERS_FILE','PLAYERS_CSV_FILE','CURRENT_TEAMS_FILE','PLAYER_BIN_FILE','TEAM_BIN_FILE','PLAYER_ASSIGNMENT_FILE'):
    setattr(config,key,ROOT/('unused-'+key))
ORDER=('data_s2526','data_s2526a','data_s2526b','data_s2526c','data_s2526d','data_s25262','data_s25262a','data_s25262b')
SHORT=('OffAware','BallCtrl','Dribble','TightPoss','LowPass','LoftPass','Finish','Header','SetPiece','Curl','Speed','Accel','KickPow','Jump','Physical','Balance','Stamina','DefAware','Tackle','Aggress','GKAware','GKCatch','GKParry','GKReflex','GKReach')
ABIL=dict(zip(SHORT,(n for n,b in F.ABILITIES)))
SKILL_ALIASES={'Heading':'Heading (skill)','Acrobatic Clearance':'Acrobatic Clear',
    'Long-Range Curler':'Long Range Drive','Chip Shot Control':'Chip shot control',
    'Rising Shot':'Rising Shots','Super-sub':'Super-Sub','Chop Turn':'Cross Over Turn',
    'Sole Control':'Step On Skill control'}

def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def running():return any((p.info.get('name') or '').lower()=='fl_2026.exe' for p in psutil.process_iter(['name']))
def stopped():
    if running():raise ValueError('Chiudi Football Life: le rose devono essere preparate prima dell’avvio del gioco.')
def json_save(p,value):
    p=Path(p);p.parent.mkdir(exist_ok=True,parents=True)
    tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');os.replace(tmp,p)
def metadata():return json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else {}
def backup(p,tag):
    dest=ROOT/'backups'/(tag+'-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    shutil.copy2(p,dest)
    if digest(p)!=digest(dest):raise ValueError('Backup non verificato')
    return dest
def baseline():
    found=None
    for name in ORDER:
        p=ROOT/'native-database'/name/'Player.bin'
        if p.exists():found=p
    if found is None:raise ValueError('Database nativo non disponibile')
    raw=bytearray(decompress_wesys(found.read_bytes(),label='Player.bin'))
    edited=json.loads((ROOT/'edit-inspect.json').read_text(encoding='utf8')).get('players',{})
    for off in range(0,len(raw),312):
        pid=str(struct.unpack_from('<I',raw,off+8)[0]);p=edited.get(pid)
        if not p:continue
        rec=bytearray(raw[off:off+312])
        for key,name in ABIL.items():F.setf(rec,name,p['abilities'][key])
        for key,name in [('age','Age'),('height','Height (cm)'),('weight','Weight (kg)'),('nationality_code','Nationality'),('wfu','Weak Foot Usage'),('wfa','Weak Foot Accuracy'),('form_code','Form'),('playing_style_code','Playing Style')]:F.setf(rec,name,p[key])
        F.setf(rec,'Registered Position',F.POSITIONS.index(p['position']))
        F.setf(rec,'Stronger Foot',int(p['foot']=='Left'))
        F.setf(rec,'Injury Resistance',['Low','Medium','High'].index(p['injury_res']))
        for pos,value in p['apt'].items():F.setf(rec,pos,value)
        for skill,_ in F.SKILLS:F.setf(rec,skill,int(skill in p['skills']))
        set_name(rec,0x44,p['name']);set_name(rec,0x81,p['shirt_name'])
        raw[off:off+312]=rec
    return raw

def ensure_sider_profile():
    """Read original Sider; run a separate local profile without admin rights."""
    PROFILE.mkdir(exist_ok=True)
    source=GAME/'SiderAddons'
    for name in ('sider.exe','sider.dll','click.wav'):
        target=PROFILE/name
        # The portable package can come from another FL installation.  Sider
        # and its DLL must always match the version selected during setup.
        if not target.exists() or digest(target)!=digest(source/name):
            shutil.copy2(source/name,target)
    shutil.copytree(source/'modules',PROFILE/'modules',dirs_exist_ok=True)
    content=PROFILE/'content'
    if not content.exists():
        import ctypes
        # Windows directory junctions need no symlink privilege.
        command="New-Item -ItemType Junction -Path '"+str(content).replace("'","''")+"' -Target '"+str(source/'content').replace("'","''")+"' | Out-Null"
        subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],check=True,capture_output=True)
    if not SIDER.exists():
        import re
        cfg=SOURCE_SIDER.read_bytes().decode('utf-8-sig')
        def absolute(match):
            val=match.group(1)
            if val.startswith('.'):val=str(source/val.replace('\\',os.sep))
            return 'cpk.root = "'+val+'"'
        cfg=re.sub(r'cpk\.root\s*=\s*"([^"]+)"',absolute,cfg)
        cfg+='\noverlay.enabled = 1\noverlay.block-input-when-on = 0\n'
        SIDER.write_bytes(cfg.encode('utf-8'))
def set_name(rec,offset,value):
    text=value.encode('utf-8')[:60].decode('utf-8','ignore').encode('utf-8')
    rec[offset:offset+61]=text+b'\0'*(61-len(text))
def set_skill(rec,skill):
    native=SKILL_ALIASES.get(skill,skill)
    if native not in F.FIELDS:raise ValueError(f'Abilità speciale non disponibile in PES/Football Life: {skill}')
    F.setf(rec,native,1)

def build_player_table(app,c):
    raw=baseline()
    valid_ids={pid for pid,p in PlayerBinDatabase.from_bytes(raw).items()}
    offsets={struct.unpack_from('<I',raw,o+8)[0]:o for o in range(0,len(raw),312) if struct.unpack_from('<I',raw,o+8)[0] in valid_ids}
    season=c.d['season'];elapsed=max(0,season-1)
    growth=c.d.get('growth',{}).get('p',{})
    regen=c.d.get('life',{}).get('regens',{})
    custom=c.d.get('custom',{})
    if custom:raise ValueError('Le modifiche avanzate dei giocatori non sono ancora convertite al formato Football Life.')
    for pid,off in offsets.items():
        rec=bytearray(raw[off:off+312])
        F.setf(rec,'Age',min(78,F.getf(rec,'Age')+elapsed))
        r=regen.get(str(pid))
        if r:
            tpl=int(r['tpl'])
            if tpl not in offsets:raise ValueError(f'Template giovane {tpl} non disponibile')
            oldid=pid
            rec=bytearray(raw[offsets[tpl]:offsets[tpl]+312])
            struct.pack_into('<I',rec,8,oldid)
            set_name(rec,0x44,r['n']);set_name(rec,0x81,r.get('sh',r['n']))
            F.setf(rec,'Age',c.life().age(r,season))
            F.setf(rec,'Registered Position',F.POSITIONS.index(r['pos']))
            for key,field in [('h','Height (cm)'),('w','Weight (kg)')]:
                if key in r:F.setf(rec,field,r[key])
            if 'nat' in r:
                code=app.game.source['players'][str(tpl)]['nationality_code']
                matches=[p['nationality_code'] for k,p in app.game.source['players'].items() if app.game.player(int(k))['nationality']==r['nat']]
                if matches:code=matches[0]
                F.setf(rec,'Nationality',code)
            for key,value in r.get('apt',{}).items():
                if key in F.POSITIONS:F.setf(rec,key,value)
            for key,value in r.get('ab',{}).items():
                if key in ABIL:F.setf(rec,ABIL[key],max(40,min(99,round(value))))
            for skill in r.get('sk',[]):set_skill(rec,skill)
        g=growth.get(str(pid),{})
        for key,delta in g.get('d',{}).items():
            if key in ABIL:
                field=ABIL[key];F.setf(rec,field,max(40,min(99,round(F.getf(rec,field)+delta))))
        if g.get('age0') is not None:F.setf(rec,'Age',max(15,min(78,c.growth().age(g,season))))
        for key,value in g.get('ap',{}).items():
            if key in F.POSITIONS:F.setf(rec,key,value)
        for skill in g.get('sk',[]):set_skill(rec,skill)
        for skill in g.get('rm_sk',[]):
            native=SKILL_ALIASES.get(skill,skill)
            if native in F.FIELDS:F.setf(rec,native,0)
        raw[off:off+312]=rec
    parsed=PlayerBinDatabase.from_bytes(raw)
    if len(parsed)!=len(offsets):raise ValueError('Verifica della tabella giocatori fallita')
    return pesdb.wesys_pack(raw),parsed

def career_teams(c):
    if c.d.get('mode')=='world':
        tids={t for lg in c.d['leagues'].values() for t in lg['teams']}
        for ts in c.d.get('no_league',{}).values():tids.update(ts)
    else:tids=set(c.d['teams'])|set(c.d.get('lower',[]))
    for move in c.d.get('life',{}).get('moves',[]):
        if isinstance(move,dict):
            for field in ('from','to'):
                if move.get(field):tids.add(int(move[field]))
        elif len(move)>=4 and move[0]=='T':
            tids.update(int(t) for t in move[2:4] if t)
    return tids

def prepare(app,c,destination):
    """Build and verify candidate files only. No writes to the installation."""
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    native,db=build_player_table(app,c)
    (destination/'Player.bin').write_bytes(native)
    folder=crypto.decrypt(ORIGINAL)
    try:
        ef=EditFile(folder/'data.dat');ef.load()
        from edit_player_import import sync_progression
        unpacked=decompress_wesys(native,label='Player.bin')
        native_records={struct.unpack_from('<I',unpacked,o+8)[0]:unpacked[o:o+312] for o in range(0,len(unpacked),312)}
        sync_progression(ef,native_records,F,ABIL)
        # Existing source can contain positional inconsistencies; verify structure
        # first and apply only requested roster/lineup mutations.
        start=ef.validate_integrity()
        if not start['valid']:raise ValueError('EDIT originale non valido')
        rosters=ef.get_all_rosters();clubs=ef.get_club_team_ids()
        desired={};where={};players={}
        for tid in sorted(career_teams(c)):
            if tid not in clubs:continue
            rows=c.squad(tid)
            if not 11<=len(rows)<=40:raise ValueError(f'Rosa squadra {tid}: {len(rows)} giocatori; ne servono da 11 a 40.')
            desired[tid]={int(p['pid']) for p in rows}
            for p in rows:
                pid=int(p['pid'])
                if pid not in db:raise ValueError(f'Giocatore {pid} assente nel database FL')
                if pid in where and where[pid]!=tid:raise ValueError(f'Giocatore {pid} duplicato')
                where[pid]=tid;players[pid]=p
        moves=[]
        for tid in clubs:
            for pid in list(rosters[tid].roster):
                dest=where.get(pid)
                if (dest is not None and dest!=tid) or (tid in desired and pid not in desired[tid]):
                    if not ef.release_player(pid,tid):raise ValueError(ef.last_mutation_error)
                    moves.append({'pid':pid,'from':tid,'to':dest})
        for tid,pids in desired.items():
            for pid in sorted(pids):
                if pid not in ef.get_team_roster(tid).roster:
                    p=players[pid]
                    if not ef.add_player(pid,tid,shirt_number=p.get('shirt_number'),position=p['position'],allow_overflow_release=False):raise ValueError(ef.last_mutation_error)
        f=c.next_user_fixture()
        lineups={};bench={}
        for tid in (int(f['home']),int(f['away'])):
            if tid not in clubs:raise ValueError(f'Squadra della partita {tid} non presente in Football Life')
            xi=c.lineup(tid,f)
            lineups[tid]=[int(p['pid']) for p in xi[:11]]
            bench[tid]=[int(p['pid']) for p in c.squad(tid) if int(p['pid']) not in lineups[tid]]
        ef.repair_game_plans(preferred_starters=lineups,preferred_bench=bench)
        validation=ef.validate_integrity()
        if not validation['valid']:raise ValueError('; '.join(validation['errors'][:6]))
        ef.save()
        candidate=destination/'EDIT00000000'
        crypto.encrypt(folder,candidate)
        verified=crypto.decrypt(candidate)
        try:
            if (verified/'data.dat').read_bytes()!=(folder/'data.dat').read_bytes():raise ValueError('Verifica ricifratura fallita')
        finally:crypto.cleanup_temp(verified)
        report={'fixture':f['id'],'home':int(f['home']),'away':int(f['away']),
            'teams':len(desired),'moves':moves,'lineups':lineups,
            'player_count':len(db),'candidate':str(candidate),'valid':True}
        json_save(destination/'report.json',report)
        return report
    finally:crypto.cleanup_temp(folder)

BEGIN='; BEGIN FOOTBALL LIFE MASTER LEAGUE'
END='; END FOOTBALL LIFE MASTER LEAGUE'
def clean_config(text):
    import re
    return re.sub(r'(?m)^'+BEGIN+r'\r?\n.*?^'+END+r'\r?\n?', '',text,flags=re.S)
def install(app,folder,report):
    stopped();meta=metadata();current=digest(EDIT)
    if current not in (digest(ORIGINAL),meta.get('installed_edit')):
        raise ValueError('L’EDIT è stato modificato nel gioco o da un altro programma. È stato conservato: ripristina prima l’originale solo se vuoi rinunciare a quelle modifiche.')
    ensure_sider_profile()
    edit_backup=backup(EDIT,'EDIT-before-FL-career')
    cfg_backup=backup(SIDER,'sider-before-FL-career')
    overlay=PROFILE/'livecpk/FL-Master-League'
    target=overlay/'common/etc/pesdb/Player.bin'
    target.parent.mkdir(parents=True,exist_ok=True)
    previous_overlay=target.read_bytes() if target.exists() else None
    module=PROFILE/'modules/FL-ML-Port.lua'
    module.parent.mkdir(parents=True,exist_ok=True)
    previous_module=module.read_bytes() if module.exists() else None
    cfg_original=SIDER.read_bytes()
    config_text=clean_config(cfg_original.decode('utf-8-sig'))
    # Sider 7.3.3 predates reliable non-Steam one-click launch support.
    # Start its hook first, then the game with process-local CPU compatibility.
    import re
    config_text=re.sub(r'(?m)^\s*start\.game\s*=.*(?:\n|$)','',config_text)
    block=f'{BEGIN}\ncpk.root = "{overlay}"\nlua.module = "FL-ML-Port.lua"\n{END}\n'
    idx=config_text.find('cpk.root')
    if idx>=0:idx=config_text.rfind('\n',0,idx)+1
    config_text=config_text[:idx]+block+config_text[idx:] if idx>=0 else config_text+'\n'+block
    try:
        stopped()
        if digest(EDIT)!=current:raise ValueError('EDIT cambiato durante la preparazione')
        tmp=EDIT.with_name('EDIT00000000.flml.tmp')
        shutil.copy2(Path(folder)/'EDIT00000000',tmp)
        if digest(tmp)!=digest(Path(folder)/'EDIT00000000'):raise ValueError('Candidato EDIT non verificato')
        native_tmp=target.with_suffix('.tmp');shutil.copy2(Path(folder)/'Player.bin',native_tmp)
        os.replace(native_tmp,target)
        module.write_bytes((ROOT/'fl_career_bridge.lua').read_bytes())
        SIDER.write_bytes(config_text.encode('utf-8'))
        stopped();os.replace(tmp,EDIT)
        json_save(STATE,{'installed_edit':digest(EDIT),'player_bin':digest(target),
            'career':str(app.career.path),'fixture':report['fixture'],
            'edit_backup':str(edit_backup),'sider_backup':str(cfg_backup),'installed_sider':digest(SIDER),'report':report})
    except Exception:
        SIDER.write_bytes(cfg_original)
        if previous_overlay is None:target.unlink(missing_ok=True)
        else:target.write_bytes(previous_overlay)
        if previous_module is None:module.unlink(missing_ok=True)
        else:module.write_bytes(previous_module)
        if EDIT.exists() and digest(EDIT)!=current:shutil.copy2(edit_backup,EDIT)
        raise

def launch(app):
    c=app.require_career();f=c.next_user_fixture()
    if not f:raise ValueError('Nessuna prossima partita disponibile')
    if running():
        meta=metadata()
        diag=json.loads((ROOT/'launch-diagnostic.json').read_text(encoding='utf-8')) if (ROOT/'launch-diagnostic.json').exists() else {}
        native_pids={p.pid for p in psutil.process_iter(['name']) if (p.info.get('name') or '').lower()=='fl_2026.exe'}
        if meta.get('career')==str(c.path) and meta.get('fixture')==f['id'] and diag.get('pid') in native_pids:
            return {'result':'starting','fixture':f['id']}
        stopped()
    stopped()
    key=hashlib.sha256(str(c.path).encode()).hexdigest()[:16]
    folder=ROOT/'prepared'/key
    report=prepare(app,c,folder)
    install(app,folder,report)
    from match_rules import rules_for
    rules=rules_for(c,f)
    # A tiny Lua-readable file avoids a JSON parser in Sider's sandbox.
    (ROOT/'match-settings.lua').write_text(
        'return {home=%d,away=%d,extra_time=%d,penalties=%d}\n' %
        (f['home'],f['away'],rules['extra_time'],rules['penalties']),encoding='ascii')
    expected={'fixture':f['id'],'home':int(f['home']),'away':int(f['away']),
        'rules':rules,
        'career':str(c.path),'started':time.time(),
        'rosters':{str(int(tid)):[int(p['pid']) for p in c.squad(tid)] for tid in (f['home'],f['away'])}}
    json_save(ROOT/'expected-match.json',expected)
    (ROOT/'sider-live.json').unlink(missing_ok=True)
    (ROOT/'native-live.json').unlink(missing_ok=True)
    hook=subprocess.Popen([str(PROFILE/'sider.exe')],cwd=PROFILE)
    time.sleep(.8)
    if hook.poll() is not None:raise ValueError('Sider non è rimasto in ascolto: controlla sider-app.log')
    game=subprocess.Popen([str(GAME/'FL_2026.exe')],cwd=GAME)
    try:
        from fl_cpu import apply
        cpu=apply(game.pid)
    except Exception:
        if game.poll() is None:game.terminate()
        raise
    json_save(ROOT/'launch-diagnostic.json',dict(cpu,method='sider-hook-then-game',started=time.time()))
    app.ingame_last=report
    return {'result':'launched','fixture':f['id'],'home':app.team_name(f['home']),
        'away':app.team_name(f['away']),'report':report}

def restore():
    stopped();meta=metadata();current=digest(EDIT)
    if current not in (digest(ORIGINAL),meta.get('installed_edit')):
        raise ValueError('L’EDIT contiene modifiche esterne: ripristino automatico bloccato per conservarle.')
    backup(EDIT,'EDIT-before-restore')
    temp=EDIT.with_name('EDIT00000000.flml-restore.tmp');shutil.copy2(ORIGINAL,temp)
    if digest(temp)!=digest(ORIGINAL):raise ValueError('Copia originale non verificata')
    os.replace(temp,EDIT)
    if SIDER.exists():
        backup(SIDER,'sider-before-restore')
        restored=clean_config(SIDER.read_bytes().decode('utf-8-sig')).encode('utf-8')
        SIDER.write_bytes(restored)
    (ROOT/'expected-match.json').unlink(missing_ok=True)
    (ROOT/'sider-live.json').unlink(missing_ok=True)
    json_save(STATE,{})
    return {'ok':True,'original_restored':True}

def read_live_capture():
    """Sider writes directly because its sandbox has no atomic rename."""
    live_path=ROOT/'sider-live.json'
    for attempt in range(4):
        try:
            return json.loads(live_path.read_text(encoding='utf-8'))
        except (json.JSONDecodeError,FileNotFoundError):
            if attempt==3:
                raise ValueError('Esportazione della partita non ancora disponibile o in scrittura. Nessun risultato registrato.')
            time.sleep(.02)

def read_native_capture(expected):
    path=ROOT/'native-live.json'
    if not path.exists():raise ValueError('Acquisitore nativo in attesa della partita. Nessun risultato registrato.')
    capture=json.loads(path.read_text(encoding='utf-8'))
    identity=('career','fixture','home','away','started')
    if any(capture['expected'].get(k)!=expected.get(k) for k in identity):
        raise ValueError('Esportazione relativa a una partita precedente')
    if capture['captured_at']<expected['started']:raise ValueError('Esportazione precedente al lancio')
    # A replay can keep the same expected fixture and game PID. Do not import
    # the previous game's complete capture after a new scoreboard was created.
    if (ROOT/'sider-live.json').exists():
        live=read_live_capture()
        if live.get('score_ptr') and capture.get('score',{}).get('score_ptr')!=live['score_ptr']:
            raise ValueError('Replay rilevato: in attesa dei dati della nuova partita, senza importare quella precedente')
        if live.get('minute',0)+5<capture.get('score',{}).get('minute',0):
            raise ValueError('La partita e ricominciata: acquisizione precedente esclusa')
    return capture

def record_result(app,body):
    if not body.get('from_sider'):raise ValueError('Inserimento manuale disabilitato: sono necessari i dati reali della partita')
    expected=json.loads((ROOT/'expected-match.json').read_text(encoding='utf-8'))
    c=app.require_career();f=c.next_user_fixture()
    if expected['career']!=str(c.path) or not f or f['id']!=expected['fixture']:raise ValueError('La partita attesa è cambiata')
    if expected.get('diagnostic'):raise ValueError('Questa era una prova diagnostica: conservata senza modificare la carriera. Chiudi il gioco e premi Gioca per una nuova partita.')
    capture=read_native_capture(expected)
    from native_match_import import summarize
    summary=summarize(capture)
    import gzip,copy
    label=hashlib.sha256(json.dumps(expected,sort_keys=True).encode()).hexdigest()[:24]
    export=ROOT/'match-results'/'native'/f'{label}.json.gz'
    if str(export) in c.d.get('processed_matches',[]):raise ValueError('Partita già importata')
    capture['summary']=summary
    export.parent.mkdir(parents=True,exist_ok=True)
    temporary=export.with_suffix('.tmp');temporary.write_bytes(gzip.compress(json.dumps(capture,ensure_ascii=False).encode('utf-8')));os.replace(temporary,export)
    app.saver.flush()
    saved=backup(Path(c.path),'career-before-native-import')
    previous=copy.deepcopy(c.d)
    try:
        result=c.apply_user_match(f['id'],summary['home_goals'],summary['away_goals'],
            'football-life-native',players=summary['players'],scorers=summary['scorers'],match_file=str(export),
            et=summary.get('et'),pens=summary.get('pens'))
        result['result']['native_final_score']=summary['final_score']
        result['result']['native_events']=capture['events']
        result['result']['native_verified_fields']=summary['verified_fields']
        result['result']['native_unverified_fields']=summary['unverified_fields']
        result['result']['native_offline_supported_fields']=summary['offline_supported_fields']
        c.save();app.saver.flush()
    except Exception:
        c.d=previous;shutil.copy2(saved,c.path)
        raise
    app.push_event('match_applied',fixture=f['id'],round=f.get('round'))
    (ROOT/'expected-match.json').unlink(missing_ok=True)
    return app.state()
