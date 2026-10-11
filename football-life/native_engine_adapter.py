"""Actual Football Life tables and the installed game's native OVR algorithm."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'engine'))
import native_overall as NATIVE_OVR
DISPLAY_KEYS=json.loads((ROOT/'ability-display-keys.json').read_text(encoding='utf-8'))
import efootball_core as C
from gamedata import ABILITY_GROUPS,ABILITY_SHORT_CN
from league import sim

class FootballLifeData:
    def __init__(self,path=ROOT/'native-snapshot.json'):
        self.source=json.loads(Path(path).read_text(encoding='utf-8'))
        self._players={}
        self.pid_teams={}
        self.teams={}
        for key,t in self.source['teams'].items():
            tid=int(key)
            r=self.source['rosters'].get(key,{}).get('player_ids',[])
            for pid in r:
                if pid:self.pid_teams.setdefault(pid,set()).add(tid)
            self.teams[tid]={'id':tid,'zh':'','latin':t['name'],
                            'aliases':[t['name']],'size':sum(bool(p) for p in r)}
        for tid,t in self.teams.items():
            rows=self.squad(tid,strict=False)
            t['strength']=round(sum(p['overall'] for p in rows[:11])/len(rows[:11]),1) if rows else 0

    def player(self,pid):
        pid=int(pid)
        if pid not in self._players:
            raw=self.source['players'].get(str(pid))
            if raw is None:raise ValueError(f'FL player {pid} missing from current native table')
            p={k:v for k,v in raw.items() if k!='abilities'}
            from fl_game_link import SKILL_ALIASES
            native_names={v:k for k,v in SKILL_ALIASES.items()}
            p['skills']=[native_names.get(s,s) for s in p['skills']]
            a=self.abilities(pid)
            p['overall']=NATIVE_OVR.overall(a,p['height'],p['position'],p.get('wfa',0))
            p['overall_source']='FL_2026.exe native algorithm 26.2.0.3'
            p['nationality']=C.NATIONALITY_ID.get(p['nationality_code']*2,'Unknown')
            self._players[pid]=p
        return dict(self._players[pid])

    def abilities(self,pid):
        a=dict(self.source['players'][str(pid)]['abilities'])
        a['DefEngage']=a['Tackle']
        return a

    def squad(self,tid,strict=True):
        key=str(tid)
        r=self.source['rosters'].get(key)
        if not r:return []
        slots=self.source['lineup_slots'].get(key,list(range(40)))
        order=[s for s in slots if s<40 and r['player_ids'][s]]
        order+= [s for s,pid in enumerate(r['player_ids']) if pid and s not in order]
        result=[]
        for rank,slot in enumerate(order):
            pid=r['player_ids'][slot]
            try:p=self.player(pid)
            except ValueError:
                if strict:raise
                continue
            p.update(slot=rank,shirt_number=r['shirt_numbers'][slot],starter=rank<11,captain=False)
            result.append(p)
        return result

    def team_info(self,tid):return {'zh':'','latin':self.teams[int(tid)]['latin']}
    def strength(self,tid):return self.teams[int(tid)]['strength']
    def formation(self,tid):return [p['position'] for p in self.squad(tid)[:11]]
    position_weights=staticmethod(NATIVE_OVR.position_weights)
    def market_value(self,pid):
        from fl_economy import baseline_value
        return int(baseline_value(self.player(pid))*1_000_000)

    def club_info(self,tid):return dict(self.teams[int(tid)])
    def stale(self):return False
    def coaches(self):return None
    def dt_loans(self):return {}
    def display_card(self,pid,has_art):return None
    def card_entry(self,pid,vid,team=None):return None
    def showcase(self,cid,has_art,**kwargs):return []
    def search_teams(self,query,limit=60):
        q=query.casefold()
        return [dict(t) for t in self.teams.values() if q in t['latin'].casefold() and t['size']>=11][:limit]

    def configure_competitions(self):
        inv=json.loads((ROOT/'port-inventory.json').read_text(encoding='utf-8'))
        # The companion's identifiers are internal schedule keys; team/player IDs remain FL IDs.
        remap={9:113,66:337,10:116,69:346,11:119,67:340,12:122,68:343,
               13:125,14:128,39:473,119:476,137:518,128:549,111:566}
        self._competition_index={}
        self._competitions=[]
        for c in inv['competitions']:
            tids=list(dict.fromkeys(t for t in c['teams'] if t in self.teams and self.teams[t]['size']>=11))
            if not tids:continue
            cid=remap.get(c['id'],10000+c['id'])
            name=next((x for x in c['names'] if 'Playoff' not in x and 'Phase' not in x and 'Regular' not in x),c['code'])
            self._competition_index[cid]=tids
            self._competitions.append({'id':cid,'name':name,'latin':name,'zh':'','size':len(tids),'count':len(tids),'teams':len(tids)})
        self._club_ids={tid for cid,tids in self._competition_index.items() for tid in tids if cid not in (10027,10028,10029,10030,10031,10032,10033,10034,10035,10036)}
        self._native_leagues={113:'England',337:'England',116:'Italy',346:'Italy',119:'Spain',340:'Spain',122:'France',343:'France',125:'Netherlands',128:'Portugal',473:'Germany',476:'Türkiye',518:'Scotland',549:'Denmark',566:'Belgium'}
        self._team_country={t:self._native_leagues[cid] for cid in self._native_leagues for t in self._competition_index.get(cid,[])}
        # National team IDs are listed by EDIT, not guessed from a numerical threshold.
        edit=json.loads((ROOT/'edit-inspect.json').read_text(encoding='utf-8'))
        self._club_ids=set(edit.get('club_ids',self._club_ids))

    def competitions(self):return self._competitions
    def _competition_tables(self):return self._competition_index
    def competition_teams(self,cid):return [self.teams[t] for t in self._competition_index.get(int(cid),[])]
    def world_setup(self,leagues,**kwargs):return ({cid:self._competition_index.get(cid,[]) for cid in leagues},[])
    def league_clubs(self):return sorted(self._club_ids)
    def is_national_team(self,tid):return int(tid) not in self._club_ids
    def team_country(self,tid):return self._team_country.get(int(tid),self.teams[int(tid)]['latin'] if self.is_national_team(tid) else 'Other')
    def national_teams(self):
        from collections import Counter
        best={}
        for tid,t in self.teams.items():
            if not self.is_national_team(tid):continue
            rows=self.squad(tid)
            if len(rows)<11:continue
            nat=Counter(p['nationality'] for p in rows).most_common(1)[0][0]
            if nat=='Unknown':continue
            if nat not in best or t['strength']>best[nat]['strength']:
                best[nat]={'id':tid,'country':nat,'strength':t['strength']}
        return sorted(best.values(),key=lambda x:x['country'])
    def life_source(self):
        if hasattr(self,'_life_source'):return self._life_source
        from collections import defaultdict
        from fl_game_link import F,SKILL_ALIASES
        names=defaultdict(list);templates=defaultdict(list);donors=defaultdict(list)
        for key,raw in self.source['players'].items():
            pid=int(key);p=self.player(pid);nat=p['nationality']
            bits=p['roman'].split()
            if len(bits)>=2:names[nat].append((' '.join(bits[:-1]),bits[-1],'',''))
            if pid in self.pid_teams:templates[p['position']].append(pid)
        vessels=sorted(int(k) for k in self.source['players'] if int(k) not in self.pid_teams)
        for pid in vessels:donors[self.player(pid)['nationality']].append(pid)
        self._life_source={'vessels':vessels,'solo':set(),'names':dict(names),
            'templates':dict(templates),'donors':dict(donors),'donors_any':vessels,
            'abilities':self.abilities,'info':lambda pid:{'h':self.player(pid)['height'],'w':self.player(pid)['weight'],'foot':self.player(pid)['foot'],'apt':self.player(pid)['apt'],'skills':self.player(pid)['skills']},
            'country':self.team_country,
            'nats':lambda tid:[p['nationality'] for p in self.squad(tid)],
            'overall':NATIVE_OVR.overall,
            'regular':lambda s:SKILL_ALIASES.get(s,s) in F.FIELDS and sim.SKILLS.get(s,('regular','minor'))[1] in ('regular','minor')}
        return self._life_source

    def player_detail(self,pid,team=None):
        p=self.player(pid);a=self.abilities(pid)
        clubs=sorted(self.pid_teams.get(int(pid),()))
        team=team or next((t for t in clubs if t in self._club_ids),None)
        return {'pid':int(pid),'base_id':int(pid),'is_base':True,
            'names':{'full':p['roman'],'cn':'','shirt':p['shirt_name'],'roman':p['roman']},
            'name':p['roman'],'position':p['position'],'overall':p['overall'],
            'nationality':p['nationality'],'nationality2':None,'age':p['age'],'height':p['height'],
            'weight':p.get('weight'),'foot':p.get('foot'),'hand':'Right','aptitudes':p['apt'],
            'abilities':[{'key':DISPLAY_KEYS[k],'cn':ABILITY_SHORT_CN.get(DISPLAY_KEYS[k],k),'en':k,'value':v,'stored':v} for k,v in a.items() if k!='DefEngage'],
            'groups':[{'label':label,'keys':[ABILITY_SHORT_CN.get(k,k) for k in keys if k!=DISPLAY_KEYS['DefEngage']]} for label,keys in ABILITY_GROUPS],
            'abilities_scaled':False,'radar':[],
            'skills':[{'en':s,'cn':'','showtime':False} for s in p['skills']],
            'skills_total':len(p['skills']),'ai_styles':[],'att_style':'Basic','def_style':'Basic',
            'form':str(p.get('form_code','')),'injury':p['injury_res'],'wfu':p.get('wfu',1),'wfa':p.get('wfa',1),
            'clubs':{'club':self.team_info(team) if team else None,'youth':None,'owner':None},
            'emblem':team,'contract_end':p.get('contract_end'),'loan_end':p.get('loan_end'),'market_value':self.market_value(pid),'caps':p.get('caps',0),
            'golden_ball':False,'motions':[],
            'card':{'kind':'base','number':0,'vid_rule':0,'pack':0,'theme':0,'nt':False},
            'appearance':{'found':False,'face_flag':False,'groups':[]},
            'teams':[dict(self.teams[t]) for t in clubs]}

if __name__=='__main__':
    import random
    from league import sim,career,world
    game=FootballLifeData()
    report={'players':len(game.source['players']),'teams':len(game.teams),
            'missing_roster_ids':sorted({pid for pid in game.pid_teams if str(pid) not in game.source['players']})}
    teams=[121,120,123,124]
    ctx=world.WorldContext(game)
    c=career.Career.new('FL adapter test','FL adapter test',teams,121,
        team_info={t:game.team_info(t) for t in teams},seed=26)
    c.attach(ctx)
    rows=ctx.squad(121)
    assert len(rows)==36
    assert rows[0]['pid']==60447 and rows[0]['stamina']==70
    assert all(p['roman']==p['name'] for p in rows)
    result=sim.simulate(rows[:11],ctx.squad(120)[:11],random.Random(26))
    report['career_fixture_count']=len(c.d['fixtures'])
    report['simulation']=result
    report['milan_first_eleven']=[p['roman'] for p in rows[:11]]
    report['lifecycle']={}
    try:
        c.simulate_user_match()
        report['lifecycle']['simulate_user_match']='passed'
        for _ in range(30):
            if c.finished():break
            c.advance()
            if c.next_user_fixture():c.simulate_user_match()
        report['lifecycle']['season_finished']=c.finished()
        if c.finished():
            c.new_season()
            report['lifecycle']['new_season']='passed'
    except Exception as exc:
        import traceback
        report['lifecycle']['error']=repr(exc)
        report['lifecycle']['traceback']=traceback.format_exc()
    (ROOT/'native-engine-test.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Original career created from FL data:',report['career_fixture_count'],'fixtures')
    print('Original simulation:',result['home_goals'],result['away_goals'])
    print('Missing IDs across EDIT:',len(report['missing_roster_ids']))
    print('Milan XI:',report['milan_first_eleven'])
    print('Lifecycle:',report['lifecycle'])
