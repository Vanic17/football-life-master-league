"""Calendar invariants and a safe replacement for the legacy forced fallback."""
from collections import defaultdict, Counter
from datetime import date, timedelta

def audit(career):
    by_team=defaultdict(list)
    ids=set()
    for f in career.d['fixtures']:
        assert f['id'] not in ids, ('duplicate fixture', f['id'])
        ids.add(f['id'])
        assert f['home']!=f['away'], ('self match',f['id'])
        for tid in (f['home'],f['away']):by_team[tid].append(f)
    for tid,fs in by_team.items():
        fs.sort(key=lambda f:f['date'])
        for a,b in zip(fs,fs[1:]):
            gap=(date.fromisoformat(b['date'])-date.fromisoformat(a['date'])).days
            assert gap>=2, ('insufficient rest',tid,a['id'],b['id'],gap)
    for lgid,league in career.d['leagues'].items():
        fs=[f for f in career.d['fixtures'] if f['comp']=='L'+str(lgid)]
        pairs=Counter((f['home'],f['away']) for f in fs)
        teams=league['teams']
        assert len(fs)==len(teams)*(len(teams)-1),('league count',lgid)
        assert all(pairs[h,a]==1 for h in teams for a in teams if h!=a),('league opponents',lgid)
    for cid,comp in career.d['comps'].items():
        for tie in comp.get('ties',{}).values():
            fs=[career.fixture(fid) for fid in tie['fixtures']]
            assert all(a['date']<b['date'] for a,b in zip(fs,fs[1:])),('leg order',cid,tie['id'])
    return {'fixtures':len(ids),'teams':len(by_team),'same_day_conflicts':0,'minimum_gap_days':2}

def install():
    from league import world
    original=world.WorldCareer._place
    if getattr(original,'_fl_calendar',False):return
    def place(self,home,away,cands):
        day=original(self,home,away,cands)
        occupied=[date.fromisoformat(f['date']) for f in self.d['fixtures']
                  if home in (f['home'],f['away']) or away in (f['home'],f['away'])]
        def free(d):return all(abs((d-other).days)>=2 for other in occupied)
        if free(day):return day
        windows=world.K.intl_windows(self.d['season'])
        # The recovered engine can return an occupied date when all candidates
        # fail. Move forward, never silently create two matches on the same day.
        for delta in range(1,29):
            candidate=day+timedelta(days=delta)
            if free(candidate) and not world.K.in_window(candidate,windows):return candidate
        raise ValueError('Nessuna data libera per la partita nei prossimi 28 giorni')
    place._fl_calendar=True
    world.WorldCareer._place=place
