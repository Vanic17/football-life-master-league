"""Validate real native events and ratings before recording a played match.

All 177 counters are retained. Unverified counter labels are deliberately
absent from the career summary rather than assigned guessed values.
"""
import math
def summarize(snapshot):
    score=snapshot['score'];expected=snapshot['expected']
    if (score['home'],score['away'])!=(expected['home'],expected['away']):raise ValueError('Squadre diverse dalla partita preparata')
    if not snapshot.get('finished') or score['minute']<90:raise ValueError('Partita non ancora conclusa')
    rules=expected.get('rules',{})
    extra=score['minute']>=105 or any(e['period'] in (2,3) for events in snapshot['events'].values() for e in events)
    pens=[score.get('pk_home',0),score.get('pk_away',0)]
    if any(not isinstance(n,int) or n<0 or n>100 for n in pens):raise ValueError('Punteggio rigori non valido')
    shootout=bool(any(pens))
    if shootout and pens[0]==pens[1]:raise ValueError('Serie di rigori non conclusa')
    if extra and score['minute']<120:raise ValueError('Supplementari non ancora conclusi')
    if rules and (extra and not rules.get('extra_time') or shootout and not rules.get('penalties')):
        raise ValueError('Supplementari o rigori non previsti per questa partita')
    participants={};players=[]
    for side,team in enumerate(snapshot['teams']):
        if team['team_id']!=expected['home' if side==0 else 'away']:raise ValueError('Identità squadra non valida')
        for p in team['players']:
            if p['entered_minute'] is None:continue
            rating=p['native_rating']
            if not math.isfinite(rating) or not 0<=rating<=10:raise ValueError('Voto nativo non valido')
            if not p['native_rating_available'] and p['left_minute']-p['entered_minute']>15:raise ValueError('Voti finali non ancora disponibili')
            if len(p['raw_totals'])!=177:raise ValueError('Contatori individuali incompleti')
            row={'pid':p['player_id'],'team':team['team_id'],'side':side,'slot':p['slot'],
                 'sub':p['entered_minute']>0,'goals':p['raw_totals'][0],'assists':p['raw_totals'][4],
                 'rating':round(rating,4) if p['native_rating_available'] else None,'minutes':max(0,p['left_minute']-p['entered_minute']),
                 'yellow_cards':p['raw_totals'][57],'red_cards':p['raw_totals'][58],
                 'fouls':p['raw_totals'][55],'native_role':p.get('native_role')}
            if (side,row['pid']) in participants:raise ValueError('Giocatore duplicato')
            participants[side,row['pid']]=row;players.append(row)
    if any(sum(p['side']==s for p in players)<11 for s in (0,1)):raise ValueError('Formazioni incomplete')
    scorers=[];goal_counts=[0,0];extra_goals=[0,0];event_goals={};event_assists={}
    for e in snapshot['events']['goals']:
        side=e['side'];pid=e['player_id'];assist=e['other_player_id']
        if e['raw_type']!=0 or e['raw_fields'][8]!=0:raise ValueError('Tipo di gol non ancora verificato')
        if (side,pid) not in participants:raise ValueError('Marcatore non presente tra i partecipanti')
        goal_counts[side]+=1;event_goals[side,pid]=event_goals.get((side,pid),0)+1
        if e['period'] in (2,3):extra_goals[side]+=1
        if assist:
            if (side,assist) not in participants:raise ValueError('Assist non attribuibile')
            event_assists[side,assist]=event_assists.get((side,assist),0)+1
        scorers.append({'pid':pid,'team':expected['home' if side==0 else 'away'],'assist':assist,'minute':e['minute']})
    if goal_counts!=[score['home_score'],score['away_score']]:raise ValueError('Elenco gol e punteggio non corrispondono')
    aggregate=[a+b for a,b in zip(rules.get('aggregate_before',[0,0]),goal_counts)]
    if shootout and aggregate[0]!=aggregate[1]:raise ValueError('Rigori su risultato aggregato non pari')
    if rules.get('knockout') and rules.get('rule') in ('et_pens','et_seed') and aggregate[0]==aggregate[1] and not extra:
        raise ValueError('Parita aggregata: mancano i supplementari reali. Il ritorno in esibizione non supporta un aggregato iniziale non pari.')
    if rules.get('knockout') and rules.get('rule','et_pens') in ('et_pens','pens') and aggregate[0]==aggregate[1] and not shootout:
        raise ValueError('Parita nel confronto: manca la conclusione reale ai rigori. Nessun vincitore simulato.')
    for key,p in participants.items():
        if p['goals']!=event_goals.get(key,0) or p['assists']!=event_assists.get(key,0):raise ValueError('Contatori gol/assist non corrispondenti agli eventi')
    for e in snapshot['events']['cards']:
        p=participants.get((e['side'],e['player_id']))
        if p is None:raise ValueError('Cartellino di un giocatore non presente')
        if e['card_kind'] not in (0,1):raise ValueError('Codice cartellino nativo non riconosciuto')
        if e['card_kind']==0 and p['red_cards']<1:raise ValueError('Evento espulsione senza contatore corrispondente')
        if e['card_kind']==1 and p['yellow_cards']<1:raise ValueError('Evento ammonizione senza contatore corrispondente')
    for p in players:
        cards=[e for e in snapshot['events']['cards'] if (e['side'],e['player_id'])==(p['side'],p['pid'])]
        if sum(e['card_kind']==0 for e in cards)!=p['red_cards']:raise ValueError('Espulsioni ed eventi non corrispondono')
        yellows=sum(e['card_kind']==1 for e in cards)
        if yellows!=p['yellow_cards'] and not (p['yellow_cards']==2 and yellows==1 and p['red_cards']==1):raise ValueError('Ammonizioni ed eventi non corrispondono')
    return {'players':players,'scorers':scorers,'home_goals':goal_counts[0]-extra_goals[0],'away_goals':goal_counts[1]-extra_goals[1],
            'final_score':goal_counts,'et':extra_goals if extra else None,'pens':pens if shootout else None,
            'verified_fields':['goals','assists','yellow_cards','red_cards','fouls','ratings','minutes','substitutions'],
            'unverified_fields':['shots','passes','tackles','interceptions','saves','offsides','own_goals'],
            'offline_supported_fields':['extra_time','shootout_score']}
