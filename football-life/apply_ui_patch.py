"""Apply only adapter navigation changes to an existing local interface."""
from pathlib import Path

def apply(root):
    path=Path(root)/'engine/web/app.js'
    if not path.exists():return
    text=path.read_text(encoding='utf8')
    # Remove the entry points to About without distributing the original UI.
    import re
    text=re.sub(r'<button class="quiet" data-act="about">.*?</button>','',text)
    if 'function europeanCompetitionNav(' not in text:
        helper='''function europeanCompetitionNav(selected) {
  return `<nav class="fl-europe-nav" aria-label="Competizioni europee">${EURO.map(cid => `<button class="pill${selected === cid ? " primary" : ""}" data-act="open-ucl" data-comp="${cid}">${esc(compName(cid))}</button>`).join("")}</nav>`;
}
'''
        text=text.replace('async function openEuro(',helper+'async function openEuro(',1)
        text=text.replace('if (!u) continue;','/* All European competitions are available to browse. */',1)
        text=text.replace('const u = c.comps.find((x) => x.comp === cid);','const u = c.comps.find((x) => x.comp === cid) || {};',1)
        text=text.replace('+ empty, true, view, nav);','+ europeanCompetitionNav(cid) + empty, true, view, nav);',1)
        text=text.replace('esc(seasonTag()), cupsSub()), true, view, nav);','esc(seasonTag()), cupsSub()) + europeanCompetitionNav(), true, view, nav);',1)
    for start,end in [('async function openCups(','function openLeagues('),('function openLeagues(','function ',)]:
        pos=text.find(start)
        if pos<0:continue
        view=text.find('const view = {',pos)
        if view>=0 and view-pos<2000 and not text[view:view+70].startswith('const view = { competitionTabs:'):
            text=text[:view]+text[view:].replace('const view = {','const view = { competitionTabs: true,',1)
    if 'classList.toggle("fl-competition-page"' not in text:
        text=text.replace('const body = $("#modal-body");','const body = $("#modal-body");\n    body.classList.toggle("fl-competition-page", !!view?.competitionTabs);',1)
    path.write_text(text,encoding='utf8')

if __name__=='__main__':apply(Path(__file__).resolve().parent)
