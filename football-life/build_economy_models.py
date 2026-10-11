"""Fit transparent economic fallbacks to the downloaded observations, not OVR."""
import json
import math
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parent
POSITIONS = ('GK','CB','LB','RB','DMF','CMF','LMF','RMF','AMF','LWF','RWF','SS','CF')


def features(p, keys):
    age = p['age']
    return [1, (age-25)/10, ((age-25)/10)**2] + [
        (p['abilities'][k]-70)/20 for k in keys] + [
        int(p['position']==pos) for pos in POSITIONS[1:]]


def fit(x, y, penalty=5):
    x, y = np.asarray(x), np.asarray(y)
    regularizer = np.eye(x.shape[1])*penalty
    regularizer[0,0] = 0
    return np.linalg.solve(x.T@x+regularizer, x.T@y)


def build():
    players=json.loads((ROOT/'native-snapshot.json').read_text(encoding='utf-8'))['players']
    data=json.loads((ROOT/'economy-data/player-economy.json').read_text(encoding='utf-8'))
    keys=sorted(next(iter(players.values()))['abilities'])
    seen=set(); observations=[]
    for pid,r in data['players'].items():
        if r['transfermarkt_id'] in seen:continue
        seen.add(r['transfermarkt_id'])
        observations.append((pid,r))
    x=[features(players[pid],keys) for pid,r in observations]
    y=[math.log(r['market_value_eur']/1e6) for pid,r in observations]
    coeff=fit(x,y)
    wage_rows=[(pid,r) for pid,r in observations if r.get('annual_gross_wage_eur')]
    wx=[[1,math.log(r['market_value_eur']/1e6), (players[pid]['age']-25)/10,
         int(players[pid]['position']=='GK')] for pid,r in wage_rows]
    wy=[math.log(r['annual_gross_wage_eur']/1e6) for pid,r in wage_rows]
    wage_coeff=fit(wx,wy)
    result={'schema':1,'features':keys,'positions':POSITIONS,
            'market_coefficients':coeff.tolist(),'wage_coefficients':wage_coeff.tolist(),
            'market_training_players':len(x),'wage_training_players':len(wx),
            'kind':'local ridge estimate from native abilities and dated economic observations',
            'salary_coverage_note':'Wage training observations cover mainly Spain and AC Milan; other leagues are estimates.'}
    (ROOT/'economy-data/economy-models.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print('Economic fallback models:',len(x),'distinct market observations,',len(wx),'distinct wage observations')


if __name__=='__main__':build()
