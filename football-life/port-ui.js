/* FL-specific controls over the recovered career interface. */
Object.assign(LANG_PACKS.it, {
 'app-title':'Master League · Football Life 26',
 'setup-sub':'Database Football Life 26: 29.412 giocatori e 749 squadre',
 'ovr-title':'Generale calcolato con la routine nativa di Football Life 26 sulle abilità del database FL. La crescita usa le stesse abilità sincronizzate in EDIT.',
 'sec-ovr':'Generale Football Life',
 'world-sub':'Carriera 2026/27 con campionati simultanei e le tre coppe europee. Qualificate assenti sostituite con club reali di zona e forza simili: vedi «Football Life».',
 'play-hint':'In Football Life seleziona Esibizione con queste squadre',
 'play-hint2':'Gioca prepara rose e giocatori con backup, poi avvia Football Life. Conferma il risultato dopo il fischio finale dal pannello Football Life. Chiudi il gioco prima di preparare la partita successiva.',
 'game-launching':'Football Life avviato: seleziona la partita indicata nel pannello.',
 'game-starting':'Football Life è già aperto con questa partita preparata.',
 'comp-UECL':'Conference League','tile-uecl':'Conference League',
 'uecl-title':'Conference League','uecl-sub':'36 squadre, sei avversari, tre partite in casa e tre fuori. Sorteggio semplificato della carriera; prime otto agli ottavi, dal 9° al 24° ai play-off.',
 'uecl-not-in':'La tua squadra non partecipa alla Conference League.',
 'uecl-winner':'{t} vince la Conference League!',
 'comp-SUI':'Coppa di Germania',
 'uel-sub':'36 squadre, otto partite per club. Nel primo anno partecipano le qualificate 2026/27 presenti in Football Life e le sostituzioni dichiarate nel pannello.',
 'ucl-sub':'36 squadre, otto partite per club. Nel primo anno partecipano le qualificate 2026/27 presenti in Football Life e le sostituzioni dichiarate nel pannello.'
});
lang='it';
document.title='Master League · Football Life 26';
const flStyle=document.createElement('style');
flStyle.textContent=`#fl-tools{position:fixed;right:18px;top:12px;z-index:500;border:1px solid #ad8498;background:#242020;color:#fff;border-radius:20px;padding:9px 16px;font:inherit;cursor:pointer}#fl-dialog{background:#171414;color:#eee;border:1px solid #66545e;border-radius:16px;width:min(760px,90vw);max-height:85vh;padding:24px;font:14px/1.5 system-ui}#fl-dialog::backdrop{background:#000b}#fl-dialog button,#fl-dialog input{font:inherit;border:1px solid #73606b;background:#332b30;color:#fff;border-radius:8px;padding:8px;margin:5px}#fl-dialog input{width:70px}#fl-dialog table{border-collapse:collapse;width:100%}#fl-dialog td{padding:6px;border-bottom:1px solid #40343a}#fl-dialog a{color:#ddb5ce}#fl-dialog .fl-muted{color:#b8aeb3}#fl-message{white-space:pre-wrap;color:#edcadb}`;
document.head.append(flStyle);
flStyle.textContent+=`.fl-competition-page .tabs-bar{align-items:flex-start}.fl-competition-page .tabs{flex:1;flex-wrap:wrap;overflow:visible;max-height:200px;overflow-y:auto;scrollbar-width:thin}.fl-competition-page .tabs button.tab{padding:8px 12px}.fl-europe-nav{display:flex;flex-wrap:wrap;gap:8px;flex:none;margin:0 0 16px}.fl-europe-nav .pill{white-space:normal}@media(max-width:640px){.fl-competition-page .tabs{max-height:160px}.fl-competition-page .tabs button.tab{font-size:12px;padding:7px 10px}}`;
flStyle.textContent+='[data-act="superxi"],[data-act="plugin"]{display:none!important}';
const flButton=document.createElement('button');flButton.id='fl-tools';flButton.textContent='Football Life';document.body.append(flButton);
const flDialog=document.createElement('dialog');flDialog.id='fl-dialog';document.body.append(flDialog);
async function flRequest(url,body){
 const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok||data.error)throw new Error(data.error||r.statusText);return data;
}
async function flPanel(auto=false){
 const [s,e]=await Promise.all([flRequest('/fl/link'),flRequest('/fl/europe')]);
 if(auto&&(!flDialog.open||flDialog.dataset.busy))return;
 if(!auto)delete flDialog.dataset.actionError;
 const expected=s.expected;
 const native=s.native;
 const preview=native?.summary?.players;
 const names=new Map((native?.teams||[]).flatMap(t=>t.players.map(p=>[p.player_id,p.name])));
 const detail=preview?`<details open><summary>Dati reali acquisiti: ${preview.length} giocatori</summary><table><thead><tr><th>Giocatore</th><th>Gol</th><th>Assist</th><th>Gialli</th><th>Rossi</th><th>Voto</th></tr></thead><tbody>${preview.map(p=>`<tr><td>${esc(names.get(p.pid)||p.pid)}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.yellow_cards}</td><td>${p.red_cards}</td><td>${p.rating??'—'}</td></tr>`).join('')}</tbody></table></details>`:'';
 const replacements=Object.entries(e.competitions).map(([comp,rows])=>`<h3>${esc(compName(comp))}</h3><table>${rows.filter(x=>x.replacement).map(x=>`<tr><td>${esc(x.qualified)}</td><td>→ ${esc(x.team)}</td><td>${esc(x.country)}</td></tr>`).join('')}</table>`).join('');
 flDialog.innerHTML=`<button id="fl-close" style="float:right">Chiudi</button><h2>Football Life 26</h2><p>29.412 giocatori · 749 squadre · rose e abilità native FL.</p>
 <p>${expected?`Partita preparata: <b>${esc(expected.home_name)} – ${esc(expected.away_name)}</b>`:'Nessuna partita preparata. Crea la carriera e premi Gioca dalla prossima partita.'}</p>
 <p class="fl-muted">Il collegamento acquisisce automaticamente gol, assist, falli, cartellini, minuti, sostituzioni e voti nativi. Non serve lasciare visibile Sider. Supplementari e punteggio dei rigori finali sono gestiti e verificati con prove automatiche; la verifica sul campo resta da fare. I rigori finali non contano nella classifica marcatori. Tiri, passaggi e altre statistiche avanzate devono ancora essere interpretati e verificati; gli autogol restano bloccati.</p>
 ${expected?.rules?`<p>Impostazioni: supplementari ${expected.rules.extra_time?'attivi':'disattivati'}, rigori ${expected.rules.penalties?'attivi':'disattivati'}.${expected.rules.aggregate_exhibition_limit?' Il ritorno parte con un aggregato diverso da zero: l’esibizione non conosce il risultato dell’andata. In caso di parità aggregata l’importazione si ferma, senza assegnare un vincitore inventato.':''}</p>`:''}
 ${native?.summary?.pens?`<p>Serie di rigori: <b>${native.summary.pens[0]} – ${native.summary.pens[1]}</b>, separata dal risultato della partita.</p>`:''}
 ${expected?`<p>Rilevazione: ${native?`${native.score.home_score} – ${native.score.away_score}, ${native.finished?'partita conclusa':'minuto '+native.score.minute}`:s.live?`${s.live.home_score} – ${s.live.away_score}, minuto ${s.live.minute}; dati individuali in attesa`:'in attesa della partita'}</p>${expected.diagnostic?'<p>Prova diagnostica conservata: non verrà registrata nella carriera. Chiudi Football Life e premi Gioca per preparare una nuova partita.</p>':`<button id="fl-read" ${native?.detail_complete?'':'disabled'}>Conferma partita con dati reali</button>`}${native?.validation_error?`<p>${esc(native.validation_error)}</p>`:''}${detail}`:''}
 <p id="fl-message" role="status"></p><hr><h3>File e backup</h3><p class="fl-muted">${esc(s.backups)}<br>Gioco ${s.running?'aperto':'chiuso'}. L’EDIT originale viene conservato e ogni sincronizzazione crea un altro backup.</p><button id="fl-restore">Ripristina EDIT originale e scollega le rose della carriera</button><hr><details><summary>Coppe 2026/27: le 24 sostituzioni</summary><p>${esc(e.policy)}</p>${replacements}<p>${Object.entries(e.sources).map(([k,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener">Qualificate UEFA ${esc(k)}</a>`).join(' · ')}</p></details>`;
 if(expected && !native?.detail_complete && s.reader_status){
  const status=document.createElement('p');status.textContent=s.reader_status.message;status.className='fl-muted';flDialog.querySelector('#fl-message').before(status);
 }
 const manualScore=flDialog.querySelector('#fl-score');
 if(manualScore)manualScore.closest('p').remove();
 flDialog.querySelector('#fl-close').onclick=()=>flDialog.close();
 const action=(id,fn)=>{const b=flDialog.querySelector(id);if(b)b.onclick=async()=>{b.disabled=true;flDialog.dataset.busy='1';try{await fn();await refresh();await flPanel()}catch(err){flDialog.dataset.actionError='1';flDialog.querySelector('#fl-message').textContent=err.message}finally{b.disabled=false;delete flDialog.dataset.busy}}};
 action('#fl-read',()=>flRequest('/fl/result',{from_sider:true}));
 action('#fl-score',()=>flRequest('/fl/result',{home_goals:Number(flDialog.querySelector('#fl-hg').value),away_goals:Number(flDialog.querySelector('#fl-ag').value)}));
 action('#fl-restore',()=>flRequest('/fl/restore',{}));
 if(!flDialog.open&&!auto)flDialog.showModal();
}
flButton.onclick=()=>flPanel().catch(e=>alert(e.message));
let flPollBusy=false;
setInterval(async()=>{
 if(!flDialog.open||flDialog.dataset.busy||flDialog.dataset.actionError||flPollBusy)return;
 flPollBusy=true;
 try{await flPanel(true)}catch(error){const status=flDialog.querySelector('#fl-message');if(status)status.textContent=error.message}
 finally{flPollBusy=false}
},2000);
const flOriginalContractHtml=playerContractHtml;
playerContractHtml=function(p){
 const e=p.fl_economy;
 if(!e)return flOriginalContractHtml(p);
 const source=(url,label)=>url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:esc(label);
 return `<section class="panel"><h2 class="panel-head">Fonti economiche</h2><p>Valore iniziale: ${source(e.market_source,e.market_kind)}${e.market_date?` (${esc(e.market_date)})`:''}. Nelle stagioni successive il valore evolve nella carriera.</p><p>Ingaggio iniziale: ${source(e.wage_source,e.wage_kind==='published_capology_estimate'?'stima pubblicata da Capology':e.wage_kind)}${e.wage_season?` (${esc(e.wage_season)})`:''}. Stipendi lordi annui, bonus esclusi. Rinnovi e nuovi contratti sono negoziati dal gestionale.</p></section>`+flOriginalContractHtml(p);
};
const flOriginalApi=api;
api=async function(url,...args){const r=await flOriginalApi(url,...args);if(url==='/api/switch/game')await flPanel();return r};
