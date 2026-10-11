"""Read-only FL 26.2.0.3 match capture. No process writes or injection."""
import ctypes as C
import gzip,json,os,struct,time,sys,math
from pathlib import Path
import psutil
from native_match_layout import *
from native_capture_session import CaptureSession
ROOT=Path(__file__).resolve().parent
SIZE=0x11AEE0
class MBI(C.Structure):
    _fields_=[('base',C.c_void_p),('allocation',C.c_void_p),('allocation_protect',C.c_ulong),('partition',C.c_ushort),('size',C.c_size_t),('state',C.c_ulong),('protect',C.c_ulong),('kind',C.c_ulong)]
k=C.WinDLL('kernel32',use_last_error=True)
k.OpenProcess.argtypes=[C.c_ulong,C.c_bool,C.c_ulong];k.OpenProcess.restype=C.c_void_p
k.ReadProcessMemory.argtypes=[C.c_void_p,C.c_void_p,C.c_void_p,C.c_size_t,C.POINTER(C.c_size_t)]
k.VirtualQueryEx.argtypes=[C.c_void_p,C.c_void_p,C.POINTER(MBI),C.c_size_t];k.VirtualQueryEx.restype=C.c_size_t
k.CloseHandle.argtypes=[C.c_void_p]
def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_bytes(data);os.replace(tmp,path)
def json_write(path,data):atomic(path,json.dumps(data,ensure_ascii=False,allow_nan=False).encode('utf-8'))
class Reader:
    def __init__(self,pid,native):
        self.pid=pid;self.native=native;self.handle=k.OpenProcess(0x410,False,pid)
        if not self.handle:raise C.WinError(C.get_last_error())
        # Fingerprint the actual native stats accessor; incompatible binaries fail closed.
        if self.read(0x140A3E8A0,8)!=bytes.fromhex('488d81d0500700c3'):
            self.close();raise ValueError('Versione Football Life non compatibile con gli offset verificati')
    def close(self):
        if self.handle:k.CloseHandle(self.handle);self.handle=None
    def read(self,address,size):
        b=C.create_string_buffer(size);n=C.c_size_t()
        if not k.ReadProcessMemory(self.handle,C.c_void_p(address),b,size,C.byref(n)) or n.value!=size:return None
        return b.raw
    def valid(self,raw,expected):
        if not raw or len(raw)!=SIZE:return False
        for side in (0,1):
            ids=[]
            for slot in range(40):
                pid=struct.unpack_from('<I',raw,side*TEAM_STRIDE+PLAYER_OFFSET+slot*PLAYER_STRIDE+4)[0]
                if pid:
                    if str(pid) not in self.native['players']:return False
                    ids.append(pid)
            if len(ids)<11 or len(set(ids))!=len(ids):return False
            allowed=set(expected.get('rosters',{}).get(str(expected['home' if side==0 else 'away']),[]))
            if not allowed:allowed=set(self.native['rosters'][str(expected['home' if side==0 else 'away'])]['player_ids'])
            if len(set(ids)&allowed)<11:return False
        try:decode_events(raw)
        except (ValueError,struct.error):return False
        return True
    def discover(self,expected,score=None):
        address=0;found=[]
        while address<0x7FFFFFFFFFFF:
            mbi=MBI()
            if not k.VirtualQueryEx(self.handle,C.c_void_p(address),C.byref(mbi),C.sizeof(mbi)):break
            address=(mbi.base or address)+mbi.size
            if mbi.state!=0x1000 or mbi.kind!=0x20000 or mbi.protect!=4 or mbi.size not in (0x190000,0x11B000):continue
            candidate=mbi.allocation+0x18+OWNER_STATS_OFFSET
            raw=self.read(candidate,SIZE)
            if not self.valid(raw,expected):continue
            if score:
                events=decode_events(raw)['goals']
                counts=[sum(e['side']==side for e in events) for side in (0,1)]
                if counts!=[score['home_score'],score['away_score']]:continue
                if score['minute']<90 and raw[0x108DAC]&0x20:continue
            found.append(candidate)
        if len(found)>1:raise ValueError('Più partite native individuate: acquisizione bloccata')
        return found[0] if found else None
    def capture(self,manager,expected,score):
        raw=self.read(manager,SIZE)
        if not self.valid(raw,expected):raise ValueError('Struttura della partita non più valida')
        teams=[]
        for side in (0,1):
            players=[]
            for slot,row in enumerate(decode_team(raw[side*TEAM_STRIDE:])):
                pid=row['player_id']
                if not pid:continue
                row.pop('rating_candidate',None)
                row.update(slot=slot,name=self.native['players'][str(pid)]['name'],native_role=struct.unpack_from('<I',raw,side*TEAM_STRIDE+PLAYER_OFFSET+slot*PLAYER_STRIDE+0x18F8)[0])
                players.append(row)
            teams.append({'team_id':expected['home' if side==0 else 'away'],'players':players})
        return {'expected':expected,'pid':self.pid,'manager':hex(manager),'captured_at':time.time(),
                'score':score,'teams':teams,'events':decode_events(raw),
                'native_flags':raw[0x108DAC],'finished':bool(raw[0x108DAC]&0x20),
                'format':'fl26-native-v1'}
