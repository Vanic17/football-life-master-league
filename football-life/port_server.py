"""Standalone Football Life adapter for the recovered local career engine."""
import sys,json,time,threading,traceback,os
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'engine'))
import paths
SAVE_DIR=Path(os.environ.get('FL_ML_SAVE_DIR',str(ROOT/'fl-saves')))
SAVE_DIR.mkdir(exist_ok=True)
paths.SAVES=str(SAVE_DIR)
from fl_paths import GAME,relocated_active
paths.GAME=str(GAME)
relocated_active(SAVE_DIR)
paths.DT200=str(ROOT/'native-snapshot.json')
paths.ML_STATS=str(ROOT/'match-results')
Path(paths.ML_STATS).mkdir(exist_ok=True)
import server,world_api
from league import world
import fl_economy
fl_economy.install()
import native_growth
native_growth.install()
from native_engine_adapter import FootballLifeData
server.ACTIVE=str(SAVE_DIR/'active.txt')
server.SERVER_INFO=str(SAVE_DIR/'server.json')
server.LOG=str(SAVE_DIR/'server.log')
server.GAME_EXE='FL_2026.exe'
PORT=int(os.environ.get('FL_ML_PORT','8770'))
world.EURO_LEAGUES[473]=('Germany',1)
world.NO_LEAGUE_ASSOC='Switzerland'
import europe_adapter
import match_rules
match_rules.install()
import calendar_checks
calendar_checks.install()
from fl_game_link import F,SKILL_ALIASES
from league import sim
# Training and AI learning must only grant abilities stored by PES 2021.
sim.SKILLS={k:v for k,v in sim.SKILLS.items() if SKILL_ALIASES.get(k,k) in dict(F.SKILLS)}

class App(server.App):
    def __init__(self,port=PORT):
        super().__init__(port)
        self.game=FootballLifeData()
        self.game.configure_competitions()
        self.game_error=None
        self.assets=None
        self.ingame_enabled=True
        if self._career:
            world_api.attach(self,self._career)
            self.ensure_life(self._career)
            fl_economy.migrate(self._career,self.game)
            if self._career.d.get('name')=='真实日历生涯':
                self._career.d['name']='Carriera Football Life 26'
                self._career.save()
    def new_world(self,body):
        body=dict(body)
        if not body.get('name'):body['name']='Carriera Football Life 26'
        return super().new_world(body)
    def load_game(self):return None
    def new_base(self,variants=False):return None
    def use_game_for(self,c):
        if self.game and c:
            world_api.attach(self,c)
            fl_economy.migrate(c,self.game)
    def _same_cpk(self,cpk):return True
    def reload_game_if_changed(self):return None
    def reload_assets_if_changed(self):return None
    def prepare_ingame(self,*args,**kwargs):return None
    def maybe_prepare_on_launch(self,*args,**kwargs):return None
    def scan_exports(self):return None
    def randomize_celebrations(self):return None
    def ingame_view(self):return {'enabled':True,'last':self.ingame_last,'game':'Football Life 26'}
    def card_view(self,pid):return {'pid':pid,'vid':None}
    def player_view(self,pid,team=None):
        from economy_online import refresh
        refresh(pid,fl_economy.entry(pid))
        result=super().player_view(pid,team)
        result['fl_economy']=fl_economy.provenance(pid)
        return result
    def showcase_view(self,cid):return {'cards':[]}
    def plugin_changed(self):return False
    def market_search(self,q):
        result=super().market_search(q)
        # FL's special national-team-only pool contains classic/icon players
        # (Zidane, Tevez, Giggs, etc.).  They are not active 2026 footballers
        # and must not be available as free agents in this career.
        result['rows']=[row for row in result.get('rows',[]) if row.get('nt') is None]
        return result
    def market_view(self):
        result=super().market_view()
        result['nt_free']=[]
        return result
    def team_name(self,tid):
        game=getattr(self,'game',None)
        return game.teams[int(tid)]['latin'] if game and int(tid) in game.teams else str(tid)

