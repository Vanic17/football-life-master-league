"""Integer OVR algorithm extracted from the installed Football Life executable.

Native routine RVA 0x1e5b540; tables RVA 0x2b47b70 and 0x2b48130.
No fitted coefficients, eFootball weights, height bonus or external player ratings.
"""
import json
from functools import lru_cache
from pathlib import Path
TABLES = json.loads(Path(__file__).with_name('native-overall-tables.json').read_text())
POSITIONS = ('GK', 'CB', 'LB', 'RB', 'DMF', 'CMF', 'LMF', 'RMF',
             'AMF', 'LWF', 'RWF', 'SS', 'CF')
FIELDS = ('OffAware', 'BallCtrl', 'Dribble', 'TightPoss', 'LowPass',
          'LoftPass', 'Finish', 'SetPiece', 'Curl', 'DefAware', 'Tackle',
          'Header', 'KickPow', 'Balance', 'Speed', 'Accel', 'Jump', 'Aggress',
          'Physical', 'GKAware', 'GKCatch', 'Stamina')


def vector(abilities, position, wfa=0, apt=None):
    col = POSITIONS.index(position)
    values = [0] * 41
    values[0] = TABLES['position_codes'][col]
    for i, pos in enumerate(POSITIONS):
        values[TABLES['position_codes'][i] + 1] = (apt or {}).get(pos, 0)
    for i, key in enumerate(FIELDS):
        values[14 + i] = int(abilities[key])
    # Native algorithm groups awareness/reach and catching/clearing/reflexes.
    values[36] = int(wfa)  # Stored 0..3, exactly as the native profile getter.
    values[37] = int(abilities['GKReach'])
    values[38] = int(abilities['GKCatch'])
    values[39] = int(abilities['GKParry'])
    values[40] = int(abilities['GKReflex'])
    return values


def from_vector(values, position_code):
    try:
        col = TABLES['position_codes'].index(position_code)
    except ValueError:
        return 70
    stats = list(values[14:37])
    stats[19] = (values[33] + values[37]) // 2
    stats[20] = (values[38] + values[39] + values[40]) // 3
    weighted = sum(((value - 25 if value >= 25 else 1) if i != 22 else value) *
                   TABLES['weights'][i][col] for i, value in enumerate(stats))
    rating = (weighted + 50) // 100
    if values[0] == position_code:
        rating += TABLES['registered_bonus'][col]
    elif values[position_code + 1] >= 2:
        rating += TABLES['familiar_bonus'][col]
    elif values[position_code + 1] == 1:
        rating += TABLES['partial_bonus'][col]
    if values[0] == position_code and position_code != 12:
        # Native magic multiply is unsigned integer division by 22.
        average = ((sum(stats[:22]) * 100) // 22 + 50) // 100
        curved = TABLES['average_curve'][average] if average < 100 else 70
        rating = (rating * 60 + curved * 40 + 50) // 100
    return max(40, min(109, rating))


def overall(abilities, height, position, wfa=0):
    """Height retained for legacy calling convention; native OVR does not use it."""
    values = vector(abilities, position, wfa)
    return from_vector(values, values[0])


@lru_cache(maxsize=13)
def position_weights(position):
    """Training/simulation sensitivity measured with the native OVR routine."""
    keys=set(FIELDS)|{'GKReach','GKParry','GKReflex'}
    baseline={k:75 for k in keys}
    weights={}
    for key in keys:
        lo=dict(baseline,**{key:70})
        hi=dict(baseline,**{key:80})
        weights[key]=max(0,(overall(hi,180,position,1)-overall(lo,180,position,1))/10)
    return weights
