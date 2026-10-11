"""Native FL initial UEFA fields, with an additional Conference competition."""
import json,random,datetime,copy
from pathlib import Path
from league import world
ROOT=Path(__file__).resolve().parent
MAPPING=json.loads((ROOT/'europe-mapping.json').read_text(encoding='utf-8'))
COUNTRIES={int(k):v for k,v in MAPPING['countries'].items()}
world.EURO=('UCL','UEL','UECL')
world.EURO_NAME.update(UCL='Champions League',UEL='Europa League',UECL='Conference League')
world.MK.EURO_PRIZE['UECL']={k:round(v*.6,4) for k,v in world.MK.EURO_PRIZE['UEL'].items()}
world.K.EURO_DATES['UECL']=copy.deepcopy(world.K.EURO_DATES['UEL'])
world.K.EURO_DATES['UECL']['MD']=[[datetime.date(2026,m,d)] for m,d in [(10,15),(10,22),(11,5),(11,26),(12,10),(12,17)]]
world.K.EURO_DATES['UECL']['F']=[[datetime.date(2027,6,2)]]
german=world.CUPS.BY_ID['SUI']
german['country']='Germany'
german['entry']['default']='R32'
pre=copy.deepcopy(german['rounds'][0]);pre['key']='R32';pre['dates']=[[datetime.date(2026,9,16)]]
german['rounds'].insert(0,pre)
_assoc=world.WorldCareer.assoc_of
def assoc(self,tid):return COUNTRIES.get(int(tid)) or _assoc(self,tid)
world.WorldCareer.assoc_of=assoc
_ucl=world.WorldCareer._start_ucl
_uel=world.WorldCareer._start_uel
def field_for(c,cid):
    if c.d['season']==1:return [r['team_id'] for r in MAPPING['competitions'][cid]]
    taken={t for x,u in c.d['comps'].items() if x in ('UCL','UEL') for t in u.get('field',[])+u.get('direct',[])}
    candidates=[]
    for lg in c.d['leagues'].values():
        candidates.extend(t for t in lg['teams'] if t not in taken)
    candidates.extend(t for ts in c.d.get('no_league',{}).values() for t in ts if t not in taken)
    return sorted(set(candidates),key=lambda t:c.club_coef(t),reverse=True)[:36]
def start(c,cid):
    field=field_for(c,cid)
    if len(field)!=36:raise ValueError('La coppa europea richiede 36 squadre distinte')
    u={'id':cid,'format':'euro','stage':'league','field':field,'pots':[], 'ties':{},'rounds':{},'pos':{},'league_fixtures':[], 'winner':None,'runner_up':None,'ha_violations':[], 'from_ucl':[],'direct':field,'titleholder':None,'replaced':[]}
    c.d['comps'][cid]=u
    for tid in field:
        extra=c.d['no_league'].setdefault(world.NO_LEAGUE_ASSOC,[])
        if not any(tid in lg['teams'] for lg in c.d['leagues'].values()) and tid not in extra:extra.append(tid)
        c.d['team_info'].setdefault(str(tid),c.ctx.names(tid))
    rng=random.Random(str(c.d['seed'])+cid+str(c.d['season']))
    if cid!='UECL':
        u['pots']=world.ucl.make_pots(field,c.club_coef,None)
        c._euro_league_phase(cid,rng)
        return
    # Six distinct opponents, three home and three away. The circular draw
    # is a companion approximation, not the official UEFA pot algorithm.
    best=None
    for _ in range(3000):
        order=field[:];rng.shuffle(order)
        pairs=[[(order[i],order[(i+delta)%36]) for i in range(36)] for delta in (1,3,5)]
        penalty=sum(assoc(c,h)==assoc(c,a) for ps in pairs for h,a in ps)
        if best is None or penalty<best[0]:best=(penalty,pairs)
        if not penalty:break
    # Each odd-offset cycle partitions into two matchdays. Directed edges
    # give every club exactly one home and one away match per cycle.
    rounds=[]
    for ps in best[1]:
        edges={h:a for h,a in ps};visited=set();r1=[];r2=[]
        for initial in field:
            if initial in visited:continue
            node=initial;idx=0
            while node not in visited:
                visited.add(node);a=edges[node]
                (r1 if idx%2==0 else r2).append((node,a));node=a;idx+=1
        rounds.extend([r1,r2])
    u['pots']=[sorted(field,key=lambda t:c.club_coef(t),reverse=True)[i:i+6] for i in range(0,36,6)]
    u['draw_note']='Sorteggio semplificato: 6 avversari, 3 partite in casa e 3 fuori.'
    for md,ps in enumerate(rounds,1):
        day=world.K.shift(world.K.EURO_DATES['UECL']['MD'][md-1][0],c.d['season'])
        for h,a in ps:
            date=c._place(h,a,[day])
            u['league_fixtures'].append(c._new_fixture({'comp':cid,'stage':f'MD{md}','round':md,'date':date,'home':h,'away':a}))
def start_ucl(c):
    if c.d['season']==1:start(c,'UCL')
    else:_ucl(c)
def start_uel(c):
    if c.d['season']==1:start(c,'UEL')
    else:_uel(c)
    start(c,'UECL')
world.WorldCareer._start_ucl=start_ucl
world.WorldCareer._start_uel=start_uel
