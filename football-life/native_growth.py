"""Keep career growth totals on the same native algorithm as EDIT synchronization."""
import json
from pathlib import Path
import native_overall
NATIVE = json.loads(Path(__file__).with_name('native-snapshot.json').read_text(encoding='utf-8'))['players']


def install():
    from league.growth import Growth
    if getattr(Growth, '_fl_native_installed', False):
        return
    old_rec, old_fresh, old_overall = Growth.rec, Growth._fresh, Growth.overall

    def rec(self, pid):
        result = old_rec(self, pid)
        if result is not None:
            result['_fl_pid'] = int(pid)
        return result

    def fresh(self, p, season):
        result = old_fresh(self, p, season)
        result['_fl_pid'] = int(p['pid'])
        return result

    def overall(self, r):
        pid = r.get('_fl_pid')
        if pid is None:
            return old_overall(self, r)
        raw = NATIVE.get(str(pid))
        if raw is None or not self._abil:
            return old_overall(self, r)
        base = self._abil(pid)
        if not base:
            return old_overall(self, r)
        abilities = {k: max(40, min(99, round(v + r.get('d', {}).get(k, 0))))
                     for k, v in base.items()}
        result = native_overall.overall(abilities, raw['height'], r['pos'], raw['wfa'])
        r['ov'] = result
        return result

    Growth.rec, Growth._fresh, Growth.overall = rec, fresh, overall
    Growth._fl_native_installed = True


def migrate(career, game):
    growth = career.growth()
    for pid, r in career.d.get('growth', {}).get('p', {}).items():
        if pid not in NATIVE:
            continue
        p = game.player(int(pid))
        old = growth._fresh(dict(p, overall=r['ovr0']), 1)
        fresh = growth._fresh(p, 1)
        r['_fl_pid'] = int(pid)
        r['rep'] = max(0, fresh['rep'] + r.get('rep', 0) - old['rep'])
        r['pot'] = max(p['overall'], min(99, fresh['pot'] + r['pot'] - old['pot']))
        r['role'] = fresh['role']
        r['ovr0'] = p['overall']
        r['ov'] = growth.overall(r)
    for tid in list(career.d.get('strength0',{})):
        if int(tid) in game.teams:
            career.d['strength0'][tid]=game.strength(int(tid))
    for nation in career.d.get('nations',[]):
        if nation['id'] in game.teams:
            nation['strength']=game.strength(nation['id'])
    career.refresh_strength()
    if career.d.get('elo') and career.d.get('elo_base'):
        from league.world import ELO
        base={str(t):value for t,value in ELO.seed(career.elo_groups(),career.strength).items()}
        oldbase=career.d['elo_base']
        oldratings=career.d['elo']
        career.d['elo']={tid:round(value+oldratings.get(tid,oldbase.get(tid,value))-oldbase.get(tid,value),2)
                         for tid,value in base.items()}
        career.d['elo_base']=base
