"""EUR-million career economics, anchored to dated public data and labelled estimates."""
import json
import math
import shutil
import contextvars,functools
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / 'economy-data/player-economy.json').read_text(encoding='utf-8'))
NATIVE = json.loads((ROOT / 'native-snapshot.json').read_text(encoding='utf-8'))['players']
MODELS = json.loads((ROOT / 'economy-data/economy-models.json').read_text(encoding='utf-8'))
VERSION = 3
WAGE_FACTORS = {}
DESTINATION=contextvars.ContextVar('fl_wage_destination',default=None)


class MarketValue(float):
    """Numeric EUR-million amount retaining the native PID for wage negotiations."""
    def __new__(cls, amount, pid):
        result=super().__new__(cls,amount)
        result.pid=int(pid)
        return result
    def __reduce__(self):
        return (MarketValue,(float(self),self.pid))


def entry(pid):
    from economy_online import current
    source=DATA['players'].get(str(pid), {})
    if source.get('name') and NATIVE.get(str(pid),{}).get('roman')!=source['name']:return {}
    return dict(source,**{k:v for k,v in current(pid).items() if k not in ('checked_at','errors')})


def baseline_value(p):
    published = entry(p['pid']).get('market_value_eur')
    if published is not None:
        return published / 1_000_000
    # Economic fallback uses native abilities only, never the old companion OVR.
    raw = NATIVE.get(str(p['pid']), p)
    from build_economy_models import features
    predicted = sum(a*b for a,b in zip(features(raw, MODELS['features']), MODELS['market_coefficients']))
    return round(min(150, max(.025, math.exp(predicted))), 3)


def player_value(p):
    raw = NATIVE.get(str(p['pid']), p)
    age_delta = max(0, p.get('age', raw.get('age', 26)) - raw.get('age', 26))
    import native_overall
    base_rating=native_overall.overall(raw['abilities'],raw['height'],raw['position'],raw['wfa'])
    growth_delta=p.get('overall',base_rating)-base_rating
    return round(baseline_value(p) * math.exp(-age_delta * .08 + growth_delta*.06), 3)


def baseline_wage(pid, value=None):
    published = entry(pid).get('annual_gross_wage_eur')
    if published is not None:
        return round(published / 1_000_000, 5)
    if value is None:
        value = baseline_value(dict(NATIVE.get(str(pid), {}), pid=int(pid)))
    raw=NATIVE.get(str(pid),{})
    predictors=[1,math.log(max(.025,value)),(raw.get('age',25)-25)/10,int(raw.get('position')=='GK')]
    estimated=math.exp(sum(a*b for a,b in zip(predictors,MODELS['wage_coefficients'])))
    return round(min(35,max(.018,estimated)) * WAGE_FACTORS.get(str(pid), 1),5)


def calibrate_club_wages(clubs, revenue_of):
    """Reserve 60% of annual recurring revenue for wages, preserving public figures.

    Transfer cash is not annual revenue: spending it all on recurring wages would
    make a club insolvent the next season. Only unpublished estimates are scaled.
    """
    for tid, players in clubs.items():
        missing=[p for p in players if not entry(p['pid']).get('annual_gross_wage_eur')]
        for p in missing:
            WAGE_FACTORS.pop(str(p['pid']), None)
        fixed=sum(baseline_wage(p['pid']) for p in players if p not in missing)
        estimated=sum(baseline_wage(p['pid']) for p in missing)
        if not estimated:
            continue
        available=max(0, float(revenue_of(tid))*.60-fixed)
        factor=min(1.5, available/estimated)
        # If published contracts already consume the budget, keep small plausible
        # reserve salaries rather than claim those real contracts are cheaper.
        factor=max(.05, factor)
        for p in missing:
            WAGE_FACTORS[str(p['pid'])]=factor


