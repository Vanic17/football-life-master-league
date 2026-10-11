"""Gameplay overlays in PES21 EDIT records; appearance bytes remain untouched.

Layout reference: https://implyingrigged.info/wiki/Pro_Evolution_Soccer_2021/Edit_file
"""
import copy,struct
from editor.editfile import PLAYER_TOTAL_SIZE

ABILITY_BITS=dict(zip(('OffAware','BallCtrl','Dribble','TightPoss','LowPass','LoftPass','Finish','Header','SetPiece','Curl','Speed','Accel','KickPow','Jump','Physical','Balance','Stamina','DefAware','Tackle','Aggress','GKAware','GKCatch','GKParry','GKReflex','GKReach'),
                     (112,119,320,128,135,142,149,302,160,167,174,181,365,192,199,206,213,288,224,231,238,245,295,358,256)))
POSITIONS=('GK','CB','LB','RB','DMF','CMF','LMF','RMF','AMF','LWF','RWF','SS','CF')
SKILLS=('Scissors Feint','Double Touch','Flip Flap','Marseille Turn','Sombrero','Cross Over Turn','Cut Behind & Turn','Scotch Move','Step On Skill control','Heading (skill)','Long Range Drive','Chip shot control','Long Range Shooting','Knuckle Shot','Dipping Shot','Rising Shots','Acrobatic Finishing','Heel Trick','First-time Shot','One-touch Pass','Through Passing','Weighted Pass','Pinpoint Crossing','Outside Curler','Rabona','No Look Pass','Low Lofted Pass','GK Low Punt','GK High Punt','Long Throw','GK Long Throw','Penalty Specialist','GK Penalty Saver','Gamesmanship','Man Marking','Track Back','Interception','Acrobatic Clear','Captaincy','Super-Sub','Fighting Spirit')
COM=('Trickster','Mazing Run','Speeding Bullet','Incisive Run','Long Ball Expert','Early Cross','Long Ranger')
APT_BITS={**{p:333+2*i for i,p in enumerate(POSITIONS[:9])},'LWF':372,'RWF':352,'SS':354,'CF':356}

def bits(rec,bit,width):
    return (int.from_bytes(rec,'little')>>bit)&((1<<width)-1)

def put(rec,bit,width,value):
    mask=((1<<width)-1)<<bit
    n=(int.from_bytes(rec,'little')&~mask)|(int(value)<<bit)
    rec[:]=n.to_bytes(len(rec),'little')

def records(ef):
    for i in range(ef.player_count):
        off=ef.player_start+i*PLAYER_TOTAL_SIZE
        rec=bytearray(ef._data[off:off+240])
        pid=struct.unpack_from('<I',rec)[0]
        if pid:yield pid,off,rec

def overlay(rec,base):
    p=copy.deepcopy(base)
    flags=bits(rec,374,5)
    if bits(rec,255,1):
        p['name']=p['roman']=rec[54:115].split(b'\0')[0].decode('utf8')
        p['shirt_name']=rec[115:176].split(b'\0')[0].decode('utf8')
    if bits(rec,287,1):
        p.update(age=bits(rec,263,6),height=rec[10],weight=rec[11],
                 nationality_code=struct.unpack_from('<H',rec,8)[0]//2,
                 foot='Left' if bits(rec,381,1) else 'Right')
    if bits(rec,351,1):
        pos=bits(rec,269,4)
        if pos>=len(POSITIONS):raise ValueError('Posizione EDIT non valida')
        p['position']=POSITIONS[pos]
    if flags&1:p['apt']={k:bits(rec,b,2) for k,b in APT_BITS.items()}
    if flags&2:
        p['abilities']={k:bits(rec,b,7) for k,b in ABILITY_BITS.items()}
        if any(not 40<=v<=99 for v in p['abilities'].values()):raise ValueError('Abilita EDIT fuori intervallo')
        p.update(wfu=bits(rec,126,2),wfa=bits(rec,318,2),form_code=bits(rec,252,3),
                 injury_res=('Low','Medium','High')[min(2,bits(rec,327,2))],stamina=p['abilities']['Stamina'])
    if flags&8:p['playing_style_code']=bits(rec,274,5)
    skills=set(p['skills'])
    if flags&4:skills=(skills-set(SKILLS))|{s for i,s in enumerate(SKILLS) if bits(rec,390+i,1)}
    if flags&16:skills=(skills-set(COM))|{s for i,s in enumerate(COM) if bits(rec,383+i,1)}
    p['skills']=sorted(skills)
    return p

def import_players(ef,snapshot):
    result={}
    for pid,off,rec in records(ef):
        if str(pid) not in snapshot['players']:
            raise ValueError(f'Giocatore creato {pid}: non presente nella tabella nativa supportata')
        result[str(pid)]=overlay(rec,snapshot['players'][str(pid)])
    return result

def sync_progression(ef,native_records,fields,ability_names):
    for pid,off,rec in records(ef):
        native=native_records.get(pid)
        if native is None:continue
        # Existing edited abilities must not override the career's Player.bin.
        if bits(rec,374,5)&2:
            for key,b in ABILITY_BITS.items():put(rec,b,7,fields.getf(native,ability_names[key]))
        if bits(rec,287,1):put(rec,263,6,min(63,fields.getf(native,'Age')))
        ef._data[off:off+240]=rec
