"""Competition rules shared by exhibition preparation and native import."""
def rules_for(career, fixture):
    comp=career.d['comps'].get(fixture['comp'], {})
    tie=comp.get('ties', {}).get(fixture.get('tie'))
    if not tie:
        return {'knockout':False,'extra_time':0,'penalties':0,'aggregate_before':[0,0]}
    from league import world
    rule='et_pens'
    if isinstance(comp.get('rounds'),list):
        stage=next((r for r in comp['rounds'] if r['key']==tie['key']),None)
        if stage:rule=stage['rule']
    spec=world.CUPS.BY_ID.get(fixture['comp'])
    if spec and not isinstance(comp.get('rounds'),list):
        stage=next((r for r in spec['rounds'] if r['key']==tie['key']),None)
        if stage:rule=stage['rule']
    ids=tie['fixtures'];decisive=fixture['id']==ids[-1]
    aggregate=[0,0]
    for fid in ids:
        if fid==fixture['id']:break
        previous=career.fixture(fid)
        result=previous.get('result')
        if not result:raise ValueError('Andata non ancora conclusa')
        goals=[result['home_goals'],result['away_goals']]
        if result.get('et'):goals=[a+b for a,b in zip(goals,result['et'])]
        if previous['home']!=fixture['home']:goals.reverse()
        aggregate=[a+b for a,b in zip(aggregate,goals)]
    compatible=aggregate[0]==aggregate[1]
    return {'knockout':decisive,'rule':rule,'aggregate_before':aggregate,
            'extra_time':int(decisive and compatible and rule in ('et_pens','et_seed')),
            'penalties':int(decisive and compatible and rule in ('et_pens','pens')),
            'aggregate_exhibition_limit':bool(decisive and not compatible)}


def install():
    # Native matches must never receive simulated extra goals or a random winner.
    from league import world
    original=world.KO.resolve
    if getattr(original,'_fl_guard',False):return
    def resolve(tie,fixtures,*args,**kwargs):
        last=fixtures[tie['fixtures'][-1]]
        result=last.get('result')
        if not result or result.get('source')!='football-life-native':
            return original(tie,fixtures,*args,**kwargs)
        source=result['source'];result['source']='played'
        try:return original(tie,fixtures,*args,**kwargs)
        finally:result['source']=source
    resolve._fl_guard=True
    world.KO.resolve=resolve
