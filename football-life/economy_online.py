"""Best-effort dated source refresh; never replace career contracts from the web."""
import html,json,re,threading,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
CACHE=ROOT/'economy-online-cache.json'
try:DATA=json.loads(CACHE.read_text(encoding='utf8'))
except (OSError,ValueError):DATA={}
LOCK=threading.Lock()
PENDING=set()

def euro_amount(text):
    text=html.unescape(text).replace('\xa0',' ').strip()
    match=re.search(r'(?:€|EUR)\s*([\d.,]+)\s*(bn|m|k|million|thousand)?',text,re.I)
    if not match:return None
    number,suffix=match.groups()
    if suffix:number=number.replace(',','.')
    else:number=number.replace(',','').replace('.','')
    value=float(number)*{'bn':1e9,'m':1e6,'million':1e6,'k':1e3,'thousand':1e3,None:1}[suffix.lower() if suffix else None]
    return round(value) if 0<value<=1e9 else None

def fetch(url):
    # Only known source links matched to native IDs; never guess a namesake.
    from urllib.parse import urlsplit
    host=urlsplit(url).hostname or ''
    if not (host.endswith('.transfermarkt.com') or host=='transfermarkt.com' or host.endswith('.capology.com') or host=='capology.com'):
        raise ValueError('Fonte non supportata')
    request=urllib.request.Request(url,headers={'User-Agent':'FootballLifeCareer/1.1 (personal source refresh)'})
    with urllib.request.urlopen(request,timeout=8) as response:
        if response.geturl().split('/')[2]!=host:raise ValueError('Redirect fonte differente')
        return response.read(2_000_000).decode('utf8',errors='replace')

def refresh(pid,row):
    if not row.get('market_value_source') and not row.get('wage_source'):return
    key=str(pid)
    with LOCK:
        if key in PENDING or len(PENDING)>=16 or time.time()-DATA.get(key,{}).get('checked_at',0)<7*86400:return
        PENDING.add(key)
    def job():
        result=dict(DATA.get(key,{}));errors=[]
        for field,source,kind in [('market_value_eur','market_value_source','market'),('annual_gross_wage_eur','wage_source','wage')]:
            url=row.get(source)
            if not url:continue
            try:
                page=fetch(url)
                pattern=r'data-header__market-value-wrapper[^>]*>(.*?)</a>' if kind=='market' else r'Gross Fixed Salary of\s*(.{1,100}?)\s*for the\s*(\d{4}-\d{4})'
                match=re.search(pattern,page,re.S|re.I)
                if not match:raise ValueError('Dato non presente nella pagina')
                value=euro_amount(re.sub('<[^>]+>','',match.group(1)))
                if not value:raise ValueError('Valuta/importo non riconosciuti')
                result[field]=value;result[source]=url
                result['online_'+kind+'_retrieved_at']=time.strftime('%Y-%m-%d')
                if kind=='wage':result['wage_season']=match.group(2);result['wage_kind']='published_capology_estimate'
            except Exception as exc:errors.append(kind+': '+str(exc))
        result['checked_at']=time.time();result['errors']=errors
        with LOCK:
            DATA[key]=result
            try:
                temp=CACHE.with_suffix('.tmp');temp.write_text(json.dumps(DATA,ensure_ascii=False),encoding='utf8');temp.replace(CACHE)
            finally:PENDING.discard(key)
    threading.Thread(target=job,daemon=True).start()

def current(pid):
    with LOCK:return dict(DATA.get(str(pid),{}))