def run():
    native=json.loads((ROOT/'native-snapshot.json').read_text(encoding='utf-8'))
    reader=None;manager=None;key=None;session=CaptureSession()
    try:
        while True:
            try:
                expected=json.loads((ROOT/'expected-match.json').read_text(encoding='utf-8'))
                diag=json.loads((ROOT/'launch-diagnostic.json').read_text(encoding='utf-8'))
                pid=diag['pid']
                if not psutil.pid_exists(pid):raise ValueError('Football Life chiuso: ultima acquisizione conservata')
                newkey=(pid,expected['career'],expected['fixture'],expected['started'])
                if newkey!=key:
                    if reader:reader.close()
                    reader=Reader(pid,native);manager=None;key=newkey;session=CaptureSession()
                score=json.loads((ROOT/'sider-live.json').read_text(encoding='utf-8'))
                if (ROOT/'sider-live.json').stat().st_mtime<expected['started'] or (score['home'],score['away'])!=(expected['home'],expected['away']):raise ValueError('In attesa delle squadre preparate')
                if session.observe(score):
                    manager=None
                    json_write(ROOT/'native-live.json',{'expected':expected,'score':score,'teams':[],
                        'captured_at':time.time(),'finished':False,'detail_complete':False,
                        'validation_error':'Nuova partita rilevata: acquisizione dei dati in corso.'})
                if manager is None:manager=reader.discover(expected,score)
                if manager is None:raise ValueError('In attesa della partita sul campo')
                try:snapshot=reader.capture(manager,expected,score)
                except ValueError:
                    manager=None
                    raise
                snapshot['capture_session']=repr(session.token)
                from native_match_import import summarize
                try:
                    summary=summarize(snapshot);snapshot['detail_complete']=True;snapshot['summary']=summary
                except ValueError as error:snapshot['detail_complete']=False;snapshot['validation_error']=str(error)
                json_write(ROOT/'native-live.json',snapshot)
                json_write(ROOT/'native-reader-status.json',{'at':time.time(),'message':
                    'Dati finali pronti per la conferma' if snapshot.get('detail_complete') else snapshot.get('validation_error','Partita in corso')})
                if snapshot['finished']:
                    label=__import__('hashlib').sha256(repr((key,session.token)).encode()).hexdigest()[:24]
                    atomic(ROOT/'match-results'/'native'/f'{label}.json.gz',gzip.compress(json.dumps(snapshot,ensure_ascii=False).encode()))
            except (OSError,ValueError,KeyError,psutil.Error) as error:
                json_write(ROOT/'native-reader-status.json',{'at':time.time(),'message':str(error)})
                if reader and not psutil.pid_exists(reader.pid):reader.close();reader=None;key=None;manager=None
            time.sleep(1)
    finally:
        if reader:reader.close()
if __name__=='__main__':run()