def provenance(pid):
    row = entry(pid)
    return {'market_source': row.get('market_value_source'),
            'market_date': row.get('market_value_date'),
            'market_kind': 'Transfermarkt' if 'market_value_eur' in row else 'stima del gestionale',
            'wage_source': row.get('wage_source'), 'wage_season': row.get('wage_season'),
            'wage_kind': row.get('wage_kind', 'stima del gestionale'),
            'wage_unit': 'EUR lordi annui, bonus esclusi',
            'online_market_retrieved_at':row.get('online_market_retrieved_at'),
            'online_wage_retrieved_at':row.get('online_wage_retrieved_at')}


def install():
    from league.world import WorldRules
    from league.market import Market
    if getattr(Market, '_fl_economy_installed', False):
        return
    WorldRules.player_value = lambda self, p, season=None, years=None: MarketValue(player_value(p),p['pid'])
    # Potential changes the negotiating price, not the published baseline.
    WorldRules._wonder_value = lambda self, p, pot, season: self.player_value(p, season)
    def wage_for(self,value,role='regular'):
        factor=float(getattr(self.cfg,'w_role',{}).get(role,1))
        if isinstance(value,MarketValue):
            p=dict(NATIVE.get(str(value.pid),{}),pid=value.pid)
            baseline=baseline_value(p)
            demand=baseline_wage(value.pid,baseline)*(max(.025,value)/max(.025,baseline))**.5
            context=DESTINATION.get()
            if context:
                career,tid=context
                revenue=max(.1,float(career.revenue_of(tid)))
                # Salary demand follows destination wage scale and player quality.
                target=max(.018,min(35,revenue*.60/25*(max(.025,float(value))/5)**.45))
                demand=.5*demand+.5*target
            return round(max(.018,min(35,demand*factor)),3)
        predictors=[1,math.log(max(.025,value)),0,0]
        return round(min(35,max(.018,math.exp(sum(a*b for a,b in zip(predictors,MODELS['wage_coefficients'])))*factor)),3)
    Market.wage_for=wage_for
    original = Market.ensure

    def ensure(self, clubs, season, value_of, revenue_of, user=None):
        calibrate_club_wages(clubs, revenue_of)
        existing = set(self.s['contracts'])
        result = original(self, clubs, season, value_of, revenue_of, user)
        for rows in clubs.values():
            for p in rows:
                key = str(p['pid'])
                if key not in existing and key in self.s['contracts']:
                    self.s['contracts'][key][1] = baseline_wage(p['pid'], value_of(p))
        return result

    Market.ensure = ensure
    from league.world import WorldCareer
    def contextual(original,team_argument=False):
        @functools.wraps(original)
        def wrapped(career,*args,**kwargs):
            tid=(kwargs.get('t',args[1] if len(args)>1 else None) if team_argument else career.d.get('user_team'))
            token=DESTINATION.set((career,tid) if tid else None)
            try:return original(career,*args,**kwargs)
            finally:DESTINATION.reset(token)
        return wrapped
    for name in ('quote','renew_ask','buy','renew'):
        setattr(WorldCareer,name,contextual(getattr(WorldCareer,name)))
    WorldCareer.renew_like_ai=contextual(WorldCareer.renew_like_ai,True)
    Market._fl_economy_installed = True


def migrate(career, game=None):
    """One-time correction; preserve deadlines, results, rosters and cash balances."""
    if career.d.get('fl_economy_version') == VERSION:
        return False
    path = Path(career.path)
    if path.exists():
        backup = ROOT / 'backups' / ('economy-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '-' + path.name)
        backup.parent.mkdir(exist_ok=True)
        shutil.copy2(path, backup)
    if game is not None:
        import native_growth
        native_growth.migrate(career, game)
        calibrate_club_wages(career._clubs(), career.revenue_of)
    for pid, contract in career.d.get('market', {}).get('contracts', {}).items():
        if pid in NATIVE and len(contract) >= 2:
            contract[1] = baseline_wage(pid)
            if len(contract) >= 3 and contract[2] is not None:
                contract[2] = round(baseline_value(dict(NATIVE[pid], pid=int(pid))) * 3, 3)
    career.d['fl_economy_version'] = VERSION
    career.save()
    return True
