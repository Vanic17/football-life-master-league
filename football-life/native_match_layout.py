"""FL26 native raw counters, reconstructed from this executable's accessors.

No counter labels are assumed from eFootball. Native identities, votes,
minutes and goal/card/substitution tables were verified against FL 26.2.0.3.
Raw counters preserve all values; individual labels require separate proof.
"""
import struct

STAT_COUNT=177
SEGMENT_COUNT=9
PLAYER_COUNT=40
PLAYER_OFFSET=0x64D8
PLAYER_STRIDE=0x2134
TEAM_STRIDE=0x59650
OWNER_STATS_OFFSET=0x750D0
COUNTERS_OFFSET=8
PERIOD_SEGMENTS=((0,1,2),(3,4,5),(6,),(7,),(8,),tuple(range(8)))

def decode_player(record):
    if len(record)!=PLAYER_STRIDE:
        raise ValueError('Incomplete native player counter record')
    values=struct.unpack_from('<'+str(STAT_COUNT*SEGMENT_COUNT)+'I',record,COUNTERS_OFFSET)
    segments=[list(values[i:i+SEGMENT_COUNT]) for i in range(0,len(values),SEGMENT_COUNT)]
    return {'raw_segments':segments,
            'raw_totals':[sum(row[:8]) for row in segments],
            'raw_periods':[[sum(row[i] for i in selected) for row in segments] for selected in PERIOD_SEGMENTS],
            'metadata_flag_candidate':record[0x18EC],
            'player_id':struct.unpack_from('<I',record,4)[0],
            'entered_minute':record[0x18EC] if record[0x18EC]!=255 else None,
            'left_minute':record[0x18ED] if record[0x18EC]!=255 else None,
            'native_rating':struct.unpack_from('<f',record,0x1934)[0],
            'native_rating_available':bool(record[0x1933]),
            'rating_candidate':struct.unpack_from('<f',record,0x1B94)[0],
            'verified':False}

def decode_events(manager):
    """Native event tables; preserve raw type values for untested event kinds."""
    if len(manager)<0x10B4E8:raise ValueError('Missing native event tables')
    result={'shootout_events':[]}
    for kind,offset,count in [('goals',0x108DBC,198),('cards',0x10ACB0,40),('substitutions',0x10B2F4,12)]:
        events=[]
        for index in range(count):
            fields=struct.unpack_from('<10I',manager,offset+index*40)
            event_type,side,period,minute,ticks,slot,other_slot=fields[:7]
            if event_type==3 and side==2 and period==5:continue
            if side not in (0,1) or period>4 or slot>=40:
                raise ValueError('Invalid native event identity')
            base=side*TEAM_STRIDE+PLAYER_OFFSET
            pid=struct.unpack_from('<I',manager,base+slot*PLAYER_STRIDE+4)[0]
            other_pid=struct.unpack_from('<I',manager,base+other_slot*PLAYER_STRIDE+4)[0] if kind!='cards' and other_slot<40 else None
            events.append({'raw_type':event_type,'side':side,'period':period,
                'minute':minute+(0,45,90,105,120)[period],'period_minute':minute,
                'player_id':pid,'other_player_id':other_pid,'slot':slot,
                'other_slot':other_slot,'raw_fields':list(fields),
                **({'card_kind':other_slot} if kind=='cards' else {})})
        # The shootout is separate from played-match goals and player counters.
        result['shootout_events'].extend(dict(e,event_table=kind) for e in events if e['period']==4)
        result[kind]=[e for e in events if e['period']!=4]
    return result

def decode_team(block):
    if len(block)<PLAYER_OFFSET+PLAYER_COUNT*PLAYER_STRIDE:
        raise ValueError('Incomplete native team counter block')
    return [decode_player(block[PLAYER_OFFSET+i*PLAYER_STRIDE:PLAYER_OFFSET+(i+1)*PLAYER_STRIDE])
            for i in range(PLAYER_COUNT)]