def handler(app):
    Original=server.make_handler(app)
    class Handler(Original):
        def do_GET(self):
            route=urlsplit(self.path).path
            if route=='/fl/status':
                self._json({'program':'Football Life Master League','port':PORT,
                    'players':len(app.game.source['players']),'teams':len(app.game.teams),
                    'save_dir':str(SAVE_DIR),'program_root':str(ROOT),'original_engine':'1.1','standalone':True})
            elif route=='/fl/europe':
                self._json(json.loads((ROOT/'europe-mapping.json').read_text(encoding='utf-8')))
            elif route=='/fl/economy':
                self._json({'counts':fl_economy.DATA['counts'],
                    'retrieved_at':fl_economy.DATA['retrieved_at'],
                    'units':fl_economy.DATA['units']})
            elif route.startswith('/img/'):
                import re
                match=re.fullmatch(r'/img/(emblem|face)/(\d+)\.png',route)
                target=ROOT/'images'/match[1]/(match[2]+'.png') if match else None
                if target and target.is_file():
                    encoded=target.read_bytes()
                    self.send_response(200);self.send_header('Content-Type','image/png');self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
                else:super().do_GET()
            elif route=='/fl/link':
                from fl_game_link import metadata,running
                expected=json.loads((ROOT/'expected-match.json').read_text(encoding='utf-8')) if (ROOT/'expected-match.json').exists() else None
                c=app.career
                if expected and (not c or str(c.path)!=expected['career'] or not c.next_user_fixture() or c.next_user_fixture()['id']!=expected['fixture']):expected=None
                if expected:expected=dict(expected,home_name=app.team_name(expected['home']),away_name=app.team_name(expected['away']))
                from fl_game_link import read_live_capture
                live=None;live_error=None
                try:live=read_live_capture() if (ROOT/'sider-live.json').exists() else None
                except ValueError as error:live_error=str(error)
                native=None
                if expected:
                    from fl_game_link import read_native_capture
                    try:
                        capture=read_native_capture(expected)
                        native={key:capture.get(key) for key in ('score','finished','detail_complete','summary','validation_error','captured_at','native_flags')}
                        native['teams']=[{'team_id':team['team_id'],'players':[{'player_id':p['player_id'],'name':p['name']} for p in team['players']]} for team in capture['teams']]
                    except ValueError:pass
                reader_status=json.loads((ROOT/'native-reader-status.json').read_text(encoding='utf8')) if (ROOT/'native-reader-status.json').exists() else None
                if live_error:reader_status={'message':live_error,'at':time.time()}
                self._json({'expected':expected,'live':live,'native':native,'reader_status':reader_status,'running':running(),'installed':metadata(),'backups':str(ROOT/'backups')})
            elif route=='/app.js':
                data=(ROOT/'engine/web/app.js').read_text(encoding='utf-8')
                data=data.replace('const EURO = ["UCL", "UEL"];','const EURO = ["UCL", "UEL", "UECL"];')
                data=data.replace('const euroKey = (cid) => (cid === "UEL" ? "uel" : "ucl");','const euroKey = (cid) => cid.toLowerCase();')
                data=data.replace('const leagueName = (cid) => {','const leagueName = (cid) => { if (String(cid) === "473") return "Bundesliga";')
                data=data.replace('  noticePlugin();','  /* FL uses the native Sider connection. */')
                data=data.replace('${esc(dispTeam(team).sub)} · ','')
                data=data.replace('function cardsSeg() {','function cardsSeg() { return "";')
                data=data.replace('...(p.growth && p.growth.mine ? [{ k: "edit", label: t("tab-edit"), html: () => playerEditHtml(p) }] : []),','/* eFootball-only editor omitted from FL. */')
                encoded=data.encode('utf-8')
                self.send_response(200);self.send_header('Content-Type','text/javascript; charset=utf-8');self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
            elif route=='/api/world/leagues':
                data=world_api.setup_leagues(app)
                for row in data['leagues']:
                    if row['id']==473:row['en']='Bundesliga';row['zh']=''
                self._json(data)
            elif route=='/fl/ui.js':
                data=(ROOT/'port-ui.js').read_bytes()
                self.send_response(200);self.send_header('Content-Type','text/javascript; charset=utf-8')
                self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            elif route=='/api/plugin':
                self._json({'installed':False,'game':'Football Life 26','note':'Collegamento tramite Sider; il plugin eFootball non è utilizzato.'})
            elif route=='/':
                data=(ROOT/'engine/web/index.html').read_text(encoding='utf-8')
                data=data.replace('<html lang="zh-CN">','<html lang="it">')
                data=data.replace('<script>','<script>localStorage.setItem("ml-lang","it");',1)
                data=data.replace('</body>','<script src="/fl/ui.js"></script></body>')
                encoded=data.encode('utf-8')
                self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8')
                self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)
            else:super().do_GET()
        def do_POST(self):
            route=urlsplit(self.path).path
            origin=self.headers.get('Origin')
            if origin and origin not in (f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}'):
                self._json({'error':'Origine della richiesta non autorizzata'},403);return
            if route in ('/api/player/edit','/api/superxi'):
                self._json({'error':'Editor manuale eFootball incompatibile: usa allenamento e mercato della carriera.'},400);return
            if route in ('/api/switch/game','/fl/restore','/fl/result','/fl/shutdown'):
                try:
                    length=int(self.headers.get('Content-Length','0'))
                    body=json.loads(self.rfile.read(length) or b'{}')
                    from fl_game_link import launch,restore,record_result
                    with app.lock:
                        if route=='/fl/shutdown':
                            app.saver.flush();result={'ok':True}
                            threading.Thread(target=self.server.shutdown,daemon=True).start()
                        elif route=='/api/switch/game':result=launch(app)
                        elif route=='/fl/restore':result=restore()
                        else:result=record_result(app,body)
                    self._json(result)
                except Exception as e:
                    traceback.print_exc()
                    self._json({'error':str(e)},400)
            elif route.startswith('/api/plugin/'):
                self._json({'error':'Il plugin eFootball non è compatibile con Football Life.'},400)
            else:super().do_POST()
    return Handler

def main():
    app=App()
    httpd=server.Server(('127.0.0.1',PORT),handler(app))
    (SAVE_DIR/'server.json').write_text(json.dumps({'port':PORT,'pid':os.getpid(),'game':'Football Life 26'}),encoding='utf-8')
    print(f'Football Life Master League: http://127.0.0.1:{PORT}',flush=True)
    from native_match_reader import run as capture_native
    if PORT==8770 and SAVE_DIR.resolve()==(ROOT/'fl-saves').resolve():
        threading.Thread(target=capture_native,name='FL-native-reader',daemon=True).start()
    try:httpd.serve_forever()
    finally:app.saver.flush();httpd.server_close()

if __name__=='__main__':main()
