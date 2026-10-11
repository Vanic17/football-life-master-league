"use strict";
// 大师联赛界面。数据全部来自本地服务 (server.py), 服务再从 dt200 / 游戏容器 / 比赛导出读。

const $ = (sel, el = document) => el.querySelector(sel);
// R-89: 一次性的动效 (入场、切换、弹出、数字滚动) 都用 GSAP 放; CSS 只留循环的 (转圈、扫光、呼吸) 和悬停 / 焦点这种状态过渡。
// 没载到 GSAP、或者系统设了减少动效: motion() 给 null, 调用的地方就直接到位不动
if (window.gsap && window.Flip) gsap.registerPlugin(Flip);
const motion = () => (window.gsap && !UI.reduced ? window.gsap : null);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = null;
let lastEvent = 0;
// 服务这次启动的标识。事件编号每次启动从 0 数: 标识变了, lastEvent 也得跟着换, 不然重启后的战报被滤掉
let boot = "";
// 本窗口的 id: 轮询时带上, 关窗口时说再见 —— 窗口全关了服务就退出
const CLIENT = Math.random().toString(36).slice(2) + Date.now().toString(36);
// 资源包版本 (服务端的资源包指纹)。换了 pak 它就变, 图片 URL 跟着变, 浏览器不会拿旧图
let assetsV = "";
// 头像跟着换的卡走 (R-34): 你的人换了变体卡, 用那张卡自己的头像 (卡上的球衣、照片); 卡没有头像服务端退回基础卡的
const img = (kind, key) => {
  if (kind === "face" && state && state.career && state.career.cards) key = state.career.cards[key] || key;
  return `/img/${kind}/${key}.png?v=${assetsV}`;
};
// name: 用户填的联赛名, null = 还没动过 (跟着语言显示默认名)。切语言会整页重画, 不存就被冲掉
const setup = { selected: new Map(), mine: null, query: "", name: null };
// 点了「新建联赛」: 服务端还有当前联赛, 但界面停在开档页, 事件触发的刷新也别把人弹回主页
let setupMode = false;

// 语言：中英写在 app.js 里; 别的语种是社区翻的译文包 (R-108): web/i18n/<代码>.json, 服务端拼成 /i18n.js 先载入,
// 放进去就多一种, 按钮自动轮换。导出英文原文、检查译文用 tools/i18n.py。
// fields: 球员名优先用哪个字段; locale: 日期格式
const NAME_LANGS = {
  zh: { label: "中文", fields: ["cn", "roman"], locale: "zh-CN" },
  en: { label: "EN", fields: ["roman", "cn"], locale: "en-GB" },
};
const LANG_PACKS = window.LANG_PACKS || {};
// 译文包里填错的 locale 会让 toLocaleDateString 直接抛错, 认不出就用英式日期
const okLocale = (l) => { try { return l && Intl.DateTimeFormat.supportedLocalesOf([l]).length ? l : "en-GB"; } catch (e) { return "en-GB"; } };
for (const [code, p] of Object.entries(LANG_PACKS)) {
  if (!NAME_LANGS[code]) NAME_LANGS[code] = { label: p._label || code.toUpperCase(), fields: ["roman", "cn"], locale: okLocale(p._locale || code) };
}
// 译文包里的一条; 没翻、或者带了 <b> 以外的标签 (译文会进 innerHTML) 就当没有, 由调用的地方退回英文
const px = (k) => {
  const v = LANG_PACKS[lang] && LANG_PACKS[lang][k];
  return typeof v === "string" && v.trim() && !/<(?!\/?b>)[A-Za-z\/!?]/.test(v) ? v : undefined;
};
// 游戏里的名字 (技能、AI 打法、能力短名): 中文界面用中文, 别的语种先查译文包 (skill.<英文>…) 再用英文
const gname = (ns, cn, en) => (lang === "zh" ? cn || en : px(ns + "." + en) || en);
// 悬停给另一种写法: 英文界面看中文, 其他看英文
const galt = (cn, en) => (lang === "en" ? cn : en);
let lang = null;
try { lang = localStorage.getItem("ml-lang"); } catch (e) { /* 无痕等极端情况 */ }
if (!NAME_LANGS[lang]) {
  const nav = (navigator.language || "").toLowerCase();
  lang = Object.keys(NAME_LANGS).find((c) => nav.startsWith(c.toLowerCase())) || "en";
}
// 快速模拟 (R-56): 点「模拟这场」不弹战报 (战报照旧从赛果、历史对局点进去看)。记在本机浏览器里
let fastSim = false;
try { fastSim = localStorage.getItem("ml-fast-sim") === "1"; } catch (e) { /* 同上 */ }

function cardDisplayName(p) {
  for (const f of NAME_LANGS[lang].fields) { if (p.names[f]) return p.names[f]; }
  return p.name;
}
const langToggleHtml = () => `<button class="lang-toggle quiet" data-k="lang" title="切换语言 / Switch language">${esc(NAME_LANGS[lang].label)}</button>`;
function onLangToggle() {
  const keys = Object.keys(NAME_LANGS);
  lang = keys[(keys.indexOf(lang) + 1) % keys.length];
  try { localStorage.setItem("ml-lang", lang); } catch (e) { /* 同上 */ }
  render();
  if (!$("#modal").hidden && currentView) currentView.reopen("replace");   // 弹窗 (连同返回按钮) 按新语言原地重画
}
function bindLangToggle() {
  document.querySelectorAll(".lang-toggle").forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = "1";
    b.addEventListener("click", onLangToggle);
  });
}

// 界面文案。t() 找不到当前语种就退回英文、再退回中文, 永远不显示 undefined。
// 中英以外的语种不写在这里, 走译文包 (见 NAME_LANGS 上面)。
const STRINGS = {
  "app-title": { zh: "大师联赛", en: "Master League" },
  "loading-game": { zh: "正在载入游戏数据…", en: "Loading game data…" },
  "loading-dt200": { zh: "正在载入 dt200…", en: "Loading dt200…" },
  "loading-player": { zh: "正在载入球员…", en: "Loading player…" },
  "err-connect": { zh: "连不上本地服务：", en: "Cannot reach local service: " },
  "err-load": { zh: "载入游戏数据失败：", en: "Failed to load game data: " },
  "setup-title": { zh: "新建大师联赛", en: "New Master League" },
  "setup-sub": { zh: "球队、球员、队徽全部取自游戏里的 dt200", en: "Teams, players and emblems all come from the in-game dt200" },
  "league-name": { zh: "联赛名", en: "League name" },
  "league-default": { zh: "大师联赛", en: "Master League" },
  "setup-lifemode": { zh: "世界规则", en: "World rules" },
  "setup-cup": { zh: "国内杯赛", en: "Domestic cup" },
  "setup-cards": { zh: "球员卡", en: "Player cards" },
  "setup-cards-base": { zh: "照游戏", en: "As in game" },
  "setup-cards-var": { zh: "全员变体卡", en: "All variant cards" },
  "setup-cards-note": { zh: "全员变体卡：全世界每个人换成他最新的一张变体卡，能力、技能、样子都用卡上的；周最佳这一类每队最多一张；没有变体卡的用基础卡。", en: "All variant cards: everyone uses their newest variant card (its own stats, skills and looks); at most one Player of the Week-type card per team; players without variants keep their base card." },
  "setup-div2": { zh: "次级联赛", en: "Second division" },
  "setup-div2-note": { zh: "次级联赛：一键选的英超 / 西甲 / 意甲 / 法甲用游戏里的次级联赛，其他按实力挑紧随其后的队；两级之间升降级，次级联赛有升级附加赛。", en: "Second division: Premier League / LaLiga / Serie A / Ligue 1 use their real second tier; otherwise the next-strongest clubs. Promotion, relegation and play-offs between the two." },
  "on": { zh: "开", en: "On" },
  "off": { zh: "关", en: "Off" },
  "comp-CC": { zh: "{l}杯", en: "{l} Cup" },
  "comp-CPO": { zh: "升级附加赛", en: "Promotion play-offs" },
  "cup-after": { zh: "第 {n} 轮之后", en: "After round {n}" },
  "setup-life-classic": { zh: "经典：有青训", en: "Classic: youth intake" },
  "setup-life-reborn": { zh: "转世世界：无青训，全员退役转世", en: "Reborn world: no youth, all retirees reborn" },
  "rw-tag": { zh: "转世世界", en: "Reborn world" },
  "nw-reborn-home": { zh: "{p} 退役后转世，16 岁回到本队（{pos}）", en: "{p} retires and is reborn back home aged 16 ({pos})" },
  "search-teams": { zh: "搜索球队", en: "Search teams" },
  "search-ph": { zh: "队名，中英文都行，比如 阿森纳 / Arsenal", en: "Team name, e.g. Arsenal / 阿森纳" },
  "selected": { zh: "已选", en: "Selected" },
  "teams-u": { zh: "队", en: "teams" },
  "pick-mine": { zh: "点「执教」选你的球队", en: "click Manage to pick your team" },
  "coach": { zh: "执教", en: "Manage" },
  "my-team": { zh: "我的球队", en: "My team" },
  "one-click": { zh: "按游戏联赛一键开档", en: "Start from an in-game league" },
  "one-click-hint": { zh: "照游戏原样填入球队，之后还能增删", en: "Fills in teams as in the game; you can still add or remove" },
  "loading-comps": { zh: "正在读联赛…", en: "Loading leagues…" },
  "comps-fail": { zh: "联赛没读出来", en: "Couldn't load leagues" },
  "stale-server": { zh: "服务可能是旧的：任务管理器里结束 pythonw 后再重开工具", en: "The service may be outdated: kill pythonw in Task Manager, then relaunch" },
  "retry": { zh: "重试", en: "Retry" },
  "custom-pick": { zh: "自选球队", en: "Custom teams" },
  "start-season": { zh: "开始赛季", en: "Start season" },
  "not-found": { zh: "没有找到", en: "No matches" },
  "add": { zh: "加入", en: "Add" },
  "remove": { zh: "移除", en: "Remove" },
  "set-mine": { zh: "设为我的球队", en: "Set as my team" },
  "people": { zh: "人", en: "players" },
  "strength": { zh: "实力", en: "Strength" },
  "from-left": { zh: "从左边搜索并加入球队", en: "Search on the left and add teams" },
  "need-2": { zh: "至少选 2 支队", en: "Pick at least 2 teams" },
  "no-mine": { zh: "还没选你的球队", en: "You haven't picked your team" },
  "rr-rounds": { zh: "双循环 {n} 轮", en: "Double round-robin, {n} rounds" },
  "start-failed": { zh: "开档失败：", en: "Failed to start: " },
  "season": { zh: "第 {n} 赛季", en: "Season {n}" },
  "round-x": { zh: "第 {a} / {b} 轮", en: "Round {a} / {b}" },
  "finished": { zh: "已结束", en: "Finished" },
  "managing": { zh: "执教 {t}", en: "Managing {t}" },
  "new-league": { zh: "新建联赛", en: "New league" },
  "saves": { zh: "存档", en: "Saves" },
  // 关于 (R-102): 署名、版本、官方帖、许可和免责。措辞要和包里实际有什么对得上 (LICENSE 第 6、7 条)
  "about": { zh: "关于", en: "About" },
  "ab-by": { zh: "作者 {a} · 版本 {v}", en: "By {a} · version {v}" },
  "ab-home": { zh: "官方发布帖", en: "Official release thread" },
  "ab-home-none": { zh: "{h} 论坛上的 RBs GameLab 发布帖", en: "The RBs GameLab thread on {h}" },
  "ab-only": { zh: "只从官方帖下载：别处的版本可能被人改过。想分享请发官方帖的链接，不要转载文件。",
    en: "Only download from the official thread: copies found elsewhere may have been tampered with. To share it, post the link to the thread, not the files." },
  "ab-free": { zh: "免费软件，不收费、不接受付费分发。", en: "Freeware. Never sold, never behind a paywall." },
  "ab-license": { zh: "使用许可和免责声明见程序文件夹里的 LICENSE.txt；第三方组件的许可见 THIRD_PARTY_NOTICES.txt 和 licenses 文件夹。",
    en: "License and disclaimer: LICENSE.txt in the program folder. Third-party components: THIRD_PARTY_NOTICES.txt and the licenses folder." },
  "ab-disclaimer": { zh: "本软件是独立的非官方工具，与 Konami 没有任何关系，未获其授权或认可。不含任何游戏文件、素材或数据库，队徽、头像、卡面都从你自己的游戏里读。eFootball™ 是其所有者的商标。",
    en: "An independent, unofficial tool, not affiliated with or endorsed by Konami. It contains no game files, artwork or databases; badges, faces and cards are read from your own installed game. eFootball™ is a trademark of its owner." },
  "ab-offline": { zh: "只在单机 / 离线模式下使用。部分功能会改写游戏数据，比赛统计插件会被游戏加载，联网时可能被当作作弊处理，后果自负。使用前请备份。",
    en: "Offline / single-player use only. Some features write to the game's data and the match-stats plugin is loaded by the game; online, this may be treated as cheating. Use at your own risk and back up first." },
  "ab-credits": { zh: "第二作者 Tom Gibbons：很多灵感和修改思路来自他的文件和文章。界面动画：GSAP。地球仪的陆地轮廓：Natural Earth（公共领域）。",
    en: "Co-author Tom Gibbons: many of the ideas and changes came from his files and articles. Animations: GSAP. Globe land outlines: Natural Earth (public domain)." },
  // 说明和许可都打在 exe 里 (R-105), 这里打开看
  "ab-docs": { zh: "说明和许可", en: "Guide & licenses" },
  "ab-licenses": { zh: "第三方组件的许可原文", en: "Third-party license texts" },
  "doc-guide": { zh: "使用说明", en: "User guide" },
  "doc-license": { zh: "使用许可和免责声明", en: "License & disclaimer" },
  "doc-notices": { zh: "第三方声明", en: "Third-party notices" },
  // 比赛统计插件 (R-105): 程序里装 / 更新 / 卸载
  "plugin": { zh: "插件", en: "Plugin" },
  "pg-title": { zh: "比赛统计插件", en: "Match-stats plugin" },
  "pg-what": { zh: "装上以后：踢完一场自动记下比分和每个球员的数据；联赛里的转会、新人、成长、伤停排阵、换卡会写进游戏，游戏开着时几秒内生效；游戏不在前台时不会跟着手柄动。不装也能玩，只是比分要手动录入或模拟，游戏里的阵容也不会跟着联赛变。",
    en: "With it, every match you play is recorded automatically (score and every player's stats); transfers, youngsters, growth, injuries and card changes are written into the game within seconds; and the game ignores the controller while it is in the background. Without it you can still play, but you enter or simulate scores and the in-game squads don't follow your career." },
  "pg-risk": { zh: "风险：插件是一个 dxgi.dll，被游戏自己加载进游戏进程。eFootball 是网络游戏，我们没法保证官方不会把这类插件当作弊处理。只在单机 / 离线时使用，要不要装你自己决定。",
    en: "Risk: the plugin is a dxgi.dll that the game loads into its own process. eFootball is an online game and we cannot promise Konami won't treat this kind of plugin as cheating. Use it offline / single-player only; it's your decision." },
  "pg-st-none": { zh: "还没装", en: "Not installed" },
  "pg-st-ok": { zh: "已安装，是最新版", en: "Installed, up to date" },
  "pg-st-old": { zh: "已安装，有新版本", en: "Installed, update available" },
  "pg-st-partial": { zh: "已安装，但开关不全", en: "Installed, but switches are missing" },
  "pg-st-other": { zh: "游戏目录里有别的 dxgi.dll（不是本程序放的）。安装时会把它改名备份，卸载时放回去。",
    en: "The game folder has another dxgi.dll (not ours). Installing renames it as a backup; uninstalling puts it back." },
  "pg-no-game": { zh: "找不到游戏目录", en: "Game folder not found" },
  "pg-no-bundle": { zh: "这个版本没有带插件", en: "This build has no plugin" },
  "pg-running": { zh: "游戏开着：先把游戏完全关掉再装 / 卸插件。", en: "The game is running: quit it completely before installing or removing the plugin." },
  "pg-install": { zh: "安装插件", en: "Install plugin" },
  "pg-update": { zh: "更新插件", en: "Update plugin" },
  "pg-repair": { zh: "修复", en: "Repair" },
  "pg-uninstall": { zh: "卸载插件", en: "Remove plugin" },
  "pg-install-q": { zh: "把插件装进游戏目录？只在单机 / 离线时使用。", en: "Install the plugin into the game folder? Use it offline / single-player only." },
  "pg-uninstall-q": { zh: "卸载插件？游戏会回到原来的样子（联赛存档不受影响）。", en: "Remove the plugin? The game goes back to normal (your careers are not affected)." },
  "pg-done-install": { zh: "插件装好了，下次启动游戏生效", en: "Plugin installed; it takes effect the next time you start the game" },
  "pg-done-uninstall": { zh: "插件卸载了", en: "Plugin removed" },
  "pg-where": { zh: "游戏目录", en: "Game folder" },
  "pg-toast": { zh: "还没装比赛统计插件：点页头的「插件」一键安装，踢完自动结算。", en: "The match-stats plugin isn't installed: click \"Plugin\" at the top to install it and have matches recorded automatically." },
  "pg-toast-old": { zh: "比赛统计插件有新版本：点页头的「插件」更新。", en: "A newer match-stats plugin is available: click \"Plugin\" at the top to update." },
  "continue-save": { zh: "继续已有联赛", en: "Continue a saved league" },
  "save-switch": { zh: "切换到这个", en: "Switch to this" },
  "save-current": { zh: "当前", en: "Current" },
  "save-broken": { zh: "读不了：{e}", en: "Can't read: {e}" },
  "save-line": { zh: "第 {s} 赛季 · 第 {r} / {t} 轮 · {n} 队", en: "Season {s} · Round {r} / {t} · {n} teams" },
  "save-updated": { zh: "上次改动 {d}", en: "Last changed {d}" },
  "no-saves": { zh: "没有别的存档", en: "No other saves" },
  "back-league": { zh: "← 返回当前联赛", en: "← Back to current league" },
  "seasons": { zh: "往季", en: "Past seasons" },
  "no-seasons": { zh: "还没有踢完的赛季", en: "No finished seasons yet" },
  "my-finish": { zh: "我的名次：第 {n}", en: "My finish: #{n}" },
  "final-table": { zh: "最终积分榜", en: "Final standings" },
  "th-season": { zh: "赛季", en: "Season" },
  "match-stats": { zh: "比赛统计", en: "Match stats" },
  "stats-basic-only": { zh: "这场只有基本数据（模拟赛或比赛导出文件不在了）", en: "Basic numbers only (simulated match, or the match export is gone)" },
  "stats-row-hint": { zh: "点球员那一行，展开他这场的全部数据", en: "Click a player's row to see all of his numbers" },
  "succ-of": { zh: "成功 / 尝试", en: "completed / attempted" },
  "sg-attack": { zh: "进攻", en: "Attack" },
  "sg-passing": { zh: "传球", en: "Passing" },
  "sg-possession": { zh: "控球", en: "Possession" },
  "sg-defending": { zh: "防守", en: "Defending" },
  "sg-gk": { zh: "门将", en: "Goalkeeping" },
  "sg-discipline": { zh: "纪律", en: "Discipline" },
  "del-league": { zh: "删除联赛", en: "Delete league" },
  "del-confirm": { zh: "删除当前联赛「{n}」？存档文件会一起删掉，撤销不回来。", en: "Delete the current league '{n}'? The save file goes with it. This cannot be undone." },
  "del-save": { zh: "删除", en: "Delete" },
  "del-save-aria": { zh: "删除存档「{n}」", en: "Delete save '{n}'" },
  "del-save-confirm": { zh: "删除存档「{n}」？存档文件会一起删掉，撤销不回来。", en: "Delete the save '{n}'? The file goes with it. This cannot be undone." },
  "del-save-done": { zh: "已删除「{n}」", en: "Deleted '{n}'" },
  "season-over": { zh: "赛季结束", en: "Season finished" },
  "champion": { zh: "冠军：", en: "Champions: " },
  "pts": { zh: "分", en: "pts" },
  "w-d-l": { zh: "{w} 胜 {d} 平 {l} 负", en: "{w}W {d}D {l}L" },
  "next-match": { zh: "下一场 · 第 {n} 轮", en: "Next match · Round {n}" },
  "vs": { zh: "VS", en: "VS" },
  "play-hint": { zh: "在 eFootball 里开一场友谊赛", en: "Play a friendly in eFootball" },
  "play-hint2": { zh: "踢完选「结束比赛」回主菜单，大约 5 秒后自动结算；战报在「赛果」里看。", en: "After the match, quit to the main menu; it settles automatically in about 5 seconds. The report is under Results." },
  "home-abbr": { zh: "（主）", en: " (home)" },
  "home-side": { zh: "主场", en: "Home" },
  "away-side": { zh: "客场", en: "Away" },
  "tile-next": { zh: "下一场", en: "Next match" },
  "tile-results": { zh: "赛果", en: "Results" },
  "tile-squad": { zh: "本队", en: "My squad" },
  "open-table": { zh: "完整积分榜", en: "Full standings" },
  "open-scorers": { zh: "完整射手榜", en: "All scorers" },
  "open-assists": { zh: "完整助攻榜", en: "All assists" },
  "open-squad": { zh: "全队数据", en: "Full squad stats" },
  "squad-list": { zh: "球队阵容", en: "Squad list" },
  "scout-opp": { zh: "看对手阵容", en: "Scout the opponent" },
  "pos-pts": { zh: "第 {p} 名 · {pts} 分", en: "#{p} · {pts} pts" },
  "lead-by": { zh: "领先第二名 {n} 分", en: "{n} pts clear at the top" },
  "behind": { zh: "落后榜首 {n} 分", en: "{n} pts behind the leader" },
  "top-scorer": { zh: "领跑：{n}，{g} 球", en: "Leading: {n}, {g} goals" },
  "top-assister": { zh: "领跑：{n}，{g} 次助攻", en: "Leading: {n}, {g} assists" },
  "squad-line": { zh: "{a} 人出过场 · 共进 {g} 球", en: "{a} players used · {g} goals" },
  "my-last": { zh: "我的比赛：{h} {s} {a}", en: "My match: {h} {s} {a}" },
  "home": { zh: "主页", en: "Home" },
  "cancel": { zh: "取消", en: "Cancel" },
  "sound-on": { zh: "音效：开", en: "Sound: on" },
  "sound-off": { zh: "音效：关", en: "Sound: off" },
  "hint-ok": { zh: "确认", en: "Select" },
  "hint-back": { zh: "返回", en: "Back" },
  "hint-switch": { zh: "切换栏目", en: "Switch" },
  "hint-tabs": { zh: "切换标签", en: "Tabs" },
  "hint-page": { zh: "翻页", en: "Page" },
  // 一屏一页 (R-20): 长页面拆成的标签
  "loading": { zh: "正在载入…", en: "Loading…" },
  "no-data": { zh: "还没有数据", en: "No data yet" },
  "boards": { zh: "数据榜", en: "Leaderboards" },
  "tab-summary": { zh: "概况", en: "Summary" },
  "key-stats": { zh: "主要数据", en: "Key stats" },
  "motm": { zh: "本场最佳", en: "Player of the match" },
  "goals-list": { zh: "进球", en: "Goals" },
  "tab-overview": { zh: "概览", en: "Overview" },
  "tab-skills": { zh: "技能与风格", en: "Skills & style" },
  "tab-profile": { zh: "档案", en: "Profile" },
  "tab-my-games": { zh: "我的比赛", en: "My games" },
  "tab-oneclick": { zh: "一键开档", en: "From a league" },
  "abilities": { zh: "能力值", en: "Abilities" },
  "top-5": { zh: "前五名", en: "Top 5" },
  "hint-game": { zh: "长按回游戏", en: "Hold: back to game" },
  "buff-on": { zh: "你已亲手连胜 {n} 场：这一场开球后，对手全队能力 +{d}（连胜暗改）。", en: "You've won {n} in a row: at kick-off the opponent's whole squad gets +{d} to every ability (winning-streak handicap)." },
  "buff-soon": { zh: "亲手连胜 {n} 场。再赢 {k} 场之后，开球时对手全队能力会 +{d}（连胜暗改）。", en: "{n} wins in a row. Win {k} more and from then on the opponent's whole squad starts at +{d} (winning-streak handicap)." },
  "buff-applied": { zh: "连胜暗改已生效：这一场对手全队能力 +{d}（你已亲手连胜 {n} 场）", en: "Winning-streak handicap is on: the opponent's whole squad is +{d} this match ({n} wins in a row)" },
  "buff-tag": { zh: "对手 +{d}（连胜暗改）", en: "Opponent +{d} (streak handicap)" },
  "team-rating": { zh: "模拟用：进攻 {a}（其中技能 {as}）· 防守 {d}（其中技能 {ds}）", en: "In simulations: attack {a} (skills {as}) · defence {d} (skills {ds})" },
  "team-rating-w": { zh: "阵容攻防：进攻 {a}（其中技能 {as}）· 防守 {d}（其中技能 {ds}）。模拟看 Elo，这两个数只管伤停、轮换时比全主力差多少", en: "Squad: attack {a} (skills {as}) · defence {d} (skills {ds}). Simulations use Elo; these only measure how much weaker an injured or rotated XI is" },
  "to-game": { zh: "进入游戏", en: "Go to game" },
  "game-launching": { zh: "游戏没开，正在通过 Steam 启动 eFootball…", en: "The game isn't running; launching eFootball via Steam…" },
  "game-starting": { zh: "游戏正在启动，等窗口出来再切", en: "The game is starting; switch once its window appears" },
  "game-failed": { zh: "Windows 没让切到游戏，点一下任务栏里的 eFootball", en: "Windows blocked the switch; click eFootball in the taskbar" },
  "game-unsupported": { zh: "只有 Windows 上能切到游戏", en: "Switching to the game only works on Windows" },
  // 真实日历生涯 (R-18)
  "world-title": { zh: "真实日历生涯", en: "Real-calendar career" },
  "world-sub": { zh: "游戏里欧洲 15 个联赛同时开踢，按 2026/27 的真实日历：周末联赛、周中欧冠和杯赛，国家队比赛日停赛；欧洲杯、世界杯到时候自动进行。", en: "All 15 European leagues in the game run at once on the real 2026/27 calendar: league weekends, Champions League and cup midweeks, breaks for international windows. The EURO and World Cup happen when they are due." },
  "world-pick": { zh: "选联赛，再点「执教」", en: "Pick a league, then Manage" },
  "world-start": { zh: "执教{t}，开始 2026/27 赛季", en: "Manage {t} and start 2026/27" },
  "world-creating": { zh: "正在排整个赛季的赛程（15 个联赛、杯赛、欧冠），几秒钟…", en: "Building the whole season (15 leagues, cups, Champions League)…" },
  "world-tag": { zh: "真实日历", en: "Real calendar" },
  "comp-UCL": { zh: "欧冠", en: "Champions League" },
  "comp-FAC": { zh: "足总杯", en: "FA Cup" },
  "comp-EFL": { zh: "联赛杯", en: "League Cup" },
  "comp-CDR": { zh: "国王杯", en: "Copa del Rey" },
  "comp-SCE": { zh: "西班牙超级杯", en: "Supercopa" },
  "comp-CIT": { zh: "意大利杯", en: "Coppa Italia" },
  "comp-CDF": { zh: "法国杯", en: "Coupe de France" },
  "comp-UEL": { zh: "欧联", en: "Europa League" },
  "comp-USC": { zh: "欧洲超级杯", en: "UEFA Super Cup" },
  "comp-KNV": { zh: "荷兰杯", en: "KNVB Cup" },
  "comp-TDP": { zh: "葡萄牙杯", en: "Taça de Portugal" },
  "comp-SUI": { zh: "瑞士杯", en: "Swiss Cup" },
  "comp-TUR": { zh: "土耳其杯", en: "Turkish Cup" },
  "comp-SCO": { zh: "苏格兰杯", en: "Scottish Cup" },
  "comp-DBU": { zh: "丹麦杯", en: "Danish Cup" },
  "comp-BEL": { zh: "比利时杯", en: "Belgian Cup" },
  "comp-CSH": { zh: "社区盾", en: "Community Shield" },
  "comp-SCI": { zh: "意大利超级杯", en: "Supercoppa Italiana" },
  "comp-TDC": { zh: "法国超级杯", en: "Trophée des Champions" },
  "comp-JCS": { zh: "荷兰超级杯", en: "Johan Cruijff Schaal" },
  "comp-STP": { zh: "葡萄牙超级杯", en: "Supertaça" },
  "comp-TSC": { zh: "土耳其超级杯", en: "Turkish Super Cup" },
  "comp-BSC": { zh: "比利时超级杯", en: "Belgian Super Cup" },
  "comp-PO": { zh: "{l}升级附加赛", en: "{l} promotion play-offs" },
  "comp-PO343": { zh: "法国升降级附加赛", en: "Ligue 1 / Ligue 2 play-offs" },
  "comp-EURO": { zh: "欧洲杯", en: "EURO" },
  "comp-WC": { zh: "世界杯", en: "World Cup" },
  "st-MD": { zh: "联赛阶段第 {n} 轮", en: "League phase MD{n}" },
  "st-PO": { zh: "资格附加赛", en: "Qualifying play-off" },
  "st-wait": { zh: "等抽签", en: "Awaiting draw" },
  "st-KPO": { zh: "淘汰赛附加赛", en: "Knockout play-off" },
  "st-PRE": { zh: "预选轮", en: "Preliminary round" },
  "st-PO1": { zh: "附加赛第一轮", en: "Play-off round 1" },
  "st-PO2": { zh: "附加赛第二轮", en: "Play-off round 2" },
  "by-seed": { zh: "打平，联赛名次高的晋级", en: "Level: higher league finish goes through" },
  "cup-direct": { zh: "联赛第 3 名领先第 4 名超过 14 分，附加赛不踢，第 3 名直接升级", en: "3rd finished more than 14 points clear of 4th: no play-offs, 3rd promoted directly" },
  "st-R1": { zh: "第一轮", en: "First round" },
  "st-R2": { zh: "第二轮", en: "Second round" },
  "st-R3": { zh: "第三轮", en: "Third round" },
  "st-R4": { zh: "第四轮", en: "Fourth round" },
  "st-R5": { zh: "第五轮", en: "Fifth round" },
  "st-R64": { zh: "64 强", en: "Round of 64" },
  "st-R32": { zh: "32 强", en: "Round of 32" },
  "st-R16": { zh: "16 强", en: "Round of 16" },
  "st-QF": { zh: "8 强", en: "Quarter-final" },
  "st-SF": { zh: "半决赛", en: "Semi-final" },
  "st-F": { zh: "决赛", en: "Final" },
  "st-3P": { zh: "三四名决赛", en: "Third-place play-off" },
  "st-G": { zh: "小组赛第 {n} 轮", en: "Group matchday {n}" },
  "leg-1": { zh: "首回合", en: "1st leg" },
  "leg-2": { zh: "次回合", en: "2nd leg" },
  "first-leg": { zh: "首回合 {a}–{b}", en: "1st leg {a}–{b}" },
  "agg": { zh: "总比分 {a}–{b}", en: "Agg. {a}–{b}" },
  "et": { zh: "加时 {a}–{b}", en: "Extra time {a}–{b}" },
  "pens": { zh: "点球 {a}–{b}", en: "Penalties {a}–{b}" },
  "neutral": { zh: "中立场地", en: "Neutral venue" },
  "postponed": { zh: "改期", en: "Rescheduled" },
  "through": { zh: "{t}晋级", en: "{t} through" },
  "decide-title": { zh: "打平了：谁晋级？", en: "Level: who went through?" },
  "decide-sub": { zh: "你在游戏里踢平了（{s}）。点球或加时谁赢了，就点谁；比赛统计里认不出点球大战，所以要你说一声。", en: "You drew in the game ({s}). Click whoever won on penalties or in extra time; the match stats can't tell a shoot-out yet." },
  "decide-win": { zh: "{t} 晋级", en: "{t} went through" },
  "tile-ucl": { zh: "欧冠", en: "Champions League" },
  "tile-uel": { zh: "欧联", en: "Europa League" },
  "tile-cups": { zh: "杯赛", en: "Cups" },
  "tile-calendar": { zh: "赛历", en: "Calendar" },
  "tile-leagues": { zh: "各国联赛", en: "Leagues" },
  "tile-national": { zh: "国家队", en: "Internationals" },
  "calendar": { zh: "赛历", en: "Calendar" },
  "calendar-sub": { zh: "你这季的每一场，和中间的国家队比赛日、各项决赛", en: "Every match you have this season, plus international windows and finals" },
  "ev-intl": { zh: "国际比赛日", en: "International window" },
  "ev-final": { zh: "{c}决赛", en: "{c} final" },
  "ev-league_start": { zh: "{c}开赛", en: "{c} starts" },
  "ev-league_end": { zh: "{c}收官", en: "{c} ends" },
  "ev-tournament": { zh: "{y} 年{c}", en: "{c} {y}" },
  "ucl-title": { zh: "欧冠", en: "Champions League" },
  "ucl-sub": { zh: "36 队一张总表，每队 8 场；前 8 直进 16 强，9–24 名打附加赛，25–36 名出局。之后两回合淘汰，决赛单场。", en: "One 36-team table, 8 games each; top 8 go to the round of 16, 9–24 play off, 25–36 are out. Two-legged knockouts, one-off final." },
  "ucl-league": { zh: "联赛阶段", en: "League phase" },
  "ucl-ko": { zh: "淘汰赛", en: "Knockout" },
  "ucl-mine": { zh: "你的联赛阶段 8 场", en: "Your 8 league-phase games" },
  "ucl-replaced": { zh: "真实 2026/27 欧冠有 10 队游戏里没有，换成了：", en: "10 real 2026/27 clubs are not in the game; replaced by:" },
  "ucl-winner": { zh: "{t} 夺得欧冠", en: "{t} won the Champions League" },
  "ucl-not-in": { zh: "你这季没踢欧冠。", en: "You are not in the Champions League this season." },
  "uel-title": { zh: "欧联", en: "Europa League" },
  "uel-sub": { zh: "赛制和欧冠一样：36 队一张总表，每队 8 场，周四踢。名额给各国杯赛冠军和联赛名次，再加欧冠资格附加赛的负者；冠军下季进欧冠。", en: "Same format as the Champions League: one 36-team table, 8 games each, on Thursdays. Places go to domestic cup winners and league finishers, plus the Champions League play-off losers; the winner goes into next season's Champions League." },
  "uel-winner": { zh: "{t} 夺得欧联", en: "{t} won the Europa League" },
  "uel-not-in": { zh: "你这季没踢欧联。", en: "You are not in the Europa League this season." },
  "uel-from-ucl": { zh: "欧冠附加赛输了转来的：", en: "Dropped in from the Champions League play-offs:" },
  "uel-waiting": { zh: "欧冠资格附加赛踢完（8 月底）再凑齐 36 队抽签。已经确定的 {n} 队：", en: "The draw waits for the Champions League play-offs (late August). {n} clubs are already in:" },
  "cups-title": { zh: "杯赛", en: "Cups" },
  "cups-sub": { zh: "只有游戏里有的两级球队参加：前几轮自动跳过，凑不成对就让种子队轮空", en: "Only the two tiers in the game take part: early rounds are skipped, top seeds get byes to even out the draw" },
  "cup-byes": { zh: "轮空：{n} 队", en: "Byes: {n}" },
  "cup-skipped": { zh: "这一轮不用踢（队数不够）", en: "Not needed (too few teams)" },
  "cup-undrawn": { zh: "还没抽签 · {d}", en: "Not drawn yet · {d}" },
  "cup-winner": { zh: "冠军：{t}", en: "Winner: {t}" },
  "leagues-title": { zh: "各国联赛", en: "Leagues" },
  "divs-title": { zh: "各级联赛", en: "Divisions" },
  "cups-sub-custom": { zh: "两级所有球队参加，单场淘汰，平局加时点球，低级别的队主场；凑不成对就让种子队轮空", en: "Every club from both divisions: one-off ties, extra time and penalties, lower-tier side at home; top seeds get byes to even out the draw" },
  "national-title": { zh: "国家队", en: "Internationals" },
  "national-sub": { zh: "欧国联、各洲预选赛和洲际附加赛在国际比赛日踢，欧洲杯、世界杯在夏天；每个窗口按国籍从全世界俱乐部征召", en: "Nations League, qualifiers and the play-off tournament run in the international windows, the EURO and World Cup in summer; every window each nation calls up its best players from clubs worldwide" },
  "ic-NL": { zh: "欧国联 {y}", en: "Nations League {y}" },
  "ic-EQ": { zh: "{y} 欧洲杯预选赛", en: "EURO {y} qualifying" },
  "ic-WQ": { zh: "{y} 世界杯预选赛 · {c}", en: "World Cup {y} qualifying · {c}" },
  "ic-ICP": { zh: "{y} 世界杯洲际附加赛", en: "World Cup {y} play-off tournament" },
  "ics-NL": { zh: "欧国联", en: "Nations League" },
  "ics-EQ": { zh: "欧洲杯预选赛", en: "EURO qualifying" },
  "ics-WQ": { zh: "世预赛 · {c}", en: "WCQ · {c}" },
  "ics-ICP": { zh: "洲际附加赛", en: "Play-off tournament" },
  "conf-UEFA": { zh: "欧洲", en: "Europe" },
  "conf-AFC": { zh: "亚洲", en: "Asia" },
  "conf-CAF": { zh: "非洲", en: "Africa" },
  "conf-CONCACAF": { zh: "中北美", en: "N. & C. America" },
  "conf-CONMEBOL": { zh: "南美", en: "South America" },
  "conf-OFC": { zh: "大洋洲", en: "Oceania" },
  "nst-LP": { zh: "联赛阶段", en: "League phase" },
  "nst-A": { zh: "联赛阶段", en: "League phase" },
  "nst-QF": { zh: "八强", en: "Quarter-finals" },
  "nst-PR": { zh: "升降级附加赛", en: "Promotion/relegation play-offs" },
  "nst-SF": { zh: "半决赛", en: "Semi-finals" },
  "nst-3P": { zh: "三四名决赛", en: "Third-place play-off" },
  "nst-F": { zh: "决赛", en: "Final" },
  "nst-G": { zh: "小组赛", en: "Group stage" },
  "nst-PO": { zh: "附加赛", en: "Play-offs" },
  "nst-POS": { zh: "附加赛半决赛", en: "Play-off semi-finals" },
  "nst-POF": { zh: "附加赛决赛", en: "Play-off finals" },
  "nst-L": { zh: "循环赛", en: "Round robin" },
  "nst-R2": { zh: "第二阶段", en: "Second round" },
  "nst-R3": { zh: "第三阶段", en: "Third round" },
  "nst-R4": { zh: "第四阶段（赛会制）", en: "Fourth round (one venue)" },
  "nst-R5": { zh: "第五阶段", en: "Fifth round" },
  "nst-FR": { zh: "最终轮", en: "Final round" },
  "nst-R32": { zh: "32 强", en: "Round of 32" },
  "nst-R16": { zh: "16 强", en: "Round of 16" },
  "ng-tier": { zh: "{t} 级第 {n} 组", en: "League {t} · Group {n}" },
  "ng-letter": { zh: "{g} 组", en: "Group {g}" },
  "ng-num": { zh: "第 {n} 组", en: "Group {n}" },
  "nat-sched": { zh: "日程", en: "Schedule" },
  "nat-window": { zh: "国际比赛日", en: "International window" },
  "nat-quiet": { zh: "没有正式比赛", en: "No competitive matches" },
  "nat-qualified": { zh: "出线", en: "Qualified" },
  "nat-playoff": { zh: "去洲际附加赛", en: "To the play-off tournament" },
  "nat-progress": { zh: "已踢 {a} / {b} 场", en: "{a} of {b} played" },
  "nat-next": { zh: "下一场 {d}", en: "Next {d}" },
  "nat-skipped": { zh: "读档时这项赛事已经开打了，没有踢；出线按国家队 Elo 补出。", en: "This competition was already under way when the save was loaded, so it wasn't played; qualifiers were filled by national-team Elo." },
  "nat-tbd": { zh: "抽签还没做（等前一阶段踢完）", en: "Not drawn yet (waiting for the previous stage)" },
  "nat-agg": { zh: "总比分 {a}–{b}", en: "Agg. {a}–{b}" },
  "nat-champ": { zh: "冠军 {w}", en: "Winner {w}" },
  "nat-comps": { zh: "国家队赛事", en: "Competitions" },
  "ov-title": { zh: "全部栏目", en: "All sections" },
  "ov-sub": { zh: "方向键选，确认跳过去", en: "Pick one and jump straight to it" },
  "ov-go": { zh: "跳过去", en: "Go" },
  "ov-close": { zh: "关上", en: "Close" },
  "nt-kicker": { zh: "你执教的国家队", en: "Your national team" },
  "nt-note": { zh: "国家队的比赛也是你的下一场：可以进游戏亲手踢（开球时征召名单和首发写进游戏里的这支国家队），也可以模拟。", en: "National-team matches are your matches too: play them in eFootball (the call-up and starting XI are written into this national team at kick-off) or simulate." },
  "nt-next-is": { zh: "下一场 {d}", en: "next match {d}" },
  "nt-callup": { zh: "征召名单", en: "Call-up" },
  "nt-callup-sub": { zh: "从游戏里所有俱乐部按国籍挑，16–26 人；不挑就由 AI 按总评挑。点一下加进来 / 拿掉，保存后这个窗口还没踢的比赛马上换。", en: "Pick 16–26 players of this nationality from every club in the game, or let the AI pick by rating. Click to add or drop; saving applies to this window's remaining matches straight away." },
  "nt-squad": { zh: "名单", en: "Squad" },
  "nt-squad-n": { zh: "{n} / {m} 人", en: "{n} of {m}" },
  "nt-pool": { zh: "能征召的", en: "Eligible" },
  "nt-pool-n": { zh: "共 {n} 人", en: "{n} players" },
  "nt-save": { zh: "保存名单", en: "Save squad" },
  "nt-auto": { zh: "交给 AI 挑", en: "Let the AI pick" },
  "nt-custom": { zh: "现在用的是你挑的名单", en: "Using your squad" },
  "nt-ai": { zh: "现在用的是 AI 挑的名单", en: "Using the AI's squad" },
  "nt-saved": { zh: "名单存好了", en: "Squad saved" },
  "nt-full": { zh: "名单最多 {m} 人", en: "At most {m} players" },
  "nt-resign": { zh: "辞去国家队主帅", en: "Resign" },
  "nt-resign-q": { zh: "辞去{t}主帅？之后要等别的国家队来邀请。", en: "Resign as {t} coach? You'll have to wait for another offer." },
  "nt-accept": { zh: "接受", en: "Accept" },
  "nt-decline": { zh: "拒绝", en: "Decline" },
  "nt-no-job": { zh: "你现在没执教国家队。国家队换帅时，按你的俱乐部的实力会有邀请找上门。", en: "You don't coach a national team. When one changes coach, you may get an offer depending on your club's standing." },
  "nt-offer-why-change": { zh: "换帅，想请你去（{d} 前答复）", en: "Changing coach and wants you (reply by {d})" },
  "nt-offer-why-not_qualified": { zh: "没打进大赛，换帅（{d} 前答复）", en: "Missed the tournament and wants you (reply by {d})" },
  "nt-offer-why-group_exit": { zh: "大赛小组赛出局，换帅（{d} 前答复）", en: "Out in the group stage and wants you (reply by {d})" },
  "todo-nt": { zh: "国家队邀请 {n}", en: "{n} national-team offer(s)" },
  "nw-nt_offer": { zh: "{t} 邀请你出任主帅", en: "{t} want you as their coach" },
  "nw-nt_hired": { zh: "你出任 {t} 主帅", en: "You are the new {t} coach" },
  "nw-nt_left": { zh: "你不再执教 {t}", en: "You are no longer {t} coach" },
  "nt-ntjob": { zh: "国家队", en: "National team" },
  "setup-nt": { zh: "兼任国家队", en: "National team" },
  "setup-nt-none": { zh: "不兼任", en: "None" },
  "setup-nt-pick": { zh: "选一支", en: "Choose" },
  "setup-nt-head": { zh: "选一支国家队", en: "Choose a national team" },
  "setup-nt-hint": { zh: "可以不选：之后国家队换帅时也可能收到邀请", en: "Optional: offers may come later when a nation changes coach" },
  "nat-upcoming": { zh: "接下来", en: "Coming up" },
  "nat-after": { zh: "{s} 赛季之后", en: "after {s}" },
  "nat-none": { zh: "还没办过。", en: "None played yet." },
  "nat-winner": { zh: "冠军 {w} · 亚军 {r}", en: "Winner {w} · runner-up {r}" },
  "season-done": { zh: "{s} 赛季踢完了", en: "The {s} season is over" },
  "ucl-pos": { zh: "第 {p} / 36", en: "{p} / 36" },
  "kickoff": { zh: "开始比赛", en: "Kick off" },
  "ko-note": { zh: "在 eFootball 里开一场友谊赛，两边选{h}和{a}，谁主谁客都行。踢完回主菜单，这边自动结算。", en: "In eFootball, start a friendly with {h} and {a}; either side can be home. Quit to the main menu afterwards and the result settles here automatically." },
  "ko-failed": { zh: "没能切到游戏：{e}", en: "Couldn't switch to the game: {e}" },
  "sim-mine": { zh: "模拟这场", en: "Simulate" },
  "manual-in": { zh: "手动录入", en: "Manual" },
  "top-rated": { zh: "两队评分前三", en: "Top rated" },
  "no-goals": { zh: "没进球", en: "No goals" },
  "manual-why": { zh: "比赛导出没接上时，自己填比分", en: "Enter the score yourself if the match export didn't come through" },
  "next-more": { zh: "更多", en: "More" },
  "next-less": { zh: "收起", en: "Less" },
  "mh": { zh: "主", en: "H" },
  "ma": { zh: "客", en: "A" },
  "ok": { zh: "确定", en: "OK" },
  "need-score": { zh: "两边比分都要填 0–99 的整数", en: "Enter both scores as whole numbers 0–99" },
  "src-played": { zh: "实战", en: "Played" },
  "src-manual": { zh: "手动", en: "Manual" },
  "src-sim": { zh: "模拟", en: "Sim" },
  "results": { zh: "赛果", en: "Results" },
  "no-results": { zh: "还没有比赛结果", en: "No results yet" },
  "round-results": { zh: "第 {n} 轮赛果", en: "Round {n} results" },
  "history": { zh: "历史对局", en: "Match history" },
  "back-to": { zh: "返回 {n}", en: "Back to {n}" },
  "my-players": { zh: "本队本季数据", en: "My team this season" },
  "th-player": { zh: "球员", en: "Player" },
  "th-pos": { zh: "位置", en: "Pos" },
  "th-apps": { zh: "出场", en: "Apps" },
  "th-goals": { zh: "进球", en: "Goals" },
  "th-rating": { zh: "平均评分", en: "Avg rating" },
  "standings": { zh: "积分榜", en: "Standings" },
  "th-team": { zh: "球队", en: "Team" },
  "th-p": { zh: "赛", en: "P" },
  "th-w": { zh: "胜", en: "W" },
  "th-d": { zh: "平", en: "D" },
  "th-l": { zh: "负", en: "L" },
  "th-gf": { zh: "进", en: "GF" },
  "th-ga": { zh: "失", en: "GA" },
  "th-gd": { zh: "净", en: "GD" },
  "th-pts": { zh: "分", en: "Pts" },
  "th-form": { zh: "近况", en: "Form" },
  "form-w": { zh: "胜", en: "W" },
  "form-d": { zh: "平", en: "D" },
  "form-l": { zh: "负", en: "L" },
  "scorers": { zh: "射手榜", en: "Top scorers" },
  "th-rating1": { zh: "评分", en: "Rating" },
  "th-shots": { zh: "射门", en: "Shots" },
  "th-passes": { zh: "传球", en: "Passes" },
  "th-tackles": { zh: "抢断", en: "Tackles" },
  "th-int": { zh: "拦截", en: "Interceptions" },
  "th-cards": { zh: "红黄牌", en: "Cards" },
  "th-fouls": { zh: "犯规", en: "Fouls" },
  "round-tag": { zh: "第 {n} 轮", en: "Round {n}" },
  "sim-only": { zh: "模拟比分（旧存档，没有球员明细）。", en: "Simulated score (old save, no player detail)." },
  "manual-only": { zh: "手动录入的比分，没有球员数据。", en: "Manually entered score, no player data." },
  "manual-sim": { zh: "手动录入：比分是你填的，进球人和球员数据按这个比分模拟。", en: "Entered by hand: the score is yours; scorers and player stats are simulated to fit it." },
  "team-strength": { zh: "实力 {s} · {n} 人", en: "Strength {s} · {n} players" },
  "team-elo": { zh: "Elo {e}（全世界第 {r} / {n}）· 这季基准 {b} · 模拟用 {s}", en: "Elo {e} (#{r} of {n}) · season baseline {b} · used in sims {s}" },
  "odds": { zh: "赛前胜率", en: "Pre-match odds" },
  "unread": { zh: "未读", en: "Unread" },
  "odds-h": { zh: "主胜 {p}", en: "Home {p}" },
  "odds-d": { zh: "平 {p}", en: "Draw {p}" },
  "odds-a": { zh: "客胜 {p}", en: "Away {p}" },
  "th-num": { zh: "#", en: "#" },
  "th-age": { zh: "年龄", en: "Age" },
  "th-ovr": { zh: "总评", en: "Overall" },
  "tag-sub": { zh: "替补", en: "Sub" },
  "unmatched": { zh: "检测到一场比赛（{a}），但对不上下一场赛程：{b}", en: "Spotted a match ({a}) but it doesn't fit the next fixture: {b}" },
  "open-player": { zh: "打开球员页", en: "Open player page" },
  "age-u": { zh: "岁", en: "y/o" },
  "second-nat": { zh: "第二国籍 {n}", en: "2nd nationality: {n}" },
  "ovr-title": { zh: "按主位置现算（显示值），与编辑器一致", en: "Computed for main position (display values), same as the editor" },
  "sec-card": { zh: "球员卡", en: "Player card" },
  "base-card": { zh: "基础卡", en: "Base card" },
  "var-card": { zh: "变体卡", en: "Featured card" },
  "no-material": { zh: "这是变体卡, 但游戏还没把它的卡面下载到本地, 先用头像代替 (联网后在游戏里看一眼这张卡就会下载)", en: "This is a featured card, but the game hasn't downloaded its artwork yet, so the face is shown instead (view the card in-game while online to download it)" },
  "no-history": { zh: "还没有踢过的比赛", en: "No matches played yet" },
  "sec-ovr": { zh: "总评", en: "Overall" },
  "raw-note": { zh: "数据库原始值（裸卡，非升级后）", en: "Raw database values (base card, not levelled)" },
  "scaled-note": { zh: "这批卡存的是放大值，界面显示的是换算后的显示值（与编辑器一致）。", en: "These cards store scaled-up values; display values are shown (same as the editor)." },
  "stored-tip": { zh: "记录值 {v}，已换算为显示值", en: "Stored value {v}, converted to display value" },
  "grp-atk": { zh: "进攻", en: "Attack" },
  "grp-pass": { zh: "传球", en: "Passing" },
  "grp-drib": { zh: "盘带", en: "Dribbling" },
  "grp-def": { zh: "防守", en: "Defending" },
  "grp-body": { zh: "身体", en: "Physical" },
  "grp-gk": { zh: "门将", en: "GK" },
  "sec-pos": { zh: "位置熟练度", en: "Position proficiency" },
  "pos-main": { zh: "主位置", en: "Main position" },
  "pos-a": { zh: "擅长", en: "Proficient" },
  "pos-b": { zh: "可胜任", en: "Capable" },
  "pos-c": { zh: "不能打", en: "Unplayable" },
  "sec-skills": { zh: "技能", en: "Skills" },
  "sec-style": { zh: "风格", en: "Playstyle" },
  "st-atk": { zh: "进攻", en: "Attack" },
  "st-def": { zh: "防守", en: "Defence" },
  "st-ai": { zh: "AI 风格", en: "AI styles" },
  "sec-cond": { zh: "状态", en: "Condition" },
  "form": { zh: "稳定性", en: "Form" },
  "injury": { zh: "伤病抵抗", en: "Injury resistance" },
  "wfu": { zh: "逆足频率", en: "Weak-foot usage" },
  "wfa": { zh: "逆足精度", en: "Weak-foot accuracy" },
  "foot": { zh: "惯用脚", en: "Stronger foot" },
  "hand": { zh: "惯用手", en: "Stronger hand" },
  "sec-league": { zh: "联赛数据", en: "League stats" },
  "no-career": { zh: "还没开档。", en: "No career started." },
  "season-line": { zh: "第 {s} 赛季：出场 {a} · 进球 {g} · 助攻 {as} · 平均评分 {r} · 犯规 {f} · 红黄牌 {c}", en: "Season {s}: {a} apps · {g} goals · {as} assists · avg rating {r} · fouls {f} · cards {c}" },
  "th-assists": { zh: "助攻", en: "Ast" },
  "assisters": { zh: "助攻榜", en: "Top assists" },
  // 球员卡展台和领奖台 (R-19)
  "unit-goals": { zh: "球", en: "goals" },
  "unit-assists": { zh: "助攻", en: "assists" },
  "sc-bigtime": { zh: "Big Time", en: "Big Time" },
  "sc-star": { zh: "联赛球星", en: "League star" },
  "sc-empty": { zh: "这个联赛的球员卡素材本地还没有（游戏联网后在卡面上看一眼就会下载）", en: "No card artwork for this league yet (view the cards in-game while online to download them)" },
  "sc-open": { zh: "打开 {n} 的球员页", en: "Open {n}'s player page" },
  "sc-pick": { zh: "指到一个联赛，看它的 Big Time 球星", en: "Point at a league to see its Big Time stars" },
  "no-apps": { zh: "第 {s} 赛季：还没有出场记录", en: "Season {s}: no appearances yet" },
  "th-round": { zh: "轮", en: "Rd" },
  "th-match": { zh: "比赛", en: "Match" },
  "sec-basic": { zh: "基本信息", en: "Profile" },
  "nm-cn": { zh: "中文名", en: "Chinese name" },
  "nm-roman": { zh: "罗马名", en: "Roman name" },
  "nm-shirt": { zh: "球衣名", en: "Shirt name" },
  "nm-full": { zh: "全名", en: "Full name" },
  "human-id": { zh: "人 ID", en: "Human ID" },
  "hw": { zh: "身高 / 体重", en: "Height / Weight" },
  "cm-kg": { zh: "{h} cm / {w} kg", en: "{h} cm / {w} kg" },
  "club": { zh: "所属俱乐部", en: "Club" },
  "youth": { zh: "青训俱乐部", en: "Youth club" },
  "owner": { zh: "所有权", en: "Owned by" },
  "contract": { zh: "合同到期", en: "Contract until" },
  "loan": { zh: "租借到期", en: "Loan until" },
  "mv": { zh: "市值", en: "Market value" },
  "caps": { zh: "国家队出场", en: "National caps" },
  "teams": { zh: "效力球队", en: "Plays for" },
  "none": { zh: "—", en: "—" },
  "sec-motions": { zh: "动作", en: "Motions" },
  "sec-cardinfo": { zh: "卡片信息", en: "Card info" },
  "base-note": { zh: "基础卡（PID < 2²⁴）。", en: "Base card (PID < 2²⁴)." },
  "kind-num": { zh: "卡种 / 编号", en: "Card type / No." },
  "pack": { zh: "卡包", en: "Pack" },
  "theme": { zh: "主题", en: "Theme" },
  "str-ab": { zh: "强度 STR", en: "Strength STR" },
  "golden": { zh: "金球先生", en: "Ballon d'Or" },
  "special": { zh: "特殊块", en: "Special block" },
  "nt-card": { zh: "国家队卡", en: "National team card" },
  "gk-flag": { zh: "门将标记", en: "GK flag" },
  "yes": { zh: "是", en: "Yes" },
  "no": { zh: "否", en: "No" },
  "sec-app": { zh: "外观", en: "Appearance" },
  "no-app": { zh: "外观表里没有这条记录。", en: "No appearance record." },
  "face-flag": { zh: "真脸标记位（byte58 & 0x04）：", en: "Real-face flag (byte58 & 0x04): " },
  "face-on": { zh: "开", en: "On" },
  "face-off": { zh: "关", en: "Off" },
  "face-note": { zh: "完整判定还要查脸模（RealFace 容器扫描，未做）。", en: "Full check needs a face-model scan (RealFace containers, not done)." },
  // 伤停 (R-21)
  "absent": { zh: "缺阵", en: "Out" },
  "absent-hint": { zh: "游戏不会替你把伤停的人换下：开球前在 eFootball 里调好阵容。带伤或停赛中上场的，赛后会在战报里标出来。", en: "The game won't drop them for you: fix your lineup in eFootball before kickoff. Anyone who plays while injured or suspended is flagged in the match report." },
  "fit-title": { zh: "伤停", en: "Injuries & suspensions" },
  "ingame-on": { zh: "开球时程序会把游戏里两队的阵容按伤停排好：伤停的人坐替补席，对面累了的人也会轮换。你的队只换下伤停的人，累不累你自己排。", en: "At kickoff the program sets both lineups in the game: injured and suspended players go to the bench and tired opponents are rotated. For your team only injured and suspended players are swapped out." },
  "ingame-done": { zh: "游戏里的阵容已经按伤停换好（游戏重读用了 {ms} 毫秒）。", en: "The in-game lineups are set (the game reloaded in {ms} ms)." },
  "ingame-queued": { zh: "阵容已经写进游戏，游戏数据一就绪就会自动重读。", en: "The lineups are written to the game and load as soon as it's ready." },
  "ingame-fail": { zh: "没能把阵容写进游戏：{e}", en: "Couldn't set the in-game lineups: {e}" },
  "th-fit": { zh: "状态", en: "Status" },
  "fit-cond": { zh: "体能", en: "Fitness" },
  "cond-tip": { zh: "体能：每踢一场掉一截，按天恢复。体能低了发挥差、也更容易受伤", en: "Fitness drops after every match and recovers day by day. Tired players perform worse and get injured more easily" },
  "fit-inj": { zh: "伤", en: "Inj" },
  "fit-ban": { zh: "停", en: "Susp" },
  "fit-inj-long": { zh: "受伤", en: "Injured" },
  "fit-ban-long": { zh: "停赛", en: "Suspended" },
  "inj-back": { zh: "预计 {d} 回来", en: "back {d}" },
  "inj-weeks": { zh: "约 {n} 周", en: "about {n} wk" },
  "ban-n": { zh: "停 {n} 场", en: "{n}-match ban" },
  "why-red": { zh: "红牌", en: "Red card" },
  "why-yellow": { zh: "黄牌累计 {n} 张", en: "{n} yellow cards" },
  "fx-inj": { zh: "{p} 受伤：{t}，{w}", en: "{p} injured: {t}, {w}" },
  "fx-ban": { zh: "{p} {why}，{b}", en: "{p}: {why}, {b}" },
  "fx-bad-inj": { zh: "{p} 带伤上场", en: "{p} played while injured" },
  "fx-bad-ban": { zh: "{p} 停赛中上场，这场不算服过", en: "{p} played while suspended, so this match doesn't count toward the ban" },
  "inj-knock": { zh: "挫伤", en: "Knock" },
  "inj-ankle": { zh: "脚踝扭伤", en: "Ankle sprain" },
  "inj-tight": { zh: "肌肉紧张", en: "Muscle tightness" },
  "inj-hamstring": { zh: "腿筋拉伤", en: "Hamstring strain" },
  "inj-calf": { zh: "小腿拉伤", en: "Calf strain" },
  "inj-knee": { zh: "膝盖扭伤", en: "Knee sprain" },
  "inj-ligament": { zh: "韧带撕裂", en: "Ligament tear" },
  "inj-fracture": { zh: "骨折", en: "Fracture" },
  "inj-meniscus": { zh: "半月板损伤", en: "Meniscus injury" },
  "inj-acl": { zh: "十字韧带断裂", en: "ACL rupture" },
  "inj-achilles": { zh: "跟腱断裂", en: "Achilles rupture" },
  // ---- 成长 (R-23)
  "role-prospect": { zh: "新秀", en: "Prospect" },
  "role-regular": { zh: "主力", en: "Regular" },
  "role-star": { zh: "明星", en: "Star" },
  "role-superstar": { zh: "巨星", en: "Superstar" },
  "role-legend": { zh: "传奇", en: "Legend" },
  "tab-growth": { zh: "成长", en: "Growth" },
  "gr-title": { zh: "成长", en: "Growth" },
  "gr-identity": { zh: "身份", en: "Status" },
  "gr-rep": { zh: "声望", en: "Reputation" },
  "gr-next-role": { zh: "下一级「{r}」：声望 {rep}，总评 {o}", en: "Next, {r}: reputation {rep}, overall {o}" },
  "gr-next-age": { zh: "，满 {a} 岁", en: ", aged {a}+" },
  "gr-top": { zh: "已经是最高的身份。换季时声望打六折，得一直踢出来才保得住（传奇不会掉）。", en: "Top status. Reputation shrinks each summer, so it has to be earned again (legends never drop)." },
  "gr-ovr": { zh: "总评", en: "Overall" },
  "gr-pot": { zh: "潜力", en: "Potential" },
  "grade-tip": { zh: "球探对他天花板的评价，S 最高。具体能到多少看不到", en: "Scout's grade for his ceiling, S is best. The exact figure stays hidden" },
  "grade-S": { zh: "世界级的天花板", en: "World-class ceiling" },
  "grade-A": { zh: "能成长为顶级球员", en: "Can become a top player" },
  "grade-B": { zh: "能在高水平联赛立足", en: "Solid top-flight ceiling" },
  "grade-C": { zh: "天花板不高", en: "Limited ceiling" },
  "gr-capped": { zh: "到了瓶颈：经验涨得很慢。淘汰赛、欧冠里打出高分能突破上限。", en: "Plateau: XP barely counts now. A top rating in a knockout or Champions League match can break through." },
  "gr-breaks": { zh: "大场面突破过 {n} 次", en: "{n} big-match breakthroughs" },
  "gr-xp": { zh: "经验", en: "XP" },
  "gr-xp-next": { zh: "再攒 {n} 点经验涨一项能力", en: "{n} more XP to the next ability point" },
  "gr-stage": { zh: "阶段", en: "Stage" },
  "stage-1": { zh: "黄金成长期 · 经验 ×{x}", en: "Golden years · XP ×{x}" },
  "stage-2": { zh: "成长期 · 经验 ×{x}", en: "Developing · XP ×{x}" },
  "stage-3": { zh: "成熟期 · 经验 ×{x}", en: "Maturing · XP ×{x}" },
  "stage-4": { zh: "巅峰期 · 经验 ×{x}", en: "Prime · XP ×{x}" },
  "stage-5": { zh: "巅峰末期 · 经验 ×{x}", en: "Late prime · XP ×{x}" },
  "stage-6": { zh: "老将 · 经验 ×{x}", en: "Veteran · XP ×{x}" },
  "gr-declining": { zh: "每到换季身体能力（速度、爆发、体力…）会往下掉；意识和传球还能慢慢磨。", en: "Physical attributes (speed, acceleration, stamina…) drop every summer; awareness and passing can still improve." },
  "gr-grow-tip": { zh: "联赛里的成长", en: "Growth in this league" },
  "gr-note": { zh: "含联赛里的成长（原值 {o}）", en: "Includes league growth (base {o})" },
  "gr-changes": { zh: "能力变化", en: "Ability changes" },
  "gr-changes-none": { zh: "还没有变化。上场踢比赛攒经验，每 {n} 点经验涨一项能力，按位置挑重要的涨。", en: "No changes yet. Playing earns XP; every {n} XP raises one ability, weighted by position." },
  "gr-season-pts": { zh: "本季 +{n}", en: "This season +{n}" },
  "gr-this-season": { zh: "本季涨了", en: "This season" },
  "gr-learned": { zh: "练成的技能", en: "Learned skills" },
  "learned-tip": { zh: "在联赛里练成的", en: "Learned in this league" },
  "gr-training": { zh: "技能训练", en: "Skill training" },
  "gr-training-now": { zh: "正在练「{k}」", en: "Training {k}" },
  "gr-training-none": { zh: "没在练技能", en: "Not training a skill" },
  "open-training": { zh: "去训练中心", en: "Training centre" },
  // 手动首发 (R-65)
  "tac-title": { zh: "战术", en: "Tactics" },
  "tac-auto": { zh: "自动", en: "Auto" },
  "tac-manual": { zh: "手动", en: "Manual" },
  "tac-formation": { zh: "阵型", en: "Formation" },
  "tac-open": { zh: "点击调整", en: "Adjust" },
  "tac-adjust": { zh: "调整首发", en: "Adjust lineup" },
  "tac-filled": { zh: "顶替", en: "Deputy" },
  "tac-filled-line": { zh: "{a} 缺阵，由 {b} 顶替", en: "{a} is out, {b} deputises" },
  "tac-note": { zh: "先选一个人，再选另一处，两人互换。有人伤停会先从替补席找人顶，卖了人空槽按阵型递补。", en: "Pick a player, then another spot to swap them. Absentees are covered from the bench first; sold starters are backfilled by role." },
  "tac-save": { zh: "保存首发", en: "Save lineup" },
  "tac-saved": { zh: "手动首发已保存", en: "Manual lineup saved" },
  "tac-dirty": { zh: "未保存", en: "Unsaved" },
  "tac-auto-back": { zh: "恢复自动", en: "Back to auto" },
  "tac-auto-done": { zh: "已恢复自动排阵", en: "Auto lineup restored" },
  "tac-auto-confirm": { zh: "撤掉手动首发，回到自动排阵？", en: "Drop the manual lineup and go back to auto?" },
  "tac-xi": { zh: "首发", en: "Starting XI" },
  "tac-subs": { zh: "替补席", en: "Substitutes" },
  "tac-reserves": { zh: "预备队", en: "Reserves" },
  "tac-subs-max": { zh: "比赛里最多换 6 人", en: "up to 6 subs per match" },
  "tac-num": { zh: "号", en: "#" },
  "tac-form": { zh: "状态", en: "Form" },
  "tac-req-short": { zh: "转会", en: "Wants out" },
  "tac-ln-GK": { zh: "门将", en: "Goalkeeper" },
  "tac-ln-DEF": { zh: "后卫", en: "Defenders" },
  "tac-ln-MID": { zh: "中场", en: "Midfielders" },
  "tac-ln-FWD": { zh: "前锋", en: "Forwards" },
  "tac-pending": { zh: "待换：{n} —— 再选一处交换。数字是换过去的总评，+ / − 是比现在强多少、弱多少", en: "Swapping {n}: pick another spot. Numbers show the rating after the swap; + / − is how much better or worse than now" },
  "tac-out-warn": { zh: "{n} 伤停中：开赛时会先从替补席找人顶；想自己定就把他换下来", en: "{n} unavailable: the bench covers at kick-off; swap them out to choose yourself" },
  "tac-cmp-off": { zh: "错线 {m}", en: "Off role {m}" },
  "tac-best": { zh: "一键排阵", en: "Auto-pick" },
  "sx-btn": { zh: "首发一键超人", en: "Max out XI" },
  "sx-tip": { zh: "把现在的首发 11 人直接改成：26 项能力全 103、技能全开（门将全开，别的人不开门将技能）。和在修改器里一个个改一样，永久的，以后照常成长。", en: "Edit the current starting XI: 103 in all 26 abilities and every skill (keepers get all; outfielders skip keeper skills). Same as editing each one in the player editor: permanent, and they keep developing as usual." },
  "sx-dirty": { zh: "先保存首发，再一键超人", en: "Save the lineup first" },
  "sx-confirm": { zh: "把现在的首发 11 人改成能力全 103、技能全开？这是直接修改，不能一键撤回。", en: "Set the current XI to 103 in every ability with all skills? This edits them directly and can't be undone in one click." },
  "sx-done": { zh: "{n} 名首发已改成超人", en: "{n} starters maxed out" },
  "sx-applied": { zh: "已写进游戏（重读 {ms} ms）", en: "written into the game (reloaded in {ms} ms)" },
  "sx-later": { zh: "下次开球前写进游戏", en: "goes into the game before the next kick-off" },
  "sx-failed": { zh: "写进游戏失败：{e}（开球前会再写一次）", en: "writing into the game failed: {e} (retried before kick-off)" },
  "tac-best-tip": { zh: "按当前阵型自动排首发和替补席：伤停的不上，累的按模拟的口径扣分，站错线扣熟悉度。只改草稿，满意了再保存。", en: "Pick the XI and bench for this formation: injured and suspended players are left out, tired ones are marked down as in the simulation, off-role picks pay familiarity. Only changes the draft; save when happy." },
  "tac-best-done": { zh: "已按 {f} 排好首发和替补席，还没保存", en: "XI and bench picked for {f}, not saved yet" },
  "tac-leave": { zh: "战术改动还没保存，确定离开？", en: "Your lineup changes aren't saved. Leave anyway?" },
  "tac-leave-yes": { zh: "放弃改动", en: "Discard" },
  "tac-fam-tip": { zh: "错线 {m}", en: "off role {m}" },
  "hint-save": { zh: "保存", en: "Save" },
  "tac-cancel": { zh: "取消", en: "Cancel" },
  "tac-no-res": { zh: "没有预备队员", en: "No reserves" },
  "tac-warn-line": { zh: "{n} 在 {c} 上错线了", en: "{n} is off role at {c}" },
  "tac-err-gk": { zh: "0 号槽必须是门将", en: "Slot 0 must be a goalkeeper" },
  "tac-err-dup": { zh: "{n} 上了两次", en: "{n} is picked twice" },
  "tac-err-out": { zh: "{n} 已经不在队里了", en: "{n} has left the club" },
  "tac-err-size": { zh: "首发必须是 11 个人", en: "The XI must be 11 players" },
  "gr-mentors": { zh: "师从", en: "Mentors" },
  "gr-mentor-n": { zh: "同场 {n} 次", en: "{n} games together" },
  "gr-hist": { zh: "成长记录", en: "Career log" },
  "gr-hist-none": { zh: "还没有记录", en: "Nothing yet" },
  "gh-mentor1": { zh: "开始跟着 {p} 踢球：同场时经验翻倍", en: "Started playing alongside {p}: double XP together" },
  "gh-mentor": { zh: "和 {p} 同场满 {n} 次", en: "{n} games alongside {p}" },
  "gh-role": { zh: "成为{r}", en: "Became {r}" },
  "gh-break": { zh: "大场面打出 {v} 分，潜力突破", en: "Rated {v} on the big stage: potential breakthrough" },
  "gh-skill": { zh: "学会「{k}」", en: "Learned {k}" },
  "gh-decline": { zh: "年龄不饶人：{k}", en: "Age catching up: {k}" },
  "gh-season": { zh: "整季进步 {n} 点", en: "+{n} points over the season" },
  "ge-tag-up": { zh: "进步", en: "Up" },
  "ge-tag-break": { zh: "突破", en: "Breakthrough" },
  "ge-tag-skill": { zh: "技能", en: "Skill" },
  "ge-pt": { zh: "{p} 进步：{k}", en: "{p} improved: {k}" },
  "ge-aura": { zh: "（和 {m} 同场，经验翻倍）", en: " (with {m}: double XP)" },
  "ge-role": { zh: "{p} 成为{r}", en: "{p} is now a {r}" },
  "ge-break": { zh: "{p} 大场面打出 {v} 分，潜力突破", en: "{p} rated {v} on the big stage: potential breakthrough" },
  "ge-skill": { zh: "{p} 练成「{k}」", en: "{p} learned {k}" },
  "ge-skill-m": { zh: "（{m} 手把手教的）", en: " (taught by {m})" },
  "tile-training": { zh: "训练", en: "Training" },
  "tr-title": { zh: "训练中心", en: "Training centre" },
  "tr-slots": { zh: "训练名额 {a}/{b}", en: "Training slots {a}/{b}" },
  "tr-in": { zh: "在练", en: "Training" },
  "tr-hero-n": { zh: "{n} 人在练技能", en: "{n} in skill training" },
  "tr-hero-none": { zh: "还没安排技能训练", en: "No skill training yet" },
  "tr-hero-empty": { zh: "去训练中心给球员挑一个技能练。", en: "Pick a skill for a player in the training centre." },
  "tr-sub": { zh: "每人练一个技能。上场的比赛进度快，没上场也在慢慢练；队友会这个技能、一起上场时学得更快。特殊技能要明星以上才能练，「队长」要满 25 岁。", en: "One skill per player. Matches played count most, the bench still helps, and a teammate who knows the skill speeds it up when you play together. Special skills need Star status or above; Captaincy needs age 25+." },
  "tr-risers": { zh: "本季进步最多", en: "Most improved this season" },
  "tab-train": { zh: "训练", en: "Training" },
  "tab-grow": { zh: "成长榜", en: "Growth" },
  "tab-mentor": { zh: "老带新", en: "Mentoring" },
  "tr-options": { zh: "能练什么", en: "What he can train" },
  "tr-none-left": { zh: "他能练的技能都会了。", en: "He already knows every skill he can train." },
  "tr-special-lock": { zh: "特殊技能要成为明星以后才能练。", en: "Special skills unlock at Star status." },
  "tr-matches": { zh: "上场约 {n} 场", en: "~{n} matches played" },
  "tr-switch": { zh: "换一个会清掉现在的进度", en: "Switching resets current progress" },
  "tr-stop": { zh: "停止训练", en: "Stop training" },
  "tr-full": { zh: "名额满了：先停掉一个人的训练。", en: "All slots in use: stop someone's training first." },
  "tr-started": { zh: "{p} 开始练「{k}」", en: "{p} started training {k}" },
  "tr-stopped": { zh: "{p} 停止训练", en: "{p} stopped training" },
  "tr-mentor-on": { zh: "{m} 会这个技能，一起上场时学得更快", en: "{m} knows this skill: faster when you play together" },
  "tier-minor": { zh: "小技能", en: "Minor" },
  "tier-regular": { zh: "普通技能", en: "Regular" },
  "tier-special": { zh: "特殊技能", en: "Special" },
  "th-role": { zh: "身份", en: "Status" },
  "th-grow": { zh: "成长", en: "Growth" },
  "th-season-pts": { zh: "本季涨点", en: "Pts this season" },
  "th-pot": { zh: "潜力", en: "Pot." },
  "th-xp": { zh: "经验", en: "XP" },
  "th-mentor": { zh: "导师", en: "Mentor" },
  "tr-aura-rule": { zh: "{a} 岁及以下的球员和导师同场，经验 ×{m}。导师是巨星、传奇、队长，或者会「队长」技能的人。新人踢成巨星，就轮到他带下一批。", en: "Players aged {a} or under earn ×{m} XP alongside a mentor: a superstar, a legend, the captain, or anyone with Captaincy. Once a youngster becomes a superstar, he mentors the next group." },
  "tr-mentors": { zh: "队里的导师", en: "Mentors in the squad" },
  "tr-youth": { zh: "新人", en: "Youngsters" },
  "tr-no-mentor": { zh: "还没和导师同场过", en: "No mentor yet" },
  "tr-no-mentors": { zh: "队里还没有导师。", en: "No mentors in the squad yet." },
  "tr-no-youth": { zh: "队里没有 {a} 岁及以下的球员。", en: "No players aged {a} or under." },
  "sg-top": { zh: "全联赛进步最多", en: "Most improved" },
  "sg-mine": { zh: "你的队", en: "Your squad" },
  "pts-n": { zh: "+{n} 点", en: "+{n} pts" },
  "mw-captain": { zh: "队长", en: "Captain" },
  "mw-skill": { zh: "会「队长」技能", en: "Has Captaincy" },
  // ---- 球员的一生 (R-24)
  "tile-news": { zh: "新闻", en: "News" },
  // 底部快讯条 + 手机 (R-82)
  "dock-phone": { zh: "手机", en: "Phone" },
  "dock-alert": { zh: "{n} 件事等你处理", en: "{n} things need you" },
  "ph-msgs": { zh: "消息", en: "Inbox" },
  "ph-news": { zh: "新闻", en: "News" },
  "ph-tr": { zh: "转会", en: "Transfers" },
  "ph-bid": { zh: "<b>{t}</b> 出价 {x} 要买 <b>{p}</b>", en: "<b>{t}</b> bid {x} for <b>{p}</b>" },
  "ph-bid-swap": { zh: "<b>{t}</b> 出价 {x} 要买 <b>{p}</b>（搭上 <b>{s}</b>）", en: "<b>{t}</b> bid {x} for <b>{p}</b> (with <b>{s}</b>)" },
  "ph-bid-loan": { zh: "<b>{t}</b> 想租 <b>{p}</b>（租借费 {x}）", en: "<b>{t}</b> want <b>{p}</b> on loan (fee {x})" },
  "ph-bid-confirm": { zh: "把 {p} 卖给 {t}（{x}）？", en: "Sell {p} to {t} for {x}?" },
  "ph-loan-confirm": { zh: "把 {p} 租给 {t}？", en: "Loan {p} to {t}?" },
  "ph-job-sacked": { zh: "<b>{t}</b> 愿意请你执教（实力 {s}）", en: "<b>{t}</b> are willing to hire you (strength {s})" },
  "ph-job-poach": { zh: "<b>{t}</b> 想挖你过去执教（实力 {s}）", en: "<b>{t}</b> want you as their manager (strength {s})" },
  "ph-nt": { zh: "<b>{t}</b> 国家队请你兼任主教练", en: "<b>{t}</b> want you as national team manager" },
  "ph-req": { zh: "<b>{p}</b> 要求转会", en: "<b>{p}</b> wants to leave" },
  "ph-academy": { zh: "青训营 {n} 个孩子等你挑", en: "{n} academy kids are waiting for you" },
  "ph-retire": { zh: "{n} 个退役的明星等你选去向", en: "{n} retiring stars await your choice" },
  "ph-train": { zh: "训练名额空着 {n} 个", en: "{n} training slots are free" },
  "ph-accept": { zh: "接受", en: "Accept" },
  "ph-reject": { zh: "拒绝", en: "Reject" },
  "ph-detail": { zh: "详情", en: "Details" },
  "ph-go": { zh: "去看", en: "Open" },
  "ph-no-msgs": { zh: "没有要你处理的事", en: "Nothing needs you right now" },
  "ph-no-tr": { zh: "还没有转会", en: "No transfers yet" },
  "ph-all-news": { zh: "全部新闻", en: "All news" },
  "dock-board": { zh: "董事会信任度 {c}，低于警告线", en: "Board confidence {c}, below the warning line" },
  "dk-bid": { zh: "{n} 份报价", en: "{n} bids" },
  "dk-expire": { zh: "{n} 人合同到期", en: "{n} contracts expiring" },
  // 合同到期 + 结束赛季 (R-85)
  "ph-expire": { zh: "<b>{p}</b> 合同这季到期（他要 {w}/年 · {y} 年）", en: "<b>{p}</b>'s contract expires this season (asks {w}/yr · {y} yrs)" },
  "ph-renew": { zh: "续约", en: "Renew" },
  "ph-let-go": { zh: "放走", en: "Let go" },
  "ph-talk": { zh: "谈合同", en: "Negotiate" },
  "ph-ok-renew": { zh: "{p} 续约了：{w}/年 · {y} 年", en: "{p} renewed: {w}/yr · {y} yrs" },
  "ph-ok-go": { zh: "{p} 这季踢完就走", en: "{p} leaves at the end of the season" },
  "todo-expiring": { zh: "{n} 人合同到期", en: "{n} contracts expiring" },
  "se-open": { zh: "结束赛季…", en: "End season…" },
  "se-title": { zh: "结束赛季", en: "End the season" },
  "se-sub": { zh: "确认以后：颁奖、成长结算、退役和新人、合同到期的人离队、董事会评估、换帅、开夏窗、排 {n} 的赛程。确认了就回不到这个赛季。", en: "Confirming runs the awards, growth, retirements and newcomers, departures of expired contracts, the board review, managerial changes, the summer window and the {n} fixtures. There's no going back." },
  "se-contracts": { zh: "合同到期", en: "Expiring contracts" },
  "se-none": { zh: "没有合同到期的人", en: "No contracts expire this season" },
  "se-must": { zh: "必须定", en: "Decide" },
  "se-fringe": { zh: "不选就放走", en: "Leaves if you do nothing" },
  "se-terms": { zh: "现在 {a}/年 → 他要 {b}/年 · {y} 年", en: "Now {a}/yr → asks {b}/yr · {y} yrs" },
  "se-renewed": { zh: "续约", en: "Renew" },
  "se-gone": { zh: "放走", en: "Leaving" },
  "se-undo": { zh: "撤回", en: "Undo" },
  "se-req": { zh: "提了转会要求，不肯续", en: "Wants out, won't renew" },
  "se-retire": { zh: "{n} 个退役的明星还没选去向（不选就按默认）", en: "{n} retiring stars have no choice yet (defaults apply)" },
  "se-go-retire": { zh: "去选", en: "Choose" },
  "se-blockers": { zh: "还有 {n} 个主力 / 明星没定：续约还是放走", en: "{n} key players still need a decision: renew or let go" },
  "se-ready": { zh: "都定好了，可以结束赛季", en: "All set, you can end the season" },
  "se-confirm": { zh: "确认结束赛季", en: "End season" },
  "se-confirm-q": { zh: "确定结束 {s} 赛季？之后不能再回到这个赛季。", en: "End the {s} season? You can't come back to it." },
  "dk-job": { zh: "{n} 家球队请你", en: "{n} job offers" },
  "dk-request": { zh: "{n} 人要求转会", en: "{n} want to leave" },
  "dk-academy": { zh: "青训营 {n} 人", en: "{n} academy kids" },
  "dk-retire": { zh: "{n} 人退役去向", en: "{n} retirements" },
  "news-title": { zh: "新闻", en: "News" },
  "news-none": { zh: "还没有新闻。", en: "No news yet." },
  "news-unread": { zh: "{n} 条未读", en: "{n} unread" },
  "news-all": { zh: "全部新闻", en: "All news" },
  "news-hint": { zh: "告别赛季、退役、青训新人、你的人升身份和练成技能都会写在这里。", en: "Farewells, retirements, academy graduates, and your players' promotions and new skills show up here." },
  "nw-farewell": { zh: "{p} 宣布这是职业生涯最后一个赛季（{a} 岁）", en: "{p} announces this will be his final season (aged {a})" },
  "nw-retired": { zh: "{p} 挂靴退役（{a} 岁）", en: "{p} has retired (aged {a})" },
  "nw-left": { zh: "{p} 离开了欧洲顶级联赛（{a} 岁）", en: "{p} has left the European top flight (aged {a})" },
  "nw-youth": { zh: "青训营：{p}（{a} 岁，{pos}）升入一线队，接过 {o} 的号码", en: "Academy: {p} ({a}, {pos}) joins the first team, taking {o}'s number" },
  "nw-signing": { zh: "{p}（{a} 岁，{pos}）加盟，接过 {o} 的号码", en: "{p} ({a}, {pos}) has signed, taking {o}'s number" },
  "nw-wonderkid": { zh: "{t} 的青训出了一个天才：{p}（{a} 岁，{pos}）", en: "{t}'s academy has produced a gem: {p} ({a}, {pos})" },
  "nw-grow_role": { zh: "{p} 成为{r}", en: "{p} is now a {r}" },
  "nw-grow_break": { zh: "{p} 大场面打出 {v} 分，潜力突破", en: "{p} rated {v} on the big stage: potential breakthrough" },
  "nw-grow_skill": { zh: "{p} 练成「{k}」", en: "{p} learned {k}" },
  "nw-grow_pos": { zh: "{p} 练成新位置：{k}", en: "{p} can now play {k}" },
  "nw-academy": { zh: "青训营来了 {n} 个孩子，夏窗关之前挑谁提拔进一线队", en: "{n} youngsters arrive at the academy — promote any before the summer window shuts" },
  "tr-pos-name": { zh: "{p}（{l}）", en: "{p} ({l})" },
  "apt-1": { zh: "能踢", en: "competent" },
  "apt-2": { zh: "擅长", en: "natural" },
  "tr-pos-title": { zh: "位置训练", en: "Position training" },
  "tr-pos-note": { zh: "和技能训练共用名额。一次升一级：不会 → 能踢 → 擅长；和主位置不在一条线的慢一些；同场有这个位置的队友学得快。练成后排首发、写进游戏都算他会踢。", en: "Shares slots with skill training. One step at a time: unfamiliar → competent → natural; positions outside his line take longer, and a teammate who plays there speeds it up. Once learned it counts for line-ups and is written into the game." },
  "tr-pos-now": { zh: "现在：{a}", en: "Now: {a}" },
  "tr-ab-title": { zh: "能力训练", en: "Attribute training" },
  "tr-ab-note": { zh: "和技能、位置训练共用名额。挑一项一直练：攒够进度就 +1，接着练下一点，练到 99 自动停；越高越难练。30 岁以后练身体能力只有一半，总评到了潜力只剩四分之一；同场有这项 {m} 以上的队友快三成。涨的点算进总评，模拟和写进游戏都用上。", en: "Shares slots with skill and position training. Pick one attribute and keep at it: each time the bar fills it goes up by 1 and the next point begins, stopping by itself at 99; higher values take longer. Physical attributes train at half speed from age 30, and only a quarter once he reaches his potential; a teammate on the pitch with {m}+ in it speeds things up by 30%. Points count toward his overall, in simulations and in the game." },
  "tr-ab-opt": { zh: "{v} → {n}", en: "{v} → {n}" },
  "tr-ab-sub": { zh: "+1 约 {n} 场", en: "+1 in ~{n} matches" },
  "tr-ab-gained": { zh: "这次已经练了 +{n}", en: "+{n} so far" },
  "ge-ab": { zh: "{p} 练{k} +1{v}", en: "{p} trained {k} +1{v}" },
  "ge-ab-to": { zh: "（到 {v}）", en: " (now {v})" },
  "gh-ab": { zh: "能力训练：{k} +{n}", en: "Attribute training: {k} +{n}" },
  "nw-grow_ab": { zh: "{p} 的{k}练到了 99", en: "{p} has trained {k} to 99" },
  "tab-academy": { zh: "青训营", en: "Academy" },
  "tab-room": { zh: "更衣室", en: "Dressing room" },
  "rm-chem": { zh: "团队默契 {x}%", en: "Team chemistry {x}%" },
  "rm-chem-note": { zh: "首发每个人和这支队一起踢满 {n} 场就磨合好了。默契不满时模拟里首发每人总评最多 −{p}（一口气换一半首发大约 −1.5）。", en: "A starter is fully settled after {n} matches with the club. Below 100%, each starter loses up to {p} overall in simulations (swap half the XI at once and it's about −1.5)." },
  "rm-note": { zh: "上场会高兴，坐板凳会不满（主力最在乎）；输赢全队都受影响。心情折成状态：模拟时总评最多 ±{f}。低于 {r} 会要求转会、不和你续约。谈话承诺出场：之后 {g} 场里让他上 {n} 场算守住，不然食言扣得更多。", en: "Playing time pleases, the bench frustrates (regulars most); results move everyone. Mood becomes form: up to ±{f} overall in simulations. Below {r} a player asks to leave and won't renew. Promise playing time: give him {n} of the next {g} matches or the broken promise hurts more." },
  "rm-mood": { zh: "心情", en: "Mood" },
  "rm-form": { zh: "状态", en: "Form" },
  "rm-games": { zh: "磨合", en: "Settled" },
  "rm-request": { zh: "要求转会", en: "Wants out" },
  "rm-cfg-error": { zh: "调参台 config/morale.json 有问题，用的出厂数：{e}", en: "config/morale.json has a problem, using built-in defaults: {e}" },
  "rm-promise": { zh: "承诺出场", en: "Promise minutes" },
  "rm-let-go": { zh: "放他走", en: "Let him go" },
  "rm-refuse": { zh: "不放", en: "Refuse" },
  "rm-sulk": { zh: "消极", en: "Sulking" },
  "rm-wait": { zh: "等你回话 {n}/{m}", en: "Awaiting reply {n}/{m}" },
  "rm-listed": { zh: "挂牌中", en: "Listed" },
  "rm-req-note": { zh: "提了转会要求的人等你回话：「放他走」= 平价挂牌，他安心了，每场心情回升；「承诺出场」先稳住他；「不放」、拒掉买他的报价、或者 {w} 场都不理，他就消极 —— 模拟里总评再 −{f}，训练进度 ×{t}。转会窗开着时，别的球队会主动来问他。", en: "Players who asked to leave await your reply: \"Let him go\" lists him at par and his mood recovers each match; \"Promise minutes\" calms him for now; refusing, turning down a bid for him, or ignoring him for {w} matches makes him sulk — a further −{f} overall in simulations and training progress ×{t}. While a window is open, other clubs come asking for him." },
  "rm-ok-refuse": { zh: "你拒绝放 {p} 走，他开始消极（心情 {m}）", en: "You refused to let {p} go; he's sulking (mood {m})" },
  "rm-ok-let-go": { zh: "{p} 挂牌了（平价），转会日有球队来要人会给你报价", en: "{p} is listed at par; clubs will bid on transfer days" },
  "mkw-no_request": { zh: "他没提转会要求，或者已经在闹了。", en: "He hasn't asked to leave, or he is already sulking." },
  "rm-promised": { zh: "承诺中 {p}/{n}", en: "Promised {p}/{n}" },
  "rm-promise-used": { zh: "这季谈过了", en: "Talked this season" },
  "rm-ok": { zh: "{p}：心情变好了（{m}）", en: "{p}: mood lifted ({m})" },
  "rm-empty": { zh: "踢完第一场以后开始记心情。", en: "Moods are tracked from your first match." },
  "rl-core": { zh: "主力", en: "Starter" },
  "rl-rotation": { zh: "轮换", en: "Rotation" },
  "rl-fringe": { zh: "边缘", en: "Fringe" },
  "mkw-unhappy": { zh: "他提了转会要求，不和你续约。", en: "He has asked to leave and won't renew." },
  "mkw-promised": { zh: "这季已经和他谈过了。", en: "You've already talked to him this season." },
  "pc-renew-refuse": { zh: "他提了转会要求，不和你续约（先让他多上场、心情好起来）。", en: "He has asked to leave and won't renew (give him minutes first)." },
  "nw-mood_request": { zh: "{p} 对出场时间不满，要求转会", en: "{p} is unhappy with his playing time and asks to leave" },
  "nw-mood_settled": { zh: "{p} 撤回了转会要求", en: "{p} withdraws his transfer request" },
  "nw-mood_kept": { zh: "你兑现了给 {p} 的出场承诺", en: "You kept your promise of minutes to {p}" },
  "nw-mood_sulk-ignored": { zh: "{p} 提了转会要求一直没等到回话，开始消极", en: "{p} got no answer to his transfer request and is now sulking" },
  "nw-mood_sulk-refused": { zh: "你拒绝放 {p} 走，他开始消极", en: "You refused to let {p} go — he is sulking" },
  "nw-mood_sulk-bid": { zh: "你拒掉了 {t} 对 {p} 的报价，他很不满，开始消极", en: "You turned down {t}'s bid for {p} — he is unhappy and sulking" },
  "nw-mood_broke": { zh: "你没兑现给 {p} 的出场承诺，他很失望", en: "You broke your promise of minutes to {p} — he's bitter" },
  "nt-mood": { zh: "更衣室", en: "Dressing room" },
  "ac-head": { zh: "这个夏窗来的孩子", en: "This summer's intake" },
  "ac-note": { zh: "每个夏窗开的时候青训营来 {n} 个 16–18 岁的孩子。提拔进一线队签 3 季青训合同；夏窗关了还没提拔的就走了。潜力评价看天花板：S 最高。", en: "Each summer window {n} youngsters aged 16–18 arrive. Promoting one signs a 3-season academy contract; anyone not promoted by the end of the window leaves. Potential grade is the ceiling: S is the best." },
  "ac-closed": { zh: "夏窗关着：下个夏窗开的时候来新的一批。", en: "Summer window closed: the next intake arrives when it opens." },
  "ac-empty": { zh: "这批都处理完了。", en: "No one left in this intake." },
  "ac-promote": { zh: "提拔", en: "Promote" },
  "ac-ok": { zh: "{p} 提拔进一线队了", en: "{p} promoted to the first team" },
  "ac-squad": { zh: "一线队 {a} / {b} 人", en: "First team {a} / {b}" },
  "tag-farewell": { zh: "告别赛季", en: "Final season" },
  "nt-farewell": { zh: "告别", en: "Farewell" },
  "nt-retired": { zh: "退役", en: "Retired" },
  "nt-left": { zh: "离开", en: "Left" },
  "nt-youth": { zh: "青训", en: "Academy" },
  "nt-signing": { zh: "新援", en: "Signing" },
  "nt-wonderkid": { zh: "天才", en: "Wonderkid" },
  "nt-reborn": { zh: "转世", en: "Reincarnation" },
  "nw-reborn": { zh: "{o} 的转世 {p} 加入 {t} 青训营（{a} 岁，{pos}）", en: "{o}'s reincarnation {p} joins the {t} academy ({a}, {pos})" },
  "tag-reborn-of": { zh: "{p} 的转世", en: "Reincarnation of {p}" },
  "tag-reborn-as": { zh: "转世为 {p}", en: "Reborn as {p}" },
  "nw-reborn-back": { zh: "{p} 退役后转世，回到 {t} 青训营（{a} 岁，{pos}）", en: "{p} retires and is reborn at the {t} academy ({a}, {pos})" },
  "tag-reborn-back": { zh: "转世 · {s} 回到 {t}（{w} 在 {wt} 退役）", en: "Reborn · back at {t} in {s} (retired at {wt} in {w})" },
  "tag-retired": { zh: "{s} 退役", en: "Retired {s}" },
  "tag-left": { zh: "{s} 离开", en: "Left {s}" },
  "tag-youth": { zh: "青训出身", en: "Academy graduate" },
  "tag-signing": { zh: "外面签来", en: "Signed from outside" },
  "tag-new-youth": { zh: "青训", en: "Academy" },
  "tag-new-signing": { zh: "新援", en: "New" },
  "gr-gtype": { zh: "成长类型", en: "Growth type" },
  "gt-early": { zh: "早熟：涨得早，也老得早", en: "Early bloomer: peaks early, declines early" },
  "gt-normal": { zh: "正常", en: "Normal" },
  "gt-late": { zh: "晚熟：大器晚成，老得也晚", en: "Late bloomer: peaks late, lasts longer" },
  "sl-title": { zh: "人员变动", en: "Squad turnover" },
  "sl-counts": { zh: "全世界 {r} 人退役、{l} 人离开、{n} 名新人", en: "Worldwide: {r} retired, {l} left, {n} newcomers" },
  "sl-counts-rw": { zh: "全世界 {r} 人退役、{b} 人转世回来", en: "Worldwide: {r} retired, {b} reborn" },
  "sl-out": { zh: "你的队走了", en: "Your departures" },
  "sl-in": { zh: "你的队来了", en: "Your arrivals" },
  // ---- 转会和合同 (R-25)
  "tile-market": { zh: "转会", en: "Transfers" },
  "mk-title": { zh: "转会市场", en: "Transfer market" },
  "mk-open": { zh: "窗口开着", en: "Window open" },
  "mk-open-days": { zh: "开窗中 · 剩 {n} 天", en: "Open · {n} days left" },
  "mk-open-last": { zh: "开窗中 · 最后一天", en: "Open · last day" },
  "mk-open-round": { zh: "开窗中 · 到第 {n} 轮", en: "Open · until round {n}" },
  "win-chip-summer": { zh: "夏窗开着", en: "Summer window open" },
  "win-chip-winter": { zh: "冬窗开着", en: "Winter window open" },
  "mk-days": { zh: "剩 {n} 天", en: "{n} days left" },
  "mk-last": { zh: "最后一天", en: "last day" },
  "mk-until": { zh: "到第 {n} 轮", en: "until round {n}" },
  "mk-closed": { zh: "窗口关着", en: "Window closed" },
  "mk-window-open": { zh: "转会窗口开着，到 {d}", en: "Transfer window open until {d}" },
  "mk-window-open-r": { zh: "转会窗口开着，到第 {n} 轮", en: "Transfer window open until round {n}" },
  "mk-window-closed": { zh: "转会窗口关着", en: "Transfer window closed" },
  "mk-window-when": { zh: "夏窗：赛季开始到 9 月 1 日；冬窗：1 月", en: "Summer: season start to 1 September · Winter: January" },
  "mk-money": { zh: "账上 {c} · 工资 {w} / 预算 {b}（每年）· 一季收入 {r}", en: "Balance {c} · wages {w} / budget {b} a year · revenue {r} a season" },
  "mk-money-short": { zh: "账上 {c} · 工资 {w} / 预算 {b}（每年）", en: "Balance {c} · wages {w} / budget {b} a year" },
  "mk-f-ok": { zh: "只看愿意来的", en: "Only players willing to join" },
  "mk-no-way": { zh: "不愿来", en: "Won't join" },
  "mk-bids-n": { zh: "有 {n} 家报价等你回", en: "{n} offers waiting for your answer" },
  "mk-exp-n": { zh: "{n} 份合同这季踢完到期，不续就走", en: "{n} contracts expire at the end of this season — renew or lose them" },
  "mk-latest": { zh: "最近的转会", en: "Latest transfers" },
  "mk-exp-title": { zh: "这季到期的合同", en: "Contracts expiring" },
  "mk-hint": { zh: "开窗时 AI 各队会互相买人卖人，也会给你的人报价。买人、续约、解约都在球员页的「合同」里。", en: "While the window is open, AI clubs buy and sell among themselves and make offers for your players. Buying, renewing and releasing are on each player's Contract tab." },
  "tab-mk-search": { zh: "找人", en: "Find players" },
  "tab-mk-mine": { zh: "我的合同", en: "My contracts" },
  "tab-mk-bids": { zh: "报价", en: "Offers" },
  "tab-mk-free": { zh: "自由身", en: "Free agents" },
  "tab-mk-log": { zh: "转会动态", en: "Transfer news" },
  "th-value": { zh: "身价", en: "Value" },
  "th-wage": { zh: "年薪", en: "Wage" },
  "th-contract": { zh: "合同到", en: "Contract" },
  "th-club": { zh: "球队", en: "Club" },
  "mk-f-all": { zh: "全部", en: "All" },
  "mk-f-GK": { zh: "门将", en: "GK" },
  "mk-f-DEF": { zh: "后卫", en: "Defenders" },
  "mk-f-MID": { zh: "中场", en: "Midfielders" },
  "mk-f-FWD": { zh: "前锋", en: "Forwards" },
  "mk-f-min": { zh: "最低总评", en: "Min overall" },
  "mk-f-age": { zh: "最大年龄", en: "Max age" },
  "mk-f-value": { zh: "最高身价（百万欧）", en: "Max value (€M)" },
  "mk-f-name": { zh: "名字", en: "Name" },
  "mk-f-go": { zh: "找", en: "Search" },
  // 找人 (R-86)
  "mk-f-filters": { zh: "筛选", en: "Filters" },
  "mk-f-reset": { zh: "重置", en: "Reset" },
  "mk-f-line": { zh: "位置", en: "Position" },
  "mk-f-pos": { zh: "具体位置", en: "Exact position" },
  "mk-f-ages": { zh: "年龄", en: "Age" },
  "mk-f-ovrs": { zh: "总评", en: "Overall" },
  "mk-f-money": { zh: "身价 ≤（百万）", en: "Value ≤ (€M)" },
  "mk-f-wage": { zh: "年薪 ≤（百万）", en: "Wage ≤ (€M)" },
  "mk-f-role": { zh: "身份", en: "Status" },
  "mk-f-nat": { zh: "国籍", en: "Nationality" },
  "mk-f-league": { zh: "联赛", en: "League" },
  "mk-f-any": { zh: "不限", en: "Any" },
  "mk-f-exp": { zh: "合同这季到期", en: "Contract expiring" },
  "mk-f-listed": { zh: "挂牌中", en: "Listed" },
  "mk-f-loan": { zh: "可租借", en: "Loanable" },
  "mk-f-more": { zh: "条件", en: "Conditions" },
  "mk-f-sort": { zh: "排序", en: "Sort" },
  "mk-s-ovr": { zh: "总评高", en: "Overall" },
  "mk-s-value": { zh: "身价低", en: "Cheapest" },
  "mk-s-age": { zh: "年轻", en: "Youngest" },
  "mk-found": { zh: "找到 {n} 人", en: "{n} found" },
  "mk-found-cap": { zh: "（显示前 150 个）", en: " (showing 150)" },
  "mk-pick-back": { zh: "← 回到结果", en: "← Back to results" },
  "mk-pick-nat": { zh: "选国籍", en: "Pick a nationality" },
  "mk-pick-league": { zh: "选联赛", en: "Pick a league" },
  // 没有俱乐部的国脚 (R-87)
  "mk-nt-free": { zh: "没有俱乐部的国脚", en: "Internationals without a club" },
  "mk-nt-free-note": { zh: "游戏给没授权的国家队生成的球员，任何俱乐部都没有。只有你能签：不要转会费，按他要的工资签。", en: "Players the game generated for unlicensed national teams; no club has them. Only you can sign them: no fee, just his wage." },
  "mk-nt-club": { zh: "无俱乐部 · {t}", en: "No club · {t}" },
  "mk-tag-gen": { zh: "游戏生成", en: "Generated" },
  "mk-pick-confed": { zh: "选大洲", en: "Pick a continent" },
  "mk-pick-in": { zh: "选国籍 · {c}", en: "Nationality · {c}" },
  "mk-pick-up": { zh: "← 回到大洲", en: "← Back to continents" },
  "mk-pick-all": { zh: "整个{c}", en: "All of {c}" },
  "cf-UEFA": { zh: "欧洲", en: "Europe" },
  "cf-CONMEBOL": { zh: "南美洲", en: "South America" },
  "cf-CONCACAF": { zh: "中北美洲及加勒比", en: "North & Central America" },
  "cf-AFC": { zh: "亚洲", en: "Asia" },
  "cf-CAF": { zh: "非洲", en: "Africa" },
  "cf-OFC": { zh: "大洋洲", en: "Oceania" },
  "cf-OTHER": { zh: "其他", en: "Other" },
  "mk-none": { zh: "没找到合适的人。", en: "No players found." },
  "mk-search-hint": { zh: "点头像进球员页，在「合同」里出价", en: "Click a face to open the player and make an offer on his Contract tab" },
  "mk-bid-line": { zh: "{t} 出价 {f} 求购 {p}", en: "{t} offer {f} for {p}" },
  "mk-accept": { zh: "接受", en: "Accept" },
  "mk-reject": { zh: "拒绝", en: "Reject" },
  "mk-st-accepted": { zh: "已接受", en: "Accepted" },
  "mk-st-rejected": { zh: "已拒绝", en: "Rejected" },
  "mk-st-expired": { zh: "已过期", en: "Expired" },
  "mk-no-bids": { zh: "还没有报价。", en: "No offers yet." },
  "mk-no-free": { zh: "现在没有自由身。赛季末合同到期没续的人会出现在这里。", en: "No free agents right now. Players whose contracts run out appear here at season end." },
  "mk-no-log": { zh: "还没有转会。", en: "No transfers yet." },
  "mk-log-buy": { zh: "{p}：{a} → {b}，{f}", en: "{p}: {a} → {b}, {f}" },
  "mk-log-free": { zh: "{p} 以自由身加盟 {b}", en: "{p} joined {b} on a free" },
  "mk-log-expire": { zh: "{p} 合同到期离开 {a}", en: "{p} left {a} as his contract ran out" },
  "mk-log-release": { zh: "{p} 被 {a} 解约", en: "{p} was released by {a}" },
  "mk-free-agent": { zh: "自由身", en: "Free agent" },
  "tab-contract": { zh: "合同", en: "Contract" },
  // 变体卡 (R-34)
  "tab-cards": { zh: "变体卡", en: "Cards" },
  "vc-note": { zh: "选一张卡给他用：能力还是联赛里的他（总评 {o}）写进这张卡，换的是卡的技能、打法风格、动作和样子。游戏开着就马上写进去，不然下次开球前写。",
    en: "Pick a card for him. His abilities stay his league ones (overall {o}), written into the card; the card changes his skills, playing style, animations and look. It goes into the game right away if the game is running, otherwise before the next kick-off." },
  "vc-now": { zh: "正在用：{k}", en: "Using: {k}" },
  "vc-current": { zh: "正在用", en: "In use" },
  "vc-orig": { zh: "原来的卡", en: "original" },
  "vc-card-ovr": { zh: "卡面原本 {n}", en: "Card rated {n}" },
  "vc-applied": { zh: "换卡写进游戏了（重读 {ms} ms）", en: "Card written into the game (reloaded in {ms} ms)" },
  "vc-later": { zh: "换好了，下次开球前写进游戏", en: "Card changed; it goes into the game before the next kick-off" },
  "vc-failed": { zh: "换好了，但写进游戏失败：{e}（开球前会再写一次）", en: "Card changed, but writing it into the game failed: {e} (it will be retried before kick-off)" },
  "vc-kind-base": { zh: "基础卡", en: "Base card" },
  "vc-kind-0000": { zh: "标准卡", en: "Standard" },
  "vc-kind-0100": { zh: "传奇", en: "Legendary" },
  "vc-kind-0300": { zh: "周最佳", en: "POTW" },
  "vc-kind-0301": { zh: "月最佳", en: "POTM" },
  "vc-kind-0302": { zh: "赛季最佳", en: "POTS" },
  "vc-kind-0400": { zh: "活动企划", en: "Event" },
  "vc-kind-0500": { zh: "俱乐部赛季", en: "Club season" },
  "vc-kind-0501": { zh: "Big Time", en: "Big Time" },
  "vc-kind-0600": { zh: "Selection", en: "Selection" },
  "vc-kind-0601": { zh: "Show Time", en: "Show Time" },
  "pc-value": { zh: "身价", en: "Value" },
  "pc-wage": { zh: "年薪", en: "Wage" },
  "pc-contract": { zh: "合同踢到", en: "Contract until" },
  "pc-left": { zh: "这季踢完还剩 {n} 季", en: "{n} more seasons after this one" },
  "pc-expiring": { zh: "这季踢完到期", en: "Expires at the end of this season" },
  "pc-club": { zh: "现在", en: "Club" },
  "pc-bid-title": { zh: "出价", en: "Make an offer" },
  "pc-sign-title": { zh: "签下这个自由身", en: "Sign this free agent" },
  "pc-renew-title": { zh: "续约", en: "Renew contract" },
  "pc-fee": { zh: "转会费（百万欧）", en: "Fee (€M)" },
  "pc-offer-wage": { zh: "年薪（百万欧）", en: "Wage (€M a year)" },
  "pc-years": { zh: "签几季", en: "Seasons" },
  "pc-ask": { zh: "对方要价 {f}，他要年薪 {w}。", en: "The club wants {f}; he wants {w} a year." },
  "pc-renew-ask": { zh: "他要年薪 {w}。", en: "He asks {w} a year." },
  "pc-go-bid": { zh: "出价", en: "Make offer" },
  "pc-go-sign": { zh: "签下", en: "Sign" },
  "pc-go-renew": { zh: "续约", en: "Renew" },
  "pc-release": { zh: "解约", en: "Release" },
  "pc-release-note": { zh: "解约要赔剩下工资的一半，他成了自由身。", en: "Releasing costs half his remaining wages; he becomes a free agent." },
  "pc-release-confirm": { zh: "确定和 {p} 解约？要赔 {x}。", en: "Release {p}? It costs about {x}." },
  "pc-unwilling": { zh: "他不愿意去比现在明显弱的队。", en: "He won't drop to a clearly weaker club." },
  "pc-window-closed": { zh: "转会窗口关着，开窗才能买人。", en: "The transfer window is closed." },
  "mk-ok-buy": { zh: "成交！", en: "Deal done!" },
  "mk-ok-sold": { zh: "成交：卖了 {x}。", en: "Deal: sold for {x}." },
  "mk-ok-renew": { zh: "续约了。", en: "Contract renewed." },
  "mk-ok-release": { zh: "解约了，赔了 {x}。", en: "Released; paid {x}." },
  "mk-ok-accept": { zh: "卖了。", en: "Sold." },
  "mkw-fee": { zh: "对方不卖：要价 {x}。", en: "Rejected: the club wants {x}." },
  "mkw-wage": { zh: "他不签：要年薪 {x}。", en: "He refuses: he wants {x} a year." },
  "mkw-unwilling": { zh: "他不愿意去比现在明显弱的队。", en: "He won't drop to a clearly weaker club." },
  "mkw-cash": { zh: "账上的钱不够。", en: "Not enough money." },
  "mkw-number": { zh: "填的数字不对。", en: "That number doesn't look right." },
  "mkw-buyer_cash": { zh: "对方已经买不起了，这份报价作废。", en: "They can't afford it anymore — this bid is void." },
  "mkw-buyer_wage": { zh: "对方工资满了，这份报价作废。", en: "Their wage bill is full — this bid is void." },
  "mkw-wage_budget": { zh: "签了工资会超预算太多。", en: "That would blow the wage budget." },
  "mkw-window": { zh: "转会窗口关着。", en: "The transfer window is closed." },
  "mkw-squad": { zh: "一队最多 40 人，满了。", en: "Squad is full (40)." },
  "mkw-who": { zh: "不行。", en: "Not possible." },
  "mkw-counter": { zh: "对方还价：{x}（{m}）。", en: "They come back with {x} ({m})." },
  "mkw-walked": { zh: "谈崩了：对方 30 天内不再谈这个人。", en: "Talks broke down: no more talks about him for 30 days." },
  "mkw-on_loan": { zh: "他在租借中，不能买。", en: "He's on loan and can't be bought." },
  "mkw-not_loanable": { zh: "他是那队的主力，不外租。", en: "He's a key player there — not available on loan." },
  "mkw-loan_max": { zh: "一季最多租 3 个人。", en: "You can loan in at most 3 players a season." },
  "mkw-lender_short": { zh: "那队人手不够，不外租。", en: "They're short of players and won't loan him out." },
  "mkw-mode": { zh: "不行。", en: "Not possible." },
  "mkw-swap_max": { zh: "一笔最多搭 {n} 个人。", en: "At most {n} players per deal." },
  "mkw-swap_who": { zh: "搭的人不行（租借中的人不能搭）。", en: "That player can't be included (players on loan can't)." },
  "mkw-swap_unwilling": { zh: "搭的人不愿意去那队。", en: "A player you offered won't join them." },
  "mkw-swap_squad": { zh: "对方人满了，搭不进去。", en: "Their squad is full." },
  "mkw-counter-swap": { zh: "对方还价：整份要 {x}，你搭的人作价 {v}，还要现金 {c}（{m}）。", en: "They come back: {x} in total — your players count {v}, so {c} in cash ({m})." },
  "pc-swap-title": { zh: "拿人抵转会费", en: "Include players" },
  "pc-swap-note": { zh: "最多搭 {n} 个你的人，对方按它眼里的价值作价（它缺这个位置就值得多），和现金加起来算一份报价。解约金只收现金。", en: "Offer up to {n} of your players as part of the fee. They're valued as the other club sees them (more if it needs that position) and added to the cash. Release clauses are cash only." },
  "pc-swap-sum": { zh: "作价合计 {v} · 现金 {c} · 整份 {t}", en: "Players {v} · cash {c} · total {t}" },
  "pc-swap-no": { zh: "不愿去", en: "Won't go" },
  "pc-talking-swap": { zh: "在谈：对方现在要整份 {f}（你搭的人作价 {v}，还要现金 {c}；{m}）。", en: "In talks: they want {f} in total (your players count {v}, so {c} in cash; {m})." },
  "mk-log-swap": { zh: "{p}：{a} → {b}，交换作价 {f}", en: "{p}: {a} → {b}, part-exchange valued {f}" },
  "mk-ok-swap": { zh: "成交！付了现金 {c}，搭过去 {n} 人。", en: "Deal done! Paid {c} in cash plus {n} player(s)." },
  "mk-mood-high": { zh: "耐心还足", en: "patient" },
  "mk-mood-mid": { zh: "有点不耐烦", en: "getting impatient" },
  "mk-mood-low": { zh: "快没耐心了", en: "nearly out of patience" },
  "mk-counter": { zh: "还价", en: "Counter" },
  "mk-counter-ph": { zh: "你要多少", en: "Your price" },
  "mk-h-ai": { zh: "对方", en: "them" },
  "mk-h-you": { zh: "你", en: "you" },
  "mk-st-walked": { zh: "谈崩了", en: "Walked away" },
  "mk-bid-loan-line": { zh: "{t} 想租 {p}：租借费 {f}，他们付 {s} 工资{b}", en: "{t} want {p} on loan: fee {f}, they pay {s} of his wages{b}" },
  "mk-loan-buy-opt": { zh: "，可选择买断 {x}", en: ", option to buy for {x}" },
  "mk-loan-buy-must": { zh: "，到期强制买断 {x}", en: ", obligation to buy for {x}" },
  "mk-ok-loan": { zh: "租来了：你付 {s} 的工资。", en: "Loan agreed: you pay {s} of his wages." },
  "mk-ok-loanbuy": { zh: "买断了，他留下了。", en: "Bought outright — he stays." },
  "mk-ok-list": { zh: "挂牌了：转会日有球队来要人会给你报价。", en: "Listed: clubs will make offers on transfer days." },
  "mk-ok-unlist": { zh: "撤牌了。", en: "Taken off the list." },
  "mk-tag-listed": { zh: "挂牌", en: "Listed" },
  "mk-tag-loan": { zh: "租借", en: "On loan" },
  "mk-tag-request": { zh: "要求转会·身价受压", en: "Wants out · cut price" },
  "tab-mk-loans": { zh: "租借", en: "Loans" },
  "tab-mk-fin": { zh: "财政", en: "Finances" },
  "fin-sum": { zh: "本季收支", en: "This season" },
  "fin-book": { zh: "账本", en: "Ledger" },
  "fin-item": { zh: "项目", en: "Item" },
  "fin-now": { zh: "到现在", en: "So far" },
  "fin-est": { zh: "赛季末结账（估）", en: "Season-end (est.)" },
  "fin-last": { zh: "上季", en: "Last season" },
  "fin-net": { zh: "合计", en: "Net" },
  "fin-cost": { zh: "球队开支（工资 + 转会费摊销）{c}，占一季收入 {r} 的 {p}%（欧足联的线是 {l}%）", en: "Squad cost (wages + transfer amortisation) {c}: {p}% of {r} revenue (UEFA limit {l}%)" },
  "fin-note": { zh: "门票、转播、商业、名次奖金、员工和设施、工资在赛季末一起结；买卖球员、租借费、解约、董事会奖金、欧战奖金（参赛、每场胜平、晋级、夺冠）当场进出。估算按现在的名次（第 {p}）、收入和工资。", en: "Tickets, TV, commercial, prize money, staff, facilities and wages are settled at season end; transfers, loan fees, releases, board bonuses and UEFA prize money (entry, each win or draw, each round reached, the title) move money straight away. Estimate uses your current position ({p}), revenue and wages." },
  "fin-empty": { zh: "还没有账。买卖球员、赛季末结账以后会记在这里。", en: "Nothing yet. Transfers and the season-end settlement are recorded here." },
  "fin-k-tickets": { zh: "门票", en: "Matchday" },
  "fin-k-tv": { zh: "转播", en: "Broadcasting" },
  "fin-k-commercial": { zh: "商业（赞助、周边）", en: "Commercial" },
  "fin-k-prize": { zh: "联赛名次奖金", en: "League prize money" },
  "fin-k-euro": { zh: "欧战奖金", en: "UEFA prize money" },
  "rt-title": { zh: "退役的明星：去向你来定", en: "Retiring stars: you decide" },
  "rt-note": { zh: "开下一季时生效。转世：本人 16 岁回到效力最久的队的青训；考教练证：几季后成为传奇教练，能请进你的教练组。", en: "Takes effect when the next season starts. Reborn: he returns aged 16 to the academy of the club he served longest. Coaching: after a few seasons he becomes a legend coach you can hire." },
  "rt-reborn": { zh: "转世回青训", en: "Reborn to academy" },
  "rt-coach": { zh: "去考教练证", en: "Coaching badge" },
  "rt-default": { zh: "不选的话：{w}", en: "If you don't choose: {w}" },
  "rt-chosen": { zh: "已选好，开下一季时生效", en: "Chosen; applies when the next season starts" },
  "todo-cap": { zh: "待处理", en: "To do" },
  "todo-n": { zh: "{n} 件待处理", en: "{n} to deal with" },
  "todo-bids": { zh: "{n} 份报价等你回", en: "{n} offer(s) to answer" },
  "todo-offers": { zh: "{n} 家球队请你执教", en: "{n} job offer(s)" },
  "todo-academy": { zh: "青训营 {n} 人等你挑", en: "{n} academy prospect(s) to pick" },
  "mk-offer-btn": { zh: "出价", en: "Bid" },
  "working": { zh: "处理中…", en: "Working…" },
  "working-season": { zh: "正在换季：颁奖、退役和新人、合同到期、开夏窗、排新赛季的赛程…", en: "Starting the new season: awards, retirements and newcomers, contracts, the summer window, fixtures…" },
  "ahead-label": { zh: "连续模拟", en: "Simulate ahead" },
  "ahead-n5": { zh: "5 场", en: "5 matches" },
  "ahead-month": { zh: "到月底", en: "To month end" },
  "ahead-season": { zh: "到这季踢完", en: "To season end" },
  "ahead-running": { zh: "连续模拟中：已经踢了 {n} 场", en: "Simulating: {n} played so far" },
  "ahead-stop": { zh: "停下", en: "Stop" },
  "ahead-r-done": { zh: "连续模拟完了：踢了 {n} 场", en: "Done: {n} matches simulated" },
  "ahead-r-stopped": { zh: "停下了：踢了 {n} 场", en: "Stopped after {n} matches" },
  "ahead-r-season_end": { zh: "这季你的比赛都踢完了（这次 {n} 场）", en: "Your season is over ({n} matches this run)" },
  "ahead-r-bids": { zh: "有球队给你的球员报价，先停下（踢了 {n} 场）", en: "A club made an offer for one of your players; stopped after {n}" },
  "ahead-r-offers": { zh: "有球队想请你执教，先停下（踢了 {n} 场）", en: "A club wants you as manager; stopped after {n}" },
  "ahead-r-sacked": { zh: "你被解雇了（踢了 {n} 场）", en: "You were sacked (after {n} matches)" },
  "ahead-r-decide": { zh: "有一场要你定谁晋级（踢了 {n} 场）", en: "A tie needs your decision (after {n} matches)" },
  "ahead-r-switched": { zh: "存档换了，停下（踢了 {n} 场）", en: "Save changed; stopped after {n}" },
  "ahead-error": { zh: "连续模拟出错：{e}", en: "Simulating ahead failed: {e}" },
  "fast-sim-on": { zh: "不弹战报：开", en: "Skip report: on" },
  "fast-sim-off": { zh: "不弹战报：关", en: "Skip report: off" },
  "fx-hot": { zh: "{n} 连胜", en: "{n} wins in a row" },
  "fx-ub": { zh: "不败 {n} 场", en: "Unbeaten in {n}" },
  "fx-inv": { zh: "不败赛季 ×{n}", en: "Invincible season ×{n}" },
  "nw-invincible": { zh: "{t} 在{l}整季不败：{w} 胜 {d} 平，进 {gf} 失 {ga}", en: "{t} went the whole {l} season unbeaten: {w} wins, {d} draws, {gf}–{ga}" },
  "rc-invincible": { zh: "不败赛季", en: "Invincible seasons" },
  "rc-inv-line": { zh: "{s} · {l} · {w} 胜 {d} 平 · {pts} 分", en: "{s} · {l} · W{w} D{d} · {pts} pts" },
  "new-season-meta": { zh: "新赛季还没开踢", en: "Season not started" },
  "fin-k-bonus": { zh: "董事会奖金", en: "Board bonus" },
  "fin-k-sell": { zh: "卖人", en: "Player sales" },
  "fin-k-buy": { zh: "买人", en: "Player purchases" },
  "fin-k-loan_fee": { zh: "租借费", en: "Loan fees" },
  "fin-k-release": { zh: "解约赔偿", en: "Release payouts" },
  "fin-k-wages": { zh: "工资", en: "Wages" },
  "fin-k-staff": { zh: "员工", en: "Staff" },
  "fin-k-facilities": { zh: "设施", en: "Facilities" },
  "mk-loan-in-title": { zh: "租来的人", en: "Loaned in" },
  "mk-loan-out-title": { zh: "租出去的人", en: "Loaned out" },
  "mk-no-loans": { zh: "没有租借。租人在球员页的「合同」里；把人租出去在自己球员的「合同」里挂租借牌。", en: "No loans. Loan players in from their Contract tab; list your own for loan on theirs." },
  "th-clause": { zh: "解约金", en: "Clause" },
  "pc-clause": { zh: "解约金", en: "Release clause" },
  "pc-clause-note": { zh: "出到解约金就不用和俱乐部谈，直接和他签。", en: "Offer the release clause and you skip the club and deal with him directly." },
  "pc-go-clause": { zh: "按解约金买 {x}", en: "Pay the clause {x}" },
  "pc-beta": { zh: "新合同的解约金", en: "New release clause" },
  "pc-beta-note": { zh: "解约金是身价的几倍：定得越高越不容易被挖走，但他要的工资越高（超过 2 倍后每高 1 倍工资 +8%）。", en: "Clause as a multiple of value: higher is harder to poach, but he asks more wages (+8% per 1× above 2×)." },
  "pc-talking": { zh: "在谈：对方现在要价 {f}（{m}）。", en: "In talks: they now want {f} ({m})." },
  "pc-walked": { zh: "和对方谈崩了，{d}之前不能再谈（出到解约金除外）。", en: "Talks broke down — none until {d} (except paying the clause)." },
  "pc-walked-soon": { zh: "30 天内", en: "30 days from now" },
  "pc-loan-title": { zh: "租借", en: "Loan" },
  "pc-loan-note": { zh: "租借费 {f}（半季 {h}）；工资按两队实力分担，他比你队首发平均越强你付得越多。", en: "Loan fee {f} ({h} for half a season); wages are shared by strength — the better he is than your XI, the more you pay." },
  "pc-loan-half": { zh: "租半季（到冬窗）", en: "Half season (to winter)" },
  "pc-loan-full": { zh: "租一季", en: "Full season" },
  "pc-loan-buy-none": { zh: "不带买断", en: "No option" },
  "pc-loan-buy-option": { zh: "选择性买断 {x}", en: "Option to buy {x}" },
  "pc-loan-buy-must": { zh: "强制买断 {x}", en: "Obligation to buy {x}" },
  "pc-go-loan": { zh: "申请租借", en: "Request loan" },
  "pc-on-loan": { zh: "{a} → {b}，{w}还（借入的队付 {s} 工资）", en: "{a} → {b}, back {w} (borrower pays {s} of wages)" },
  "pc-loan-end-winter": { zh: "{s} 冬窗", en: "in the {s} winter window" },
  "pc-loan-end-end": { zh: "{s} 赛季末", en: "at the end of {s}" },
  "pc-go-loanbuy": { zh: "行使买断 {x}", en: "Buy him for {x}" },
  "pc-list-title": { zh: "挂牌", en: "Transfer list" },
  "pc-list-note": { zh: "挂牌后，窗口开着的每个转会日都可能有球队来报价（一个窗口最多 3 家），报价在转会市场的「报价」里。", en: "While the window is open, clubs may make offers on any transfer day (up to 3 a window); they show under Offers." },
  "pc-list-none": { zh: "不挂牌", en: "Not listed" },
  "pc-list-discount": { zh: "折扣（身价 × 0.8）", en: "Discount (value × 0.8)" },
  "pc-list-par": { zh: "平价（身价 × 1.0）", en: "At value" },
  "pc-list-premium": { zh: "溢价（身价 × 1.2）", en: "Premium (value × 1.2)" },
  "pc-list-loan": { zh: "租借挂牌", en: "Loan list" },
  "pc-go-list": { zh: "确定", en: "Apply" },
  "nw-loan": { zh: "{p} 从 {a} 租借加盟 {b}（租借费 {f}）", en: "{p} joins {b} on loan from {a} (fee {f})" },
  "nw-loan_back": { zh: "{p} 租借到期回到 {b}", en: "{p} returns to {b} as his loan ends" },
  "nw-bid-loan": { zh: "{t} 想租借 {p}", en: "{t} want {p} on loan" },
  "nw-transfer-clause": { zh: "{p}：{a} → {b}，触发解约金 {f}", en: "{p}: {a} → {b}, release clause {f} triggered" },
  "nt-loan": { zh: "租借", en: "Loan" },
  "mk-log-clause": { zh: "{p}：{a} → {b}，解约金 {f}", en: "{p}: {a} → {b}, release clause {f}" },
  "mk-log-loan": { zh: "{p} 从 {a} 租借到 {b}（租借费 {f}）", en: "{p} loaned from {a} to {b} (fee {f})" },
  "mk-log-loan_back": { zh: "{p} 租借到期从 {a} 回到 {b}", en: "{p} back from {a} to {b} as his loan ends" },
  "mk-log-loan_buy": { zh: "{p}：{a} → {b}，租借买断 {f}", en: "{p}: {a} → {b}, bought after loan for {f}" },
  "nw-transfer": { zh: "{p}：{a} → {b}（{f}）", en: "{p}: {a} → {b} ({f})" },
  "nw-bid": { zh: "{t} 出价 {f} 求购 {p}", en: "{t} offer {f} for {p}" },
  "nw-bid-swap": { zh: "{t} 出价 {f} 求购 {p}，其中搭上 {s} 抵一部分", en: "{t} offer {f} for {p}, with {s} included as part-exchange" },
  "nw-bid-wk": { zh: "豪门 {t} 看上了你的小将 {p}，出价 {f}", en: "{t} are chasing your youngster {p} with a {f} bid" },
  "nw-transfer-wk": { zh: "豪门 {b} 从 {a} 签下 {n} 岁的好苗子 {p}（{f}）", en: "{b} sign {n}-year-old prospect {p} from {a} ({f})" },
  "mk-bid-swap": { zh: "其中搭上 {p}（作价 {v}），现金 {c}", en: "includes {p} (valued {v}); cash {c}" },
  "mk-bid-wk": { zh: "豪门看上小将", en: "Big club interest" },
  "nw-expired": { zh: "{p} 合同到期离队", en: "{p} leaves as his contract runs out" },
  "nt-transfer": { zh: "转会", en: "Transfer" },
  "nt-bid": { zh: "报价", en: "Offer" },
  "nt-expired": { zh: "到期", en: "Expired" },
  "nw-warn_expire": { zh: "{p} 的合同这季踢完到期，还没续约", en: "{p}'s contract runs out at the end of this season — not renewed yet" },
  "nw-warn_loan": { zh: "{p} 的租借快到期了（{a} → {b}）", en: "{p}'s loan spell is about to end ({a} → {b})" },
  "nw-warn_clause": { zh: "{p} 的解约金只有 {f}，已低于身价，当心被触发", en: "{p}'s release clause is only {f}, below his market value" },
  "nw-bid_missed": { zh: "{t} 出价 {f} 求购 {p}，你没回，报价作废了", en: "Unanswered {f} offer from {t} for {p} has expired" },
  "nt-warn": { zh: "预警", en: "Warning" },
  // ---- 董事会 (R-26)
  "tile-board": { zh: "董事会", en: "Board" },
  "bd-title": { zh: "董事会", en: "The board" },
  "bd-conf": { zh: "信任度", en: "Confidence" },
  "bd-conf-line": { zh: "董事会信任度 {c} / 100", en: "Board confidence {c} / 100" },
  "bd-goal": { zh: "本季目标", en: "Season objective" },
  "bd-goal-title": { zh: "联赛夺冠", en: "Win the league" },
  "bd-goal-top4": { zh: "联赛前 {t}", en: "Finish in the top {t}" },
  "bd-goal-tophalf": { zh: "联赛前 {t}", en: "Finish in the top {t}" },
  "bd-goal-mid": { zh: "联赛前 {t}", en: "Finish in the top {t}" },
  "bd-goal-survive": { zh: "保级（前 {t}）", en: "Avoid relegation (top {t})" },
  "bd-ucl-goal": { zh: "欧冠联赛阶段前 {t}", en: "Champions League league phase: top {t}" },
  "bd-now": { zh: "现在第 {p}", en: "Currently {p}" },
  "bd-now-none": { zh: "还没开踢", en: "Not started yet" },
  "bd-on-track": { zh: "达标", en: "On track" },
  "bd-off-track": { zh: "落后 {n} 名", en: "{n} places short" },
  "bd-expected": { zh: "按实力你的队在联赛里排第 {e}（共 {n} 队）。", en: "On paper your squad ranks {e} of {n} in the league." },
  "bd-rules": { zh: "每场赢了加、输了扣（赢强队、输弱队更多）；联赛踢到 1/4、1/2、3/4 时董事会看一次排名；赛季末按目标评估。信任度低于 {w} 会收到警告；赛季末低于 {s}、又连着两季没达标就被解雇（差得太多或者保级失败，一季就走人）；1/2、3/4 那次看排名时信任度低于 {s}、又落后目标太多，赛季中就下课（中途接手的这季不会）；高于 {p} 又达标会有强队来挖你。", en: "Wins raise confidence and defeats lower it (more for upsets); the board reviews the table at 1/4, 1/2 and 3/4 of the league season and judges the objective at season end. Below {w} you get a warning; below {s} at season end after two missed objectives in a row you are sacked (one season is enough if you miss by a mile or get relegated); below {s} and well off the objective at the 1/2 or 3/4 review, you are sacked mid-season (not in a season you took over mid-way); above {p} with the objective met, bigger clubs come for you." },
  "bd-strike": { zh: "上季没达标：这季再不达标，信任度又低于 {s}，就会被解雇；1/2、3/4 那次看排名时还落后，赛季中就可能下课。", en: "You missed last season's objective. Miss this one too with confidence below {s} and you will be sacked; still behind at the 1/2 or 3/4 review and you may go mid-season." },
  "bd-last": { zh: "上季：第 {p}（目标 {t}），信任度 {d}", en: "Last season: finished {p} (target {t}), confidence {d}" },
  "bd-bonus": { zh: "，奖金 {b}", en: ", bonus {b}" },
  "bd-offers": { zh: "工作机会", en: "Job offers" },
  "bd-no-offers": { zh: "现在没有。信任度高于 75 又达标的话，赛季末会有强队来挖你。", en: "None right now. Meet the objective with confidence above 75 and bigger clubs will call at season end." },
  "bd-offer-poach": { zh: "{t} 想请你去执教（实力 {s}，你现在 {m}）", en: "{t} want you as their manager (strength {s}, yours {m})" },
  "bd-offer-sacked": { zh: "{t} 愿意请你（实力 {s}）", en: "{t} are willing to hire you (strength {s})" },
  "bd-accept": { zh: "接受", en: "Accept" },
  "bd-accept-confirm": { zh: "离开 {a}，去执教 {b}？", en: "Leave {a} to manage {b}?" },
  "bd-poach-hint": { zh: "夏窗关之前都可以跳槽；不理就作废。", en: "You can move until the summer window closes; otherwise the offers lapse." },
  "bd-sacked": { zh: "你被解雇了", en: "You have been sacked" },
  "bd-sacked-sub-mid": { zh: "{t} 的董事会等不到赛季末了：排第 {p}，目标第 {g}。挑一家愿意请你的球队接着带（选了才能继续踢比赛；中途接手的这季董事会不会炒你）。", en: "The {t} board could not wait for the end of the season: {p} in the table against an objective of {g}. Pick one of the clubs willing to hire you to carry on (you can't play until you do; a club you take over mid-season won't sack you this season)." },
  "bd-sacked-sub": { zh: "{t} 的董事会对上季的成绩失去了信心。挑一家愿意请你的球队接着带（选了才能继续踢比赛）。", en: "The {t} board lost faith after last season. Pick one of the clubs willing to hire you to carry on (you can't play until you do)." },
  "nw-board_check": { zh: "董事会：联赛第 {p}（目标前 {t}），信任度 {c}", en: "Board: {p} in the league (target top {t}), confidence {c}" },
  "nw-board_warn": { zh: "董事会警告：联赛第 {p}，目标是前 {t}，信任度只剩 {c}", en: "Board warning: {p} in the league against a top-{t} target; confidence down to {c}" },
  "nw-verdict": { zh: "赛季评估：第 {p}（目标前 {t}），{r}，信任度 {c}", en: "Season review: finished {p} (target top {t}), {r}, confidence {c}" },
  "nw-verdict-met": { zh: "达标", en: "objective met" },
  "nw-ultimatum": { zh: "董事会最后通牒：这季再不达标就走人（信任度 {c}）", en: "Board ultimatum: miss the objective again this season and you are out (confidence {c})" },
  "nw-verdict-miss": { zh: "没达标", en: "objective missed" },
  "nw-sacked-mid": { zh: "赛季中下课：你被 {t} 解雇了（排第 {p}，目标第 {g}）", en: "Sacked mid-season by {t} ({p} in the table, objective {g})" },
  "nw-sacked": { zh: "你被 {t} 解雇了", en: "You have been sacked by {t}" },
  "nw-offer": { zh: "{t} 想请你当主教练", en: "{t} want you as manager" },
  "nw-hired": { zh: "你成了 {t} 的主教练", en: "You are the new {t} manager" },
  "nt-board": { zh: "董事会", en: "Board" },
  "nt-sacked": { zh: "解雇", en: "Sacked" },
  "nt-offer": { zh: "工作", en: "Offer" },
  "sl-board": { zh: "董事会评估：第 {p}（目标前 {t}）", en: "Board review: finished {p} (target top {t})" },
  // ---- 荣誉和历史 (R-27)
  "tile-honors": { zh: "荣誉", en: "Honours" },
  "hn-title": { zh: "荣誉", en: "Honours" },
  "hn-race": { zh: "年度最佳候选", en: "Player of the Year race" },
  "hn-race-eu": { zh: "欧洲年度最佳候选", en: "European Player of the Year race" },
  "hn-race-note": { zh: "按本季到现在的数据现算；冠军分赛季末才加。", en: "Worked out live from this season so far; trophy points are added at season end." },
  "hn-race-lead": { zh: "{p} 领跑，{s} 分", en: "{p} leads on {s} points" },
  "hn-race-empty": { zh: "踢几场以后这里会排出候选。", en: "The race takes shape after a few matches." },
  "hn-boot-race": { zh: "金靴榜", en: "Golden Boot race" },
  "hn-last": { zh: "上季年度最佳：{p}", en: "Last season: {p}" },
  "hn-first": { zh: "第一季踢完颁奖。", en: "The first awards come at the end of this season." },
  "hn-open": { zh: "荣誉室", en: "Honours" },
  "hn-hof-n": { zh: "名人堂 {n} 人", en: "{n} in the Hall of Fame" },
  "hn-tab-race": { zh: "本季", en: "This season" },
  "hn-tab-awards": { zh: "颁奖", en: "Awards" },
  "hn-tab-seasons": { zh: "历届", en: "Roll of honour" },
  "hn-tab-hof": { zh: "名人堂", en: "Hall of Fame" },
  "hn-tab-coaches": { zh: "教练", en: "Coaches" },
  "hn-tab-records": { zh: "纪录", en: "Records" },
  "hn-no-awards": { zh: "还没有颁过奖。赛季踢完、开始下一赛季时颁发。", en: "No awards yet. They are handed out when you start the next season." },
  "hn-score-rule": { zh: "评分 = 表现（平均表现分 − 6）× 10 + 进球 × 位置系数 + 助攻 × 0.7 + 零封 + 冠军 + 名气（总评 − 78）× 0.6。要踢够联赛 {e}% 的场次。", en: "Score = form (avg rating − 6) × 10 + goals × position weight + assists × 0.7 + clean sheets + trophies + star power (overall − 78) × 0.6. Needs {e}% of league games." },
  "hn-score-rule-eu": { zh: "欧洲年度最佳看全部赛事，要踢 {g} 场以上；欧洲金靴 = 联赛进球 × 联赛系数（英西意法 ×2、其他顶级 ×1.5、次级 ×1）。", en: "The European award counts all competitions (at least {g} games); the European Golden Shoe = league goals × league weight (England/Spain/Italy/France ×2, other top flights ×1.5, second tiers ×1)." },
  "aw-poty": { zh: "年度最佳球员", en: "Player of the Year" },
  "aw-poty-eu": { zh: "欧洲年度最佳", en: "European Player of the Year" },
  "aw-poty-2": { zh: "年度最佳第二", en: "Player of the Year runner-up" },
  "aw-poty-3": { zh: "年度最佳第三", en: "Player of the Year, third" },
  "aw-lpoty": { zh: "联赛最佳球员", en: "League Player of the Year" },
  "aw-boot": { zh: "金靴", en: "Golden Boot" },
  "aw-eboot": { zh: "欧洲金靴", en: "European Golden Shoe" },
  "aw-assist": { zh: "助攻王", en: "Top assists" },
  "aw-glove": { zh: "最佳门将", en: "Golden Glove" },
  "aw-young": { zh: "最佳年轻球员", en: "Young Player of the Year" },
  "aw-xi": { zh: "赛季最佳阵容", en: "Team of the Season" },
  "aw-ucl_poty": { zh: "欧冠最佳球员", en: "Champions League Player of the Season" },
  "aw-ucl_boot": { zh: "欧冠金靴", en: "Champions League top scorer" },
  "aw-nat_boot": { zh: "大赛金靴", en: "Tournament top scorer" },
  "aw-title": { zh: "联赛冠军", en: "League title" },
  "aw-cup": { zh: "杯赛冠军", en: "Cup winner" },
  "aw-ucl": { zh: "欧冠冠军", en: "Champions League winner" },
  "aw-nat": { zh: "大赛冠军", en: "International title" },
  "hp-form": { zh: "表现", en: "Form" },
  "hp-att": { zh: "进球助攻", en: "Goals & assists" },
  "hp-def": { zh: "零封", en: "Clean sheets" },
  "hp-tro": { zh: "冠军", en: "Trophies" },
  "hp-star": { zh: "名气", en: "Star power" },
  "hp-form-s": { zh: "表现", en: "Form" },
  "hp-att-s": { zh: "攻", en: "G+A" },
  "hp-def-s": { zh: "守", en: "CS" },
  "hp-tro-s": { zh: "冠", en: "Tr" },
  "hp-star-s": { zh: "名", en: "Star" },
  "th-score": { zh: "评分", en: "Score" },
  "th-cs": { zh: "零封", en: "CS" },
  "unit-pts": { zh: "分", en: "pts" },
  // 伤停的天数、停赛的场数, 紧跟在数字后面 (3天 / 3d)
  "unit-day": { zh: "天", en: "d" },
  "unit-match": { zh: "场", en: "m" },
  "hn-winner": { zh: "冠军", en: "Champions" },
  "hn-leagues": { zh: "各联赛", en: "Around the leagues" },
  "hof-tag": { zh: "名人堂", en: "Hall of Fame" },
  "hof-in": { zh: "{s} 入选 · {n} 分", en: "Inducted {s} · {n} pts" },
  "hof-rule": { zh: "人走的时候（退役，或 31 岁以后离开）够 {n} 分入选：奖项、冠军、生涯进球和出场、巅峰身份；dt200 里的老将另算开档前的生涯。", en: "Players qualify when they leave (retire, or leave after 31) with {n} points: awards, trophies, career goals and games, peak status; veterans from the game's own database also get credit for their career before this save." },
  "hof-none": { zh: "还没有人入选。明星退役、拿过大奖的人走的时候会进来。", en: "Nobody yet. Stars and award winners get in when they retire." },
  "hof-now": { zh: "现在退役的话：{n} 分（够 {l} 入选）", en: "If he retired now: {n} pts ({l} needed)" },
  "hof-b-awards": { zh: "奖项", en: "Awards" },
  "hof-b-trophies": { zh: "冠军", en: "Trophies" },
  "hof-b-goals": { zh: "进球", en: "Goals" },
  "hof-b-apps": { zh: "出场", en: "Games" },
  "hof-b-role": { zh: "身份", en: "Status" },
  "hof-b-legacy": { zh: "开档前", en: "Before this save" },
  "hof-main": { zh: "主队", en: "Club" },
  "co-you": { zh: "你", en: "You" },
  "co-head": { zh: "主教练", en: "Manager" },
  "co-line": { zh: "主教练：{c}", en: "Manager: {c}" },
  "co-legend-tag": { zh: "传奇教练", en: "Legend coach" },
  "co-staff": { zh: "你的教练组", en: "Your coaching staff" },
  "co-pool": { zh: "候选传奇", en: "Legends looking for work" },
  "co-heads": { zh: "执教中的传奇", en: "Legends in charge" },
  "co-hire": { zh: "请进教练组", en: "Hire" },
  "co-release": { zh: "请走", en: "Let go" },
  "co-hire-confirm": { zh: "请 {p} 进你的教练组？", en: "Bring {p} onto your staff?" },
  "co-release-confirm": { zh: "请走 {p}？他在练的训练名额会少一个。", en: "Let {p} go? You lose one training slot." },
  "co-ok-hire": { zh: "{p} 加入了你的教练组。", en: "{p} joins your staff." },
  "co-ok-release": { zh: "{p} 离开了教练组。", en: "{p} has left your staff." },
  "co-slots": { zh: "训练名额 {a}（基础 {b} + 教练组 {c}）", en: "Training slots {a} (base {b} + staff {c})" },
  "co-rule": { zh: "每个传奇助教：训练名额 +1；练他会的技能算有人带（×{m}）；他那条线 {a} 岁以下的人场上没有导师时由他带（经验 ×{x}）。最多 {n} 人，换队时跟你走。", en: "Each legend on your staff adds a training slot, counts as a mentor for skills he had (×{m}), and mentors under-{a}s in his line when no mentor is on the pitch (×{x} experience). Up to {n}; they follow you if you change clubs." },
  "co-pool-rule": { zh: "退役的名人堂成员、巨星、明星有人去考教练证（一季），之后 AI 俱乐部换帅时会请他们；执教的球队实力上限 = 72 + 威望 × 0.5。你的队出身的随时能请，别的要你的队实力不低于他的上限 {g} 以上。", en: "Some retired Hall of Famers and stars take a one-season coaching course; afterwards AI clubs hire them when they change managers (club strength limit = 72 + prestige × 0.5). Your own former players will always come; others need your strength within {g} of their limit." },
  "co-empty-staff": { zh: "还没请人。", en: "Nobody yet." },
  "co-empty-pool": { zh: "现在没有候选。传奇退役后会出现在这里。", en: "None right now. Retired legends appear here." },
  "co-empty-heads": { zh: "还没有传奇当上主教练。", en: "No legend manages a club yet." },
  "co-st-pool": { zh: "等工作", en: "Available" },
  "co-st-badge": { zh: "考证中（{s} 起）", en: "On the course (from {s})" },
  "co-st-head": { zh: "执教 {t}", en: "Manages {t}" },
  "co-st-staff": { zh: "你的教练组", en: "On your staff" },
  "co-st-off": { zh: "不干了", en: "Out of the game" },
  "co-pr": { zh: "威望 {p} · 上限 {c}", en: "Prestige {p} · limit {c}" },
  "co-why-unwilling": { zh: "嫌你的队不够格", en: "Thinks your club is too small" },
  "co-why-full": { zh: "教练组满了", en: "Staff is full" },
  "co-why-busy": { zh: "在别处执教", en: "Busy elsewhere" },
  "co-why-already": { zh: "已经在你的教练组", en: "Already on your staff" },
  "co-why-who": { zh: "请不了", en: "Not available" },
  "co-since": { zh: "{s} 上任", en: "since {s}" },
  "rc-scorers": { zh: "历史射手榜", en: "All-time top scorers" },
  "rc-apps": { zh: "历史出场榜", en: "Most appearances" },
  "rc-season": { zh: "单季联赛进球纪录", en: "Single-season league goals record" },
  "rc-season-line": { zh: "{p} · {n} 球（{s}）", en: "{p} · {n} goals ({s})" },
  "rc-trophies": { zh: "冠军榜", en: "Trophy table" },
  "rc-none": { zh: "踢完一季以后开始记。", en: "Records start after the first season." },
  "th-titles": { zh: "联赛", en: "League" },
  "th-cups": { zh: "杯赛", en: "Cups" },
  "th-ucl": { zh: "欧冠", en: "UCL" },
  "tab-honors": { zh: "荣誉", en: "Honours" },
  "ph-career": { zh: "这个存档里的生涯", en: "Career in this save" },
  "ph-line": { zh: "{s} 季 · {a} 场 · {g} 球 · {as} 助攻", en: "{s} seasons · {a} games · {g} goals · {as} assists" },
  "ph-peak": { zh: "巅峰总评 {o}", en: "Peak overall {o}" },
  "ph-clubs": { zh: "效力过", en: "Clubs" },
  "ph-seasons-n": { zh: "{n} 季", en: "{n} seasons" },
  "ph-now": { zh: "本季年度评分 {s}", en: "This season's score {s}" },
  "ph-list": { zh: "奖项和冠军", en: "Awards and trophies" },
  "ph-list-none": { zh: "还没拿过。", en: "Nothing yet." },
  "ph-coach": { zh: "教练生涯", en: "Coaching" },
  "tm-trophies": { zh: "荣誉室：联赛冠军 ×{a} · 杯赛 ×{b} · 欧冠 ×{c}", en: "Trophies: league ×{a} · cups ×{b} · Champions League ×{c}" },
  "tm-inv": { zh: " · 不败赛季 ×{n}", en: " · invincible season ×{n}" },
  "tm-legends": { zh: "俱乐部传奇", en: "Club legends" },
  "sl-honors": { zh: "年度最佳 {p} · 金靴 {b}（{n} 球）", en: "Player of the Year {p} · Golden Boot {b} ({n})" },
  "sl-honors-eu": { zh: "欧洲年度最佳 {p}", en: "European Player of the Year {p}" },
  "nw-award": { zh: "{p} 获得{a}", en: "{p} wins the {a}" },
  "nw-award-n": { zh: "{p} 以 {n} 球获得{a}", en: "{p} wins the {a} with {n} goals" },
  "nw-hof": { zh: "{p} 入选名人堂（{n} 分）", en: "{p} enters the Hall of Fame ({n} pts)" },
  "nw-coach_badge": { zh: "{p} 挂靴，开始考教练证", en: "{p} hangs up his boots and starts his coaching badges" },
  "nw-coach_hired": { zh: "传奇 {p} 出任 {t} 主教练", en: "Legend {p} takes charge of {t}" },
  "nw-coach_after_you": { zh: "你走后，{c} 接手 {t}", en: "{c} takes over {t} after your exit" },
  "nw-staff_in": { zh: "{p} 加入你的教练组", en: "{p} joins your coaching staff" },
  "nt-award": { zh: "颁奖", en: "Award" },
  "nt-hof": { zh: "名人堂", en: "Hall of Fame" },
  "nt-upset": { zh: "爆冷", en: "Upset" },
  "nw-upset": { zh: "{c}：{w} {s} {l}，赛前胜率只有 {p}", en: "{c}: {w} beat {l} {s} with only a {p} chance before kick-off" },
  "pre-odds": { zh: "赛前胜率 主 {h} · 平 {d} · 客 {a}", en: "Before kick-off: home {h} · draw {d} · away {a}" },
  "nt-coach": { zh: "教练", en: "Coach" },
  // ---- 颁奖典礼和动效 (R-28)
  "cer-kicker": { zh: "{s} · 颁奖典礼", en: "{s} · Awards night" },
  "cer-next": { zh: "下一项", en: "Next" },
  "cer-skip": { zh: "跳过", en: "Skip" },
  "cer-go": { zh: "进入新赛季", en: "On to the new season" },
  "cer-close": { zh: "关闭", en: "Close" },
  "cer-champ-title": { zh: "{t} 夺得联赛冠军", en: "{t} are the champions" },
  "cer-ucl": { zh: "欧冠冠军", en: "Champions League winners" },
  "cer-mine-kicker": { zh: "你的赛季", en: "Your season" },
  "cer-mine-title": { zh: "{t} 排名第 {p}", en: "{t} finish in position {p}" },
  "cer-board": { zh: "董事会：目标前 {t}，{r}", en: "Board: target top {t}, {r}" },
  "cer-bonus": { zh: "奖金 {b}", en: "bonus {b}" },
  "cer-sacked": { zh: "董事会决定解雇你。", en: "The board has decided to sack you." },
  "cer-up": { zh: "升级", en: "Promoted" },
  "cer-down": { zh: "降级", en: "Relegated" },
  "cer-awards": { zh: "赛季奖项", en: "Season awards" },
  "cer-hof": { zh: "名人堂新成员", en: "New Hall of Famers" },
  "cer-legacy": { zh: "传奇的下一站", en: "Where the legends go next" },
  "cer-coach": { zh: "出任 {t} 主教练", en: "takes charge of {t}" },
  "cer-farewell": { zh: "告别 {t}", en: "says goodbye to {t}" },
  "cer-new-kicker": { zh: "新赛季", en: "A new season" },
  "cer-new-sub": { zh: "转会窗口开了，董事会定了新目标。去主页看看下一场。", en: "The transfer window is open and the board has new objectives. Your next match is on the home screen." },
  "cer-replay-end": { zh: "这一季的颁奖到此结束。", en: "That's the end of this season's awards." },
  "cer-replay": { zh: "回放颁奖典礼", en: "Replay the ceremony" },
  "nt-retired": { zh: "退役", en: "Retired" },
  "mv-up": { zh: "比上一轮升了 {n} 名", en: "Up {n} since the last round" },
  "mv-down": { zh: "比上一轮降了 {n} 名", en: "Down {n} since the last round" },
  "hn-season-end": { zh: "开始下一赛季时颁奖：现在领跑年度最佳的是 {p}。", en: "Awards are presented when you start the next season. {p} leads the Player of the Year race." },
  // 开发者模式 (R-30)
  "dv-btn": { zh: "开发者", en: "Developer" },
  "dv-btn-running": { zh: "开发者 · 快进中", en: "Developer · running" },
  "dv-title": { zh: "开发者模式", en: "Developer mode" },
  "dv-kicker": { zh: "快进几季，看各系统的数合不合适", en: "Fast-forward a few seasons and check the numbers" },
  "dv-tab-run": { zh: "快进", en: "Fast-forward" },
  "dv-g-match": { zh: "比赛", en: "Matches" },
  "dv-g-pop": { zh: "人口", en: "Population" },
  "dv-g-abil": { zh: "能力", en: "Ability" },
  "dv-g-money": { zh: "转会和钱", en: "Transfers & money" },
  "dv-g-mine": { zh: "你的队", en: "Your team" },
  "dv-g-hon": { zh: "荣誉", en: "Honours" },
  "dv-g-time": { zh: "用时", en: "Timing" },
  "dv-from": { zh: "从当前存档拷一份：{n}", en: "Copies the current save: {n}" },
  "dv-seasons": { zh: "快进几季", en: "Seasons to simulate" },
  "dv-n": { zh: "{n} 季", en: "{n} seasons" },
  "dv-n1": { zh: "1 季", en: "1 season" },
  "dv-start": { zh: "开始快进", en: "Start" },
  "dv-stop": { zh: "停下", en: "Stop" },
  "dv-stopping": { zh: "这一场踢完就停…", en: "Stopping after this match…" },
  "dv-copy-note": { zh: "只动副本 {f}，原存档一点不动。关了窗口也会跑完；跑完右下角会提示。", en: "Only the copy {f} changes; your save is untouched. It keeps running if you close the window, and you'll get a notice when it's done." },
  "dv-running": { zh: "第 {i} / {n} 季 · {s}", en: "Season {i} of {n} · {s}" },
  "dv-round": { zh: "第 {r} 轮", en: "Round {r}" },
  "dv-elapsed": { zh: "已用 {a}", en: "{a} elapsed" },
  "dv-eta": { zh: "估计还要 {b}", en: "about {b} left" },
  "dv-last-done": { zh: "上次快进跑完 {d} / {n} 季，用了 {a}。", en: "Last run finished {d} of {n} seasons in {a}." },
  "dv-last-stopped": { zh: "上次快进停在 {d} / {n} 季（跑完的季都在副本里）。", en: "Last run stopped after {d} of {n} seasons (finished seasons are kept in the copy)." },
  "dv-last-error": { zh: "上次快进出错：{e}", en: "Last run failed: {e}" },
  "dv-open-copy": { zh: "切到这个存档", en: "Switch to this save" },
  "dv-on-copy": { zh: "你现在就在这个副本上。在这里再快进一次会再拷一份，体检接着往后记。", en: "You're on this copy now. Running again makes another copy and the report carries on." },
  "dv-see-report": { zh: "看体检报告", en: "See the report" },
  "dv-auto-title": { zh: "托管你的队", en: "Autopilot for your team" },
  "dv-auto-1": { zh: "你的每场比赛都模拟（和「模拟这场」一样）；挂着要你定谁晋级的淘汰赛，按实力抽。", en: "Every match of yours is simulated (same as Simulate). A knockout tie waiting for your decision is drawn by strength." },
  "dv-auto-2": { zh: "你的人合同到期，照 AI 的规矩续：30 岁以下的主力九成、替补七成、33 岁以上一半，工资要在预算里。", en: "Expiring contracts are renewed by the AI rule: 90% for regulars under 30, 70% for fringe players, 50% for 33+, within the wage budget." },
  "dv-auto-3": { zh: "被解雇就接实力最强的那份工作；被挖角不走；AI 的报价不理；不买人、不练技能、不请助教。", en: "Sacked: takes the strongest job offered. Poaching offers and AI bids are ignored. No signings, training or staff." },
  "dv-auto-4": { zh: "不写进游戏、不碰 dt200。", en: "Nothing is written into the game or dt200." },
  "dv-events": { zh: "托管做了什么", en: "What autopilot did" },
  "dv-no-events": { zh: "还没有要托管拿主意的事。", en: "Nothing needed a decision yet." },
  "dv-ev-hired-mid": { zh: "第 {s} 季赛季中被解雇，接了 {t}", en: "Season {s}: sacked mid-season, took over {t}" },
  "dv-ev-hired": { zh: "第 {s} 季开季被解雇，接了 {t}", en: "Season {s}: sacked, took over {t}" },
  "dv-ev-decide": { zh: "第 {s} 季：{w} 淘汰 {l}（按实力抽）", en: "Season {s}: {w} beat {l} (drawn by strength)" },
  "dv-no-report": { zh: "还没有体检报告：在「快进」里跑几季。", en: "No report yet. Run a few seasons under Fast-forward." },
  "dv-report-of": { zh: "体检报告：{n}", en: "Report: {n}" },
  "dv-th-metric": { zh: "指标", en: "Metric" },
  "dv-th-ref": { zh: "参考", en: "Target" },
  "dv-flag": { zh: "超出参考", en: "outside target" },
  "dv-done-toast": { zh: "开发者模拟跑完了：{d} / {n} 季。去「开发者」看体检报告。", en: "Developer run finished: {d} of {n} seasons. The report is under Developer." },
  "dv-err-toast": { zh: "开发者模拟出错：{e}", en: "Developer run failed: {e}" },
  "dv-rank": { zh: "实力第 {n}", en: "#{n} by strength" },
  "dv-sacked": { zh: "被解雇", en: "Sacked" },
  "dv-poached": { zh: "{n} 家来挖", en: "{n} offers" },
  "dv-pts": { zh: "{n} 分", en: "{n} pts" },
  "dv-goals": { zh: "{n} 球", en: "{n} goals" },
  "dv-sec": { zh: "{n} 秒", en: "{n} s" },
  "dv-min": { zh: "{m} 分 {s} 秒", en: "{m}m {s}s" },
  "dv-note-match": { zh: "这季所有赛事的比赛（模拟的和你亲手踢的）。参考值是现实联赛的大概：场均 2.3–3.2 球、主胜四成多；受伤按规则设计时定的每队每场约 0.13 人（FitConfig）。",
    en: "Every match this season in all competitions. Targets are rough real-league figures: 2.3–3.2 goals a game, home sides win just over 40%. Injuries follow the design rate of about 0.13 per team per match (FitConfig)." },
  "dv-note-pop": { zh: "赛季末、换季之前的世界。「dt200」列是开档时游戏里原样的阵容；各年龄段人数在它的 ±5% 以内算稳（R-24 校准的标准）。退役、离开、新人是换季时的数。",
    en: "The world at the end of each season, before rollover. The dt200 column is the game's original squads; each age band within ±5% of it counts as stable (the R-24 standard). Retired, left and newcomers are counted at rollover." },
  "dv-note-abil": { zh: "成长和衰退之后全世界的总评。各年龄段平均总评离 dt200 原样 ±2 以内、80+ 和 85+ 的人数离它 ±15% 以内算稳；一路涨是成长太快（潜力给多了），一路掉是太慢。",
    en: "Overall ratings after growth and decline. Stable means each age band within ±2 of the dt200 average and the 80+ and 85+ counts within ±15% of it. Steady climbs mean growth is too fast (potential too generous); steady falls mean too slow." },
  "dv-note-money": { zh: "转会日志和各队的账（AI 俱乐部账上超过半季收入的部分每季拿一半投进设施）。「实力漂移」：收入、董事会目标、球员愿不愿意来、工作机会用的「实力」是开季按阵容算的（第一季是 dt200 的）；这里按同一个公式（首发平均总评）算赛季末的阵容，差得多说明这些系统看到的实力过时了。",
    en: "Transfer log and club finances (each season AI clubs put half of any cash above half a season's revenue into facilities). Strength drift: revenue, board targets, player willingness and job offers use the strength worked out from each squad at the start of the season (dt200's in the first season). This compares it with the squad at season end (same formula, starting XI average); a big gap means those systems see stale strength." },
  "dv-note-mine": { zh: "托管下你的队。名次没达到目标的标「!」。", en: "Your team on autopilot. A position below target is marked \"!\"." },
  "dv-note-hon": { zh: "换季时发的奖。名人堂每季新进 5–15 人是设计时希望的（R-27）。", en: "Awards at each rollover. The design hopes for 5–15 new Hall of Famers a season (R-27)." },
  "dv-note-time": { zh: "在这台电脑上一季要跑多久、存档多大。", en: "How long a season takes on this computer, and how big the save gets." },
  "dv-m_n": { zh: "场数（所有赛事）", en: "Matches (all competitions)" },
  "dv-m_goals": { zh: "场均进球", en: "Goals per match" },
  "dv-m_home": { zh: "主胜", en: "Home wins" },
  "dv-m_draw": { zh: "平局", en: "Draws" },
  "dv-m_away": { zh: "客胜", en: "Away wins" },
  "dv-m_inj": { zh: "每队每场受伤", en: "Injuries per team per match" },
  "dv-m_inj_long": { zh: "重伤（6 周以上）", en: "Long injuries (6+ weeks)" },
  "dv-m_bans": { zh: "停赛", en: "Suspensions" },
  "dv-m_fav": { zh: "实力第一的队夺冠", en: "Favourites who won the league" },
  "dv-m_dog": { zh: "冷门赢球（分出胜负里赛前胜率低的一方赢）", en: "Underdog wins (lower pre-match chance won)" },
  "dv-m_upsets": { zh: "大冷门（赢的一方赛前胜率不到 15%）", en: "Big upsets (winner under 15% before kick-off)" },
  "dv-m_shots": { zh: "模拟赛每队场均射门", en: "Shots per team (simulated)" },
  "dv-m_champ": { zh: "你那个联赛的冠军", en: "Your league's champion" },
  "dv-m_boot": { zh: "你那个联赛的射手王", en: "Your league's top scorer" },
  "dv-p_n": { zh: "世界上的球员", en: "Players in the world" },
  "dv-p_ret": { zh: "退役", en: "Retired" },
  "dv-p_left": { zh: "离开", en: "Left the world" },
  "dv-p_new": { zh: "新人", en: "Newcomers" },
  "dv-p_reborn": { zh: "转世回来的明星", en: "Reborn stars" },
  "dv-p_regen": { zh: "新人占比", en: "Share of newgens" },
  "dv-p_vessels": { zh: "新容器还剩", en: "Fresh vessels left" },
  "dv-p_age": { zh: "{b} 岁人数", en: "Players aged {b}" },
  "dv-a_avg": { zh: "平均总评", en: "Average overall" },
  "dv-a_age": { zh: "{b} 岁平均总评", en: "Avg overall, aged {b}" },
  "dv-a_top100": { zh: "前 100 平均", en: "Top-100 average" },
  "dv-a_n80": { zh: "80 分以上", en: "Rated 80+" },
  "dv-a_n85": { zh: "85 分以上", en: "Rated 85+" },
  "dv-a_n90": { zh: "90 分以上", en: "Rated 90+" },
  "dv-a_best": { zh: "最强的人", en: "Best player" },
  "dv-a_star": { zh: "明星", en: "Stars" },
  "dv-a_super": { zh: "巨星", en: "Superstars" },
  "dv-a_legend": { zh: "传奇", en: "Legends" },
  "dv-k_buys": { zh: "转会", en: "Transfers" },
  "dv-k_fees": { zh: "转会费总额", en: "Total fees" },
  "dv-k_top": { zh: "最贵的一笔", en: "Record fee" },
  "dv-k_free": { zh: "签自由身", en: "Free signings" },
  "dv-k_clause": { zh: "解约金触发", en: "Release clauses paid" },
  "dv-k_loans": { zh: "新租借", en: "New loans" },
  "dv-k_loan_back": { zh: "租借到期回母队", en: "Loans ended" },
  "dv-k_expire": { zh: "合同到期走人", en: "Contracts run out" },
  "dv-k_youth": { zh: "招青训补人", en: "Youth call-ups" },
  "dv-k_invest": { zh: "AI 投进设施", en: "AI spent on facilities" },
  "dv-k_cash_med": { zh: "各队账上中位数", en: "Median club cash" },
  "dv-k_cash_min": { zh: "账上最少", en: "Lowest club cash" },
  "dv-k_debt": { zh: "欠钱的队", en: "Clubs in debt" },
  "dv-k_wage_med": { zh: "工资 / 预算（中位数）", en: "Wages ÷ budget (median)" },
  "dv-k_wage_max": { zh: "工资 / 预算（最高）", en: "Wages ÷ budget (max)" },
  "dv-k_drift": { zh: "实力漂移（平均差几分）", en: "Strength drift (average gap)" },
  "dv-k_drift_n": { zh: "差 3 分以上的队", en: "Clubs off by 3+" },
  "dv-k_drift_top": { zh: "差得最多", en: "Largest drift" },
  "dv-u_team": { zh: "执教", en: "Managing" },
  "dv-u_pos": { zh: "名次 / 目标", en: "Position / target" },
  "dv-u_conf": { zh: "信任度", en: "Board confidence" },
  "dv-u_delta": { zh: "赛季评估", en: "Season review" },
  "dv-u_bonus": { zh: "奖金", en: "Bonus" },
  "dv-u_job": { zh: "解雇 / 挖角", en: "Sacked / offers" },
  "dv-u_hired": { zh: "托管换到", en: "Autopilot moved to" },
  "dv-u_size": { zh: "阵容人数", en: "Squad size" },
  "dv-u_xi": { zh: "首发平均总评", en: "Starting XI average" },
  "dv-u_renew": { zh: "托管续约", en: "Autopilot renewals" },
  "dv-h_poty": { zh: "年度最佳", en: "Player of the Year" },
  "dv-h_boot": { zh: "金靴", en: "Golden Boot" },
  "dv-h_hof": { zh: "新进名人堂", en: "New Hall of Famers" },
  "dv-h_hof_top": { zh: "名人堂分最高", en: "Top Hall of Fame score" },
  "dv-h_lc": { zh: "执教中的传奇", en: "Legends coaching" },
  "dv-h_pool": { zh: "教练候选", en: "Coach candidates" },
  "dv-t_sim": { zh: "模拟", en: "Simulation" },
  "dv-t_roll": { zh: "换季", en: "Season rollover" },
  "dv-t_size": { zh: "存档", en: "Save size" },
  // 内置修改器 (R-61)
  "tab-edit": { zh: "修改", en: "Edit" },
  "ed-note": { zh: "只能改你的队的人。能力、潜力、年龄、主位置改完以后接着长；别的不再变。游戏开着就马上写进去，不然下次开球前写。",
    en: "Only your own players can be edited. Abilities, potential, age and main position keep developing afterwards; the rest stays fixed. It goes into the game right away if the game is running, otherwise before the next kick-off." },
  "ed-sec-ab": { zh: "能力", en: "Abilities" },
  "ed-pot": { zh: "潜力", en: "Potential" },
  "ed-age": { zh: "年龄", en: "Age" },
  "ed-sec-pos": { zh: "位置", en: "Position" },
  "ed-pos": { zh: "主位置", en: "Main position" },
  "ed-sec-profile": { zh: "档案", en: "Profile" },
  "ed-height": { zh: "身高（cm）", en: "Height (cm)" },
  "ed-weight": { zh: "体重（kg）", en: "Weight (kg)" },
  "ed-nat": { zh: "国籍", en: "Nationality" },
  "ed-nat2": { zh: "第二国籍", en: "Second nationality" },
  "ed-left": { zh: "左", en: "Left" },
  "ed-right": { zh: "右", en: "Right" },
  "ed-revert-profile": { zh: "档案恢复原版", en: "Reset profile" },
  "ed-sec-style": { zh: "风格", en: "Style" },
  "ed-sec-contract": { zh: "合同", en: "Contract" },
  "ed-face": { zh: "真脸", en: "Real face" },
  "ed-face-locked": { zh: "他有真脸，把「真脸」的勾去掉才能捏（可以和要捏的一起保存）。", en: "He has a real face — untick “Real face” to sculpt it (you can save that together with the sculpt)." },
  "ed-save": { zh: "保存修改", en: "Save changes" },
  "ed-clear": { zh: "清空", en: "Clear" },
  "ed-clear-min": { zh: "已是最小，再按左清空", en: "At min — press left again to clear" },
  "ed-nochange": { zh: "什么都没改。", en: "Nothing changed." },
  "ed-applied": { zh: "改好了，写进游戏了（重读 {ms} ms）", en: "Saved and written into the game (reloaded in {ms} ms)" },
  "ed-later": { zh: "改好了，下次开球前写进游戏", en: "Saved; it goes into the game before the next kick-off" },
  "ed-failed": { zh: "改好了，但写进游戏失败：{e}（开球前会再写一次）", en: "Saved, but writing it into the game failed: {e} (it will be retried before kick-off)" },
};
const t = (k) => (STRINGS[k] && (STRINGS[k][lang] || px(k) || STRINGS[k].en || STRINGS[k].zh)) || k;
const tf = (k, o) => t(k).replace(/\{(\w+)\}/g, (_, m) => o[m]);
const AB_GROUP_EN = { "进攻": "grp-atk", "传球": "grp-pass", "盘带": "grp-drib", "防守": "grp-def", "身体": "grp-body", "门将": "grp-gk" };
// 服务端错误翻译（后端只说中文，前端收到熟面孔就翻; 其他语种按英文去译文包里找 err.<英文>）
const ERR_EN = { "还没有存档": "No career yet", "赛季已经结束": "Season finished", "游戏数据还在载入": "Game data still loading", "没有这场比赛": "No such fixture", "库里没有这个球员": "Player not in database", "比分要填 0-99 的整数": "Scores must be whole numbers 0–99", "这场已经结算过了": "That match has already been settled", "没有这个存档": "No such save", "存档读不了": "Can't read that save", "首发必须是 11 个人": "The XI must be 11 players", "有人上了两次": "Someone is picked twice", "有人已经不在队里了": "Someone has left the club", "0 号槽必须是门将": "Slot 0 must be a goalkeeper", "首发名单不对": "Bad lineup data" };
const terr = (m) => (lang === "zh" || !ERR_EN[m] ? m : px("err." + ERR_EN[m]) || ERR_EN[m]);

async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(terr(j.error || r.statusText));
  return j;
}

// ok: 成功的提示 (签人、续约、保存…), 前面画一个勾 (R-88)
const TOAST_OK = `<svg class="toast-ok" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3.2L17 9"/></svg>`;
function toast(msg, ms = 6000, ok = false) {
  const t = $("#toast");
  t.textContent = "";
  t.hidden = false;
  t.classList.toggle("ok", !!ok);
  const M = motion();
  if (M) M.fromTo(t, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.26, ease: "power3.out", overwrite: true, clearProps: "transform,opacity" });
  requestAnimationFrame(() => {   // 先显出来再写字: 读屏只念「显示着的 live 区域里变了的字」
    t.innerHTML = (ok ? TOAST_OK : "") + `<span>${esc(msg)}</span>`;
    const G = ok && motion();
    if (G) {
      G.from($(".toast-ok circle", t), { strokeDashoffset: 63, duration: 0.4, ease: "power3.out" });
      G.from($(".toast-ok path", t), { strokeDashoffset: 16, duration: 0.28, delay: 0.26, ease: "power3.out" });
    }
  });
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

const fxOf = (tid) => (state && state.fx && state.fx[tid]) || null;
function fxClass(tid) {
  const e = fxOf(tid);
  if (!e) return "";
  return (e.w >= 5 ? " fx-blaze" : e.w ? " fx-hot" : "") + (e.ub ? " fx-ub" : "");
}
// 积分榜那一格的小标签: 连胜 / 不败场数 (文字写出来, 不只靠颜色)
const fxTags = (tid) => {
  const e = fxOf(tid);
  if (!e) return "";
  return (e.ub && e.ub > (e.w || 0) ? `<span class="fit-tag fx-tag ub">${esc(tf("fx-ub", { n: e.ub }))}</span>` : "")
    + (e.w ? `<span class="fit-tag fx-tag hot">${esc(tf("fx-hot", { n: e.w }))}</span>` : "");
};
const emblem = (tid, cls = "") => `<img class="emb ${cls}${fxClass(tid)}" src="${img("emblem", tid)}" onerror="this.classList.add('missing')" alt="">`;
// 没有头像 (新人、游戏没下载的脸): 换成他所在球队的队徽 (R-43); 连队都不知道才留空
function noFace(el, team) {
  el.onerror = () => el.classList.add("missing");
  if (team) {
    el.classList.add("face-emb");
    // 内边距按头像自己多大算 (CSS 的百分比内边距按外层的宽度算, 放在宽的一行里队徽会被挤成一个大圆)
    el.style.padding = Math.max(2, Math.round((el.clientWidth || 32) * 0.12)) + "px";
    el.src = img("emblem", team);
  } else el.onerror();
}
const faceErr = (team) => `onerror="noFace(this, ${Number(team) || 0})"`;
const face = (pid, team) => `<img class="face clickable" tabindex="0" data-pid="${pid}"${team ? ` data-team="${team}"` : ""} src="${img("face", pid)}" loading="lazy" ${faceErr(team)} title="${t("open-player")}" role="button" aria-label="${esc(t("open-player"))}">`;
// 游戏球员卡 (R-19): 服务端合成的静态卡面 + 左上队徽 + 底部名字; data-live 让 cards.js 叠上动态层。
// c: { card: 查卡面用的 PID (球员本人或某张卡), name, roman, team: 队徽用的球队, still: 静态卡的图 }
// 没有卡面素材时退成头像卡: 队徽色光打底, 脸居中 (和球员页基础卡的头像卡一个意思); 连脸图都没有就放队徽。
// open: 点了进球员页 (data-pid); 展台两侧的卡点了是转到它, 不进球员页
function gameCard(c, { live = "hover", open = true, extra = "" } = {}) {
  const name = esc(dispPlayer(c).main);
  const attrs = open ? ` tabindex="0" role="button" data-pid="${c.pid}"${c.team ? ` data-team="${c.team}"` : ""} aria-label="${esc(tf("sc-open", { n: dispPlayer(c).main }))}"` : "";
  return `<div class="gcard${c.still ? "" : " noart"}" data-card="${c.card}" data-live="${live}"${attrs}${extra}>
    ${c.still ? `<img class="gcard-still" src="${c.still}" alt="" onerror="this.parentElement.classList.add('noart')">` : ""}
    <div class="gcard-face" aria-hidden="true">${c.team ? `<img class="gcard-glow" src="${img("emblem", c.team)}" alt="">` : ""}
      <img class="gcard-portrait" src="${img("face", c.pid)}" onerror="this.classList.add('missing')" alt="">
      ${c.team ? `<img class="gcard-mark" src="${img("emblem", c.team)}" alt="">` : ""}</div>
    ${c.team ? `<img class="gcard-emb" src="${img("emblem", c.team)}" onerror="this.classList.add('missing')" alt="">` : ""}
    <div class="gcard-name">${name}</div>
  </div>`;
}

const teamName = (tid) => {
  const info = state && state.teams && state.teams[tid];
  if (!info) return String(tid);
  return lang === "zh" ? info.zh : info.latin;
};
// 开档搜索里的球队有名无 state：主副名按语言摆
const dispTeam = (t) => (lang === "zh" ? { main: t.zh, sub: t.latin } : { main: t.latin, sub: t.zh });
// 球员简报只有 name + roman：英文模式优先罗马名
const dispPlayer = (p) => ({ main: lang === "zh" ? p.name : p.roman || p.name });
function ratingBadge(r) {
  if (r === null || r === undefined) return `<span class="rating r-na">-</span>`;
  const cls = r >= 7 ? "r-hi" : r >= 6 ? "r-mid" : "r-lo";
  return `<span class="rating ${cls}">${Number(r).toFixed(1)}</span>`;
}
const sourceTag = (s) => ({ played: t("src-played"), manual: t("src-manual"), sim: t("src-sim") }[s] || s);

async function refresh() {
  try {
    state = await api("/api/state");
  } catch (e) {
    $("#app").innerHTML = `<div class="error">${t("err-connect")}${esc(e.message)}</div>`;
    return;
  }
  if (state.boot !== boot) {
    boot = state.boot || "";
    lastEvent = state.event_id ?? 0;
  }
  if (assetsV && state.assets !== assetsV && window.Cards) Cards.reset();   // 换了资源包: 卡面分层按新的取
  assetsV = state.assets || "";
  render();
  if (state.ahead && state.ahead.running) {   // 刷新 / 重开窗口时连续模拟还在跑: 接着看进度
    busy = true;
    aheadPoll();
  }
}

function render() {
  document.title = t("app-title");
  const app = $("#app");
  if (state.loading) {
    app.innerHTML = `<div class="loading">${t("loading-dt200")}</div>`;
    setTimeout(refresh, 1000);
    return;
  }
  if (state.error) {
    app.innerHTML = `<div class="error">${t("err-load")}${esc(state.error)}</div>`;
    return;
  }
  // 用手柄 / 键盘时重画 (结算、切语言) 不能把焦点弄丢: 记下是谁, 画完找回来
  const key = UI.mode !== "pointer" && $("#modal").hidden && $("#confirm").hidden ? focusKey(document.activeElement) : null;
  if (!state.career || setupMode) renderSetup();
  else renderMain();
  const el = key && $(key, $("#app"));
  if (el) UI.focus(el, true);
  renderDock();
  if (phoneOpen()) phoneLoad();
}

// ------------------------------------------------------------ 开档
// 一屏一页 (R-20): 四种开法各一个标签 (继续存档 / 真实日历 / 一键开档 / 自选球队), L1 / R1 或点标签换, 不再往下翻
let setupHost = null;    // 开档页的标签宿主 (它画在 #app 里, 不是弹页)
let setupTab = "world";  // 上次停在哪个标签, 切语言重画时保持
let setupSaves = null;   // 当前以外的存档; 有才出「继续已有联赛」标签
function setupTabs() {
  const tabs = [];
  if (setupSaves && setupSaves.length) {
    tabs.push({ k: "saves", label: t("continue-save"), html: () => fillPanel(`<div class="list">${savesListHtml(setupSaves)}</div>`),
      after: (pane) => bindSaveButtons(pane) });
  }
  tabs.push({ k: "world", label: t("world-title"), after: () => loadWorldLeagues(), html: () => `<div class="cols world-cols" data-nav-sides>
    <section class="panel fill"><h2 class="panel-head">${t("world-title")} <span class="muted">${t("world-pick")}</span></h2>
      <p class="world-sub">${t("world-sub")}</p><div class="start-row lifemode-row">${segHtml("setup-lifemode", [["classic", t("setup-life-classic")], ["reborn", t("setup-life-reborn")]], "classic", t("setup-lifemode"))}
        ${cardsSeg()}</div>
      <div class="start-row nt-row" id="world-nt">${worldNtRow()}</div>${scroller(`<div class="md-list" id="world-leagues" data-nav-group="wl"><span class="muted">${t("loading-comps")}</span></div>`)}</section>
    <section class="panel fill"><h2 class="panel-head" id="world-team-head"></h2>${scroller(`<div class="list" id="world-teams"></div>`)}</section></div>` });
  tabs.push({ k: "comp", label: t("tab-oneclick"), after: () => { setupGlobe(); loadCompetitions(); }, html: () => `<section class="panel fill comp-bar">
      <h2 class="panel-head">${t("one-click")} <span class="muted">${t("one-click-hint")}</span></h2>
      <div class="comp-stage">
        <div class="comp-globe" aria-hidden="true"><canvas></canvas><div class="globe-pin"><span></span></div></div>
        <div class="showcase" id="showcase"><div class="sc-deck"></div><div class="sc-cap" aria-live="polite"><div class="sc-kicker">${t("sc-pick")}</div></div></div>
        <div class="comp-grid scroller" id="comp-grid"><span class="muted">${t("loading-comps")}</span></div>
      </div>
      <div class="comp-err" id="comp-err" hidden></div></section>` });
  tabs.push({ k: "custom", label: t("custom-pick"), after: bindCustomPane, html: () => `<div class="cols custom-cols" data-nav-sides>
    <section class="panel fill">
      <h2 class="panel-head">${t("custom-pick")}</h2>
      <div class="field"><label for="league-name">${t("league-name")}</label><input id="league-name" value="${esc(setup.name ?? t("league-default"))}"></div>
      <div class="field"><label for="team-q">${t("search-teams")}</label><input id="team-q" placeholder="${t("search-ph")}"></div>
      ${scroller(`<div class="list" id="team-results"></div>`)}
    </section>
    <section class="panel fill">
      <h2 class="panel-head">${t("selected")} <span id="sel-count">0</span> ${t("teams-u")} <span class="muted">${t("pick-mine")}</span></h2>
      ${scroller(`<div class="list" id="team-selected"></div>`)}
      <div class="start-row lifemode-row">${segHtml("setup-lifemode", [["classic", t("setup-life-classic")], ["reborn", t("setup-life-reborn")]], "classic", t("setup-lifemode"))}
        ${cardsSeg()}</div>
      <div class="start-row lifemode-row">${segHtml("setup-cup", [["1", t("on")], ["0", t("off")]], "1", t("setup-cup"))}
        ${segHtml("setup-div2", [["0", t("off")], ["1", t("on")]], "0", t("setup-div2"))}</div>
      <p class="muted setup-div2-note">${t("setup-div2-note")}</p>
      <div class="start-row">
        <button class="primary" id="start">${t("start-season")}</button>
        <span class="muted" id="start-hint"></span>
      </div>
    </section></div>` });
  return tabs;
}

function renderSetup() {
  if (setupHost) setupTab = setupHost.ui.tab || setupTab;
  $("#app").innerHTML = `
  <div class="hub setup-page">
    <div class="backdrop" aria-hidden="true"><div class="bd"></div><div class="bd"></div></div>
    <header class="hub-top">
      <div>${state.career ? `<button class="pill" id="back-league" data-sound="back">${t("back-league")}</button>` : ""}</div>
      <nav class="hub-util"><button class="quiet" data-act="plugin">${t("plugin")}</button>${langToggleHtml()}<span class="clock"></span></nav>
    </header>
    ${pageHead(t("setup-title"), "", t("setup-sub"))}
    <div class="tabs-slot"></div>
    <div class="page-body"></div>
  </div>`;
  const host = (setupHost = { root: $(".setup-page"), tabs: setupTabs(), ui: { tab: setupTab } });
  if (!host.tabs.some((x) => x.k === host.ui.tab)) host.ui.tab = "world";
  $(".tabs-slot", host.root).outerHTML = tabsHtml(host.tabs, host.ui.tab);
  const back = $("#back-league");
  if (back) back.addEventListener("click", () => { setupMode = false; render(); });
  bindLangToggle();
  bdTeam = null;
  tickClock();
  setBackdrop(setup.mine);
  renderTab(host, host.ui.tab);
  loadSaves();
}

// 自选球队那一页: 搜索框、联赛名、开始按钮 (标签画出来之后再接线)
function bindCustomPane(pane) {
  const q = $("#team-q", pane);
  q.value = setup.query;
  q.addEventListener("input", () => {
    setup.query = q.value;
    clearTimeout(renderSetup.t);
    renderSetup.t = setTimeout(searchTeams, 200);
  });
  $("#league-name", pane).addEventListener("input", (e) => (setup.name = e.target.value));
  $("#start", pane).addEventListener("click", startCareer);
  searchTeams();
  renderSelected();
}

// 真实日历生涯 (R-18) 开档: 左边选联赛 (手柄走到哪个就亮哪个), 右边在那个联赛里选执教的球队
let worldLeagues = null, worldPick = null, worldNations = null, worldNation = null;
// 兼任国家队 (R-71): 一行「兼任国家队: 不兼任 [选一支]」; 点了右边换成国家队列表, 选了再回到球队
function worldNtRow() {
  const n = worldNation && (worldNations || []).find((x) => x.id === worldNation);
  return `<span class="seg-cap">${t("setup-nt")}</span>${n ? `${emblem(n.id, "sm")} <b>${esc(lang === "zh" ? n.zh : n.latin)}</b>` : `<span class="muted">${t("setup-nt-none")}</span>`}
    <button class="pill quiet-pill" id="world-nt-pick">${t("setup-nt-pick")}</button>${n ? `<button class="pill ghost" id="world-nt-clear">${t("setup-nt-none")}</button>` : ""}`;
}
function bindWorldNt() {
  const row = $("#world-nt");
  if (!row) return;
  row.innerHTML = worldNtRow();
  $("#world-nt-pick").addEventListener("click", () => {
    const list = $("#world-teams");
    if (!list || !worldNations) return;
    $("#world-team-head").innerHTML = `${t("setup-nt-head")} <span class="muted">${t("setup-nt-hint")}</span>`;
    list.innerHTML = worldNations.map((n) => `<div class="pick">${emblem(n.id, "md")}<div class="grow"><div>${esc(lang === "zh" ? n.zh : n.latin)}</div>
      <div class="muted">${esc(t("conf-" + n.confed))} · ${t("strength")} ${n.strength}</div></div>
      <button class="pill" data-wnation="${n.id}">${t("setup-nt-pick")}</button></div>`).join("");
    list.closest(".scroller").scrollTop = 0;
    list.querySelectorAll("button[data-wnation]").forEach((b) => b.addEventListener("click", () => {
      worldNation = Number(b.dataset.wnation);
      bindWorldNt();
      pickWorld(worldPick, true);
      if (UI.mode !== "pointer") UI.focus($("#world-nt-pick"), true);
    }));
    UI.prepScrollers(list.closest(".page-body"));
    if (UI.mode !== "pointer") UI.focusDefault(list);
  });
  const clr = $("#world-nt-clear");
  if (clr) clr.addEventListener("click", () => { worldNation = null; bindWorldNt(); });
}
async function loadWorldLeagues() {
  const box = $("#world-leagues");
  if (!box) return;
  try {
    if (!worldLeagues) {
      const r = await api("/api/world/leagues");
      worldLeagues = r.leagues;
      worldNations = r.nations || [];
    }
  } catch (e) {
    if ($("#world-leagues") === box) box.innerHTML = `<span class="comp-err">${esc(e.message)}</span>`;
    return;
  }
  if ($("#world-leagues") !== box) return;
  if (!worldLeagues.some((l) => l.id === worldPick)) worldPick = worldLeagues[0] ? worldLeagues[0].id : null;
  box.innerHTML = worldLeagues.map((l) => `<button class="md-item${worldPick === l.id ? " on" : ""}" data-wl="${l.id}"${worldPick === l.id ? " data-nav-default" : ""}>
    <span class="md-text"><span class="md-main">${esc(lang === "zh" ? l.zh : l.en)}</span></span><span class="md-sub">${l.teams.length} ${t("teams-u")}</span></button>`).join("");
  box.querySelectorAll("button[data-wl]").forEach((b) => {
    b.addEventListener("focus", () => pickWorld(Number(b.dataset.wl)));
    b.addEventListener("click", () => {
      pickWorld(Number(b.dataset.wl));
      if (UI.mode !== "pointer") UI.focusDefault($("#world-teams"));   // ✕ 进右边的球队
    });
  });
  pickWorld(worldPick, true);
  bindWorldNt();
  // 第一次打开时联赛是现读的, 标签页画好时列表还空着, 焦点先停在了标签上: 读到了就放进列表
  const a = document.activeElement;
  if (UI.mode !== "pointer" && (!a || a === document.body || a.matches(".tab"))) UI.focusDefault(box);
}
function pickWorld(id, force = false) {
  const list = $("#world-teams");
  if (!list || (id === worldPick && !force)) return;
  worldPick = id;
  document.querySelectorAll("#world-leagues .md-item").forEach((b) => {
    const on = Number(b.dataset.wl) === id;
    b.classList.toggle("on", on);
    b.toggleAttribute("data-nav-default", on);
  });
  const lg = worldLeagues.find((l) => l.id === id);
  $("#world-team-head").innerHTML = lg ? `${esc(lang === "zh" ? lg.zh : lg.en)} <span class="muted">${t("world-pick")}</span>` : "";
  list.innerHTML = lg ? lg.teams.map((team) => `<div class="pick">${emblem(team.id, "md")}
      <div class="grow"><div>${esc(dispTeam(team).main)}</div><div class="muted">${esc(dispTeam(team).sub)} · ${t("strength")} ${team.strength}</div></div>
      <button class="primary" data-wmine="${team.id}" title="${esc(tf("world-start", { t: dispTeam(team).main }))}">${t("coach")}</button></div>`).join("") : "";
  list.closest(".scroller").scrollTop = 0;
  list.querySelectorAll("button[data-wmine]").forEach((b) => b.addEventListener("click", async () => {
    toast(t("world-creating"), 15000);
    setupMode = false;
    await act("/api/world/new", { user_team: Number(b.dataset.wmine), reborn_world: segVal("setup-lifemode") === "reborn", nation: worldNation,
      variants: segVal("setup-cards") === "1" });     // 全员变体卡 (R-96)
    $("#toast").hidden = true;
  }));
  UI.prepScrollers(list.closest(".page-body"));
}

// 开档页的「继续已有联赛」: 只列当前以外的存档 (当前的有「返回当前联赛」), 一个都没有就不出这个标签
async function loadSaves() {
  const host = setupHost;
  let careers;
  try {
    ({ careers } = await api("/api/careers"));
  } catch (e) {
    return;   // 列不出来不挡开档
  }
  const others = careers.filter((c) => !c.active);
  const had = !!(setupSaves && setupSaves.length);
  setupSaves = others;
  if (setupHost !== host || !host.root.isConnected || had === !!others.length) return;   // 切语言重画了 / 标签没变
  host.tabs = setupTabs();
  if (!host.tabs.some((x) => x.k === host.ui.tab)) return renderSetup();
  $(".tabs-bar", host.root).outerHTML = tabsHtml(host.tabs, host.ui.tab);
  syncTabKeys();
}

const fmtTime = (sec) => new Date(sec * 1000).toLocaleString(NAME_LANGS[lang].locale, { dateStyle: "short", timeStyle: "short" });

function savesListHtml(careers) {
  return careers.map((c) => {
    if (c.error) {
      return `<div class="pick"><div class="grow"><div>${esc(c.file)}</div><div class="muted">${tf("save-broken", { e: esc(c.error) })}</div></div></div>`;
    }
    const tm = c.user_team;
    const tmName = (lang === "zh" ? tm.zh : tm.latin) || tm.zh || String(tm.id);
    const progress = c.mode === "world" ? `${t("world-tag")} · ${esc(c.season_label)} · ${tf("round-x", { a: c.round || "–", b: c.rounds_total })}`
      : c.finished ? `${tf("season", { n: c.season })} · ${t("finished")}`
      : tf("save-line", { s: c.season, r: c.round, t: c.rounds_total, n: c.teams });
    return `<div class="pick ${c.active ? "sel" : ""}">${emblem(tm.id, "md")}
      <div class="grow"><div>${esc(c.name)} <span class="muted">${tf("managing", { t: esc(tmName) })}</span></div>
        <div class="muted">${progress}${c.reborn_world ? ` · ${t("rw-tag")}` : ""} · ${tf("save-updated", { d: fmtTime(c.updated) })}</div></div>
      ${c.active ? `<span class="tag">${t("save-current")}</span>` : `<button data-load="${esc(c.file)}">${t("save-switch")}</button>
        <button class="ghost danger" data-del="${esc(c.file)}" data-name="${esc(`${c.name} · ${tmName} · ${c.season_label || tf("season", { n: c.season })}`)}" aria-label="${esc(tf("del-save-aria", { n: c.name }))}">${t("del-save")}</button>`}
    </div>`;
  }).join("");
}

function bindSaveButtons(root) {
  root.querySelectorAll("button[data-load]").forEach((b) => b.addEventListener("click", async () => {
    closeModal();
    setupMode = false;
    await act("/api/career/load", { file: b.dataset.load });
  }));
  // 删别的存档 (R-73): 以前只能删当前的。红字、要确认; 删完原地刷新这张列表
  root.querySelectorAll("button[data-del]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!(await askConfirm(tf("del-save-confirm", { n: b.dataset.name }), t("del-save"), true))) return;
    try {
      state = await api("/api/career/delete", { file: b.dataset.del });
      toast(tf("del-save-done", { n: b.dataset.name }));
    } catch (err) {
      return toast(err.message);
    }
    if (!$("#modal").hidden) openSaves("replace");
    else { setupSaves = null; renderSetup(); }
  }));
}

async function openSaves(nav = "push") {
  const seq = ++openSeq;
  let r;
  try {
    r = await api("/api/careers");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const others = r.careers.some((c) => !c.active);
  // 按钮在 after 里接: 页面切换动画 (View Transitions) 里新页面是晚一帧才画上的, openModal 一返回就去找按钮会扑空
  openModal(glowHtml(state.career && state.career.user_team) + pageHead(t("saves"))
    + pageBody(fillPanel(`<div class="list">${savesListHtml(r.careers)}</div>${others ? "" : `<div class="empty">${t("no-saves")}</div>`}`
      // 新建 / 删除联赛 (R-57): 以前在主页页头和日常按钮挤在一起, 现在放在存档这里; 删除放最后、红色、还要确认
      + `<div class="hero-actions saves-actions"><button class="pill" data-act="new-league">${t("new-league")}</button>
         ${state.career ? `<button class="pill danger" data-act="del-league">${t("del-league")}</button>` : ""}</div>`)),
  false, { label: () => t("saves"), reopen: (n) => openSaves(n), after: (root) => bindSaveButtons(root) }, nav);
}

const DOC_LABEL = { "使用说明.txt": "doc-guide", "README_EN.txt": "doc-guide", "LICENSE.txt": "doc-license", "THIRD_PARTY_NOTICES.txt": "doc-notices" };

function docsHtml(docs) {   // 关于页里的「说明和许可」(R-105): 说明按界面语言只出一份, 第三方许可原文列在下面
  const guide = lang === "zh" ? "使用说明.txt" : "README_EN.txt";
  const main = docs.filter((d) => d.main && (DOC_LABEL[d.path] !== "doc-guide" || d.path === guide || !docs.some((x) => x.path === guide)));
  const rest = docs.filter((d) => !d.main);
  return `<div class="ab-docs"><b>${t("ab-docs")}</b>
    <div class="hero-actions">${main.map((d) => `<button class="pill" data-act="doc" data-path="${esc(d.path)}">${t(DOC_LABEL[d.path])}</button>`).join("")}</div>
    ${rest.length ? `<details class="ab-lic"><summary class="muted">${t("ab-licenses")} (${rest.length})</summary>
      <div class="ab-lic-list">${rest.map((d) => `<button class="quiet" data-act="doc" data-path="${esc(d.path)}">${esc(d.path)}</button>`).join("")}</div></details>` : ""}</div>`;
}

async function openDoc(path, nav = "push") {   // 一份说明 / 许可的全文
  const seq = ++openSeq;
  let r;
  try {
    r = await api("/api/doc?path=" + encodeURIComponent(path));
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const title = DOC_LABEL[path] ? t(DOC_LABEL[path]) : path;
  openModal(pageHead(title, "", DOC_LABEL[path] ? path : "") + pageBody(fillPanel(`<pre class="doc-text">${esc(r.text)}</pre>`)), false,
    { label: () => title, reopen: (n) => openDoc(path, n) }, nav);
}

function pluginStateText(s) {
  if (!s.game) return t("pg-no-game");
  if (s.installed !== "ours") return t("pg-st-none");
  if (!s.active) return t("pg-st-partial");
  return t(s.current || !s.bundled ? "pg-st-ok" : "pg-st-old");
}

async function openPlugin(nav = "push") {   // 比赛统计插件 (R-105): 状态 + 安装 / 更新 / 卸载
  const seq = ++openSeq;
  let s;
  try {
    s = await api("/api/plugin");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const label = s.installed !== "ours" ? "pg-install" : !s.active ? "pg-repair" : "pg-update";
  const body = fillPanel(`<div class="ab-page pg-page">
    <div class="ab-home"><b>${esc(pluginStateText(s))}</b>
      <div class="muted">${s.game ? `${t("pg-where")}: ${esc(s.game)}` : ""}${s.version ? ` · ${esc(s.version)}` : ""}</div></div>
    ${s.installed === "other" ? `<p class="ab-warn">${t("pg-st-other")}</p>` : ""}
    ${s.running ? `<p class="ab-warn">${t("pg-running")}</p>` : ""}
    ${!s.bundled ? `<p class="ab-warn">${t("pg-no-bundle")}</p>` : ""}
    <p>${t("pg-what")}</p>
    <p class="muted">${t("pg-risk")}</p>
    <div class="hero-actions">
      <button class="pill" data-act="pg-install" ${s.can_install ? "" : "disabled"}>${t(label)}</button>
      <button class="pill danger" data-act="pg-uninstall" ${s.can_uninstall ? "" : "disabled"}>${t("pg-uninstall")}</button>
    </div></div>`);
  openModal(glowHtml(state.career && state.career.user_team) + pageHead(t("pg-title")) + pageBody(body), false,
    { label: () => t("plugin"), reopen: (n) => openPlugin(n) }, nav);
}

async function pluginAct(kind) {
  const install = kind === "install";
  if (!(await askConfirm(t(install ? "pg-install-q" : "pg-uninstall-q"), t(install ? "pg-install" : "pg-uninstall"), !install))) return;
  try {
    await api("/api/plugin/" + kind, {});
    toast(t(install ? "pg-done-install" : "pg-done-uninstall"), 6000, true);
  } catch (e) {
    toast(e.message, 10000);
  }
  openPlugin("replace");
}

let pluginNoticeShown = false;
async function noticePlugin() {   // 启动时说一次: 带了插件但没装 / 装的是旧的
  if (pluginNoticeShown) return;
  pluginNoticeShown = true;
  try {
    const s = await api("/api/plugin");
    if (!s.game || !s.bundled || s.running) return;
    if (s.installed !== "ours") toast(t("pg-toast"), 10000);
    else if (!s.current) toast(t("pg-toast-old"), 10000);
  } catch (e) { /* 老服务没有这个接口 */ }
}

async function openAbout(nav = "push") {   // 关于 (R-102): 署名、版本、官方发布帖 (version.py), 许可和免责
  const seq = ++openSeq;
  let a, docs = [];
  try {
    [a, { docs }] = await Promise.all([api("/api/about"), api("/api/docs").catch(() => ({ docs: [] }))]);
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const home = a.home_url
    ? `<a class="ab-link" href="${esc(a.home_url)}" target="_blank" rel="noopener noreferrer">${esc(a.home_url)}</a>`
    : `<span>${esc(tf("ab-home-none", { h: a.home_name }))}</span>`;
  const body = fillPanel(`<div class="ab-page">
    <div class="ab-name">${esc(lang === "zh" ? a.name_zh : a.name)}</div>
    <div class="ab-by">${esc(tf("ab-by", { a: a.author, v: a.version }))}</div>
    <div class="ab-home"><b>${t("ab-home")}</b><div class="muted">${home}</div></div>
    <p class="ab-warn">${t("ab-only")}</p>
    <p>${t("ab-free")}</p>
    <p class="muted">${t("ab-disclaimer")}</p>
    <p class="muted">${t("ab-offline")}</p>
    <p class="muted">${t("ab-credits")}</p>
    ${docs.length ? docsHtml(docs) : `<p class="muted">${t("ab-license")}</p>`}</div>`);
  openModal(glowHtml(state.career && state.career.user_team) + pageHead(t("about"), "", a.author) + pageBody(body), false,
    { label: () => t("about"), reopen: (n) => openAbout(n) }, nav);
}

async function loadCompetitions() {
  const grid = $("#comp-grid");
  grid.innerHTML = `<span class="muted">${t("loading-comps")}</span>`;
  let competitions;
  try {
    ({ competitions } = await api("/api/competitions"));
  } catch (e) {
    if ($("#comp-grid") !== grid) return;   // 切语言重渲染了，老请求别碰新 DOM
    // 404 not found 基本就是旧服务进程没退：页面是新的，后端还是老的
    const hint = e.message === "not found" ? `（${t("stale-server")}）` : "";
    grid.innerHTML = `<span class="comp-err">${t("comps-fail")}：${esc(e.message)}${esc(hint)}</span> <button id="comp-retry">${t("retry")}</button>`;
    $("#comp-retry").addEventListener("click", loadCompetitions);
    return;
  }
  if ($("#comp-grid") !== grid) return;
  grid.innerHTML = competitions.map((c) => {
    const name = lang === "zh" ? c.zh : c.en;
    const ok = c.playable >= 2;
    const geo = c.geo ? ` data-lat="${c.geo.lat}" data-lon="${c.geo.lon}" data-country="${esc(c.geo.country)}"` : "";
    return `<button class="comp" data-cid="${c.id}" data-name="${esc(name)}"${geo} ${ok ? "" : "disabled"}><span>${esc(name)}</span><span class="n">${c.total} ${t("teams-u")}</span></button>`;
  }).join("");
  grid.querySelectorAll("button.comp").forEach((b) => {
    b.addEventListener("click", () => { previewLeague(b); oneClickLeague(b); });
    b.addEventListener("focus", () => previewLeague(b));
    b.addEventListener("pointerenter", () => previewLeague(b));
  });
  // 一进来就亮一个联赛 (上次看的那个, 没有就第一个), 展台不空着
  const first = grid.querySelector(`button.comp[data-cid="${previewCid}"]:not([disabled])`) || grid.querySelector("button.comp:not([disabled])");
  if (first) setTimeout(() => { if (first.isConnected && !grid.querySelector(".comp.on")) previewLeague(first); }, 500);
}

// ------------------------------------------------------------ 联赛展台 (R-19)
// 指到哪个联赛: 地球仪飞过去锁定那个国家, 展台从地球仪那边发来这个联赛的 Big Time 卡 (一人一张, 按总评排;
// 不够 5 张用联赛里的头牌补)。看得见的几张都在动 (cards.js), 每 5 秒转下一张; 点两侧的转过去, 点正中的进球员页。
// 转: 鼠标点、键盘 ← → (焦点在正中那张上时)、手柄 L1 / R1。
let previewCid = null;
const showcaseCache = new Map();   // 联赛 ID -> Promise<[卡]>
let deck = null;                   // { cid, name, cards, at, el, box, timer, hover }
function previewLeague(btn) {
  pickerFly(btn);
  document.querySelectorAll("#comp-grid .comp.on").forEach((b) => b.classList.remove("on"));
  btn.classList.add("on");
  previewCid = Number(btn.dataset.cid);
  clearTimeout(previewLeague.t);   // 连着往下走时不每一格都发一手牌
  previewLeague.t = setTimeout(() => showcase(previewCid, btn.dataset.name), 160);
}

async function showcase(cid, name) {
  const box = $("#showcase");
  if (!box || (deck && deck.cid === cid && deck.box === box)) return;
  if (!showcaseCache.has(cid)) {
    showcaseCache.set(cid, api(`/api/showcase/${cid}`).then((r) => r.cards).catch(() => { showcaseCache.delete(cid); return []; }));
  }
  const token = (showcase.token = {});
  const cards = await showcaseCache.get(cid);
  if (showcase.token !== token || $("#showcase") !== box) return;   // 等的时候又指了别的 / 页面重画了
  dealDeck(box, cid, name, cards);
}

// 两侧的位置 (离正中几张): 横移 (卡宽的倍数)、下沉 px、缩放、旋转、亮度、透明度
const DECK_SLOTS = [[0, 0, 1, 0, 1, 1], [0.58, 14, 0.8, 6, 0.5, 1], [0.92, 34, 0.64, 11, 0.3, 1], [1.1, 50, 0.52, 15, 0.2, 0]];
function dealDeck(box, cid, name, cards) {
  if (deck) clearInterval(deck.timer);
  const old = box.querySelector(".sc-deck");
  if (old) {
    old.classList.add("out");
    setTimeout(() => old.remove(), 320);
  }
  const el = document.createElement("div");
  el.className = "sc-deck deal";
  el.innerHTML = cards.map((c, i) => gameCard({ pid: c.pid, card: c.vid || c.pid, name: c.name, roman: c.roman,
    team: c.club.id || null, still: c.vid ? img("card", c.vid) : null }, { live: "off", open: false, extra: ` data-i="${i}"` })).join("");
  box.prepend(el);
  const me = (deck = { cid, name, cards, at: 0, el, box, timer: 0, hover: false });
  layoutDeck();
  captionDeck();
  // 先摆在地球仪那边 (.deal), 下一帧撤掉, 按顺序一张张飞到自己的位置
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.replace("deal", "dealing");
    setTimeout(() => el.classList.remove("dealing"), 900);
  }));
  el.addEventListener("click", (e) => {
    const card = e.target.closest(".gcard");
    if (!card || deck !== me) return;
    const i = Number(card.dataset.i);
    if (i === me.at) openPlayer(cards[i].pid, cards[i].club.id || null);
    else turnDeck(i - me.at, true);
  });
  el.addEventListener("keydown", (e) => {   // 焦点在正中那张上: ← → 转 (不让 pad.js 拿去移焦点)
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    turnDeck(e.key === "ArrowLeft" ? -1 : 1);
  });
  box.onpointerenter = () => (me.hover = true);
  box.onpointerleave = () => (me.hover = false);
  me.timer = setInterval(() => {
    if (deck !== me || !el.isConnected) return clearInterval(me.timer);
    if (UI.reduced || me.hover || !document.hasFocus() || el.contains(document.activeElement)) return;
    turnDeck(1, false, true);
  }, 5200);
}

function layoutDeck() {
  const n = deck.cards.length;
  deck.el.querySelectorAll(".gcard").forEach((card, i) => {
    let k = i - deck.at;
    if (n >= 3) {                        // 三张以上转圈: 两侧对称
      k = ((k % n) + n) % n;
      if (k > n / 2) k -= n;
    }
    const a = Math.min(Math.abs(k), 3), sg = Math.sign(k);
    const [x, y, s, r, b, o] = DECK_SLOTS[a];
    for (const [p, v] of [["--x", sg * x], ["--y", y + "px"], ["--s", s], ["--r", sg * r + "deg"], ["--b", b], ["--o", o], ["--d", a], ["z-index", 10 - a]]) {
      card.style.setProperty(p, v);
    }
    card.dataset.live = a <= 2 ? "always" : "off";   // 看得见的都动, 转到看不见的位置就停
    if (k === 0) {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", tf("sc-open", { n: dispPlayer(deck.cards[i]).main }));
    } else {
      card.tabIndex = -1;
      card.removeAttribute("role");
      card.removeAttribute("aria-label");
    }
    card.setAttribute("aria-hidden", k === 0 ? "false" : "true");
  });
}

function captionDeck() {
  const cap = deck.box.querySelector(".sc-cap");
  const c = deck.cards[deck.at];
  if (!c) {
    cap.innerHTML = `<div class="sc-kicker">${esc(deck.name)}</div><div class="sc-empty">${t("sc-empty")}</div>`;
    return;
  }
  const club = c.club.id ? `${emblem(c.club.id, "sm")}<span>${esc(lang === "zh" ? c.club.zh : c.club.latin)}</span>` : "";
  cap.innerHTML = `<div class="sc-kicker">${c.bigtime ? t("sc-bigtime") : t("sc-star")}<span class="sc-count">${deck.at + 1} / ${deck.cards.length}</span></div>
    <div class="sc-name">${esc(dispPlayer(c).main)}</div>
    <div class="sc-meta">${club}${c.pack ? `<span class="sc-pack">${esc(c.pack)}</span>` : ""}</div>`;
  const M = motion();
  if (M) M.from(cap.children, { opacity: 0, duration: 0.3, ease: "power3.out", clearProps: "opacity" });
}

function turnDeck(d, pointer = false, auto = false) {
  if (!deck || !deck.el.isConnected || deck.cards.length < 2) return UI.sound("edge");
  const n = deck.cards.length;
  const had = deck.el.contains(document.activeElement);
  deck.at = n >= 3 ? (((deck.at + d) % n) + n) % n : Math.max(0, Math.min(n - 1, deck.at + d));
  layoutDeck();
  captionDeck();
  if (!auto) UI.sound("move");
  if (had && !pointer) UI.focus(deck.el.querySelector(`.gcard[data-i="${deck.at}"]`), true);
}

// 一键开档的地球仪 (R-17): 平时慢慢转; 指到 / 焦点到哪个联赛, 镜头就飞过去锁定那个国家, 从上一个联赛拉一条航线过来
let picker = null;   // { globe, at: 当前锁定的 geo, pin }
function setupGlobe() {
  const cv = $(".comp-globe canvas");
  if (!cv || !window.Globe) return;
  const pin = $(".comp-globe .globe-pin");
  const me = { at: null, pin };
  me.globe = Globe.create(cv, { colors: globeColors(), reduced: UI.reduced, bare: true, onFrame: (g) => {
    if (!me.at) return;
    const q = g.project(me.at.lat, me.at.lon, 0.1);
    pin.style.transform = `translate(${q.x}px, ${q.y}px) translate(-50%, -100%)`;
    pin.classList.toggle("off", !q.visible);
  } });
  me.globe.set({ lat: 30, lon: 10, dist: 4.3, cy: 0.5 });   // 整个球都在框里
  me.globe.drift(5);
  picker = me;
}
function pickerFly(btn) {
  const me = picker;
  if (!me || btn.dataset.lat === undefined) return;
  const geo = { lat: Number(btn.dataset.lat), lon: Number(btn.dataset.lon), country: btn.dataset.country };
  if (me.at && me.at.country === geo.country) {   // 同一国的另一级联赛: 只换名字
    $("span", me.pin).textContent = btn.dataset.name;
    return;
  }
  const g = me.globe, from = me.at;
  me.at = geo;
  me.pin.classList.remove("on");   // 飞的路上不挂牌子, 到了再亮
  g.drift(0);
  g.clearLocks();
  g.clearArcs();
  if (from) g.arc(from, geo, 900);
  const far = from ? Globe.angle(from, geo) : 60;
  g.flyTo({ lat: geo.lat, lon: geo.lon, dist: 3.95 }, 900 + Math.min(far, 140) * 5, { hump: far > 45 ? 0.5 : 0.1 }).then(() => {
    if (me.at !== geo || picker !== me) return;   // 半路又指了别的
    g.lock(geo.lat, geo.lon, { radius: 7, ring: 3 });
    $("span", me.pin).textContent = btn.dataset.name;
    me.pin.classList.add("on");
  });
}

async function oneClickLeague(btn) {
  const cid = Number(btn.dataset.cid);
  const name = btn.dataset.name;
  btn.disabled = true;
  try {
    const { teams } = await api(`/api/competitions/${cid}/teams`);
    if ($("#comp-grid") === null) return;
    setup.selected.clear();
    for (const team of teams) setup.selected.set(team.id, team);
    setup.mine = null;
    setup.name = name;
    setup.cid = cid;                 // 次级联赛 (R-94): 英超 / 西甲 / 意甲 / 法甲用游戏里的次级联赛
    // 球队填好了, 翻到「自选球队」那一页选执教的队、开赛季 (以前是往下翻到页底)
    if (setupHost) renderTab(setupHost, "custom", 1);
  } catch (e) {
    const err = $("#comp-err");
    if (err) { err.textContent = `${t("comps-fail")}：${e.message}`; err.hidden = false; }
  } finally {
    if (btn.isConnected) btn.disabled = false;
  }
}

async function searchTeams() {
  const seq = (searchTeams.seq = (searchTeams.seq || 0) + 1);
  const { teams } = await api("/api/teams?q=" + encodeURIComponent(setup.query));
  if (seq !== searchTeams.seq || !$("#team-results")) return;   // 打字快时旧请求晚回来, 丢掉, 别盖住新结果; 换了标签也不画
  $("#team-results").innerHTML = teams.map((team) => `
    <div class="pick ${setup.selected.has(team.id) ? "sel" : ""}" data-id="${team.id}">
      ${emblem(team.id, "md")}
      <div class="grow"><div>${esc(dispTeam(team).main)}</div><div class="muted">${esc(dispTeam(team).sub)} · ${team.size} ${t("people")} · ${t("strength")} ${team.strength}</div></div>
      <button data-add="${team.id}">${setup.selected.has(team.id) ? t("remove") : t("add")}</button>
    </div>`).join("") || `<div class="empty">${t("not-found")}</div>`;
  $("#team-results").querySelectorAll("button[data-add]").forEach((b) =>
    b.addEventListener("click", () => {
      const team = teams.find((x) => x.id === Number(b.dataset.add));
      if (setup.selected.has(team.id)) setup.selected.delete(team.id);
      else setup.selected.set(team.id, team);
      if (!setup.selected.has(setup.mine)) setup.mine = null;
      searchTeams();
      renderSelected();
    }));
}

function renderSelected() {
  setBackdrop(setup.mine);   // 选了执教的球队, 背景就亮起它的队徽
  if (!$("#team-selected")) return;
  const had = $("#team-selected").contains(document.activeElement) ? focusKey(document.activeElement) : null;
  const list = [...setup.selected.values()].sort((a, b) => b.strength - a.strength);
  $("#sel-count").textContent = list.length;
  $("#team-selected").innerHTML = list.map((team, i) => `
    <div class="pick ${setup.mine === team.id ? "sel" : ""}">
      <button class="mine-toggle" data-mine="${team.id}" aria-pressed="${setup.mine === team.id}" title="${t("set-mine")}"${(setup.mine ? setup.mine === team.id : i === 0) ? " data-nav-default" : ""}>${setup.mine === team.id ? t("my-team") : t("coach")}</button>
      ${emblem(team.id, "md")}
      <div class="grow"><div>${esc(dispTeam(team).main)}</div><div class="muted">${t("strength")} ${team.strength}</div></div>
      <button class="quiet" data-del="${team.id}">${t("remove")}</button>
    </div>`).join("") || `<div class="empty">${t("from-left")}</div>`;
  $("#team-selected").querySelectorAll("button[data-mine]").forEach((b) =>
    b.addEventListener("click", () => { setup.mine = Number(b.dataset.mine); renderSelected(); }));
  $("#team-selected").querySelectorAll("button[data-del]").forEach((b) =>
    b.addEventListener("click", () => { setup.selected.delete(Number(b.dataset.del)); searchTeams(); renderSelected(); }));
  const n = list.length;
  const rounds = n < 2 ? 0 : (n % 2 ? n : n - 1) * 2;
  $("#start-hint").textContent = n < 2 ? t("need-2") : !setup.mine ? t("no-mine") : tf("rr-rounds", { n: rounds });
  $("#start").disabled = n < 2 || !setup.mine;
  UI.prepScrollers($("#team-selected").closest(".page-body"));
  // 手柄点了「执教」: 那一行重画了, 焦点放回同一个按钮 (不然掉到页面外, 下一下不知道去哪)
  const back = had && UI.mode !== "pointer" && ($(had, $("#team-selected")) || $("#start:not(:disabled)"));
  if (back) UI.focus(back, true);
}

// 开档的「球员卡」开关 (R-96): 照游戏 / 全员变体卡。说明放在按钮的 title 里 (开档页一屏装下, 不另占一行)
function cardsSeg() {
  return segHtml("setup-cards", [["0", t("setup-cards-base")], ["1", t("setup-cards-var")]], "0", t("setup-cards"),
    `title="${esc(t("setup-cards-note"))}"`);
}

async function startCareer() {
  try {
    state = await api("/api/career/new", {
      league_name: $("#league-name").value,
      teams: [...setup.selected.keys()],
      user_team: setup.mine,
      reborn_world: segVal("setup-lifemode") === "reborn",
      variants: segVal("setup-cards") === "1",          // 全员变体卡 (R-96)
      cup: segVal("setup-cup") !== "0",                 // 国内杯赛 (R-94)
      lower: segVal("setup-div2") === "1",              // 次级联赛 (R-94)
      league_cid: setup.cid ?? null,
    });
    setupMode = false;
    setup.name = null;
    render();
  } catch (e) {
    toast(t("start-failed") + e.message);
  }
}

// ------------------------------------------------------------ 主页: PS5 式中枢
// 上面一排图块 (栏目), 下面是选中栏目的详情, 背景是选中栏目的队徽光晕。
// 手柄 / 键盘: 左右换栏目 (L1 / R1 也行), 往下是详情里的按钮和列表, ✕ 打开完整页面, ○ 回来。
let hubKey = "next";      // 选中的栏目, 重画时保持
let hubEntered = false;   // 图块入场动画只在打开窗口时放一次

const formLetter = (x) => (x === "W" ? t("form-w") : x === "D" ? t("form-d") : t("form-l"));
const formHtml = (form) => `<span class="form">${form.map((x) => `<span class="${x}">${formLetter(x)}</span>`).join("")}</span>`;
const oppOf = (f) => (f.home === state.career.user_team ? f.away : f.home);
const myRow = () => state.table.find((r) => r.team === state.career.user_team);
const myLastFixture = () => {
  const lr = state.last_round;
  const mine = state.career.user_team;
  return (lr && lr.fixtures.find((f) => f.home === mine || f.away === mine)) || null;
};
// 页面背景: 和主页一样的队徽光晕。bg = 一支队, 或 [主队, 客队] (战报: 左右各一团)
const glowHtml = (bg) => {
  const ids = (Array.isArray(bg) ? bg : [bg]).filter((x) => x != null);
  if (!ids.length) return "";
  return `<div class="backdrop page-bd${ids.length > 1 ? " duo" : ""}" data-bg="${ids.join(",")}" aria-hidden="true">${ids.map((tid, i) =>
    `<div class="bd on side-${i}"><img class="glow" src="${img("emblem", tid)}" alt=""><img class="mark" src="${img("emblem", tid)}" alt=""></div>`).join("")}</div>`;
};
// 换标签时换背景 (数据榜换到助攻榜 -> 助攻王的队): 新的一层淡入盖上去, 旧的等它盖满再拿掉
function swapGlow(root, bg) {
  const old = root && root.querySelector(".page-bd:not(.leaving)");
  const html = glowHtml(bg);
  if (!old || !html) return;
  const ids = (Array.isArray(bg) ? bg : [bg]).filter((x) => x != null).join(",");
  if (old.dataset.bg === ids) return;
  old.classList.add("leaving");
  old.insertAdjacentHTML("afterend", html);
  const M = motion();
  if (M) M.from(old.nextElementSibling.querySelectorAll(".bd"), { opacity: 0, duration: 0.7, ease: "power3.out", clearProps: "opacity" });
  setTimeout(() => old.remove(), 750);
}
// 页头: 宋体大标题压在最上面, 下面一行粉色的出处 (哪个队 / 哪一季), 再下面是说明。
// R-69 起出处放到标题下面 (以前在标题上方当小眉标, 标题被压下去一行)
const pageHead = (title, kicker = "", meta = "") => `<header class="page-head">
  <h1 class="page-title">${title}</h1>${kicker ? `<div class="page-ctx">${kicker}</div>` : ""}${meta ? `<div class="hero-meta">${meta}</div>` : ""}</header>`;

// ------------------------------------------------------------ 一屏一页 (R-20)
// 页面自己不滚, 像主机游戏的菜单一样一屏装下: 页头固定, 下面的 .page-body 占满剩下的高度,
// 长列表装进 .scroller 只在自己的面板里滚 (焦点走到哪滚到哪, LT / RT 翻一屏, Home / End 到头到尾)。
// 内容多的页面分成几个标签 (tabs), L1 / R1 (LB / RB, 键盘 Q / E) 或点标签换。
const pageBody = (inner, cls = "") => `<div class="page-body${cls ? " " + cls : ""}">${inner}</div>`;
const scroller = (inner, cls = "") => `<div class="scroller${cls ? " " + cls : ""}">${inner}</div>`;
// 一块占满剩余高度的面板: 标题固定在上面, 内容在下面滚
const fillPanel = (inner, head = "", cls = "") => `<section class="panel fill${cls ? " " + cls : ""}">${head}${scroller(inner)}</section>`;
// 把一行滚到它所在列表的正中 (只动那个列表; scrollIntoView 会连 overflow:hidden 的外层一起滚, 页面会错位)
function centerIn(el) {
  const sc = el && el.closest(".scroller");
  if (!sc) return;
  const a = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
  sc.scrollTop += a.top - b.top - (b.height - a.height) / 2;
}
// 积分榜这类: 一打开就把我的那一行摆到中间 (退回来时按原来的滚动位置, 不再挪)
const centerMine = (root, restored) => { if (!restored) centerIn(root.querySelector("tr.mine, .row.mine")); };
// 页面里每个列表滚到哪了: 进下一层前记下, 退回来照原样摆
const scrollState = (root) => [...root.querySelectorAll(".scroller")].map((s) => s.scrollTop);
function restoreScrolls(root, list) {
  root.querySelectorAll(".scroller").forEach((s, i) => { if (list && list[i] != null) s.scrollTop = list[i]; });
}

// 标签。host = { root: 页面根元素, tabs: [{ k, label, html() -> 字符串或 Promise, after(pane, restored) }], ui: { tab } }
// 弹页的 host 就是 currentView; 开档页 (画在 #app 里) 是 setupHost。只有一页时不画标签条
function tabsHtml(tabs, on) {
  if (tabs.length < 2) return "";
  return `<div class="tabs-bar"><kbd class="tab-key" data-side="l" aria-hidden="true" hidden></kbd>
    <nav class="tabs" role="tablist" data-nav-group="tabs">${tabs.map((x) => `<button class="tab${x.k === on ? " on" : ""}" role="tab" aria-selected="${x.k === on}" data-tab="${esc(x.k)}" data-nav-skip>${x.label}</button>`).join("")}</nav>
    <kbd class="tab-key" data-side="r" aria-hidden="true" hidden></kbd></div>`;
}
// 标签条两头的按键提示: 手柄 L1 / R1 (Xbox LB / RB), 键盘 Q / E; 用鼠标时不显示
function syncTabKeys() {
  const g = UI.mode === "pad" && UI.padKind ? (UI.padKind === "ps" ? ["L1", "R1"] : ["LB", "RB"]) : UI.mode === "key" ? ["Q", "E"] : null;
  document.querySelectorAll(".tab-key").forEach((k) => {
    k.textContent = g ? g[k.dataset.side === "l" ? 0 : 1] : "";
    k.hidden = !g;   // R-81: 战术页里 LB / RB 也是换标签 (以前首发标签里是跳栏, 标签条一换到更衣室就变样)
  });
}
function tabHost() {
  if (confirmDone || kick || cer) return null;
  if (!$("#modal").hidden) return currentView && currentView.tabs && currentView.tabs.length > 1 ? currentView : null;
  return setupHost && setupHost.root.isConnected && setupHost.tabs.length > 1 ? setupHost : null;
}
// 自己滚的条 (滚动条藏着), 哪头还有东西那头就淡出: 标签条、主页图块横着 (more-l / more-r), 主页左栏竖着 (more-t / more-b), R-70。
// 每个元素只挂一次滚动监听; 窗口大小变了统一重算
function edgeFade(el, axis = "x") {
  if (!el) return;
  if (!el.edgeFade) {
    el.edgeFade = axis === "x"
      ? () => { el.classList.toggle("more-l", el.scrollLeft > 2); el.classList.toggle("more-r", el.scrollLeft + el.clientWidth < el.scrollWidth - 2); }
      : () => { el.classList.toggle("more-t", el.scrollTop > 2); el.classList.toggle("more-b", el.scrollTop + el.clientHeight < el.scrollHeight - 12); };   // 竖着留 12px: 最后一段的下边距不算「还有字」
    el.dataset.fade = axis;
    el.addEventListener("scroll", el.edgeFade, { passive: true });
  }
  el.edgeFade();
}
addEventListener("resize", () => document.querySelectorAll("[data-fade]").forEach((el) => el.edgeFade && el.edgeFade()));
// 画某个标签: 标签条跟着亮、内容从换的方向滑进来 (dir: 1 从右, -1 从左, 0 不动)。
// restore = 退回来 / 原地重画时的 { scrolls, focus }: 滚动和焦点照原样
async function renderTab(host, k, dir = 0, restore = null) {
  const tab = host.tabs.find((x) => x.k === k) || host.tabs[0];
  host.ui.tab = tab.k;
  const body = host.root.querySelector(".page-body");
  const bar = host.root.querySelector(".tabs");
  if (!body) return;
  if (bar) {
    bar.querySelectorAll(".tab").forEach((b) => {
      const on = b.dataset.tab === tab.k;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on);
    });
    const btn = bar.querySelector(".tab.on");
    if (btn) {   // 标签多 (15 个联赛) 时标签条自己横着滚, 当前的那个一直看得见
      const a = btn.getBoundingClientRect(), b = bar.getBoundingClientRect();
      if (a.left < b.left + 56) bar.scrollBy({ left: a.left - b.left - 56, behavior: UI.reduced ? "auto" : "smooth" });
      else if (a.right > b.right - 56) bar.scrollBy({ left: a.right - b.right + 56, behavior: UI.reduced ? "auto" : "smooth" });
    }
    edgeFade(bar);   // 哪边还藏着标签, 那边就淡出
  }
  const onBar = !!bar && bar.contains(document.activeElement);
  const token = (host.token = {});
  const pane = document.createElement("div");
  pane.className = "pane";
  pane.setAttribute("role", "tabpanel");
  body.replaceChildren(pane);
  const M = dir && motion();
  if (M) M.from(pane, { x: dir > 0 ? 36 : -36, opacity: 0, duration: 0.3, ease: "power3.out", clearProps: "transform,opacity" });
  let html = tab.html();
  if (html && typeof html.then === "function") {
    pane.innerHTML = `<div class="loading">${t("loading")}</div>`;
    try {
      html = await html;
    } catch (e) {
      html = `<section class="panel"><div class="error">${esc(e.message)}</div></section>`;
    }
    if (host.token !== token || !pane.isConnected) return;   // 等的时候又换了标签 / 页面换了
  }
  pane.innerHTML = html;
  enterFx(pane);
  if (tab.after) tab.after(pane, !!restore);
  UI.prepScrollers(pane);
  if (restore && restore.scrolls) restoreScrolls(pane, restore.scrolls);
  renderHints();
  if (UI.mode === "pointer" || onBar) return;
  const el = restore && restore.focus && $(restore.focus, host.root);
  if (el && !el.matches("[data-nav-skip]")) return UI.focus(el, true);
  UI.focusDefault(pane);
  // 这一页没有能点的 (球员概览、档案): 焦点停在当前标签上, 左右直接翻页, 不会掉到页面外面
  const tabBtn = bar && bar.querySelector(".tab.on");
  if (tabBtn && !pane.contains(document.activeElement)) UI.focus(tabBtn, true);
}
// L1 / R1: 往左 / 右一个标签, 到头轻轻顶一下 (不绕回, 和主页图块一样)
function stepTab(host, d) {
  const i = host.tabs.findIndex((x) => x.k === host.ui.tab);
  const next = host.tabs[i + d];
  if (!next) return UI.sound("edge");
  UI.sound("move");
  const bar = host.root.querySelector(".tabs");
  const onBar = !!bar && bar.contains(document.activeElement);
  renderTab(host, next.k, d);
  if (onBar && UI.mode !== "pointer") UI.focus($(`.tab[data-tab="${CSS.escape(next.k)}"]`, bar), true);
}
// 焦点 (或鼠标点) 到了哪个标签就换到哪个: 手柄停在标签条上左右走就是翻页
function selectTabEl(el) {
  const host = tabHost();
  if (!host || !host.root.contains(el) || el.dataset.tab === host.ui.tab) return;
  const i = host.tabs.findIndex((x) => x.k === host.ui.tab), j = host.tabs.findIndex((x) => x.k === el.dataset.tab);
  if (j >= 0) renderTab(host, el.dataset.tab, Math.sign(j - i));
}

// 左右两栏 (像主机的设置页): 左边一列条目, 右边是选中那条的内容。
// 手柄在左边上下走右边跟着换; ✕ / → 进右边, ← 回到左边选中的那条。鼠标点左边的条目换。
// items: [{ label, sub, badge }] (都是 HTML); 选中的是第几个记在 ui[key] 里, 退回这页时还是它
function mdHtml(items, sel, head = "") {
  return `<div class="split" data-nav-sides>
    <section class="panel fill md-side">${head}${scroller(`<div class="md-list" data-nav-group="md">${items.map((x, i) => `<button class="md-item${i === sel ? " on" : ""}" data-md="${i}"${i === sel ? " data-nav-default" : ""}>
      <span class="md-text"><span class="md-main">${x.label}</span>${x.sub ? `<span class="md-sub">${x.sub}</span>` : ""}</span>${x.badge || ""}</button>`).join("")}</div>`)}</section>
    <section class="panel fill md-detail"></section></div>`;
}
function bindMd(pane, ui, key, count, detail, restored, def = 0) {
  const list = pane.querySelector(".md-list"), box = pane.querySelector(".md-detail");
  if (!list || !box || !count) return;
  const pick = (i) => {
    if (box.dataset.i === String(i)) return;
    ui[key] = i;
    list.querySelectorAll(".md-item").forEach((b) => {
      const on = b.dataset.md === String(i);
      b.classList.toggle("on", on);
      b.toggleAttribute("data-nav-default", on);
    });
    box.dataset.i = i;
    box.innerHTML = detail(i);
    const M = motion();
    if (M) M.from(box.children, { opacity: 0, duration: 0.22, ease: "power3.out", clearProps: "opacity" });
    UI.prepScrollers(box);
  };
  pick(Math.min(ui[key] ?? def, count - 1));
  list.addEventListener("focusin", (e) => { const b = e.target.closest(".md-item"); if (b) pick(Number(b.dataset.md)); });
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".md-item");
    if (!b) return;
    pick(Number(b.dataset.md));
    if (UI.mode !== "pointer") UI.focusDefault(box);
  });
  if (!restored) centerIn(list.querySelector(".md-item.on"));
}
// 我那一场的比分 + 胜平负 (左栏条目右边的小标)
function myResultBadge(fixtures) {
  const mine = state.career.user_team;
  const f = fixtures.find((x) => x.home === mine || x.away === mine);
  if (!f || !f.result) return "";
  const home = f.home === mine;
  const my = home ? f.result.home_goals : f.result.away_goals, op = home ? f.result.away_goals : f.result.home_goals;
  return `<span class="md-res"><span class="n">${my}–${op}</span>${formHtml([my > op ? "W" : my < op ? "L" : "D"])}</span>`;
}
const leagueKicker = () => (isWorld() ? `${esc(leagueName(state.career.league))} · ${esc(state.career.season_label)}`
  : `${esc(state.career.league_name)} · ${tf("season", { n: state.career.season })}`);

// ------------------------------------------------------------ 真实日历生涯 (R-18) 的名字和日期
const isWorld = () => !!(state && state.career && state.career.mode === "world");
const leagueName = (cid) => {
  const l = state && state.world && state.world.leagues[String(cid)];
  return l ? (lang === "zh" ? l.zh : l.en) : String(cid);
};
const EURO = ["UCL", "UEL"];                       // 欧冠、欧联 (R-50) 共用一个页面
const euroKey = (cid) => (cid === "UEL" ? "uel" : "ucl");
// 国家队赛事 (R-71): N-NL2026 / N-EQ2028 / N-WQ2030 / N-WQ2030-AFC / N-ICP2030 / N-EURO2028 / N-WC2030
const INTL_RE = /^N-(NL|EQ|WQ|ICP|EURO|WC)(\d{4})(?:-([A-Z]+))?$/;
function intlName(cid, short = false) {
  const m = INTL_RE.exec(cid || "");
  if (!m) return cid;
  const [, k, y, conf] = m;
  const p = short ? "ics-" : "ic-";
  if (k === "NL") return short ? t("ics-NL") : tf("ic-NL", { y: `${y}/${String((+y + 1) % 100).padStart(2, "0")}` });
  if (k === "EQ") return short ? t("ics-EQ") : tf("ic-EQ", { y });
  if (k === "WQ") return tf(p + "WQ", { y, c: t("conf-" + (conf || "UEFA")) });
  if (k === "ICP") return short ? t("ics-ICP") : tf("ic-ICP", { y });
  return tf("ev-tournament", { y, c: t("comp-" + k) });
}
function compName(comp) {
  if (!comp) return "";
  if (comp.startsWith("N-")) return intlName(comp);
  if (comp[0] === "L") return leagueName(comp.slice(1));
  if (comp === "PO343") return t("comp-PO343");
  if (comp === "CC") return tf("comp-CC", { l: state.career.league_name });     // 自选联赛 (R-94)
  if (comp === "CPO") return t("comp-CPO");
  if (comp.startsWith("PO")) return tf("comp-PO", { l: leagueName(comp.slice(2)) });
  return t("comp-" + comp);
}
function stageName(f) {
  const st = f.stage || "";
  if (f.comp && f.comp.startsWith("N-")) {
    const nm = t("nst-" + st);
    return f.round && !f.tie ? `${nm} · ${tf("round-tag", { n: f.round })}` : nm;
  }
  if (f.comp && f.comp[0] === "L") return tf("round-tag", { n: f.round });
  if (st.startsWith("MD")) return tf("st-MD", { n: st.slice(2) });
  if (/^G\d$/.test(st)) return tf("st-G", { n: st.slice(1) });
  return t("st-" + st);
}
const fxLabel = (f) => (f.comp ? `${compName(f.comp)} · ${stageName(f)}${f.leg ? ` · ${t("leg-" + f.leg)}` : ""}` : tf("round-tag", { n: f.round }));
function fmtDate(iso, withDay = true) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(NAME_LANGS[lang].locale, withDay ? { month: "short", day: "numeric", weekday: "short" } : { month: "short", day: "numeric" });
}
// 淘汰赛那一行下面的小字: 首回合比分 / 总比分 / 加时 / 点球 / 中立场地 / 改期
function tieNote(f) {
  const bits = [];
  if (f.first_leg && !f.result) bits.push(tf("first-leg", { a: f.first_leg[1], b: f.first_leg[0] }));
  if (f.et) bits.push(tf("et", { a: f.et[0], b: f.et[1] }));
  if (f.pens) bits.push(tf("pens", { a: f.pens[0], b: f.pens[1] }));
  if (f.leg === 2 && f.agg && f.result) bits.push(tf("agg", { a: f.agg[0], b: f.agg[1] }));
  if (f.tie_winner && f.result && (f.leg === 2 || !f.leg)) bits.push(tf("through", { t: esc(teamName(f.tie_winner)) }));
  if (f.neutral) bits.push(t("neutral"));
  if (f.postponed) bits.push(t("postponed"));
  return bits.join(" · ");
}
const tileEmb = (tid) => `<img class="t-emb" src="${img("emblem", tid)}" onerror="this.classList.add('missing')" alt="">`;
const tileFace = (p) => `<img class="t-face" src="${img("face", p.pid)}" ${faceErr(p.team)} alt="">`;

// ---- 数变了就滚过去 (R-28): 图块上的数 (名次、信任度、账上的钱、未读新闻、欧冠名次) 记住上次给人看到的值,
// 主页露出来时从旧值滚到新值, 角上冒一个「+2」「▲3」说明变了多少。结算时主页是在战报后面重画的, 那时不播 (holdCounts),
// 等战报 / 典礼关了、主页露出来再播。
const lastCounts = new Map();
let holdCounts = false;
const COUNT_FMT = { i: (v) => String(Math.round(v)), money: (v) => money(v) };
// low: 越小越好 (名次): 变小是「升」
const countNum = (key, v, fmt = "i", cls = "t-num", low = false) =>
  `<span class="${cls}" data-count="${key}" data-v="${v}" data-fmt="${fmt}"${low ? " data-low" : ""}>${COUNT_FMT[fmt](v)}</span>`;
function playCounts() {
  if (holdCounts || !$("#modal").hidden || cer || kick) return;
  let moved = false;
  document.querySelectorAll("#app [data-count]").forEach((el) => {
    const k = el.dataset.count, v = Number(el.dataset.v), fmt = COUNT_FMT[el.dataset.fmt] || COUNT_FMT.i;
    const was = lastCounts.get(k);
    lastCounts.set(k, v);
    if (was === undefined || fmt(was) === fmt(v) || !motion()) return;
    moved = true;
    const low = el.hasAttribute("data-low"), d = v - was;
    el.textContent = fmt(was);
    const o = { v: was };
    gsap.to(o, { v, duration: 0.9, ease: "power2.out", onUpdate: () => { el.textContent = fmt(o.v); } });
    const host = el.closest(".tile-face");
    if (!host) return;
    const chip = document.createElement("span");
    chip.className = "count-delta " + ((low ? d < 0 : d > 0) ? "up" : "down");
    chip.textContent = low ? `${d < 0 ? "▲" : "▼"}${Math.abs(d)}` : `${d > 0 ? "+" : "−"}${el.dataset.fmt === "money" ? money(Math.abs(d)) : Math.round(Math.abs(d))}`;
    host.append(chip);
    gsap.to(chip, { keyframes: { "0%": { opacity: 0, y: 8, scale: 0.8 }, "12%": { opacity: 1, y: 0, scale: 1 }, "75%": { opacity: 1 }, "100%": { opacity: 0, y: -6 } },
      duration: 2.8, ease: "none", onComplete: () => chip.remove() });
  });
  if (moved) UI.sound("tick");
}
// 积分榜的升降 (比上一轮): 三角 + 名次数, 不只靠颜色
const moveHtml = (m) => (!m ? "" : `<span class="mv ${m > 0 ? "up" : "down"}" title="${esc(tf(m > 0 ? "mv-up" : "mv-down", { n: Math.abs(m) }))}"><i></i>${Math.abs(m)}</span>`);

// 每个栏目: k 键, cap 图块下的名字, tile 图块画面, hero 详情, open 打开完整页面, bg 背景用哪支队的队徽
function hubSections() {
  const c = state.career;
  const mine = c.user_team;
  const out = [];
  if (c.finished || state.next) {
    out.push({ k: "next", cap: c.finished ? t("season-over") : t("tile-next"),
      tile: () => tileEmb(c.finished ? state.table[0].team : oppOf(state.next)), hero: heroNext,
      open: () => (c.finished ? openStandings() : openTeam(oppOf(state.next))),
      bg: () => (c.finished ? state.table[0].team : oppOf(state.next)) });
  }
  out.push({ k: "results", cap: t("tile-results"), tile: tileResults, hero: heroResults, open: () => openHistory(),
    bg: () => { const f = myLastFixture(); return f ? oppOf(f) : mine; } });
  out.push({ k: "table", cap: t("standings"), tile: tileTable, hero: heroTable, open: () => openStandings(), bg: () => state.table[0].team });
  if (state.market) {   // 转会和合同 (R-25)
    out.push({ k: "market", cap: t("tile-market"), hero: heroMarket, open: () => openMarket(), bg: () => mine,
      live: !!state.market.window,
      tile: () => `${countNum("cash", state.market.cash, "money", "t-money")}<span class="t-sub${state.market.window ? " live" : ""}">${esc(state.market.window ? windowLeft(state.market.window) : t("mk-closed"))}</span>` });
  }
  if (isWorld()) out.push(...worldSections());
  else out.push(...customSections());
  if (state.scorers.length) {
    out.push({ k: "scorers", cap: t("scorers"), tile: () => tileFace(state.scorers[0]), hero: () => heroBoard("goals"),
      open: () => openBoard("goals"), bg: () => state.scorers[0].team });
  }
  if ((state.assisters || []).length) {
    out.push({ k: "assists", cap: t("assisters"), tile: () => tileFace(state.assisters[0]), hero: () => heroBoard("assists"),
      open: () => openBoard("assists"), bg: () => state.assisters[0].team });
  }
  if (state.honors) {   // 荣誉和历史 (R-27): 年度最佳候选的领跑者 (还没有就放上季的年度最佳)
    const hn = state.honors, face0 = hn.race[0] || (hn.last && hn.last.poty);
    out.push({ k: "honors", cap: t("tile-honors"), hero: heroHonors, open: () => openHonors(), bg: () => (face0 ? face0.team : mine),
      tile: () => (face0 ? tileFace(face0) : `<span class="t-word">${esc(t("tile-honors"))}</span>`) });
  }
  // 本队: 新赛季还没人出场也要有 (以前踢第一场之前这个图块不见了)
  out.push({ k: "squad", cap: t("tile-squad"), tile: () => tileEmb(mine), hero: heroSquad, open: () => openSquad(), bg: () => mine });
  if (state.training) {   // 成长 (R-23): 训练中心
    out.push({ k: "training", cap: t("tile-training"), hero: heroTraining, open: () => openTraining(), bg: () => mine,
      tile: () => `<span class="t-num">${state.training.used}<i>/</i>${state.training.slots}</span><span class="t-sub">${esc(t("tr-in"))}</span>` });
  }
  // 角标 (R-57): 要你处理的事在图块右上角写个数 (给你球员的报价、请你执教的球队、青训营等你挑的孩子)
  const todo = state.todo || {};
  const badge = { market: todo.bids, board: todo.offers, training: todo.academy };
  for (const x of out) if (badge[x.k]) x.badge = badge[x.k];
  // 按常用程度排 (R-57): 一屏看得见 8 个, 天天用的放前面; 没列到的排在最后, 保持原来的先后
  const order = HUB_ORDER.reduce((m, k, i) => m.set(k, i), new Map());
  return out.map((x, i) => [x, order.has(x.k) ? order.get(x.k) : 100 + i]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
}
const HUB_ORDER = ["next", "squad", "market", "training", "table", "results", "calendar", "ucl", "uel", "cups",
  "scorers", "assists", "honors", "leagues", "national"];

// 真实日历生涯的图块: 欧冠 / 杯赛 (你在踢的) / 赛历 / 各国联赛 / 国家队
function worldSections() {
  const c = state.career, mine = c.user_team;
  const out = [];
  for (const cid of EURO) {
    const u = c.comps.find((x) => x.comp === cid) || {};
    const k = euroKey(cid);
    out.push({ k, cap: t("tile-" + k), bg: () => mine, open: () => openEuro(cid), hero: () => heroEuro(cid),
      tile: () => (u.position && u.stage === "league" && state.last_round
        ? `${countNum(k + "-" + c.season, u.position, "i", "t-num", true)}<span class="t-sub">/ 36</span>`
        : `<span class="t-word">${esc(u.stage && u.stage !== "league" && u.stage !== "done" ? t("st-" + u.stage) : t("ucl-league"))}</span>`) });
  }
  const cups = c.comps.filter((x) => x.comp[0] !== "L" && !EURO.includes(x.comp));
  if (cups.length) {
    const live = cups.find((x) => x.alive) || cups[0];
    out.push({ k: "cups", cap: t("tile-cups"), bg: () => mine, open: () => openCups(live.comp), hero: () => heroCups(cups),
      tile: () => `<span class="t-word">${esc(compName(live.comp))}</span><span class="t-sub">${live.stage ? esc(t("st-" + live.stage)) : ""}</span>` });
  }
  out.push({ k: "calendar", cap: t("tile-calendar"), bg: () => mine, open: () => openCalendar(), hero: heroCalendar,
    tile: () => { const d = state.next ? new Date(state.next.date + "T12:00:00") : null;
      return d ? `<span class="t-num">${d.getDate()}</span><span class="t-sub">${esc(d.toLocaleDateString(NAME_LANGS[lang].locale, { month: "short" }))}</span>` : `<span class="t-num dim">–</span>`; } });
  out.push({ k: "leagues", cap: t("tile-leagues"), bg: () => state.table[0].team, open: () => openLeagues(), hero: heroLeagues,
    tile: () => `<span class="t-num">15</span><span class="t-sub">${esc(t("tile-leagues"))}</span>` });
  out.push({ k: "national", cap: t("tile-national"), bg: () => mine, open: () => openNational(), hero: heroNational,
    tile: () => { const k = Math.floor((c.season - 1) / 2); return `<span class="t-num">${2028 + 2 * k}</span><span class="t-sub">${esc(t(k % 2 ? "comp-WC" : "comp-EURO"))}</span>`; } });
  return out;
}
// 自选联赛的图块 (R-94): 杯赛 (有杯赛 / 你进了附加赛)、各级联赛 (有次级联赛)
function customSections() {
  const c = state.career, mine = c.user_team, out = [];
  const cups = c.comps || [];
  if (cups.length) {
    const live = cups.find((x) => x.alive) || cups[0];
    out.push({ k: "cups", cap: t("tile-cups"), bg: () => mine, open: () => openCups(live.comp), hero: () => heroCups(cups),
      tile: () => `<span class="t-word">${esc(compName(live.comp))}</span><span class="t-sub">${live.stage ? esc(t("st-" + live.stage)) : ""}</span>` });
  }
  if (state.world && state.world.leagues) {
    out.push({ k: "leagues", cap: leaguesTitle(), bg: () => state.table[0].team, open: () => openLeagues(c.div), hero: heroLeagues,
      tile: () => `<span class="t-num">${Object.keys(state.world.leagues).length}</span><span class="t-sub">${esc(leaguesTitle())}</span>` });
  }
  return out;
}
// 主页详情 (R-20): 左边一栏字和按钮 (.hero-info), 右边一块预览面板 (.hero-side) 占满剩下的高度, 内容多就在面板里滚。
// 整个主页一屏装下, 不再往下翻
const heroInfo = (inner, wide = false) => `<div class="hero-info${wide ? " wide" : ""}">${inner}</div>`;
const heroSide = (inner) => `<div class="hero-side">${inner}</div>`;
function heroEuro(cid) {
  const u = state.career.comps.find((x) => x.comp === cid);
  const k = euroKey(cid);
  return heroInfo(`<div class="hero-kicker">${t(k + "-title")} · ${esc(state.career.season_label)}</div>
    <h1 class="hero-title">${u && u.position && u.stage === "league" ? tf("ucl-pos", { p: u.position }) : esc(u && u.stage && u.stage !== "league" ? (u.stage === "done" ? t("finished") : t("st-" + u.stage)) : t("ucl-league"))}</h1>
    <p class="hero-note">${t(k + "-sub")}</p>
    <div class="hero-actions"><button class="pill" data-act="open-ucl" data-comp="${cid}">${t(k + "-title")}</button></div>`, true);
}
// 自选联赛没有 2026/27 这种赛季名 (R-94 杯赛、两级联赛的页面也用)
const seasonTag = () => (isWorld() ? state.career.season_label : tf("season", { n: state.career.season }));
const cupsSub = () => t(isWorld() ? "cups-sub" : "cups-sub-custom");
const leaguesTitle = () => t(isWorld() ? "leagues-title" : "divs-title");
function heroCups(cups) {
  return heroInfo(`<div class="hero-kicker">${t("cups-title")} · ${esc(seasonTag())}</div>
    <h1 class="hero-title">${cups.map((x) => esc(compName(x.comp))).join(" · ")}</h1>
    <p class="hero-note">${cupsSub()}</p>
    <div class="hero-actions">${cups.map((x) => `<button class="pill" data-act="open-cup" data-cup="${x.comp}">${esc(compName(x.comp))}${x.stage ? ` · ${esc(t("st-" + x.stage))}` : ""}</button>`).join("")}</div>`, true);
}
function heroCalendar() {
  const f = state.next;
  return heroInfo(`<div class="hero-kicker">${t("calendar")} · ${esc(state.career.season_label)}</div>
    <h1 class="hero-title">${f ? esc(fmtDate(f.date)) : t("finished")}</h1>
    <p class="hero-note">${t("calendar-sub")}</p>
    <div class="hero-actions"><button class="pill" data-act="open-calendar">${t("calendar")}</button></div>`, true);
}
function heroLeagues() {
  return heroInfo(`<div class="hero-kicker">${leaguesTitle()}</div>
    <h1 class="hero-title">${isWorld() ? t("tile-leagues") : leaguesTitle()}</h1>
    <p class="hero-note">${isWorld() ? t("world-sub") : t("setup-div2-note")}</p>
    <div class="hero-actions"><button class="pill" data-act="open-leagues">${leaguesTitle()}</button></div>`, true);
}
// ------------------------------------------------------------ 执教国家队 (R-71)
// 主页国家队栏目: 你执教的那支 (下一场、征召名单、辞职) / 没执教时挂着的邀请 (接受、拒绝)
const ntState = () => state.nt || {};
const ntName = (tid) => teamName(tid);
function ntOffersHtml() {
  const offers = ntState().offers || [];
  if (!offers.length) return "";
  return `<div class="nt-offers">${offers.map((o) => `<div class="pick">${emblem(o.nation, "md")}
    <div class="grow"><div><b>${esc(ntName(o.nation))}</b></div><div class="muted">${esc(tf("nt-offer-why-" + (o.why || "change"), { d: fmtDate(o.until, false) }))}</div></div>
    <button class="pill primary" data-act="nt-accept" data-nation="${o.nation}">${t("nt-accept")}</button>
    <button class="pill ghost" data-act="nt-decline" data-nation="${o.nation}">${t("nt-decline")}</button></div>`).join("")}</div>`;
}
function heroNational() {
  const nid = ntState().nation;
  if (nid == null) {
    return heroInfo(`<div class="hero-kicker">${t("national-title")}</div>
      <h1 class="hero-title">${t("tile-national")}</h1>
      <p class="hero-note">${t("national-sub")}</p>
      ${ntOffersHtml() || `<p class="hero-note">${t("nt-no-job")}</p>`}
      <div class="hero-actions"><button class="pill" data-act="open-national">${t("nat-comps")}</button></div>`, true);
  }
  const next = (state.next && [state.next.home, state.next.away].includes(nid)) ? state.next : null;
  return heroInfo(`<div class="hero-kicker">${t("nt-kicker")}</div>
    <div class="hero-champ">${emblem(nid, "lg")}<div><h1 class="hero-title">${esc(ntName(nid))}</h1>
      <div class="hero-meta">Elo <span class="n">${(state.teams[nid] || {}).elo ?? "-"}</span>${next ? ` · ${esc(tf("nt-next-is", { d: fmtDate(next.date, false) }))}` : ""}</div></div></div>
    <p class="hero-note">${t("nt-note")}</p>
    <div class="hero-actions">
      <button class="pill primary" data-act="open-callup">${t("nt-callup")}</button>
      <button class="pill" data-act="open-national">${t("nat-comps")}</button>
      <button class="pill ghost" data-act="nt-resign">${t("nt-resign")}</button>
    </div>${ntOffersHtml()}`, true);
}

// 征召页: 左边这次的名单 (按线分组, 点一下拿掉), 右边能征召的人 (点一下加进来); 底下保存 / 交给 AI 挑
async function openCallup(nav = "push") {
  const seq = ++openSeq;
  let v;
  try {
    v = await api("/api/world/nt");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  if (v.nation == null) return toast(t("nt-no-job"));
  delete $("#modal").dataset.player;
  const byPid = new Map([...v.pool, ...v.squad].map((p) => [p.pid, p]));
  const pick = new Set(v.squad.map((p) => p.pid));
  const start = [...pick].sort().join(",");
  const LINE = { GK: "GK", CB: "DEF", LB: "DEF", RB: "DEF", DMF: "MID", CMF: "MID", LMF: "MID", RMF: "MID", AMF: "MID", LWF: "FWD", RWF: "FWD", SS: "FWD", CF: "FWD" };
  const lines = ["GK", "DEF", "MID", "FWD"];
  const row = (p, inList) => `<button class="md-item cu-row${inList ? " on" : ""}" data-pid="${p.pid}" data-cu="${inList ? "out" : "in"}">
    <img class="face" src="${img("face", p.pid)}" loading="lazy" ${faceErr(p.club || v.nation)} alt=""><span class="md-text"><span class="md-main">${pname(p)}</span><span class="md-sub">${esc(p.position || "")} · ${esc(String(p.age ?? "-"))} ${t("age-u")}${p.club ? ` · ${esc(teamName(p.club))}` : ""}</span></span>
    <span class="num">${p.overall ?? ""}</span></button>`;
  const group = (ps, inList) => lines.map((ln) => {
    const xs = ps.filter((p) => (LINE[p.position] || "MID") === ln);
    return xs.length ? `<div class="tac-linehead">${esc(t("tac-ln-" + ln))} · ${xs.length}</div>${xs.map((p) => row(p, inList)).join("")}` : "";
  }).join("");
  const body = () => {
    const mine = [...pick].map((pid) => byPid.get(pid)).filter(Boolean).sort((a, b) => (b.overall || 0) - (a.overall || 0));
    const rest = v.pool.filter((p) => !pick.has(p.pid));
    const n = pick.size, ok = n >= 16 && n <= v.size, changed = [...pick].sort().join(",") !== start;
    return `<div class="cols nt-cols" data-nav-sides>
      ${fillPanel(`<div class="md-list" data-nav-group="cu-in">${group(mine, true)}</div>`, `<h2 class="panel-head">${t("nt-squad")} <span class="muted">${esc(tf("nt-squad-n", { n, m: v.size }))}</span></h2>`)}
      ${fillPanel(`<div class="md-list" data-nav-group="cu-pool">${group(rest, false)}</div>`, `<h2 class="panel-head">${t("nt-pool")} <span class="muted">${esc(tf("nt-pool-n", { n: v.pool_size }))}</span></h2>`)}
    </div>
    <div class="tac-bar nt-bar"><span class="muted">${esc(v.custom ? t("nt-custom") : t("nt-ai"))}</span>
      <span class="tac-btns"><button class="pill primary" id="cu-save"${ok && changed ? "" : " disabled"}>${t("nt-save")}</button>
      <button class="pill ghost" id="cu-ai">${t("nt-auto")}</button></span></div>`;
  };
  const head = glowHtml(v.nation) + pageHead(t("nt-callup"), esc(ntName(v.nation)), t("nt-callup-sub"));
  const wire = () => {
    const box = $("#modal .cu-body");
    if (!box) return;
    box.querySelectorAll("button[data-cu]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const pid = Number(b.dataset.pid);
      if (b.dataset.cu === "out") pick.delete(pid);
      else if (pick.size < v.size) pick.add(pid);
      else return toast(tf("nt-full", { m: v.size }));
      const keep = b.dataset.cu === "out" ? "cu-in" : "cu-pool";
      box.innerHTML = body();
      wire();
      UI.prepScrollers(box);
      const again = box.querySelector(`[data-nav-group="${keep}"] button`);
      if (again && UI.mode !== "pointer") UI.focus(again, true);
    }));
    $("#cu-save").addEventListener("click", async () => {
      try {
        state = await api("/api/nt/callup", { pids: [...pick] });
        toast(t("nt-saved"));
        openCallup("replace");
      } catch (e) { toast(e.message); }
    });
    $("#cu-ai").addEventListener("click", async () => {
      try {
        state = await api("/api/nt/callup", { pids: null });
        openCallup("replace");
      } catch (e) { toast(e.message); }
    });
  };
  // 页面换上去是下一帧 (View Transitions): 按钮在 after 里接线
  openModal(head + pageBody(body(), "cu-body"), true,
    { label: () => t("nt-callup"), reopen: (n) => openCallup(n), after: () => wire() }, nav);
}

// 淘汰赛你亲手踢平了: 谁晋级
function heroDecide() {
  const p = state.career.pending;
  const last = p.fixtures[p.fixtures.length - 1];
  const score = p.fixtures.length > 1 && last.agg ? tf("agg", { a: last.agg[0], b: last.agg[1] })
    : `${last.result ? last.result.home_goals : 0}–${last.result ? last.result.away_goals : 0}`;
  return heroInfo(`<div class="hero-kicker">${esc(fxLabel(last))}</div>
    <h1 class="hero-title">${t("decide-title")}</h1>
    <p class="hero-note">${tf("decide-sub", { s: esc(score) })}</p>
    <div class="hero-actions">${[p.a, p.b].map((tid) => `<button class="pill${tid === state.career.user_team ? " primary" : ""}" data-act="decide" data-tie="${esc(p.id)}" data-winner="${tid}">${emblem(tid)} ${esc(tf("decide-win", { t: teamName(tid) }))}</button>`).join("")}</div>`, true);
}

// 待处理 (R-57): 下一场下面一行, 每件事一个按钮, 点了直接去处理的地方; 没事就不出这一行
function todoRow() {
  const td = state.todo || {};
  const items = [];
  if (td.bids) items.push(`<button class="pill todo-pill" data-act="open-market" data-tab="bids">${esc(tf("todo-bids", { n: td.bids }))}</button>`);
  if (td.offers) items.push(`<button class="pill todo-pill" data-act="todo-board">${esc(tf("todo-offers", { n: td.offers }))}</button>`);
  if (td.academy) items.push(`<button class="pill todo-pill" data-act="open-training" data-tab="academy">${esc(tf("todo-academy", { n: td.academy }))}</button>`);
  if (td.expiring) items.push(`<button class="pill todo-pill" data-act="ph-open-msgs">${esc(tf("todo-expiring", { n: td.expiring }))}</button>`);
  const nto = (ntState().offers || []).length;
  if (nto) items.push(`<button class="pill todo-pill" data-act="todo-national">${esc(tf("todo-nt", { n: nto }))}</button>`);
  if (!items.length) return "";
  return `<div class="todo-row"><span class="todo-cap">${t("todo-cap")}</span>${items.join("")}</div>`;
}

// 连续模拟 (R-56): 下一场按钮下面一行。跑着的时候换成进度和「停下」, 每 400 毫秒问一次服务端, 停了就整页重拉
let aheadTimer = null;
function aheadRow() {
  const a = state.ahead;
  if (a && a.running) {
    const where = a.today ? ` · ${fmtDate(a.today, false)}` : a.round ? ` · ${tf("round-tag", { n: a.round })}` : "";
    return `<div class="ahead-row running" aria-live="polite"><span class="ahead-spin" aria-hidden="true"></span>
      <span>${esc(tf("ahead-running", { n: a.done }))}${esc(where)}</span>
      <button class="pill" data-act="ahead-stop">${t("ahead-stop")}</button></div>`;
  }
  const opts = [["n", 5, t("ahead-n5")], ...(isWorld() ? [["month", 0, t("ahead-month")]] : []), ["season", 0, t("ahead-season")]];
  return `<div class="ahead-row"><span class="ahead-cap">${t("ahead-label")}</span>
    ${opts.map(([m, n, label]) => `<button class="pill quiet-pill" data-act="ahead-go" data-mode="${m}" data-n="${n}">${esc(label)}</button>`).join("")}
    <span class="dl-sep"></span>
    <button class="pill quiet-pill" data-act="fast-sim" aria-pressed="${fastSim}">${t(fastSim ? "fast-sim-on" : "fast-sim-off")}</button></div>`;
}
async function aheadStart(mode, n) {
  if (busy) return;
  try {
    const res = await api("/api/ahead/start", { mode, n });
    state = res.state;
    render();
    busy = true;                                // 跑着的时候别的结算按钮不响应 (服务端也会拦)
    aheadPoll();
  } catch (e) {
    toast(e.message);
  }
}
function aheadPoll() {
  clearTimeout(aheadTimer);
  aheadTimer = setTimeout(async () => {
    let a;
    try {
      a = await api("/api/ahead");
    } catch (e) {
      return aheadPoll();
    }
    if (a.running) {
      state.ahead = a;
      const row = $("#hero .ahead-row");
      if (row) row.outerHTML = aheadRow();      // 只换这一行, 不整页重画 (焦点、滚动都不动)
      return aheadPoll();
    }
    busy = false;
    await refresh();                            // 停了: 比分、积分榜、新闻都变了, 整页重拉
    toast(a.error ? tf("ahead-error", { e: a.error }) : tf("ahead-r-" + (a.reason || "done"), { n: a.done }));
  }, 400);
}

// 赛前胜率 (R-52): 按两队 Elo 算的主胜 / 平 / 客胜, 一根分三段的条, 每段写着百分比 (不只靠颜色)
function oddsBar(o) {
  if (!o) return "";
  const pct = (x) => `${Math.round(x * 100)}%`;
  // 段太窄写不下「主胜 12%」(R-70: 以前两头被裁成「ome 12」): 窄了只写数, 再窄就不写; 整句一直留给读屏和悬停
  const seg = (k, x) => {
    const full = esc(tf("odds-" + k, { p: pct(x) }));
    const shown = x >= 0.2 ? full : x >= 0.08 ? `<span aria-hidden="true">${pct(x)}</span><span class="sr-only">${full}</span>` : `<span class="sr-only">${full}</span>`;
    return `<span class="odds-seg ${k}" style="flex-grow:${Math.max(x, 0.04)}" title="${full}">${shown}</span>`;
  };
  return `<div class="odds" aria-label="${esc(t("odds"))}"><span class="odds-cap">${t("odds")}</span><div class="odds-bar">${seg("h", o[0])}${seg("d", o[1])}${seg("a", o[2])}</div></div>`;
}

// 转会窗口 (R-51): 开着的时候剩几天 / 到第几轮
function windowLeft(w, short = false) {
  if (w.round) return tf(short ? "mk-until" : "mk-open-round", { n: w.round });
  const today = state.career.today;
  if (!w.date || !today) return short ? "" : t("mk-open");
  const n = Math.round((new Date(w.date + "T12:00:00") - new Date(today + "T12:00:00")) / 864e5);
  return n <= 1 ? t(short ? "mk-last" : "mk-open-last") : tf(short ? "mk-days" : "mk-open-days", { n });
}
const winChip = () => (state.market && state.market.window
  ? `<button class="win-chip" data-act="open-market"><span class="win-dot" aria-hidden="true"></span>${esc(t(state.market.window.kind === "winter" ? "win-chip-winter" : "win-chip-summer"))}<b>${esc(windowLeft(state.market.window, true))}</b></button>`
  : "");

// 欧战进程 (R-51): 欧冠、欧联现在到哪一步, 你踢不踢都列; 点进去是那项赛事
function renderMain() {
  const c = state.career;
  const mine = c.user_team;
  const secs = hubSections();
  if (!secs.some((x) => x.k === hubKey)) hubKey = secs[0].k;
  const sec = secs.find((x) => x.k === hubKey);
  const round = c.finished ? t("finished") : tf("round-x", { a: c.current_round, b: c.rounds_total });
  const entering = !hubEntered;
  $("#app").innerHTML = `
  <div class="hub">
    <div class="backdrop" aria-hidden="true"><div class="bd"></div><div class="bd"></div></div>
    <header class="hub-top">
      <div class="hub-left"><div class="hub-id" tabindex="0" role="button" data-team="${mine}">${emblem(mine, "md")}
        <div><b>${esc(teamName(mine))}</b><span>${isWorld() ? `${esc(leagueName(c.league))} · ${esc(c.season_label)}${c.today ? ` · ${esc(fmtDate(c.today))}` : ""}`
          : `${esc(c.league_name)} · ${tf("season", { n: c.season })} · ${round}`}</span></div></div>
        ${winChip()}</div>
      <nav class="hub-util" data-nav-group="util">
        <button class="pill to-game" data-act="game">${t("to-game")}</button>
        <button class="quiet" data-act="overview">${t("ov-title")}</button>
        <span class="dl-sep"></span>
        ${c.history.length ? `<button class="quiet" data-act="seasons">${t("seasons")}</button>` : ""}
        <button class="quiet" data-act="saves">${t("saves")}</button>
        <button class="quiet" data-act="plugin">${t("plugin")}</button>
        ${state.dev ? `<button class="quiet" data-act="dev">${t(state.dev.running ? "dv-btn-running" : "dv-btn")}</button>` : ""}
        <span class="dl-sep"></span>
        <button class="quiet" data-act="sound" aria-pressed="${UI.soundOn}">${t(UI.soundOn ? "sound-on" : "sound-off")}</button>
        ${langToggleHtml()}
        <span class="clock"></span>
      </nav>
    </header>
    <div class="tiles" role="tablist" data-nav-group="tiles" data-nav-wrap>
      ${secs.map((x, i) => `<button class="tile${x.k === hubKey ? " on" : ""}${x.live ? " live" : ""}" role="tab" aria-selected="${x.k === hubKey}" data-k="${x.k}" style="--i:${i}"${x.k === hubKey ? " data-nav-default" : ""}>
        <span class="tile-face">${x.tile()}${x.badge ? `<span class="tile-badge" aria-label="${esc(tf("todo-n", { n: x.badge }))}">${x.badge}</span>` : ""}</span><span class="tile-cap">${esc(x.cap)}</span></button>`).join("")}
    </div>
    <section class="hero" id="hero" role="tabpanel" data-nav-group="hero" data-nav-sides>${sec.hero()}</section>
  </div>`;
  hubEntered = true;
  const M = entering && motion();
  if (M) {
    M.from(".hub .tile", { x: 30, opacity: 0, duration: 0.5, ease: "power3.out", stagger: 0.045, delay: 0.06, clearProps: "transform,opacity" });
    M.from("#hero", { opacity: 0, duration: 0.5, delay: 0.25, ease: "power3.out", clearProps: "opacity" });
  }
  bdTeam = null;
  setBackdrop(sec.bg(), true);
  edgeFade($(".hub .tiles"));
  prepHero();
  tickClock();
  bindLangToggle();
  playCounts();
}

// 从图块往下进详情时先落在第一个按钮上 (详情是一个导航组: 回来时回到上次停的地方);
// 预览面板一打开就把我的那一行摆到中间
function prepHero() {
  const hero = $("#hero");
  if (!hero) return;
  const b = hero.querySelector(".hero-actions button:not(:disabled)");
  if (b && !hero.querySelector("[data-nav-default]")) b.setAttribute("data-nav-default", "");
  centerIn(hero.querySelector(".hero-side tr.mine, .hero-side .row.mine"));
  edgeFade(hero.querySelector(".hero-info"), "y");
  UI.prepScrollers(hero);
  renderHints();
}

// 你的队这季踢完退役的明星 (R-58): 赛季踢完、开新赛季之前, 主页右边一栏, 每人选「转世回青训 / 去考教练证」, 点了就存;
// 不选就照 R-27 的比例 (写着默认去哪)
function retireSide() {
  const list = state.retire || [];
  if (!list.length) return "";
  const mine = state.career.user_team;
  return heroSide(`<div class="hero-panel scroller"><h2 class="panel-head">${t("rt-title")}</h2><p class="muted">${t("rt-note")}</p>
    ${list.map((x) => `<div class="retire-row">${face(x.pid, mine)}<div class="grow"><div>${pname(x)}${x.hof ? `<span class="fit-tag hof">${t("hof-tag")}</span>` : ""}</div>
      <div class="muted">${x.choice ? t("rt-chosen") : esc(tf("rt-default", { w: t("rt-" + x.default) }))}</div>
      ${segHtml("rt-" + x.pid, [["reborn", t("rt-reborn")], ["coach", t("rt-coach")]], x.choice || x.default)}</div></div>`).join("")}</div>`);
}
document.addEventListener("change", async (e) => {
  const box = e.target;
  if (!box.id || !box.id.startsWith("rt-") || !box.classList.contains("seg")) return;
  const pid = Number(box.id.slice(3)), choice = box.dataset.value;
  try {
    await api("/api/retire/choose", { pid, choice });
    const x = (state.retire || []).find((r) => r.pid === pid);
    if (x) x.choice = choice;
    const note = box.closest(".retire-row").querySelector(".muted");
    if (note) note.textContent = t("rt-chosen");
  } catch (err) {
    toast(err.message);
  }
});

// 赛季踢完、还没开下一季: 告诉人下一步会颁奖, 现在谁领跑
const awardsTeaser = () => (state.honors && state.honors.race[0]
  ? `<p class="hero-note">${tf("hn-season-end", { p: `<b>${pname(state.honors.race[0])}</b>` })}</p>` : "");

function tileResults() {
  const f = myLastFixture();
  if (!f || !f.result) return `<span class="t-num dim">–</span>`;
  const r = f.result;
  const home = f.home === state.career.user_team;
  const my = home ? r.home_goals : r.away_goals, op = home ? r.away_goals : r.home_goals;
  const res = my > op ? "W" : my < op ? "L" : "D";
  return `<span class="t-num">${my}<i>–</i>${op}</span><span class="t-sub">${formHtml([res])}</span>`;
}

function tileTable() {
  const me = myRow();
  if (!me.played) return `<span class="t-num dim">–</span><span class="t-sub">/ ${state.table.length}</span>`;   // 还没开踢: 名次没意义
  return `${countNum("pos-" + state.career.season, me.position, "i", "t-num", true)}<span class="t-sub">/ ${state.table.length}</span>`;
}

function heroNext() {
  const c = state.career;
  if (state.board && state.board.sacked) return heroSacked();
  if (c.pending) return heroDecide();             // 淘汰赛你亲手踢平了 (真实日历; 自选联赛的杯赛 / 附加赛 R-94)
  if (isWorld() && c.finished) {
    const champ = state.table[0];
    return heroInfo(`<div class="hero-kicker">${tf("season-done", { s: esc(c.season_label) })}</div>
      <div class="hero-champ">${emblem(champ.team, "lg")}<div>
        <h1 class="hero-title">${esc(leagueName(c.league))} · ${t("champion")}${esc(teamName(champ.team))}</h1>
        <div class="hero-meta">${champ.points} ${t("pts")} · ${tf("w-d-l", { w: champ.won, d: champ.drawn, l: champ.lost })}</div></div></div>
      <div class="hero-actions">
        <button class="pill primary" data-act="season-end">${t("se-open")}</button>
        <button class="pill" data-act="open-ucl">${t("ucl-title")}</button>
        <button class="pill" data-act="open-table">${t("final-table")}</button>
      </div>${awardsTeaser()}`, !retireSide()) + retireSide();
  }
  if (c.finished) {
    const champ = state.table[0];
    return heroInfo(`<div class="hero-kicker">${t("season-over")} · ${tf("season", { n: c.season })}</div>
      <div class="hero-champ">${emblem(champ.team, "lg")}<div>
        <h1 class="hero-title">${t("champion")}${esc(teamName(champ.team))}</h1>
        <div class="hero-meta">${champ.points} ${t("pts")} · ${tf("w-d-l", { w: champ.won, d: champ.drawn, l: champ.lost })}</div></div></div>
      <div class="hero-actions">
        <button class="pill primary" data-act="season-end">${t("se-open")}</button>
        <button class="pill" data-act="open-table">${t("final-table")}</button>
      </div>${awardsTeaser()}`, !retireSide()) + retireSide();
  }
  const f = state.next;
  const absent = f.absent || {};
  const side = (tid, where) => {
    const r = state.table.find((x) => x.team === tid);
    return `<div class="side" tabindex="0" role="button" data-team="${tid}">${emblem(tid, "lg")}<div>
      <div class="nm">${esc(teamName(tid))}${fxTags(tid)}</div>
      <div class="hero-meta">${t(where)} · ${t("strength")} <span class="n">${state.teams[tid]?.strength ?? "-"}</span>${state.teams[tid]?.elo ? ` · Elo <span class="n">${state.teams[tid].elo}</span>` : ""}${r ? (r.played ? ` · ${tf("pos-pts", { p: r.position, pts: r.points })} ${formHtml(r.form)}` : ` · ${t("new-season-meta")}`) : ""}</div>
      ${absentLine(absent[tid === f.home ? "home" : "away"])}</div></div>`;
  };
  const mineOut = (absent[f.home === c.user_team ? "home" : "away"] || []).length > 0;
  const tacSide = tacticsSide(f);
  const note = isWorld() || f.comp ? tieNote(f) : "";
  // 对阵横着排 (主队 VS 客队), 按钮紧跟在对阵下面, 说明放最后: 窗口矮的时候被挤掉的是说明, 不是「开始比赛」
  return heroInfo(`<div class="hero-kicker">${isWorld() ? `${esc(fxLabel(f))} · ${esc(fmtDate(f.date))}` : f.comp ? esc(fxLabel(f)) : tf("next-match", { n: f.round })}</div>${note ? `<div class="hero-meta tie-note">${note}</div>` : ""}
    <div class="matchup">${side(f.home, "home-side")}<div class="vs">${t("vs")}</div>${side(f.away, "away-side")}</div>
    ${oddsBar(f.odds)}
    <div class="hero-actions">
      <button class="pill primary" data-act="kickoff" data-nav-default>${t("kickoff")}</button>
      <button class="pill" data-act="sim">${t("sim-mine")}</button>
      <button class="pill quiet-pill" data-act="next-more" aria-expanded="${nextMore}" aria-controls="next-more">${t(nextMore ? "next-less" : "next-more")}</button>
    </div>
    ${nextMore ? `<div class="next-more" id="next-more">
      <div class="manual">
        <label for="mh">${t("manual-in")}</label>
        <input id="mh" type="number" min="0" max="20" placeholder="${t("mh")}"> : <input id="ma" type="number" min="0" max="20" placeholder="${t("ma")}" aria-label="${t("ma")}">
        <button class="pill" data-act="manual">${t("ok")}</button>
        <span class="muted manual-why">${t("manual-why")}</span>
      </div>
      ${aheadRow()}</div>` : state.ahead && state.ahead.running ? aheadRow() : ""}
    ${todoRow()}
    ${buffNote()}
    ${ingameNote(f, absent, mineOut)}
    <p class="hero-note">${t("play-hint")}${lang === "zh" ? "：" : ": "}<b>${esc(teamName(f.home))}</b>${t("home-abbr")} vs <b>${esc(teamName(f.away))}</b>${lang === "zh" ? "。" : ". "}${t("play-hint2")}</p>`, !tacSide) + tacSide;
}

// 「下一场」的次要操作 (手动录入比分、连续模拟、不弹战报) 平时收着 (R-69): 头版只留开始比赛和模拟这场。
// 只记在这个窗口里, 刷新就收回去; 连续模拟跑着的时候进度条照样露在外面
let nextMore = false;

// 手动首发 (R-65): 位置 -> 哪条线 (和 league/life.py 的 LINES 一致, 预览分组 / 错线提示用)
const TAC_LINE_OF = { GK: "GK", CB: "DEF", LB: "DEF", RB: "DEF", DMF: "MID", CMF: "MID", LMF: "MID", RMF: "MID", AMF: "MID", LWF: "FWD", RWF: "FWD", SS: "FWD", CF: "FWD" };
// 站位: 预设名 -> 11 个 [x, y] 百分比 (左上 0,0, 右下 100,100; 下标和 league/tactics.py PRESETS 的槽位顺序对齐)
const TAC_PITCH = {
  "4-4-2": [[50, 88], [83, 69], [64, 72], [36, 72], [17, 69], [85, 44], [64, 47], [36, 47], [15, 44], [38, 20], [62, 20]],
  "4-3-3": [[50, 88], [83, 69], [64, 72], [36, 72], [17, 69], [50, 54], [33, 45], [67, 45], [16, 21], [50, 17], [84, 21]],
  "4-2-3-1": [[50, 88], [83, 69], [64, 72], [36, 72], [17, 69], [39, 55], [61, 55], [17, 36], [50, 41], [83, 36], [50, 16]],
  "3-5-2": [[50, 88], [27, 70], [50, 72], [73, 70], [12, 44], [34, 48], [50, 57], [66, 48], [88, 44], [38, 20], [62, 20]],
  "5-3-2": [[50, 88], [11, 63], [31, 71], [50, 72], [69, 71], [89, 63], [31, 46], [50, 53], [69, 46], [38, 20], [62, 20]],
  "4-5-1": [[50, 88], [83, 69], [64, 72], [36, 72], [17, 69], [13, 43], [34, 47], [50, 55], [66, 47], [87, 43], [50, 16]],
};
// 球场线 (0-100 坐标, 和站位同一套百分比; 描边不等比缩放, 线宽处处一样)。
// 中圈 ry 按放它的框的比例传 (框越扁 ry 越大), 这样渲染出来才是正圆
// ry 不给 (调整页, R-81): 球场宽高比跟着窗口变, 中圈改成 HTML 画的正圆 (.tac-circle), 多宽都不变形
function tacPitchSvg(ry) {
  return `<svg class="tac-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g vector-effect="non-scaling-stroke">`
    + `<rect x="3" y="2" width="94" height="96"/><line x1="3" y1="50" x2="97" y2="50"/>${ry ? `<ellipse cx="50" cy="50" rx="9" ry="${ry}"/>` : ""}<circle cx="50" cy="50" r="1" class="dot"/>`
    + `<rect x="28" y="2" width="44" height="13"/><rect x="39" y="2" width="22" height="5.5"/><circle cx="50" cy="10.5" r="1" class="dot"/>`
    + `<rect x="28" y="85" width="44" height="13"/><rect x="39" y="92.5" width="22" height="5.5"/><circle cx="50" cy="89.5" r="1" class="dot"/></g></svg>`;
}
// 球场上的一张球员卡 (预览和调整页共用): 总评 + 槽位, 脸, 名字
// 和服务端 tactics.malus 同值 (R-66): 前端只管显示打折预览, 真正的扣分在后端 apply 里。test_web 锁死。
const TAC_FAM = { SAME: 0, LINE: -2, NEAR: -6, FAR: -12, GK: -30 };
const TAC_BENCH_N = 12;
function tacMalus(got, want) {
  if (got === want) return TAC_FAM.SAME;
  if (got === "GK" || want === "GK") return TAC_FAM.GK;
  const lg = TAC_LINE_OF[got] || "MID", lw = TAC_LINE_OF[want] || "MID";
  if (lg === lw) return TAC_FAM.LINE;
  const pair = lg < lw ? lg + lw : lw + lg;
  return (pair === "DEFMID" || pair === "FWDMID") ? TAC_FAM.NEAR : TAC_FAM.FAR;
}

function tacCard(p, code, team, dot = "", badges = "") {
  return `<span class="tac-ovr">${p.overall ?? ""}<i>${esc(code)}</i></span>`
    + `<img class="face" src="${img("face", p.pid)}" loading="lazy" ${faceErr(team)} alt="">`
    + `<span class="tac-nm">${pname(p)}</span>${dot}${badges ? `<span class="tac-badges">${badges}</span>` : ""}`;
}
// 「下一场」右侧的战术预览: 阵型 + 自动 / 手动 + 球场站位 (顶替的人描边, 下面写谁替了谁)。整块是一个焦点, 手柄移过来按确认进调整页
function tacticsSide(f) {
  const tc = f.tactics;
  if (!tc || !tc.xi || !tc.xi.length) return "";
  const mine = tc.nation ?? state.career.user_team;
  const coords = TAC_PITCH[tc.formation] || TAC_PITCH["4-4-2"];
  const outName = {};
  for (const k of ["home", "away"]) for (const x of (f.absent || {})[k] || []) outName[x.pid] = x;
  const filled = tc.xi.filter((p) => p.manual_pid).map((p) => {
    const a = outName[p.manual_pid];
    return `<div class="tac-sub">${esc(tf("tac-filled-line", { a: a ? dispPlayer(a).main : "?", b: dispPlayer(p).main }))}</div>`;
  }).join("");
  const nt = tc.nation != null;            // 你执教的国家队 (R-71): 点了进征召页
  return heroSide(`<div class="hero-panel tac-side" tabindex="0" role="button" data-act="${nt ? "open-callup" : "open-tactics"}" aria-label="${esc(t(nt ? "nt-callup" : "tac-adjust"))}">
    <h2 class="panel-head">${esc(tc.formation)} <span class="tag">${t(tc.mode === "manual" ? "tac-manual" : "tac-auto")}</span><span class="muted tac-open">${t(nt ? "nt-callup" : "tac-open")}</span></h2>
    <div class="tac-pitch prev">${tacPitchSvg(12)}${tc.xi.map((p, i) => {
      const [x, y] = coords[i] || [50, 50];
      const off = (p.fam ?? 0) < 0;   // 错线才描金 (R-68): overall 还扣了体能, 不能拿 base 比
      const cut = p.base != null && p.overall != null && p.overall < p.base;
      const tip = `${dispPlayer(p).main} · ${p.position || ""} · ${cut ? `${p.base}→${p.overall}` : (p.overall ?? "")}${off ? ` (${tf("tac-fam-tip", { m: p.fam })})` : ""}${p.manual_pid ? " · " + t("tac-filled") : ""}`;
      return `<span class="tac-slot${p.manual_pid ? " dep" : ""}${off ? " warn" : ""}" style="left:${x}%;top:${y}%" title="${esc(tip)}">${tacCard(p, p.code, mine)}</span>`;
    }).join("")}</div>${filled}</div>`);
}

// 游戏里的阵容 (R-22): 宿主开着影子 dt200 时, 开球会把两队伤停的人在游戏里换下去 (写完游戏重读);
// 没开时只能提醒你自己在游戏里调
function ingameNote(f, absent, mineOut) {
  const ig = state.ingame || {};
  if (!ig.enabled) return mineOut ? `<p class="hero-note">${t("absent-hint")}</p>` : "";
  const last = ig.last && ig.last.fixture === f.id ? ig.last : null;
  if (last && (last.changed || []).length) {
    return `<p class="hero-note">${last.reload_ms != null ? tf("ingame-done", { ms: last.reload_ms }) : t("ingame-queued")}</p>`;
  }
  if (last && last.error) return `<p class="hero-note buff">${esc(tf("ingame-fail", { e: last.error }))}</p>`;
  return (absent.home || []).length + (absent.away || []).length ? `<p class="hero-note">${t("ingame-on")}</p>` : "";
}

// 连胜暗改 (R-16): 规则和进度明着写在「下一场」里, 不再悄悄加
function buffNote() {
  const c = state.career, rule = c.buff_rule;
  if (!rule || !c.streak) return "";
  if (c.streak >= rule.threshold) return `<p class="hero-note buff">${tf("buff-on", { n: c.streak, d: rule.delta })}</p>`;
  return `<p class="hero-note">${tf("buff-soon", { n: c.streak, k: rule.threshold - c.streak, d: rule.delta })}</p>`;
}

function heroResults() {
  const lr = state.last_round;
  if (!lr) {
    return heroInfo(`<div class="hero-kicker">${t("tile-results")}</div><h1 class="hero-title">${t("results")}</h1>
      <p class="hero-note">${t("no-results")}</p>`, true);
  }
  const f = myLastFixture();
  const r = f && f.result;
  const lab = lr.comp ? `${esc(compName(lr.comp))} · ${esc(stageName(lr))}` : tf("round-results", { n: lr.round });
  return heroInfo(`<div class="hero-kicker">${lab}</div>
    <h1 class="hero-title">${r ? `${esc(teamName(f.home))} <span class="n">${r.home_goals}–${r.away_goals}</span> ${esc(teamName(f.away))}` : lab}</h1>
    <div class="hero-actions"><button class="pill" data-act="history">${t("history")}</button></div>`)
    + heroSide(`<div class="hero-panel results scroller">${resultsRows(lr.fixtures)}</div>`);
}

function heroTable() {
  const me = myRow();
  const top = state.table[0], second = state.table[1];
  const gap = me.position === 1 ? tf("lead-by", { n: me.points - (second ? second.points : 0) }) : tf("behind", { n: top.points - me.points });
  const N = 6;   // 预览: 前 6 名, 我不在里面就在后面补我那一行
  const rows = state.table.slice(0, N);
  if (me.position > N) {
    if (me.position > N + 1) rows.push(null);
    rows.push(me);
  }
  return heroInfo(`<div class="hero-kicker">${t("standings")}</div>
    <h1 class="hero-title">${esc(teamName(me.team))} · ${tf("pos-pts", { p: me.position, pts: me.points })}</h1>
    <div class="hero-meta">${gap}</div>
    <div class="hero-actions"><button class="pill" data-act="open-table">${t("open-table")}</button></div>`)
    + heroSide(`<div class="hero-panel scroller">${standingsTable(rows)}</div>`);
}

function heroBoard(field) {
  const goals = field === "goals";
  const rows = goals ? state.scorers : state.assisters;
  const p = rows[0];
  return heroInfo(`<div class="hero-kicker">${t(goals ? "scorers" : "assisters")}</div>
    <h1 class="hero-title">${tf(goals ? "top-scorer" : "top-assister", { n: esc(dispPlayer(p).main), g: p[field] })}</h1>
    <div class="hero-actions"><button class="pill" data-act="${goals ? "open-scorers" : "open-assists"}">${t(goals ? "open-scorers" : "open-assists")}</button></div>`)
    + heroSide(`<div class="board-hero">${podiumHtml(rows, field)}${rows.length > 3 ? `<div class="hero-panel scroller">${scorersTable(rows.slice(3, 8), field, true, 3)}</div>` : ""}</div>`);
}

function heroSquad() {
  const mine = state.career.user_team;
  const rows = state.my_players;
  return heroInfo(`<div class="hero-kicker">${t("my-players")}</div>
    <h1 class="hero-title">${esc(teamName(mine))}</h1>
    <div class="hero-meta">${tf("squad-line", { a: rows.filter((p) => p.apps).length, g: myRow().gf })}</div>
    <div class="hero-actions">
      <button class="pill" data-act="open-squad">${t("open-squad")}</button>
      <button class="pill" data-act="squad">${t("squad-list")}</button>
    </div>`)
    + heroSide(`<div class="hero-panel scroller">${myPlayersTable(rows)}</div>`);
}

// 换栏目: 图块立刻变, 详情和背景等停下来再画 (连着按的时候不一格一格重画)
function selectTile(k) {
  if (k === hubKey) return;
  hubKey = k;
  document.querySelectorAll(".tile").forEach((el) => {
    const on = el.dataset.k === k;
    el.classList.toggle("on", on);
    el.setAttribute("aria-selected", on);
    el.toggleAttribute("data-nav-default", on);
  });
  clearTimeout(selectTile.timer);
  selectTile.timer = setTimeout(showHero, 60);
}
function showHero() {
  selectTile.timer = 0;
  const sec = hubSections().find((x) => x.k === hubKey);
  const hero = $("#hero");
  if (!sec || !hero) return;
  const inside = hero.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  hero.innerHTML = sec.hero();
  const M = motion();
  if (M) {
    const fx = { x: 20, opacity: 0, duration: 0.36, ease: "power3.out", clearProps: "transform,opacity" };
    M.from(hero.children, { ...fx, stagger: 0.06 });
    const info = $(".hero-info", hero);
    if (info) M.from(info.children, { ...fx, stagger: (i) => Math.min(i, 3) * 0.03 });
  }
  enterFx(hero);
  prepHero();
  setBackdrop(sec.bg());
  if (inside) {
    const el = $(inside, hero);
    if (el) UI.focus(el, true);
    else UI.focusDefault(hero);
  }
}
// 换栏目后详情还在等着画时就要离开图块那一排: 先画完 (在图块之间左右走不用, 照样等停下来再画)
function flushHero(dir) {
  if (!selectTile.timer) return;
  if ((dir === "left" || dir === "right") && document.activeElement && document.activeElement.matches(".tile")) return;
  clearTimeout(selectTile.timer);
  showHero();
}
function hubStep(d) {
  const tiles = [...document.querySelectorAll(".tile")];
  if (!tiles.length) return UI.sound("edge");
  const i = tiles.findIndex((x) => x.dataset.k === hubKey);
  const next = tiles[(i + d + tiles.length) % tiles.length];     // 到头绕到另一头 (R-72)
  selectTile(next.dataset.k);
  UI.focus(next);
}
// LT / RT (PgUp / PgDn) 在图块上: 一次翻一屏 (屏幕上露出几个跳几个, 留一个接上); 已经在头 / 尾就绕到另一头 (R-72)
function tilesPage(d) {
  const cur = document.activeElement;
  if (!cur || !cur.matches || !cur.matches(".tile") || !$("#modal").hidden || ovOpen()) return false;
  const tiles = [...document.querySelectorAll(".tile")];
  const box = $(".tiles").getBoundingClientRect();
  const seen = tiles.filter((x) => { const r = x.getBoundingClientRect(); return r.left >= box.left - 2 && r.right <= box.right + 2; }).length;
  const i = tiles.indexOf(cur), last = tiles.length - 1;
  const j = d > 0 ? (i === last ? 0 : Math.min(last, i + Math.max(1, seen - 1))) : (i === 0 ? last : Math.max(0, i - Math.max(1, seen - 1)));
  UI.focus(tiles[j]);
  return true;
}
function tilesEdge(d) {
  const cur = document.activeElement;
  if (!cur || !cur.matches || !cur.matches(".tile") || !$("#modal").hidden || ovOpen()) return false;
  const tiles = [...document.querySelectorAll(".tile")];
  UI.focus(tiles[d > 0 ? tiles.length - 1 : 0]);
  return true;
}

// 全部栏目 (R-72): View 键 / Tab / 顶栏按钮, 主页上叠一层所有图块的网格, 方向键选、确认跳过去、返回关上
const ovOpen = () => { const o = $("#overview"); return !!o && !o.hidden; };
function openOverview() {
  const o = $("#overview");
  const secs = hubSections();
  o.innerHTML = `<div class="ov-box" role="dialog" aria-modal="true" aria-labelledby="ov-title">
    <h2 class="ov-title" id="ov-title">${t("ov-title")} <span class="muted">${esc(t("ov-sub"))}</span></h2>
    <div class="ov-grid" data-nav-group="ov">${secs.map((x) => `<button class="ov-item${x.k === hubKey ? " on" : ""}${x.live ? " live" : ""}" data-ov="${x.k}"${x.k === hubKey ? " data-nav-default" : ""}>
      <span class="tile-face">${x.tile()}${x.badge ? `<span class="tile-badge" aria-label="${esc(tf("todo-n", { n: x.badge }))}">${x.badge}</span>` : ""}</span>
      <span class="ov-cap">${esc(x.cap)}</span></button>`).join("")}</div></div>`;
  o.hidden = false;
  const M = motion();
  if (M) {
    M.from(o, { opacity: 0, duration: 0.18, ease: "power2.out", clearProps: "opacity" });
    M.from($(".ov-box", o), { opacity: 0, scale: 0.95, duration: 0.22, ease: "power3.out", clearProps: "transform,opacity" });
    M.from(o.querySelectorAll(".ov-item"), { y: 14, opacity: 0, duration: 0.3, ease: "power3.out", stagger: 0.018, delay: 0.04, clearProps: "transform,opacity" });
  }
  o.querySelectorAll("[data-ov]").forEach((b) => b.addEventListener("click", () => ovGo(b.dataset.ov)));
  if (UI.mode !== "pointer") UI.focusDefault(o);
  UI.sound("ok");
  renderHints();
}
function closeOverview(back = true) {
  const o = $("#overview");
  if (!o || o.hidden) return;
  o.hidden = true;
  o.innerHTML = "";
  if (back) {
    UI.sound("back");
    const tile = $(".tile.on");
    if (tile && UI.mode !== "pointer") UI.focus(tile, true);
  }
  renderHints();
}
function ovGo(k) {
  closeOverview(false);
  selectTile(k);
  const tile = $(`.tile[data-k="${CSS.escape(k)}"]`);
  if (!tile) return;
  if (UI.mode !== "pointer") UI.focus(tile, true);
  else tile.scrollIntoView({ behavior: UI.reduced ? "auto" : "smooth", block: "nearest", inline: "center" });
}

// 背景: 两层轮流, 新的一层载好再淡入, 旧的淡出
let bdTeam = null, bdSide = 0;
function setBackdrop(tid, instant = false) {
  const layers = $("#app").querySelectorAll(".backdrop .bd");
  if (layers.length < 2 || tid === bdTeam) return;
  bdTeam = tid;
  if (tid == null) {
    layers.forEach((l) => l.classList.remove("on"));
    return;
  }
  bdSide = 1 - bdSide;
  const on = layers[bdSide], off = layers[1 - bdSide];
  const src = img("emblem", tid);
  on.innerHTML = `<img class="glow" src="${src}" alt=""><img class="mark" src="${src}" alt="">`;
  const show = () => {
    if (instant) on.style.transition = "none";
    on.classList.add("on");
    off.classList.remove("on");
    if (instant) requestAnimationFrame(() => (on.style.transition = ""));
  };
  const im = on.querySelector("img");
  if (im.complete) show();
  else im.onload = im.onerror = show;
}

function tickClock() {
  const now = new Date().toLocaleTimeString(NAME_LANGS[lang].locale, { hour: "2-digit", minute: "2-digit" });
  document.querySelectorAll(".clock").forEach((el) => (el.textContent = now));
}
setInterval(tickClock, 15000);

function resultsRows(fixtures) {
  const mine = state.career.user_team;
  return fixtures.map((f) => {
    const r = f.result;
    const isMine = f.home === mine || f.away === mine;
    return `<div class="row ${isMine ? "mine" : ""}" tabindex="0" role="button" data-fixture="${f.id}">
      <div class="h">${esc(teamName(f.home))} ${emblem(f.home)}</div>
      <div class="s">${r ? `${r.home_goals} - ${r.away_goals}` : "-"}</div>
      <div class="a">${emblem(f.away)} ${esc(teamName(f.away))}${r && r.source !== "sim" ? `<span class="tag">${sourceTag(r.source)}</span>` : ""}</div>
    </div>`;
  }).join("");
}

function myPlayersTable(rows) {
  const mine = state.career.user_team;
  return `<table>
    <tr><th></th><th>${t("th-player")}</th><th>${t("th-pos")}</th><th>${t("th-fit")}</th><th class="num">${t("th-apps")}</th><th class="num">${t("th-goals")}</th><th class="num">${t("th-assists")}</th><th class="num">${t("th-rating")}</th><th class="num">${t("th-fouls")}</th><th class="num">${t("th-cards")}</th></tr>
    ${rows.map((p) => `<tr><td>${face(p.pid, mine)}</td><td>${esc(dispPlayer(p).main)}</td><td>${esc(p.position)}</td>
      <td class="fit">${fitCell(p.fit)}</td><td class="num">${p.apps}</td><td class="num">${p.goals}</td><td class="num">${p.assists || 0}</td><td class="num">${ratingBadge(p.avg_rating)}</td><td class="num">${p.fouls || ""}</td><td class="num">${cardsBadge(p)}</td></tr>`).join("")}
  </table>`;
}

// rows 里的 null = 中间省掉了几名 (主页预览: 前几名 + 我的那一行)。
// focusMine: 完整页面里手柄一进来就停在我的那一行
function standingsTable(rows, focusMine = false) {
  const mine = state.career.user_team;
  return `<table>
    <tr><th class="pos">#</th><th>${t("th-team")}</th><th class="num">${t("th-p")}</th><th class="num">${t("th-w")}</th><th class="num">${t("th-d")}</th><th class="num">${t("th-l")}</th>
      <th class="num">${t("th-gf")}</th><th class="num">${t("th-ga")}</th><th class="num">${t("th-gd")}</th><th class="num">${t("th-pts")}</th><th>${t("th-form")}</th></tr>
    ${rows.map((r) => (r ? `<tr class="click ${r.team === mine ? "mine" : ""}" tabindex="0" data-team="${r.team}"${focusMine && r.team === mine ? " data-nav-default" : ""}>
      <td class="pos">${r.position}</td><td><div class="teamcell">${emblem(r.team)}<span role="link">${esc(teamName(r.team))}</span>${moveHtml(r.move)}${fxTags(r.team)}</div></td>
      <td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.drawn}</td><td class="num">${r.lost}</td>
      <td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td>
      <td class="num"><b>${r.points}</b></td><td>${formHtml(r.form || [])}</td>
    </tr>` : `<tr class="gap"><td colspan="11">⋯</td></tr>`)).join("")}
  </table>`;
}

// 射手榜 / 助攻榜共用: field 是加粗的那一列, 另一项淡一点跟在后面。
// compact: 窄栏里球队并进球员那一格当第二行, 省一列。from: 第一行是第几名减一 (领奖台下面接着列时用)
function scorersTable(rows, field = "goals", compact = false, from = 0) {
  const other = field === "goals" ? "assists" : "goals";
  const head = (k) => t(k === "goals" ? "th-goals" : "th-assists");
  const mine = state.career.user_team;
  const who = (p) => compact
    ? `<td><div>${esc(dispPlayer(p).main)}</div><div class="teamline">${emblem(p.team, "sm")}${esc(teamName(p.team))}</div></td>`
    : `<td>${esc(dispPlayer(p).main)}</td><td><div class="teamcell">${emblem(p.team)}${esc(teamName(p.team))}</div></td>`;
  return `<table${compact ? ' class="compact"' : ""}>
    <tr><th class="pos">#</th><th></th><th>${t("th-player")}</th>${compact ? "" : `<th>${t("th-team")}</th>`}<th class="num">${head(field)}</th><th class="num">${head(other)}</th></tr>
    ${rows.map((p, i) => `<tr${p.team === mine ? ' class="mine"' : ""}><td class="pos">${from + i + 1}</td><td>${face(p.pid, p.team)}</td>${who(p)}
      <td class="num"><b>${p[field] || 0}</b></td><td class="num muted">${p[other] || ""}</td></tr>`).join("")}
  </table>`;
}

// 榜单 / 领奖台上的一张卡。卡面按球员挑 (/img/pcard/: 他本人的卡, 基础卡就挑同一个人的 Big Time 等, 见 GameData.display_card),
// 没有素材是头像卡。你的人换了卡 (R-34) 就直接按那张卡取: 地址和分层缓存都跟着变, 不会还是浏览器缓存的旧卡
function boardCard(p, opts) {
  const card = (state.career && state.career.cards && state.career.cards[p.pid]) || p.pid;
  return gameCard({ pid: p.pid, card, name: p.name, roman: p.roman, team: p.team, still: img("pcard", card) }, opts);
}

// 领奖台 (R-19): 榜单前三名用游戏球员卡站成 2-1-3, 第一名大一号, 三张都在动。
function podiumHtml(rows, field) {
  const other = field === "goals" ? "assists" : "goals";
  const unit = (k) => t(k === "goals" ? "unit-goals" : "unit-assists");
  const mine = state.career.user_team;
  const top = rows.slice(0, 3).map((p, i) => ({ p, i }));
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return `<div class="podium">${order.map(({ p, i }) => `
    <figure class="pod r${i + 1}${p.team === mine ? " mine" : ""}">
      ${boardCard(p, { live: "always" })}
      <figcaption>
        <div class="pod-line"><span class="pod-rank">${i + 1}</span><b class="pod-num">${p[field] || 0}</b><span class="pod-unit">${unit(field)}</span>${p[other] ? `<span class="pod-other">${p[other]} ${unit(other)}</span>` : ""}</div>
        <div class="pod-name">${esc(dispPlayer(p).main)}</div>
        <div class="pod-team">${emblem(p.team, "sm")}<span>${esc(teamName(p.team))}</span></div>
      </figcaption>
    </figure>`).join("")}</div>`;
}

// ------------------------------------------------------------ 完整页面 (一屏一页, R-20)
function openStandings(nav = "push") {
  openSeq++;
  delete $("#modal").dataset.player;
  const me = myRow(), top = state.table[0];
  const meta = `${esc(teamName(top.team))} ${tf("pos-pts", { p: 1, pts: top.points })}${me.team === top.team ? "" : ` · ${esc(teamName(me.team))} ${tf("pos-pts", { p: me.position, pts: me.points })}`}`;
  openModal(glowHtml(top.team) + pageHead(t("standings"), leagueKicker(), meta) + pageBody(fillPanel(standingsTable(state.table, true))), true,
    { label: () => t("standings"), reopen: (n) => openStandings(n), after: centerMine }, nav);
}

// 射手榜、助攻榜是一页的两个标签: 左边领奖台, 右边整张表 (在自己的面板里滚)
function openBoard(field, nav = "push") {
  openSeq++;
  delete $("#modal").dataset.player;
  const boards = [["goals", "scorers", state.scorers || []], ["assists", "assisters", state.assisters || []]]
    .filter(([k, , rows]) => rows.length || k === field);
  const tabs = boards.map(([k, title, rows]) => ({ k, label: t(title),
    html: () => (rows.length ? `<div class="cols board-cols" data-nav-sides><section class="podium-stage">${podiumHtml(rows, k)}</section>${fillPanel(scorersTable(rows, k))}</div>`
      : `<section class="panel"><div class="empty">${t("no-data")}</div></section>`),
    after: (pane) => { if (rows[0]) swapGlow($("#modal-body"), rows[0].team); } }));
  const lead = (field === "goals" ? state.scorers : state.assisters || [])[0];
  openModal(glowHtml(lead && lead.team) + pageHead(t("boards"), leagueKicker()), true,
    { label: () => t("boards"), reopen: (n) => openBoard(field, n), tabs, ui: { tab: field } }, nav);
}

function openSquad(nav = "push") {
  openSeq++;
  delete $("#modal").dataset.player;
  const mine = state.career.user_team;
  openModal(glowHtml(mine) + pageHead(t("my-players"), esc(teamName(mine)), tf("squad-line", { a: state.my_players.filter((p) => p.apps).length, g: myRow().gf }))
    + pageBody(fillPanel(myPlayersTable(state.my_players))), false,
    { label: () => t("my-players"), reopen: (n) => openSquad(n) }, nav);
}

// 历史对局: 左边踢过的轮次 (最近的在上), 右边那一轮的赛果。以前整页一轮一块往下排, 看第一轮要翻到底
async function openHistory(nav = "push") {
  const seq = ++openSeq;
  let h;
  try {
    h = await api("/api/history");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const rounds = h.rounds;
  const label = (r) => (r.comp ? `${esc(compName(r.comp))} · ${esc(stageName(r))}` : tf("round-tag", { n: r.round }));
  const items = rounds.map((r) => ({ label: label(r), sub: r.date ? esc(fmtDate(r.date)) : "", badge: myResultBadge(r.fixtures) }));
  const view = { label: () => t("history"), reopen: (n) => openHistory(n), ui: {},
    after: (root, restored) => bindMd(root, view.ui, "round", rounds.length, (i) => `<h2 class="panel-head">${label(rounds[i])}${rounds[i].date ? ` <span class="muted">${esc(fmtDate(rounds[i].date))}</span>` : ""}</h2>
      ${scroller(`<div class="results">${resultsRows(rounds[i].fixtures)}</div>`)}`, restored) };
  openModal(glowHtml(state.career.user_team) + pageHead(t("history"), leagueKicker())
    + pageBody(rounds.length ? mdHtml(items, 0) : `<section class="panel"><div class="empty">${t("no-history")}</div></section>`), true, view, nav);
}

// 往季: 一个赛季一个标签 (最近的在前), 左边最终积分榜, 右边射手 / 助攻前五
async function openSeasons(nav = "push") {
  const seq = ++openSeq;
  let s;
  try {
    s = await api("/api/seasons");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const list = [...s.seasons].reverse();
  const pane = (x) => `<div class="season-head">${emblem(x.champion, "md")}
      <div><div class="st">${x.league ? `${esc(leagueName(x.league))} · ` : ""}${tf("season", { n: x.season })} · ${t("champion")}${esc(teamName(x.champion))}</div>
        ${x.user_position ? `<div class="muted">${x.user_team != null && x.user_team !== state.career.user_team ? `${emblem(x.user_team, "sm")} ${esc(teamName(x.user_team))} · ` : ""}${tf("my-finish", { n: x.user_position })}</div>` : ""}</div></div>
    <div class="cols season-cols" data-nav-sides>
      ${fillPanel(standingsTable(x.table), `<h2 class="panel-head">${t("final-table")}</h2>`)}
      ${fillPanel(`${x.scorers.length ? `<h2 class="panel-head">${t("scorers")} <span class="muted">${t("top-5")}</span></h2>${scorersTable(x.scorers.slice(0, 5))}` : ""}
        ${(x.assisters || []).length ? `<h2 class="panel-head">${t("assisters")} <span class="muted">${t("top-5")}</span></h2>${scorersTable(x.assisters.slice(0, 5), "assists")}` : ""}
        ${seasonHonorsHtml(x.honors)}
        ${x.board ? `<h2 class="panel-head sub-head">${tf("sl-board", { p: x.board.position, t: x.board.target })} <span class="muted">${t(x.board.met ? "nw-verdict-met" : "nw-verdict-miss")} · ${t("bd-conf")} ${Math.round(x.board.conf)}</span></h2>` : ""}
        ${seasonGrowthHtml(x.growth)}${seasonLifeHtml(x.life)}`)}
    </div>`;
  const tabs = list.map((x) => ({ k: String(x.season), label: tf("season", { n: x.season }), html: () => pane(x),
    after: () => swapGlow($("#modal-body"), x.champion) }));
  openModal(glowHtml(list.length ? list[0].champion : state.career.user_team) + pageHead(t("seasons"), isWorld() ? "" : esc(state.career.league_name))
    + (list.length ? "" : pageBody(`<section class="panel"><div class="empty">${t("no-seasons")}</div></section>`)), true,
  { label: () => t("seasons"), reopen: (n) => openSeasons(n), tabs: list.length ? tabs : null }, nav);
}

// ------------------------------------------------------------ 真实日历生涯 (R-18) 的页面: 赛历、欧冠、杯赛、各国联赛、国家队
const monthTitle = (k) => new Date(k + "-15T12:00:00").toLocaleDateString(NAME_LANGS[lang].locale, { year: "numeric", month: "long" });
const dateRange = (a, b) => (b && b !== a ? `${fmtDate(a, false)} – ${fmtDate(b, false)}` : fmtDate(a));

function eventLabel(e) {
  if (e.kind === "intl") return `${t("ev-intl")}${e.comps && e.comps.length ? ` · ${e.comps.map((x) => intlName(x, true)).join("、")}` : ""}`;
  if (e.kind === "tournament") return tf("ev-tournament", { y: e.year, c: t("comp-" + e.comp) });
  return tf("ev-" + e.kind, { c: compName(e.comp) });
}

// 赛历: 一个月一个标签 (一进来停在今天所在的月), 这个月的每一场和国家队比赛日在一块面板里
async function openCalendar(nav = "push") {
  const seq = ++openSeq;
  let cal;
  try {
    cal = await api("/api/world/calendar");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const mine = state.career.user_team;
  const items = cal.fixtures.map((f) => ({ date: f.date, f })).concat(cal.events.map((e) => ({ date: e.date, e })));
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.e ? -1 : 1));
  const months = new Map();
  for (const it of items) {
    const k = it.date.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(it);
  }
  const row = (it) => {
    if (it.e) {
      const e = it.e;
      return `<div class="cal-row ev ${e.kind}"><span class="cal-d">${esc(dateRange(e.date, e.end))}</span><span class="cal-c">${esc(eventLabel(e))}</span></div>`;
    }
    const f = it.f, home = f.home === mine, opp = home ? f.away : f.home, r = f.result;
    let res = "";
    if (r) {
      const my = home ? r.home_goals : r.away_goals, op = home ? r.away_goals : r.home_goals;
      res = `<span class="cal-s">${my}–${op}</span>${formHtml([my > op ? "W" : my < op ? "L" : "D"])}`;
    }
    const where = f.neutral ? t("neutral") : t(home ? "home-side" : "away-side");
    const today = !r && f.date === cal.today;
    return `<div class="cal-row fx${today ? " today" : ""}" tabindex="0" role="button" data-fixture="${esc(f.id)}"${today ? " data-nav-default" : ""}>
      <span class="cal-d">${esc(fmtDate(f.date))}</span><span class="cal-c">${esc(fxLabel(f))}</span>
      <span class="cal-m">${emblem(opp)}<span>${esc(teamName(opp))}</span><span class="muted">${esc(where)}</span></span>
      <span class="cal-r">${res}</span></div>`;
  };
  const keys = [...months.keys()];
  const now = (cal.today || "").slice(0, 7);
  const next = items.find((it) => it.f && !it.f.result);
  const def = keys.includes(now) ? now : next ? next.date.slice(0, 7) : keys[0];
  const monthShort = (k) => new Date(k + "-15T12:00:00").toLocaleDateString(NAME_LANGS[lang].locale, { month: "short" });
  const tabs = keys.map((k) => ({ k, label: esc(monthShort(k)),
    html: () => fillPanel(`<div class="cal">${months.get(k).map(row).join("")}</div>`, `<h2 class="panel-head">${esc(monthTitle(k))}</h2>`),
    after: (pane, restored) => { if (!restored) centerIn(pane.querySelector(".cal-row.today")); } }));
  openModal(glowHtml(mine) + pageHead(t("calendar"), leagueKicker(), t("calendar-sub")) + (keys.length ? "" : pageBody(`<section class="panel"><div class="empty">${t("no-data")}</div></section>`)), true,
    { label: () => t("calendar"), reopen: (n) => openCalendar(n), tabs: keys.length ? tabs : null, ui: { tab: def } }, nav);
}

// 一对淘汰赛: 每一回合一行 (点进战报), 下面一行总比分 / 谁晋级 / 怎么定的
function tieBlock(tie) {
  const bits = [];
  if (tie.legs.length > 1 && tie.agg) bits.push(`${esc(teamName(tie.a))} ${tie.agg[0]}–${tie.agg[1]} ${esc(teamName(tie.b))}`);
  if (tie.winner) bits.push(tf("through", { t: esc(teamName(tie.winner)) }));
  if (tie.decided_by === "seed") bits.push(t("by-seed"));
  if (tie.pending) bits.push(t("decide-title"));
  return `<div class="tie"><div class="results">${resultsRows(tie.legs)}</div>${bits.length ? `<div class="tie-sum">${bits.join(" · ")}</div>` : ""}</div>`;
}

function uclTable(rows, focusMine = false) {
  const mine = state.career.user_team;
  return `<table class="ucl-table">
    <tr><th class="pos">#</th><th>${t("th-team")}</th><th class="num">${t("th-p")}</th><th class="num">${t("th-w")}</th><th class="num">${t("th-d")}</th><th class="num">${t("th-l")}</th>
      <th class="num">${t("th-gf")}</th><th class="num">${t("th-ga")}</th><th class="num">${t("th-gd")}</th><th class="num">${t("th-pts")}</th></tr>
    ${rows.map((r) => `<tr class="click z-${r.zone}${r.team === mine ? " mine" : ""}" tabindex="0" data-team="${r.team}"${focusMine && r.team === mine ? " data-nav-default" : ""}>
      <td class="pos"><span class="zone-dot"></span>${r.position}</td><td><div class="teamcell">${emblem(r.team)}<span role="link">${esc(teamName(r.team))}</span></div></td>
      <td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.drawn}</td><td class="num">${r.lost}</td>
      <td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td><td class="num"><b>${r.points}</b></td></tr>`).join("")}
  </table>`;
}

// 冠军横幅 (欧冠、杯赛踢完了): 标签页顶上一条
const winnerBanner = (tid, text) => `<section class="panel winner"><div class="hero-champ">${emblem(tid, "md")}<h2 class="st">${esc(text)}</h2></div></section>`;

// 淘汰赛那一页: 左边各轮 (最近的在上), 右边这一轮的每一对。我在里面踢的那一轮带个粉点
function koPane(rounds, winner) {
  const mine = state.career.user_team;
  return (winner ? winnerBanner(winner.tid, winner.text) : "")
    + mdHtml(rounds.map((r) => ({ label: esc(t("st-" + r.key)), sub: r.date ? esc(fmtDate(r.date, false)) : r.after != null ? esc(tf("cup-after", { n: r.after })) : "",
      badge: (r.ties || []).some((x) => x.legs.some((f) => f.home === mine || f.away === mine)) ? `<span class="md-dot" aria-label="${esc(teamName(mine))}"></span>` : "" })), 0);
}
function koRound(r) {
  const mine = state.career.user_team;
  const when = r.date ? fmtDate(r.date, false) : r.after != null ? tf("cup-after", { n: r.after }) : "";
  const head = `<h2 class="panel-head">${esc(t("st-" + r.key))}${when ? ` <span class="muted">${esc(when)}</span>` : ""}</h2>`;
  if (r.drawn === false) return head + `<div class="empty">${esc(tf("cup-undrawn", { d: r.date ? fmtDate(r.date) : when }))}</div>`;
  if (r.skipped) return head + `<div class="empty">${t(r.direct ? "cup-direct" : "cup-skipped")}</div>`;
  return head + scroller((r.ties || []).map(tieBlock).join("")
    + (r.byes && r.byes.length ? `<div class="muted cup-byes">${esc(tf("cup-byes", { n: r.byes.length }))}${r.byes.includes(mine) ? ` · ${esc(teamName(mine))}` : ""}</div>` : ""));
}

// 欧冠 / 欧联 (R-50): 「联赛阶段」(36 队总表 + 我的 8 场并排) 和「淘汰赛」两个标签
function europeanCompetitionNav(selected) {
  return `<nav class="fl-europe-nav" aria-label="Competizioni europee">${EURO.map((cid) => `<button class="pill${selected === cid ? " primary" : ""}" data-act="open-ucl" data-comp="${cid}" aria-current="${selected === cid ? "page" : "false"}">${esc(compName(cid))}</button>`).join("")}</nav>`;
}
async function openEuro(cid = "UCL", nav = "push") {
  const seq = ++openSeq;
  let u;
  try {
    u = await api("/api/world/comp/" + cid);
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const k = euroKey(cid);
  const mine = state.career.user_team;
  const inIt = u.table.some((r) => r.team === mine);
  const chips = (head, tags) => `<h2 class="panel-head sub-head">${head}</h2><div class="chips">${tags.join("")}</div>`;
  const teamTag = (x) => `<span class="tag">${esc(teamName(x))}</span>`;
  const replaced = u.replaced && u.replaced.length ? chips(t("ucl-replaced"), u.replaced.map((x) =>
    `<span class="tag">${esc(x.name)} → ${esc(teamName(x.by))}</span>`)) : "";
  const fromUcl = u.from_ucl && u.from_ucl.length ? chips(t("uel-from-ucl"), u.from_ucl.map(teamTag)) : "";
  const view = { label: () => t(k + "-title"), reopen: (n) => openEuro(cid, n), tabs: [], ui: {} };
  if (u.table.length) {
    view.tabs.push({ k: "league", label: t("ucl-league"), after: centerMine, html: () => `<div class="cols ucl-cols" data-nav-sides>
      ${fillPanel(uclTable(u.table, inIt))}
      ${fillPanel((u.mine.length ? `<div class="results">${resultsRows(u.mine)}</div>` : `<div class="empty">${t(k + "-not-in")}</div>`) + replaced + fromUcl,
        `<h2 class="panel-head">${t("tab-my-games")}</h2>`)}</div>` });
  }
  const rounds = [...u.rounds].reverse();
  if (rounds.length || u.winner) {
    view.tabs.push({ k: "ko", label: t("ucl-ko"), html: () => koPane(rounds, u.winner ? { tid: u.winner, text: tf(k + "-winner", { t: teamName(u.winner) }) } : null),
      after: (pane, restored) => bindMd(pane, view.ui, "round", rounds.length, (i) => koRound(rounds[i]), restored) });
  }
  const stage = (state.career.comps.find((x) => x.comp === cid) || {}).stage;
  view.ui.tab = rounds.length && stage && stage !== "league" ? "ko" : view.tabs.length ? view.tabs[0].k : null;
  // 欧联还在等欧冠附加赛 (8 月): 列出已经确定的队
  const waiting = u.direct && u.direct.length ? chips(esc(tf("uel-waiting", { n: u.direct.length })), u.direct.map(teamTag)) : "";
  const empty = view.tabs.length ? "" : pageBody(`<section class="panel">${waiting || `<div class="empty">${t(k + "-not-in")}</div>`}</section>`);
  if (!view.tabs.length) view.tabs = null;
  openModal(glowHtml(u.winner || (u.table[0] && u.table[0].team) || mine) + pageHead(t(k + "-title"), esc(state.career.season_label), t(k + "-sub")) + europeanCompetitionNav(cid) + empty, true, view, nav);
}

// 杯赛: 一个杯一个标签 (点哪个杯进来就停在哪个), 每个杯里左边各轮、右边这一轮的对阵
async function openCups(cid, nav = "push") {
  const seq = ++openSeq;
  let list;
  try {
    list = (await api("/api/world/comps")).comps.filter((x) => x.comp[0] !== "L" && !EURO.includes(x.comp));
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  if (!list.length) return toast(t("no-data"));
  delete $("#modal").dataset.player;
  const mine = state.career.user_team;
  const got = new Map();
  const view = { competitionTabs: true, label: () => t("cups-title"), reopen: (n) => openCups(view.ui.tab, n), ui: { tab: cid || list[0].comp } };
  view.tabs = list.map((x) => ({ k: x.comp, label: esc(compName(x.comp)),
    html: async () => {
      if (!got.has(x.comp)) got.set(x.comp, await api("/api/world/comp/" + encodeURIComponent(x.comp)));
      const cup = got.get(x.comp);
      return koPane([...cup.rounds].reverse(), cup.winner ? { tid: cup.winner, text: tf("cup-winner", { t: teamName(cup.winner) }) } : null);
    },
    after: (pane, restored) => {
      const cup = got.get(x.comp);
      const rounds = [...cup.rounds].reverse();
      const live = rounds.findIndex((r) => r.drawn && !r.skipped);   // 默认停在最近抽过签的那一轮
      bindMd(pane, view.ui, "round-" + x.comp, rounds.length, (i) => koRound(rounds[i]), restored, Math.max(0, live));
      swapGlow($("#modal-body"), cup.winner || mine);
    } }));
  openModal(glowHtml(mine) + pageHead(t("cups-title"), esc(seasonTag()), cupsSub()) + europeanCompetitionNav(), true, view, nav);
}

// 各国联赛: 15 个联赛各一个标签, 左边积分榜, 右边上一轮赛果和下一轮对阵
function openLeagues(cid, nav = "push") {
  openSeq++;
  delete $("#modal").dataset.player;
  const got = new Map();
  const view = { competitionTabs: true, label: () => leaguesTitle(), reopen: (n) => openLeagues(view.ui.tab, n),
    ui: { tab: String(cid ?? (isWorld() ? state.career.league : state.career.div ?? 0)) } };
  view.tabs = Object.keys(state.world.leagues).map((x) => ({ k: String(x), label: esc(leagueName(x)),
    html: async () => {
      if (!got.has(x)) got.set(x, await api("/api/world/comp/L" + x));
      const v = got.get(x);
      const side = (v.last ? `<h2 class="panel-head">${tf("round-results", { n: v.last.round })}</h2><div class="results">${resultsRows(v.last.fixtures)}</div>` : "")
        + (v.next ? `<h2 class="panel-head sub-head">${tf("round-tag", { n: v.next.round })}${v.next.fixtures[0] && v.next.fixtures[0].date ? ` <span class="muted">${esc(fmtDate(v.next.fixtures[0].date))}</span>` : ""}</h2><div class="results">${resultsRows(v.next.fixtures)}</div>` : "");
      return `<div class="cols league-cols" data-nav-sides>${fillPanel(standingsTable(v.table, true))}${side ? fillPanel(side) : ""}</div>`;
    },
    after: (pane, restored) => {
      const v = got.get(x);
      if (v && v.table[0]) swapGlow($("#modal-body"), v.table[0].team);
      centerMine(pane, restored);
    } }));
  openModal(glowHtml(state.career.user_team) + pageHead(leaguesTitle(), esc(seasonTag())), true, view, nav);
}

// 国家队大赛: 「接下来」一个标签, 办过的每一届一个标签 (左边小组积分, 右边淘汰赛)
// 国家队 (R-71): 日程 (这季每个国际比赛日在踢什么 + 接下来的大赛) | 每项赛事一页 (积分榜、淘汰赛、谁出线) | 踢完的大赛
function intlGroupName(kind, g) {
  if (/^[A-D]\d$/.test(g) && (kind === "nl" || kind === "swissq")) return tf("ng-tier", { t: g[0], n: g.slice(1) });
  if (/^\d+$/.test(g)) return tf("ng-num", { n: g });
  if (g === "L") return t("nst-L");
  return tf("ng-letter", { g });
}
function intlTableHtml(rows, nm) {
  return `<table class="compact"><tr><th class="pos">#</th><th>${t("th-team")}</th><th class="num">${t("th-p")}</th><th class="num">${t("th-gd")}</th><th class="num">${t("th-pts")}</th></tr>${rows.map((x) =>
    `<tr><td class="pos">${x.position}</td><td><div class="teamcell">${emblem(x.team)}${esc(nm(x.team))}</div></td><td class="num">${x.played}</td>
      <td class="num">${x.gd > 0 ? "+" : ""}${x.gd}</td><td class="num"><b>${x.points}</b></td></tr>`).join("")}</table>`;
}
function intlTieHtml(tie, nm) {
  const legs = tie.legs || [];
  const played = legs.length && legs.every((l) => l.hg != null);
  const last = legs[legs.length - 1] || {};
  let agg = null;
  if (legs.length > 1 && played) {
    const goals = (l, side) => (l.home === side ? l.hg : l.ag) + (l.et ? (l.home === side ? l.et[0] : l.et[1]) : 0);
    agg = tf("nat-agg", { a: legs.reduce((s, l) => s + goals(l, tie.a), 0), b: legs.reduce((s, l) => s + goals(l, tie.b), 0) });
  }
  const extra = [agg, last.et ? tf("et", { a: last.et[0], b: last.et[1] }) : null, last.pens ? tf("pens", { a: last.pens[0], b: last.pens[1] }) : null]
    .filter(Boolean).join(" · ");
  const side = (tid, cls) => `<div class="${cls}${tie.winner === tid ? " won" : ""}">${cls === "h" ? `${esc(nm(tid))} ${emblem(tid)}` : `${emblem(tid)} ${esc(nm(tid))}`}</div>`;
  const mid = played ? esc(legs.map((l) => `${l.hg}-${l.ag}`).join(", ")) : `<span class="muted">${esc(legs[0] ? fmtDate(legs[0].date, false) : "")}</span>`;
  const open = played && last.id ? ` tabindex="0" role="button" data-fixture="${esc(last.id)}"` : "";
  return `<div class="row"${open}>${side(tie.a, "h")}<div class="s">${mid}</div>${side(tie.b, "a")}</div>${extra ? `<div class="tie-sum">${esc(extra)}</div>` : ""}`;
}
function intlOutHtml(x, nm) {
  const o = x.out || {};
  const chips = (ids) => `<div class="chips nat-out">${ids.map((tid) => `<span class="skill">${emblem(tid, "sm")} ${esc(nm(tid))}</span>`).join("")}</div>`;
  let h = "";
  if (o.winner != null) h += `<h2 class="panel-head sub-head">${esc(tf("nat-champ", { w: nm(o.winner) }))}</h2>`;
  if (o.qualified && o.qualified.length) h += `<h2 class="panel-head sub-head">${t("nat-qualified")} <span class="muted">${o.qualified.length}</span></h2>${chips(o.qualified)}`;
  if (o.playoff != null) h += `<h2 class="panel-head sub-head">${t("nat-playoff")}</h2>${chips([o.playoff])}`;
  return h;
}
function intlCompHtml(x, nm) {
  const head = `<h2 class="panel-head">${esc(intlName(x.id))}</h2>`;
  if (x.status === "skipped") return fillPanel(`<p class="world-sub">${t("nat-skipped")}</p>${intlOutHtml(x, nm)}`, head);
  const groups = x.stages.filter((st) => st.type === "groups");
  const kos = x.stages.filter((st) => st.type === "ko");
  const left = groups.length ? groups.map((st) => `<h2 class="panel-head sub-head">${t("nst-" + st.key)} <span class="muted">${esc(tf("nat-progress", { a: st.played, b: st.total }))}${st.next ? ` · ${esc(tf("nat-next", { d: fmtDate(st.next, false) }))}` : ""}</span></h2>
    <div class="nat-groups">${Object.entries(st.tables).map(([g, rows]) => `<div class="nat-group"><h3>${esc(intlGroupName(x.kind, g))}</h3>${intlTableHtml(rows, nm)}</div>`).join("")}</div>`).join("")
    : `<div class="empty">${t("nat-tbd")}</div>`;
  const right = kos.map((st) => `<h2 class="panel-head sub-head">${t("nst-" + st.key)}</h2><div class="results">${st.ties.map((tie) => intlTieHtml(tie, nm)).join("")}</div>`).join("")
    + intlOutHtml(x, nm);
  if (!groups.length) return fillPanel(right || `<div class="empty">${t("nat-tbd")}</div>`, head);   // 只有淘汰赛 (洲际附加赛、大洋洲): 一块
  return `<div class="cols nat-cols" data-nav-sides>${fillPanel(left, head)}
    ${fillPanel(right || `<div class="empty">${t("nat-tbd")}</div>`, `<h2 class="panel-head">${t("ucl-ko")}</h2>`)}</div>`;
}
async function openNational(nav = "push") {
  const seq = ++openSeq;
  let v;
  try {
    v = await api("/api/world/national");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const nm = (tid) => { const n = v.names[String(tid)]; return n ? (lang === "zh" ? n.zh : n.latin) || String(tid) : teamName(tid); };
  const sched = (v.windows || []).map((w) =>
    `<div class="cal-row ev intl"><span class="cal-d">${esc(dateRange(w.date, w.end))}</span><span class="cal-c">${w.comps.map((cid) => esc(intlName(cid))).join("、") || esc(t("nat-quiet"))}</span><span class="cal-m muted">${esc(t("nat-window"))}</span><span class="cal-r"></span></div>`).join("");
  const tabs = [{ k: "up", label: t("nat-sched"), html: () => fillPanel(`<div class="cal">${sched}${v.upcoming.map((x) =>
    `<div class="cal-row ev tournament"><span class="cal-d">${esc(dateRange(x.date, x.end))}</span><span class="cal-c">${esc(tf("ev-tournament", { y: x.year, c: t("comp-" + x.kind) }))}</span><span class="cal-m muted">${esc(tf("nat-after", { s: x.after_season }))}</span></div>`).join("")}</div>`
    + (v.done.length || (v.comps || []).length ? "" : `<div class="empty">${t("nat-none")}</div>`)) }];
  (v.comps || []).forEach((x) => tabs.push({ k: x.id, label: esc(x.kind === "final" ? intlName(x.id) : intlName(x.id, true)), html: () => intlCompHtml(x, nm) }));
  v.done.forEach((r, i) => {
    const groups = Object.entries(r.tables).map(([g, rows]) => `<div class="nat-group"><h3>${esc(g)}</h3><table class="compact">${rows.map((x) =>
      `<tr><td class="pos">${x.position}</td><td><div class="teamcell">${emblem(x.team)}${esc(nm(x.team))}</div></td><td class="num">${x.points}</td><td class="num">${x.gd > 0 ? "+" : ""}${x.gd}</td></tr>`).join("")}</table></div>`).join("");
    const ko = r.knockout.map((m) => `<div class="row"><div class="h">${esc(nm(m.home))} ${emblem(m.home)}</div><div class="s">${m.hg} - ${m.ag}</div>
      <div class="a">${emblem(m.away)} ${esc(nm(m.away))} <span class="muted">${esc(t("st-" + m.stage))}${m.et ? ` · ${esc(tf("et", { a: m.et[0], b: m.et[1] }))}` : ""}${m.pens ? ` · ${esc(tf("pens", { a: m.pens[0], b: m.pens[1] }))}` : ""}</span></div></div>`).join("");
    const title = tf("ev-tournament", { y: r.year, c: t("comp-" + r.kind) });
    tabs.push({ k: "d" + i, label: esc(title), html: () => `<div class="cols nat-cols" data-nav-sides>
      ${fillPanel(`<div class="nat-groups">${groups}</div>`, `<h2 class="panel-head">${esc(title)} <span class="muted">${esc(tf("nat-winner", { w: nm(r.winner), r: nm(r.runner_up) }))}</span></h2>`)}
      ${fillPanel(`<div class="results nat-ko">${ko}</div>`, `<h2 class="panel-head">${t("ucl-ko")}</h2>`)}</div>` });
  });
  // 一打开停在正在踢的那项 (下一场最早的); 没有就停在日程
  const live = (v.comps || []).filter((x) => x.status === "active")
    .map((x) => ({ id: x.id, next: x.stages.map((st) => st.next).filter(Boolean).sort()[0] || "9999" }))
    .sort((a, b) => (a.next < b.next ? -1 : 1))[0];
  openModal(glowHtml(state.career.user_team) + pageHead(t("national-title"), "", t("national-sub")), true,
    { label: () => t("national-title"), reopen: (n) => openNational(n), tabs, ui: { tab: live ? live.id : "up" } }, nav);
}

// ------------------------------------------------------------ 开球 (R-17): 地球仪运镜 + 对阵亮相, 然后切进游戏
// 远处的地球转过来, 镜头推进锁定主队所在国; 两队不在一国就拉一条航线飞到客队那边; 对阵亮相, 最后冲进去切到 eFootball。
// 游戏里的比赛还得自己开 (插件动不了游戏菜单), 所以对阵下面写明开哪两队。
// ✕ / A / 回车随时直接进游戏, ○ / B / Esc 取消。减少动效: 不运镜, 直接停在终点画面。
const globeColors = () => {
  const css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  return { land: color("--globe-land"), ocean: color("--globe-ocean"), oceanHi: color("--globe-ocean-hi"),
    atmo: color("--globe-atmo"), accent: color("--accent"), space: color("--globe-space") };
};
const geoName = (g) => (lang === "zh" ? g.zh : g.country);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let kick = null;   // 正在放的开球: { globe, places, pins, skipped, going, closed, focus }

// 两队按所在国分组: 同一国就一个落点, 上面并排两个队徽
function kickPlaces(f) {
  const places = [];
  for (const tid of [f.home, f.away]) {
    const g = state.teams[tid] && state.teams[tid].geo;
    if (!g) continue;
    const hit = places.find((p) => p.geo.country === g.country);
    if (hit) hit.teams.push(tid);
    else places.push({ geo: g, teams: [tid] });
  }
  return places;
}

function kickoffHtml(f, places) {
  const side = (tid, where) => {
    const g = state.teams[tid] && state.teams[tid].geo;
    const txt = `<div class="ko-txt"><div class="nm">${esc(teamName(tid))}</div>
      <div class="meta">${t(where === "home" ? "home-side" : "away-side")}${g ? ` · ${esc(geoName(g))}` : ""}</div></div>`;
    return `<div class="ko-team ${where}">${where === "home" ? txt + emblem(tid) : emblem(tid) + txt}</div>`;
  };
  const c = state.career;
  return `<canvas class="ko-globe" aria-hidden="true"></canvas>
    <div class="ko-pins" aria-hidden="true">${places.map((p) => `<div class="ko-pin"><div class="ko-pin-in">
      <span class="ko-embs">${p.teams.map((tid) => emblem(tid)).join("")}</span><span class="ko-place">${esc(geoName(p.geo))}</span></div></div>`).join("")}</div>
    <div class="ko-scrim" aria-hidden="true"></div>
    <div class="ko-bar ko-top"><span class="hero-kicker">${f.comp ? `${esc(fxLabel(f))} · ${esc(fmtDate(f.date))}` : `${esc(c.league_name)} · ${tf("round-x", { a: f.round, b: c.rounds_total })}`}</span></div>
    <div class="ko-card" role="dialog" aria-modal="true" aria-labelledby="ko-vs">
      ${side(f.home, "home")}<div class="ko-vs" id="ko-vs"><span class="ko-burst" aria-hidden="true"></span>${t("vs")}</div>${side(f.away, "away")}
      <p class="ko-note" id="ko-note">${tf("ko-note", { h: `<b>${esc(teamName(f.home))}</b>`, a: `<b>${esc(teamName(f.away))}</b>` })}</p>
    </div>
    <div class="ko-bar ko-bottom"><button class="pill primary" id="ko-go" data-nav-default>${t("to-game")}</button>
      <button class="pill ghost" id="ko-cancel" data-sound="back">${t("cancel")}</button></div>
    <div class="ko-flash" aria-hidden="true"></div><div class="ko-black" aria-hidden="true"></div>`;
}

async function kickoff() {
  const f = state.next;
  if (!f || kick || !window.Globe) return;
  const el = $("#kickoff");
  const places = kickPlaces(f);
  const me = { places, skipped: false, going: false, closed: false, focus: focusKey(document.activeElement) };
  kick = me;
  if (phoneOpen()) closePhone(true);
  renderDock();   // 开球动画时快讯条只留按键提示 (R-82)
  el.innerHTML = kickoffHtml(f, places);
  el.className = "kickoff";
  el.hidden = false;
  me.pins = [...el.querySelectorAll(".ko-pin")];
  me.globe = Globe.create($(".ko-globe", el), { colors: globeColors(), reduced: UI.reduced, onFrame: (g) => me.pins.forEach((pin, i) => {
    const p = places[i].geo, q = g.project(p.lat, p.lon, 0.06);   // 钉在光柱顶上
    pin.style.transform = `translate(${q.x}px, ${q.y}px)`;
    pin.classList.toggle("off", !q.visible);
  }) });
  $("#ko-go").addEventListener("click", () => kickGo(me));
  $("#ko-cancel").addEventListener("click", () => kickClose(me));
  renderHints();
  void el.offsetWidth;
  el.classList.add("on");
  if (UI.mode !== "pointer") UI.focus($("#ko-go"), true);

  const g = me.globe;
  const alive = () => kick === me && !me.skipped;
  const A = places[0] && places[0].geo, B = places[1] && places[1].geo;
  // 最后的画面: 落点都在顶栏以下、对阵上面那块里 (对阵还没亮, 但已经排好版, 量得到位置)
  const card = $(".ko-card", el).getBoundingClientRect();
  const top = el.querySelector(".ko-top").offsetHeight + 110;   // 落点上面还立着队徽和国名, 留出它们的高度
  const box = { x0: 0.14, x1: 0.86, y0: top / innerHeight, y1: Math.max(top / innerHeight + 0.1, (card.top - 36) / innerHeight) };
  const cy = (box.y0 + box.y1) / 2;
  const end = !A ? null : B ? { ...Globe.midpoint(A, B), dist: Math.max(1.9, g.fit(Globe.midpoint(A, B), [A, B], box, cy)), cy }
    : { lat: A.lat, lon: A.lon, dist: 1.95, cy };
  const lock = (i) => {
    const p = places[i].geo;
    g.lock(p.lat, p.lon, { radius: 5 });
    me.pins[i].classList.add("on");
    UI.sound("lock");
  };
  if (!A) {
    // 两队都没有落点 (特殊队伍): 地球照转, 直接亮对阵
    g.set({ lat: 24, lon: 10, dist: 3.1, cy: 0.4 });
    g.drift(6);
    await wait(UI.reduced ? 0 : 600);
  } else if (UI.reduced) {
    g.set(end);
    places.forEach((_, i) => lock(i));
    if (B) g.arc(A, B, 0);
  } else {
    g.set({ lat: Math.max(-60, Math.min(60, A.lat * 0.5 - 12)), lon: A.lon - 80, dist: 7, cy: 0.5 });
    UI.sound("fly");
    await g.flyTo({ lat: A.lat, lon: A.lon, dist: 1.75, cy: 0.5 }, 2400, { rot: "inOutCubic", dist: "inOutQuint" });
    if (!alive()) return;
    lock(0);
    await wait(450);
    if (!alive()) return;
    if (B) {
      g.flyTo(end, 1500, { hump: Globe.angle(A, B) > 40 ? 0.45 : 0.1 });
      await g.arc(A, B, 1400);
      if (!alive()) return;
      lock(1);
      await wait(350);
    } else {
      await g.flyTo(end, 800, { dist: "outQuart" });   // 退一点、球往上抬, 给对阵让位
    }
  }
  if (!alive()) return;
  koVs(el);
  UI.sound("vs");
  g.drift(0.8);
  await wait(UI.reduced ? 1800 : 2200);
  if (alive()) kickGo(me);
}

// 对阵亮相: 球队、VS 靠 .vs 上的过渡进来, VS 后面的光圈用 GSAP 放一次
function koVs(el) {
  if (el.classList.contains("vs")) return;
  el.classList.add("vs");
  const M = motion();
  if (M) M.fromTo($(".ko-burst", el), { opacity: 0, scale: 0.3 },
    { keyframes: { "30%": { opacity: 1 }, "100%": { opacity: 0, scale: 1.6 } }, duration: 0.9, delay: 0.15, ease: "power3.out" });
}
// 冲进去, 同时切到游戏。切成功了等窗口失焦 (游戏到前台) 就把开球收起来, 切回来时是主页;
// 没切过去 (游戏没开 -> Steam 启动、还在启动、Windows 不让切): 退回对阵画面写明怎么回事, 可以再按一次
async function kickGo(me) {
  if (me.going || me.closed) return;
  me.skipped = me.going = true;
  const el = $("#kickoff"), g = me.globe;
  me.places.forEach((p, i) => {
    if (!me.pins[i].classList.contains("on")) { g.lock(p.geo.lat, p.geo.lon, { radius: 5, still: true }); me.pins[i].classList.add("on"); }
  });
  koVs(el);
  el.classList.add("dive");
  const M = motion();
  if (M) M.fromTo($(".ko-flash", el), { opacity: 0 }, { keyframes: { opacity: [0, 1, 0] }, duration: 0.7, ease: "power1.in" });
  el.classList.remove("held");
  UI.sound("dive");
  const back = g.cam.dist;
  g.flyTo({ dist: 1.03 }, 700, { dist: "inQuart" });
  let r;
  try {
    [r] = await Promise.all([api("/api/switch/game", {}), wait(UI.reduced ? 0 : 650)]);
  } catch (e) {
    r = { result: "error", error: e.message };
  }
  if (me.closed) return;
  if (r.result === "focused") {
    const done = () => kickClose(me, true);
    if (!document.hasFocus()) return done();
    addEventListener("blur", done, { once: true });
    setTimeout(done, 2500);
    return;
  }
  const msg = { launched: "game-launching", starting: "game-starting", failed: "game-failed", unsupported: "game-unsupported" }[r.result];
  $("#ko-note").textContent = msg ? t(msg) : tf("ko-failed", { e: r.error || r.result });
  el.classList.remove("dive");
  el.classList.add("held");
  g.flyTo({ dist: back }, 600, { dist: "outQuart" });
  me.going = false;
}

function kickClose(me = kick, instant = false) {
  if (!me || me.closed) return;
  me.closed = true;
  if (kick === me) kick = null;
  renderDock();
  const el = $("#kickoff");
  const fin = () => {
    me.globe.destroy();
    if (kick) return;   // 收的时候又开了一个
    el.hidden = true;
    el.innerHTML = "";
    el.className = "kickoff";
    renderHints();
    if (UI.mode !== "pointer") {
      const f = me.focus && $(me.focus, $("#app"));
      if (f) UI.focus(f, true);
      else UI.focusDefault($("#app"));
    }
  };
  if (instant || UI.reduced) return fin();
  el.classList.remove("on");
  setTimeout(fin, 240);
}

// ------------------------------------------------------------ 操作 (主页按钮都走 data-act, 一处分发)
const ACTIONS = {
  // 带上这场的 id: 服务端只结算它, 别的请求 (连点、另一个窗口) 晚到了会被拒, 不会顺手结算下一轮
  sim: () => act("/api/match/simulate", { fixture: state.next.id }, !fastSim),
  "ahead-go": (b) => aheadStart(b.dataset.mode, Number(b.dataset.n) || 5),
  "ahead-stop": async () => {
    try {
      await api("/api/ahead/stop", {});
    } catch (e) {
      toast(e.message);
    }
  },
  "next-more": () => { nextMore = !nextMore; render(); },
  "fast-sim": () => {
    fastSim = !fastSim;
    try { localStorage.setItem("ml-fast-sim", fastSim ? "1" : "0"); } catch (e) { /* 无痕窗口 */ }
    render();
  },
  manual: () => {
    const h = $("#mh").value.trim(), a = $("#ma").value.trim();
    if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(a)) return toast(t("need-score"));
    act("/api/match/manual", { fixture: state.next.id, home_goals: Number(h), away_goals: Number(a) }, true);
  },
  // 换季: 结算完放颁奖典礼 (R-28), 典礼放完回到主页, 新赛季的数字在图块上滚到位
  // 换季 (R-85): 只从「结束赛季」页确认过来; 服务端也要 confirm, 还有必须定的人没定就不换
  "season-end": () => openSeasonEnd(),
  "new-season": () => openSeasonEnd(),
  "se-confirm": async () => {
    const s = state.career.season, label = state.career.season_label || tf("season", { n: s });
    if (!(await askConfirm(tf("se-confirm-q", { s: label }), t("se-confirm")))) return;
    if (!$("#modal").hidden) closeModal();
    hubKey = "next";
    holdCounts = true;
    await act("/api/season/new", { confirm: true }, false, t("working-season"));
    if (state.career && state.career.season === s + 1) return ceremony(s);
    holdCounts = false;
    playCounts();
  },
  "se-renew": (b) => seasonExpire(b, "renew"),
  "se-go": (b) => seasonExpire(b, "go"),
  "se-undo": (b) => seasonExpire(b, "undo"),
  "se-retire": () => { if (!$("#modal").hidden) closeModal(); selectTile("next"); },
  "exp-talk": (b) => { if (phoneOpen()) closePhone(true); openPlayer(Number(b.dataset.pid), state.career.user_team, "push", "contract"); },
  ceremony: (b) => ceremony(Number(b.dataset.season), true),
  seasons: () => openSeasons(),
  saves: () => openSaves(),
  plugin: () => openPlugin(),
  "pg-install": () => pluginAct("install"),
  "pg-uninstall": () => pluginAct("uninstall"),
  doc: (b) => openDoc(b.dataset.path),
  // 不用确认: 开档页有「返回当前联赛」, 开了新联赛旧的也能从「存档」切回来
  "new-league": () => {
    closeModal();                     // 现在从「存档」页点进来 (R-57): 先把弹页关了
    setupMode = true;
    setup.selected.clear();
    setup.mine = null;
    setup.name = null;
    renderSetup();
  },
  "del-league": async () => {
    if (!(await askConfirm(tf("del-confirm", { n: state.career.league_name }), t("del-league"), true))) return;
    try {
      state = await api("/api/career/delete", {});
      closeModal();
      setupMode = false;
      setup.selected.clear();
      setup.mine = null;
      setup.name = null;
      renderSetup();
    } catch (e) {
      toast(e.message);
    }
  },
  history: () => openHistory(),
  "open-table": () => openStandings(),
  "open-scorers": () => openBoard("goals"),
  "open-assists": () => openBoard("assists"),
  "open-squad": () => openSquad(),
  "open-ucl": (b) => openEuro(b.dataset.comp || "UCL"),
  "open-cup": (b) => openCups(b.dataset.cup),
  "open-calendar": () => openCalendar(),
  "open-leagues": () => openLeagues(),
  "open-national": () => openNational(),
  "open-callup": () => openCallup(),
  overview: () => (ovOpen() ? closeOverview() : openOverview()),
  "nt-accept": (b) => act("/api/nt/accept", { nation: Number(b.dataset.nation) }),
  "nt-decline": (b) => act("/api/nt/decline", { nation: Number(b.dataset.nation) }),
  "nt-resign": async () => {
    if (await askConfirm(tf("nt-resign-q", { t: teamName(ntState().nation) }), t("nt-resign"), true)) act("/api/nt/resign", {});
  },
  "open-training": (b) => openTraining("push", b.dataset.train ? Number(b.dataset.train) : null, b.dataset.tab || null),
  "open-tactics": () => openTactics(),
  "tac-sel": (b) => tacSelect(b.dataset.spot),
  "tac-cancel": () => { if (tacPage) { tacPage.sel = null; openTactics("replace", true); } },
  "tac-best": () => tacPickBest(),
  // 首发一键超人 (R-101): 已保存的首发 11 人走修改器改掉 -> 存盘; 游戏开着就马上写进去 (服务端等游戏重读完才回), 然后重开战术页拿新总评
  superxi: async () => {
    if (busy) return;
    if (!(await askConfirm(t("sx-confirm"), t("sx-btn"), true))) return;
    busy = true;
    let r;
    try {
      r = await api("/api/superxi", {});
    } catch (e) {
      busy = false;
      return toast(e.message);
    }
    busy = false;
    await refresh();
    const g = r.ingame;
    toast(`${tf("sx-done", { n: r.n })} · ${ingameTail(g)}`);
    if (tacPage) { tacPage = null; openTactics("replace"); }
  },
  "tac-save": () => tacSave(),
  "tac-auto": () => tacAuto(),
  "todo-board": () => openPhone("board"),
  "todo-national": () => selectTile("national"),
  // 找人列表里的「出价」(R-57): 直接打开这个人的合同标签 (以前要先进球员页再换标签)
  "mk-offer": (b) => openPlayer(Number(b.dataset.offer), b.dataset.team ? Number(b.dataset.team) : null, "push", "contract"),
  "open-news": () => openNews(),
  "open-honors": (b) => openHonors("push", b.dataset.tab || null),
  "hn-hire": (b) => staffAct(b, true),
  "hn-release": (b) => staffAct(b, false),
  "open-market": (b) => openMarket("push", b.dataset.tab || null),
  "bd-accept": async (b) => {
    const team = Number(b.dataset.team);
    if (!(await askConfirm(tf("bd-accept-confirm", { a: teamName(state.career.user_team), b: teamName(team) }), t("bd-accept")))) return;
    await act("/api/board/accept", { team });
  },
  "mk-buy": (b) => mkAct("/api/market/buy", { pid: Number(b.dataset.pid), fee: Number(b.dataset.fee || ($("#mk-fee") || {}).value || 0),
    wage: Number($("#mk-wage").value), years: Number(segVal("mk-years")), beta: mkBeta(), swap: b.dataset.fee ? [] : mkSwaps() },
    (r) => (r.swap && r.swap.length ? tf("mk-ok-swap", { c: money(r.fee), n: r.swap.length }) : t("mk-ok-buy"))),
  "mk-renew": (b) => mkAct("/api/market/renew", { pid: Number(b.dataset.pid), wage: Number($("#mk-wage").value),
    years: Number(segVal("mk-years")), beta: mkBeta() }, () => t("mk-ok-renew")),
  // 租借、挂牌、还价 (R-44)
  "mk-loan": (b) => mkAct("/api/market/loan", { pid: Number(b.dataset.pid), half: segVal("mk-loan-half") === "1",
    buy: segVal("mk-loan-buy") }, (r) => tf("mk-ok-loan", { s: pctOf(r.split) })),
  "mk-loanbuy": (b) => mkAct("/api/market/loanbuy", { pid: Number(b.dataset.pid) }, () => t("mk-ok-loanbuy")),
  "mk-list": (b) => {
    const mode = segVal("mk-list");
    mkAct("/api/market/list", { pid: Number(b.dataset.pid), mode }, () => t(mode ? "mk-ok-list" : "mk-ok-unlist"));
  },
  "mk-counter": (b) => mkAct("/api/market/bid", { id: Number(b.dataset.id), counter: Number(($("#mk-c-" + b.dataset.id) || {}).value || 0) },
    (r) => tf("mk-ok-sold", { x: money(r.fee) })),
  "mk-release": async (b) => {
    if (!(await askConfirm(tf("pc-release-confirm", { p: b.dataset.who, x: money(Number(b.dataset.cost)) }), t("pc-release"), true))) return;
    mkAct("/api/market/release", { pid: Number(b.dataset.pid) }, (r) => tf("mk-ok-release", { x: money(r.paid) }));
  },
  "mk-bid": (b) => mkAct("/api/market/bid", { id: Number(b.dataset.id), accept: !!b.dataset.yes }, () => t(b.dataset.yes ? "mk-ok-accept" : "mk-st-rejected")),
  "train-start": (b) => trainAct("/api/training/start", { pid: Number(b.dataset.train), skill: b.dataset.skill, pos: b.dataset.pos, ab: b.dataset.ab },
    tf("tr-started", { p: b.dataset.who, k: b.dataset.name || b.querySelector(".tr-opt-name").textContent })),
  "train-stop": (b) => trainAct("/api/training/stop", { pid: Number(b.dataset.train) }, tf("tr-stopped", { p: b.dataset.who })),
  "rm-promise": (b) => (currentView && currentView.tac && tacPage ? tacPromise(Number(b.dataset.pid), b.dataset.who)
    : mkAct("/api/morale/promise", { pid: Number(b.dataset.pid) }, (r) => tf("rm-ok", { p: b.dataset.who, m: Math.round(r.mood) }))),
  "rm-refuse": (b) => roomAct("/api/morale/refuse", { pid: Number(b.dataset.pid) }, (r) => tf("rm-ok-refuse", { p: b.dataset.who, m: Math.round(r.mood) })),
  "rm-let-go": (b) => roomAct("/api/market/list", { pid: Number(b.dataset.pid), mode: "par" }, () => tf("rm-ok-let-go", { p: b.dataset.who })),
  phone: () => togglePhone(),
  "ph-tab": (b) => phoneTab(b.dataset.tab),
  "ph-go": (b) => phoneGo(b.dataset.go),
  "ph-open-msgs": () => openPhone("msgs"),
  "ph-ticker": () => openPhone(state.phone && state.phone.n ? "msgs" : "news"),
  "ph-bid-yes": async (b) => {   // 手机里接受报价: 人会走, 先问一句 (X / Y 一按就卖人太容易手滑)
    const loan = b.dataset.kind === "loan";
    if (!(await askConfirm(tf(loan ? "ph-loan-confirm" : "ph-bid-confirm", { p: b.dataset.who, t: teamName(Number(b.dataset.buyer)), x: b.dataset.fee }), t("ph-accept")))) return;
    mkAct("/api/market/bid", { id: Number(b.dataset.id), accept: true }, () => t("mk-ok-accept"));
  },
  "ac-promote": (b) => mkAct("/api/academy/promote", { pid: Number(b.dataset.pid) }, () => tf("ac-ok", { p: b.dataset.who })),
  decide: (b) => act("/api/world/decide", { tie: b.dataset.tie, winner: Number(b.dataset.winner) }),
  kickoff: () => kickoff(),
  // 换卡 (R-34): 存盘; 游戏开着就马上写进去 (服务端等游戏重读完才回), 然后原地重画球员页, 停在「变体卡」
  "card-pick": async (b) => {
    if (busy) return;
    busy = true;
    const pid = Number(b.dataset.owner);
    let r;
    try {
      r = await api("/api/card", { pid, vid: Number(b.dataset.vid) });
    } catch (e) {
      busy = false;
      return toast(e.message);
    }
    busy = false;
    const g = r.ingame;
    toast(!g ? t("vc-later") : g.error ? tf("vc-failed", { e: g.error }) : tf("vc-applied", { ms: g.reload_ms ?? "-" }));
    await refresh();   // state.career.cards 跟着变, 榜单 / 领奖台上他的卡换成新的
    if (currentView && currentView.ui) currentView.ui.tab = "cards";
    openPlayer(pid, null, "replace");
  },
  // 内置修改器 (R-61): 保存整份改动; 存盘后游戏开着就马上写进去, 然后原地重画球员页, 停在「修改」
  "ed-clear": (b) => {
    const row = b.closest(".ed-arow");
    const el = row && row.querySelector("input.ed-range");
    if (el) edSetNull(el, true);
  },
  "ed-save": async (b) => {
    if (busy) return;
    const patch = collectEditPatch();
    if (!patch || !Object.keys(patch).length) return toast(t("ed-nochange"));
    await edSavePatch(Number(b.dataset.pid), patch);
  },
  // 档案恢复原版: 名字、国籍、身体、惯用手脚、状态、逆足、出场、金球的改动全撤掉 (能力不撤: 改过的和练出来的混在一起分不开了)
  "ed-revert-profile": (b) => edSavePatch(Number(b.dataset.pid),
    { names: { full: "", cn: "", shirt: "", roman: "" }, nat: null, nat2: null, height: null, weight: null,
      foot: null, hand: null, form: null, injury: null, wfa: null, wfu: null, caps: null, golden: null }),
  squad: () => openTeam(state.career.user_team),
  home: () => { if (!tacLeaveGuard(closeModal)) closeModal(); },
  // 开发者模式 (R-30)
  dev: () => openDev(),
  "dv-run": async () => {
    try {
      await api("/api/dev/run", { seasons: dvSeasons });
    } catch (e) {
      return toast(e.message);
    }
    await refresh();      // 页头的「开发者」变成「快进中」
    openDev("replace", "run");
  },
  "dv-stop": async () => {
    try {
      await api("/api/dev/stop", {});
    } catch (e) {
      toast(e.message);
    }
    if (currentView && currentView.dev) openDev("replace", "run");
  },
  "dv-open": async (b) => {
    closeModal();
    setupMode = false;
    await act("/api/career/load", { file: b.dataset.file });
  },
  "dv-report": () => {
    const v = currentView;
    if (v && v.tabs && v.tabs[1]) renderTab(v, v.tabs[1].k, 1);
  },
  // 进入游戏: 游戏开着就切过去, 没开就让服务通过 Steam 启动 (switcher.py)
  game: async () => {
    let r;
    try {
      r = await api("/api/switch/game", {});
    } catch (e) {
      return toast(e.message);
    }
    const msg = { launched: "game-launching", starting: "game-starting", failed: "game-failed", unsupported: "game-unsupported" }[r.result];
    if (msg) toast(t(msg));
  },
  sound: (b) => {
    UI.setSound(!UI.soundOn);
    b.textContent = t(UI.soundOn ? "sound-on" : "sound-off");
    b.setAttribute("aria-pressed", UI.soundOn);
  },
};

// 一个操作没回来之前不接下一个: 以前连点「模拟这场」会一口气结算两场
let busy = false;
// 「处理中」(R-56): 一个请求 0.4 秒还没回来, 屏幕底部出一条带转圈的提示 (换季要几秒, 以前只是按钮全灰、像卡住了)
function working(text) {
  let el = null;
  const timer = setTimeout(() => {
    el = document.createElement("div");
    el.className = "working";
    el.setAttribute("role", "status");
    el.innerHTML = `<span class="ahead-spin" aria-hidden="true"></span><span>${esc(text || t("working"))}</span>`;
    document.body.append(el);
  }, 400);
  return () => { clearTimeout(timer); if (el) el.remove(); };
}

async function act(path, body, showReport, busyText) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("#app button").forEach((b) => (b.disabled = true));
  const fid = state.next && state.next.id;
  const done = working(busyText);
  try {
    state = await api(path, body);
    lastEvent = state.event_id;
    boot = state.boot || boot;
    if (showReport && fid) holdCounts = true;   // 主页的数等战报关了再滚
    render();
    if (showReport && fid) openReport(fid);
  } catch (e) {
    toast(e.message);
    await refresh();   // 按钮还锁着, 页面也可能是旧的 (别的窗口刚结算过): 按服务端现状重画
  } finally {
    done();
    busy = false;
  }
}

// 确认框 (代替浏览器自带的 confirm: 那个手柄按不了)。默认停在「取消」: 手快连按 ✕ 也不会误删
let confirmDone = null;
function askConfirm(msg, yes, danger = false) {
  return new Promise((resolve) => {
    const box = $("#confirm"), y = $("#confirm-yes"), n = $("#confirm-no");
    const before = document.activeElement;
    $("#confirm-msg").textContent = msg;
    y.textContent = yes;
    n.textContent = t("cancel");
    y.classList.toggle("danger", danger);
    box.hidden = false;
    const M = motion();
    if (M) {
      M.from(box, { opacity: 0, duration: 0.16, ease: "power2.out", clearProps: "opacity" });
      M.from($(".confirm-box", box), { opacity: 0, scale: 0.95, duration: 0.24, ease: "power3.out", clearProps: "transform,opacity" });
    }
    confirmDone = (ok) => {
      box.hidden = true;
      confirmDone = null;
      if (before && before.isConnected && UI.mode !== "pointer") UI.focus(before, true);
      resolve(ok);
    };
    UI.focus(n, true);
  });
}
$("#confirm-yes").addEventListener("click", () => confirmDone && confirmDone(true));
$("#confirm-no").addEventListener("click", () => confirmDone && confirmDone(false));
$("#confirm").addEventListener("click", (e) => { if (e.target.id === "confirm" && confirmDone) confirmDone(false); });

// 手柄按键提示 (右下角): 只在用手柄时出现。只列这一页用得上的键: 有标签才有 L1 / R1, 有长列表才有 L2 / R2
// ------------------------------------------------------------ 底部快讯条 + 手机 (R-82)
// 快讯条: 每个页面最底下一条 (用的是页面底部本来就空着的那 58px, 不挤任何页面)。左边手机按钮 (要处理几件)、
// 中间滚动的快讯 (有要处理的事先说这个, 后面接和你有关的新闻)、右边按键提示。开球、颁奖、开档页时只留按键提示。
let dockSig = "";
let dockN = null;     // 上次手机按钮上的数 (变多了就跳一下, R-88)
let dockRot = null;   // 减少动效: 不滚, 几秒换一条
const DOCK_KINDS = ["expire", "bid", "job", "request", "academy", "retire"];
function renderDock() {
  const dock = $("#dock");
  if (!dock) return;
  const ph = state && state.career && !setupMode ? state.phone : null;
  const bare = !ph || !!kick || !!cer;
  dock.classList.toggle("bare", bare);
  const btn = $(".dock-phone", dock), tk = $(".dock-ticker", dock);
  btn.hidden = tk.hidden = bare;
  if (bare) {
    clearInterval(dockRot);
    dockRot = null;
    dockSig = "";
    return;
  }
  // 键帽写在按钮上 (手柄 R3、键盘 P; 用鼠标时不写), 不占右边提示条的地方 —— 那里要留给滚动的快讯
  const cap = UI.mode === "pad" && UI.padKind ? "R3" : UI.mode === "key" ? "P" : "";
  const more = dockN != null && ph.n > dockN;
  dockN = ph.n;
  btn.innerHTML = `<span class="dock-ico" aria-hidden="true"></span>${esc(t("dock-phone"))}${ph.n ? `<span class="n">${ph.n}</span>` : ""}${cap ? `<kbd>${cap}</kbd>` : ""}`;
  const M = more && motion();
  if (M) {
    M.fromTo($(".n", btn), { scale: 0.4 }, { scale: 1, duration: 0.45, ease: "back.out(3)", clearProps: "transform" });
    M.to($(".dock-ico", btn), { keyframes: { rotation: [0, -14, 14, -14, 14, -6, 0], easeEach: "sine.inOut" }, duration: 0.6, clearProps: "transform" });
  }
  btn.setAttribute("aria-label", t("dock-phone") + (ph.n ? ` · ${ph.n}` : ""));
  const items = [];
  if (ph.n) {
    const parts = DOCK_KINDS.filter((k) => (ph.kinds || {})[k]).map((k) => tf("dk-" + k, { n: ph.kinds[k] }));
    items.push(`<span class="dock-item alert">${esc(tf("dock-alert", { n: ph.n }))}${parts.length ? ` · ${esc(parts.join(" · "))}` : ""}</span>`);
  }
  const bd = state.board;
  if (bd && !bd.sacked && bd.conf < bd.warn) items.push(`<span class="dock-item alert">${esc(tf("dock-board", { c: Math.round(bd.conf) }))}</span>`);
  for (const x of ph.ticker || []) items.push(`<span class="dock-item">${x.team ? emblem(x.team, "sm") : ""}<span>${newsText(x)}</span></span>`);
  const sig = `${lang}|${UI.reduced}|${items.join("")}`;
  if (sig === dockSig) return;
  dockSig = sig;
  clearInterval(dockRot);
  dockRot = null;
  if (!items.length) { tk.innerHTML = ""; return; }
  if (UI.reduced) {
    let i = 0;
    const show = () => { tk.innerHTML = `<div class="dock-track still" data-act="ph-ticker">${items[i % items.length]}</div>`; i++; };
    show();
    if (items.length > 1) dockRot = setInterval(show, 5000);
    return;
  }
  // 两份一样的接在一起往左滚, 滚过一份正好接上; 速度一定 (每秒 60px), 越长滚得越久
  const run = items.join(`<span class="dock-sep" aria-hidden="true">·</span>`) + `<span class="dock-sep" aria-hidden="true">·</span>`;
  tk.innerHTML = `<div class="dock-track" data-act="ph-ticker"><span class="dock-run">${run}</span><span class="dock-run" aria-hidden="true">${run}</span></div>`;
  requestAnimationFrame(() => {
    const r = tk.querySelector(".dock-run"), tr = tk.querySelector(".dock-track");
    if (r && tr) tr.style.setProperty("--dock-dur", Math.max(20, r.offsetWidth / 60).toFixed(1) + "s");
  });
}

// 手机: 从右下角弹出来, 盖在当前页面上一层 (焦点只在手机里走, B / Esc / R3 关上, 点手机外面也关上)。
// 三个应用: 消息 (要你回应的, 就地处理) / 新闻 / 转会, LB / RB 换
let phone = null;   // { tab, data, back: 打开前焦点在哪, seq }
let phoneCache = null;   // 上次拉到的手机数据: 再打开时先拿它画, 后台再刷新
const phoneOpen = () => !!phone && !$("#phone").hidden;
const phoneTabs = () => ["msgs", ...(state && state.board ? ["board"] : []), "news", "tr"];
function togglePhone() {
  if (phoneOpen()) closePhone();
  else openPhone();
}
function openPhone(tab) {
  if (!state || !state.phone || setupMode || confirmDone || kick || cer) return UI.sound("edge");
  if (ovOpen()) closeOverview();
  const back = phone ? phone.back : document.activeElement;
  phone = { tab: tab || (state.phone.n ? "msgs" : "news"), data: phone ? phone.data : phoneCache, back, seq: 0 };
  $("#phone").hidden = false;
  const M = motion();
  if (M) M.from("#phone", { opacity: 0, duration: 0.16, ease: "power2.out", clearProps: "opacity" });
  UI.sound("ok");
  renderPhone(true);
  phoneLoad(true);
}
function closePhone(quiet = false) {
  if (!phone) return;
  const back = phone.back;
  phone = null;
  const el = $("#phone");
  el.hidden = true;
  el.innerHTML = "";
  if (!quiet) UI.sound("back");
  if (UI.mode !== "pointer") {
    if (back && back.isConnected && back !== document.body) UI.focus(back, true);
    else UI.focusDefault();
  }
  renderHints();
}
async function phoneLoad(first = false) {
  if (!phone) return;
  const seq = ++phone.seq;
  let d;
  try {
    d = await api("/api/phone");
  } catch (e) {
    return toast(e.message);
  }
  if (!phone || seq !== phone.seq) return;
  phone.data = phoneCache = d;
  renderPhone(first);
  if (phone.tab === "news") phoneSeen();
}
// 看了新闻: 标已读 (快讯条、手机标签上的数跟着清)
async function phoneSeen() {
  const d = phone && phone.data;
  if (!d || !d.news.length || d.news[0].id <= d.seen) return;
  const top = d.news[0].id;
  d.seen = top;
  try {
    state = await api("/api/news/seen", { id: top });
    render();
  } catch (e) { /* 标已读失败不要紧 */ }
}
function phoneTab(k) {
  if (!phone || !phoneTabs().includes(k)) return;
  if (phone.tab === k) return;
  const tabs = phoneTabs();
  const dir = Math.sign(tabs.indexOf(k) - tabs.indexOf(phone.tab));
  phone.tab = k;
  UI.sound("move");
  renderPhone(true, dir);
  if (k === "news") phoneSeen();
}
function phoneStep(d) {
  if (!phone) return;
  const tabs = phoneTabs();
  const i = tabs.indexOf(phone.tab) + d;
  if (i < 0 || i >= tabs.length) return UI.sound("edge");
  phoneTab(tabs[i]);
}
// 「去看」: 关上手机, 去处理的地方
function phoneGo(go) {
  if (go === "board") return phoneTab("board");
  closePhone(true);
  if (go === "table") return openStandings();
  if (go === "seasons") return openSeasons();
  const toHub = () => { if (!$("#modal").hidden && !tacLeaveGuard(closeModal)) closeModal(); };
  if (go === "bids") return openMarket("push", "bids");
  if (go === "academy") return openTraining("push", null, "academy");
  if (go === "training") return openTraining();
  if (go === "news") return openNews();
  if (go === "room") {
    const toRoom = () => { if (currentView && currentView.tac) renderTab(currentView, "room", 0); };
    if (currentView && currentView.tac && !$("#modal").hidden) return toRoom();
    return openTactics().then(toRoom);
  }
  toHub();
  if (go === "national") return selectTile("national");
  if (go === "retire") return selectTile("next");
}
const phFace = (pid, team) => `<img class="face" src="${img("face", pid)}" loading="lazy" ${faceErr(team)} alt="">`;
let phRowKey = "";   // 正在画的那条消息是谁 (phoneMsgs 每条先设好): 刷新前后对得上「哪行是新来的、哪行没了」(R-88)
const phMsgKey = (m) => `${m.k}:${m.id ?? m.pid ?? (m.p && m.p.pid) ?? m.team ?? ""}`;
const phRow = (lead, text, btns, cls = "") => `<div class="row ph-msg${cls}" data-mk="${esc(phRowKey)}" data-flip-id="${esc(phRowKey)}">${lead}<div class="grow">${text}</div>${btns ? `<div class="ph-acts">${btns}</div>` : ""}</div>`;
const phBtn = (label, act, data = "", cls = "") => `<button class="pill compact${cls}" data-act="${act}"${data}>${esc(label)}</button>`;
function phoneMsgs(d) {
  const rows = [];
  for (const m of d.msgs) {
    phRowKey = phMsgKey(m);
    if (m.k === "bid") {
      const who = pname(m.p), fee = money(m.fee);
      rows.push(phRow(phFace(m.p.pid, m.buyer), tf(m.kind === "loan" ? "ph-bid-loan" : m.swap_p ? "ph-bid-swap" : "ph-bid",
        { t: esc(teamName(m.buyer)), p: who, x: esc(fee), s: m.swap_p ? pname(m.swap_p) : "" }),
        phBtn(t("ph-accept"), "ph-bid-yes", ` data-id="${m.id}" data-kind="${esc(m.kind)}" data-buyer="${m.buyer}" data-who="${who}" data-fee="${esc(fee)}"`, " primary")
        + phBtn(t("ph-reject"), "mk-bid", ` data-id="${m.id}"`)
        + phBtn(t("ph-detail"), "ph-go", ` data-go="bids"`, " ghost")));
    } else if (m.k === "job") {
      const s = state.teams && state.teams[m.team] ? state.teams[m.team].strength : "-";
      rows.push(phRow(emblem(m.team, "md"), tf(m.kind === "poach" ? "ph-job-poach" : "ph-job-sacked", { t: esc(teamName(m.team)), s }),
        phBtn(t("ph-accept"), "bd-accept", ` data-team="${m.team}"`, " primary") + phBtn(t("ph-go"), "ph-go", ` data-go="board"`, " ghost")));
    } else if (m.k === "request") {
      const who = pname(m.p);
      const tag = m.sulk ? `<span class="fit-tag inj">${t("rm-sulk")}</span>` : m.listed ? `<span class="fit-tag">${t("rm-listed")}</span>`
        : `<span class="fit-tag ban">${tf("rm-wait", { n: m.wait || 0, m: m.need })}</span>`;
      rows.push(phRow(phFace(m.p.pid, state.career.user_team), `${tf("ph-req", { p: who })} ${tag}`,
        m.sulk || m.listed ? phBtn(t("ph-go"), "ph-go", ` data-go="room"`, " ghost")
          : phBtn(t("rm-let-go"), "rm-let-go", ` data-pid="${m.p.pid}" data-who="${who}"`) + phBtn(t("rm-refuse"), "rm-refuse", ` data-pid="${m.p.pid}" data-who="${who}"`)));
    } else if (m.k === "expire") {   // 合同这季到期 (R-85): 一键续 / 放走 / 谈合同; 最后 5 场标红
      const who = pname(m.p);
      rows.push(phRow(phFace(m.p.pid, state.career.user_team), tf("ph-expire", { p: who, w: esc(money(m.ask_wage)), y: m.ask_years })
        + (m.request ? ` <span class="fit-tag inj">${t("se-req")}</span>` : m.must ? ` <span class="fit-tag ban">${t("se-must")}</span>` : ""),
        (m.request ? "" : phBtn(t("ph-renew"), "se-renew", ` data-pid="${m.p.pid}" data-who="${who}"`, " primary"))
        + phBtn(t("ph-let-go"), "se-go", ` data-pid="${m.p.pid}" data-who="${who}"`)
        + phBtn(t("ph-talk"), "exp-talk", ` data-pid="${m.p.pid}"`, " ghost"), m.urgent ? " urgent" : ""));
    } else if (m.k === "academy" || m.k === "retire" || m.k === "train") {
      const go = { academy: "academy", retire: "retire", train: "training" }[m.k];
      rows.push(phRow("", esc(tf("ph-" + m.k, { n: m.n })),
        phBtn(t("ph-go"), "ph-go", ` data-go="${go}"`), m.k === "train" ? " quiet" : ""));
    }
  }
  for (const o of ntState().offers || []) {   // 执教国家队的邀请 (R-71)
    phRowKey = `nt:${o.nation}`;
    rows.splice(0, 0, phRow(emblem(o.nation, "md"), tf("ph-nt", { t: esc(ntName(o.nation)) }),
      phBtn(t("nt-accept"), "nt-accept", ` data-nation="${o.nation}"`, " primary") + phBtn(t("nt-decline"), "nt-decline", ` data-nation="${o.nation}"`)));
  }
  return rows.length ? rows.join("") : `<div class="empty">${t("ph-no-msgs")}</div>`;
}
function phoneBoard() {
  const b = state.board;
  if (!b) return `<div class="empty">${t("loading")}</div>`;
  const offers = offerRows(b);
  if (b.sacked) {
    return `<div class="ph-card"><h3 class="ph-h">${t("bd-sacked")}</h3>
      <p class="ph-note">${b.sacked_mid ? tf("bd-sacked-sub-mid", { t: esc(teamName(state.career.user_team)), p: b.position ?? "-", g: (b.target || {}).league ?? "-" })
        : tf("bd-sacked-sub", { t: esc(teamName(state.career.user_team)) })}</p></div>${offers}`;
  }
  const tg = b.target || {};
  const gap = b.position && tg.league ? b.position - tg.league : null;
  const track = gap == null ? t("bd-now-none") : `${tf("bd-now", { p: b.position })} · ${gap <= 0 ? t("bd-on-track") : tf("bd-off-track", { n: gap })}`;
  const last = b.last ? tf("bd-last", { p: b.last.position, t: b.last.target, d: b.last.conf }) + (b.last.bonus ? tf("bd-bonus", { b: money(b.last.bonus) }) : "") : "";
  return `<div class="ph-card"><h3 class="ph-h${b.conf < b.warn ? " warn" : ""}">${tf("bd-conf-line", { c: Math.round(b.conf) })}</h3>${confBar(b)}
      <p class="ph-note">${t("bd-goal")}：<b>${goalText(tg)}</b> · ${track}${tg.ucl ? ` · ${tf("bd-ucl-goal", { t: tg.ucl })}${b.ucl_position ? ` (${b.ucl_position})` : ""}` : ""}</p>
      ${b.strikes ? `<p class="ph-note buff">${tf("bd-strike", { s: b.sack })}</p>` : ""}
      ${last ? `<p class="ph-note">${last}</p>` : ""}
      <div class="ph-btns">${phBtn(t("standings"), "ph-go", ` data-go="table"`)}${state.career.history.length ? phBtn(t("seasons"), "ph-go", ` data-go="seasons"`) : ""}</div></div>
    <h3 class="ph-sub">${t("bd-offers")}</h3>${offers || `<div class="empty">${t("bd-no-offers")}</div>`}${offers ? `<p class="ph-note">${t("bd-poach-hint")}</p>` : ""}
    <p class="ph-note muted">${tf("bd-expected", { e: tg.expected ?? "-", n: tg.n ?? "-" })} ${tf("bd-rules", { w: b.warn, s: b.sack, p: b.poach })}</p>`;
}
function phoneNews(d) {
  const top = `<div class="ph-more">${phBtn(t("ph-all-news"), "ph-go", ` data-go="news"`)}</div>`;
  if (!d.news.length) return top + `<div class="empty">${t("news-none")}</div>`;
  return top + d.news.map((x) => `<div class="ph-news${x.id > d.seen ? " unread" : ""}">${x.p ? phFace(x.p.pid, x.team) : x.team ? emblem(x.team, "md") : `<span class="face-gap"></span>`}
    <div class="grow"><div class="ph-when">${newsWhen(x)}</div><div>${newsText(x)}</div></div></div>`).join("");
}
function phoneTransfers(d) {
  if (!d.transfers.length) return `<div class="empty">${t("ph-no-tr")}</div>`;
  return d.transfers.map((x) => `<div class="ph-news">${phFace(x.p.pid, x.to)}<div class="grow"><div class="ph-when">${esc(x.label || "")}</div><div>${mkLogText(x)}</div></div></div>`).join("");
}
// 手机外壳只在打开时画一次 (入场动画只放这一回); 之后切应用、刷新数据只换状态栏、标签和内容 ——
// 以前每次整个重画, 切个标签整部手机跟着重新滑上来一遍, 看着很僵 (R-84)。
// 选中的标签底下那块白色滑过去 (.ph-ind), 内容从切过去的方向滑进来; 同一个应用里刷新数据不动画、滚动位置留着
function renderPhone(focusFirst = false, dir = 0) {
  const el = $("#phone");
  if (!phone || !el) return;
  const d = phone.data, c = state.career, ph = state.phone || {};
  const keep = !focusFirst && UI.mode !== "pointer" && el.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  const bd = state.board;
  const bdWarn = bd && !bd.sacked && (bd.conf < bd.warn || bd.strikes) ? "!" : 0;
  const tabs = [["msgs", t("ph-msgs"), ph.n], ...(bd ? [["board", t("tile-board"), bdWarn]] : []), ["news", t("ph-news"), ph.unread], ["tr", t("ph-tr"), 0]];
  const when = c.today ? fmtDate(c.today) : c.season_label || "";
  const body = phone.tab === "board" ? phoneBoard() : !d ? `<div class="empty">${t("loading")}</div>`
    : phone.tab === "msgs" ? phoneMsgs(d) : phone.tab === "news" ? phoneNews(d) : phoneTransfers(d);
  let frame = el.querySelector(".ph-frame");
  const first = !frame;
  if (first) {
    el.innerHTML = `<div class="ph-frame"><div class="ph-status"></div><h2 class="ph-title" id="phone-title"></h2>
      <nav class="ph-tabs" role="tablist" data-nav-group="ph-tabs"><span class="ph-ind" aria-hidden="true"></span></nav><div class="ph-body scroller"></div></div>`;
    frame = el.querySelector(".ph-frame");
  }
  $(".ph-status", frame).innerHTML = `<span>${esc(when)}</span><span>${state.market ? money(state.market.cash) : ""}</span>`;
  $(".ph-title", frame).innerHTML = `${emblem(c.user_team, "sm")}${esc(teamName(c.user_team))}`;
  const nav = $(".ph-tabs", frame);
  nav.querySelectorAll(".ph-tab").forEach((x) => x.remove());
  nav.insertAdjacentHTML("beforeend", tabs.map(([k, label, n]) => `<button class="ph-tab${phone.tab === k ? " on" : ""}" role="tab"
    aria-selected="${phone.tab === k}" data-act="ph-tab" data-tab="${k}"${phone.tab === k ? " data-nav-default" : ""}>${esc(label)}${n ? `<span class="n">${n}</span>` : ""}</button>`).join(""));
  // 内容: 换一块新的 (切应用时带方向的滑入); 同一个应用里刷新就原地换, 滚到哪还在哪
  const old = $(".ph-body", frame);
  const same = old.dataset.tab === phone.tab;
  const top = same ? old.scrollTop : 0;
  const prevRows = same ? new Map([...old.querySelectorAll("[data-mk]")].map((el) => [el.dataset.mk, { el, r: el.getBoundingClientRect() }])) : null;
  const flipState = same && window.gsap && window.Flip && prevRows.size ? Flip.getState(old.querySelectorAll("[data-mk]")) : null;   // R-89
  const pane = document.createElement("div");
  pane.className = "ph-body scroller";
  pane.dataset.tab = phone.tab;
  if (phone.tab === "news" || phone.tab === "tr") {   // 新闻、转会是纯文字: 整块能拿焦点, 上下键滚它 (data-scroll-focus, R-20)
    pane.tabIndex = 0;
    pane.dataset.scrollFocus = "";
  }
  pane.innerHTML = body;
  old.replaceWith(pane);
  pane.scrollTop = top;
  phoneInd(nav, !first && dir !== 0);
  phoneMotion(frame, pane, first, prevRows, dir, flipState);
  if (UI.mode !== "pointer") {
    const again = keep && $(keep, el);
    const firstEl = el.querySelector(".ph-body button, .ph-body[tabindex]") || el.querySelector(".ph-tab.on");
    UI.focus(again || firstEl, true);
  }
  renderHints();
}
// 手机的弹性 (R-88, 照 Telegram): 打开时从快讯条的手机按钮那里弹出来、消息一行行升上来;
// 同一个应用里刷新: 新来的消息弹进来, 处理掉的淡出, 其余的从原来的位置滑到新位置 (FLIP)。减少动效时都不动
// R-89: GSAP —— 弹出用 back.out 的回弹、一行行升上来用 stagger、刷新时换位置用 Flip (新来的走 onEnter)、处理掉的影子用 gsap.to
function phoneMotion(frame, pane, first, prevRows, dir, flipState) {
  const G = motion();
  if (!G) return;
  if (first) {
    const b = $(".dock-phone"), fr = frame.getBoundingClientRect();
    let origin = "100% 100%";
    if (b && !b.hidden) {
      const br = b.getBoundingClientRect();
      origin = `${br.left + br.width / 2 - fr.left}px ${br.top + br.height / 2 - fr.top}px`;
    }
    G.from(frame, { scale: 0.25, autoAlpha: 0, transformOrigin: origin, duration: 0.45, ease: "back.out(1.5)", clearProps: "transform,opacity,visibility,transformOrigin" });
  }
  if (dir) {                               // 切应用: 整块带方向滑进来 (R-84), 行不另外动
    G.from(pane, { x: dir * 28, opacity: 0, duration: 0.26, ease: "power3.out", clearProps: "transform,opacity" });
    return;
  }
  const rows = [...pane.querySelectorAll(".ph-msg, .ph-news")].slice(0, 8);
  if (!prevRows || !prevRows.size) {       // 原来没有行 (刚打开、载入中、原来是空的): 一行行升上来
    G.from(rows, { y: 14, autoAlpha: 0, duration: 0.32, ease: "power3.out", stagger: 0.04, delay: first ? 0.09 : 0, clearProps: "all" });
    return;
  }
  if (flipState) {
    // 同一条 (data-flip-id 对得上) 从原来的位置滑到新位置; 新来的带回弹弹进来
    Flip.from(flipState, {
      targets: pane.querySelectorAll("[data-mk]"), duration: 0.32, ease: "power3.out",
      onEnter: (els) => G.fromTo(els, { autoAlpha: 0, scale: 0.86, y: 10 },
        { autoAlpha: 1, scale: 1, y: 0, duration: 0.45, ease: "back.out(1.8)", clearProps: "transform,opacity,visibility" }),
    });
  }
  const now = new Set([...pane.querySelectorAll("[data-mk]")].map((el) => el.dataset.mk));
  for (const [k, { el, r }] of prevRows) {   // 处理掉的: 原地留个影子淡出
    if (now.has(k)) continue;
    const ghost = el.cloneNode(true);
    ghost.classList.add("ph-ghost");
    ghost.removeAttribute("data-flip-id");
    Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    document.body.appendChild(ghost);
    G.to(ghost, { autoAlpha: 0, x: 24, scale: 0.97, duration: 0.26, ease: "power2.in", onComplete: () => ghost.remove() });
  }
}
// 选中标签底下的白块: 挪到选中的那个下面 (切应用时滑过去, 其余时候直接到位)
function phoneInd(nav, animate) {
  const ind = $(".ph-ind", nav), on = $(".ph-tab.on", nav);
  if (!ind || !on) return;
  const to = { x: on.offsetLeft, width: on.offsetWidth };
  const G = animate && motion();
  if (G) G.to(ind, { ...to, duration: 0.36, ease: "back.out(1.3)", overwrite: true });
  else if (window.gsap) gsap.set(ind, { ...to, overwrite: true });
  else Object.assign(ind.style, { width: to.width + "px", transform: `translateX(${to.x}px)` });
}
// 点手机外面 (那层暗色): 关上
document.addEventListener("click", (e) => { if (phoneOpen() && e.target === $("#phone")) closePhone(); });

// ------------------------------------------------------------ 结束赛季 (R-85)
// 赛季踢完以后「下一场」那块是「结束赛季…」, 点进这一页: 合同到期的人逐个定 (主力 / 轮换 / 明星以上必须定, 边缘不选就放走),
// 退役去向的入口, 确认以后会发生什么; 「确认结束赛季」必须定的都定了才能按, 按了再问一句
async function openSeasonEnd(nav = "push") {
  const seq = ++openSeq;
  let v;
  try {
    v = await api("/api/season/end");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const mine = state.career.user_team;
  const row = (r) => {
    const who = pname(r);
    const tag = r.request ? `<span class="fit-tag inj">${t("se-req")}</span>` : r.must ? (r.gone ? "" : `<span class="fit-tag ban">${t("se-must")}</span>`)
      : `<span class="fit-tag">${t("se-fringe")}</span>`;
    const acts = r.gone ? `<span class="fit-tag inj">${t("se-gone")}</span>${phBtn(t("se-undo"), "se-undo", ` data-pid="${r.pid}" data-who="${who}"`, " ghost")}`
      : (r.request ? "" : phBtn(`${t("se-renewed")} · ${money(r.ask_wage)}`, "se-renew", ` data-pid="${r.pid}" data-who="${who}"`, " primary"))
        + phBtn(t("ph-let-go"), "se-go", ` data-pid="${r.pid}" data-who="${who}"`) + phBtn(t("ph-talk"), "exp-talk", ` data-pid="${r.pid}"`, " ghost");
    return `<div class="row se-row${r.must && !r.gone ? " must" : ""}${r.gone ? " gone" : ""}">${phFace(r.pid, mine)}
      <div class="grow"><div><b>${who}</b> <span class="muted">${esc(r.position || "")} · ${r.age ?? ""} · ${r.overall ?? ""}</span> ${tag}</div>
        <div class="muted">${tf("se-terms", { a: money(r.wage_now), b: money(r.ask_wage), y: r.ask_years })}</div></div>
      <div class="se-acts">${acts}</div></div>`;
  };
  const left = fillPanel(v.expiring.length ? v.expiring.map(row).join("") : `<div class="empty">${t("se-none")}</div>`,
    `<h2 class="panel-head">${t("se-contracts")} <span class="muted">${v.expiring.length}</span></h2>`);
  const ready = !v.blockers;
  const right = fillPanel(`<p class="hero-note">${tf("se-sub", { n: v.next_label || tf("season", { n: v.season + 1 }) })}</p>
    ${v.retire_open ? `<div class="row se-row">${esc(tf("se-retire", { n: v.retire_open }))}<div class="se-acts">${phBtn(t("se-go-retire"), "se-retire")}</div></div>` : ""}
    <p class="se-state ${ready ? "ok" : "warn"}" aria-live="polite">${esc(ready ? t("se-ready") : tf("se-blockers", { n: v.blockers }))}</p>
    <div class="hero-actions"><button class="pill primary" data-act="se-confirm"${ready && v.finished && !v.sacked ? "" : " disabled"}>${t("se-confirm")}</button></div>`,
    `<h2 class="panel-head">${esc(v.label || tf("season", { n: v.season }))}</h2>`);
  openModal(glowHtml(mine) + pageHead(t("se-title"), leagueKicker()) + pageBody(`<div class="cols se-cols" data-nav-sides>${left}${right}</div>`),
    false, { label: () => t("se-title"), reopen: (x) => openSeasonEnd(x) }, nav);
}
async function seasonExpire(b, choice) {
  if (busy) return;
  busy = true;
  const who = b.dataset.who || "";
  try {
    const r = await api("/api/season/expire", { pid: Number(b.dataset.pid), choice });
    state = r.state;
    render();
    const res = r.result || {};
    if (res.ok) {
      if (choice === "renew") toast(tf("ph-ok-renew", { p: who, w: money(res.wage), y: res.years }), 3000, true);
      else if (choice === "go") toast(tf("ph-ok-go", { p: who }), 3000, true);
      if (currentView && !$("#modal").hidden) currentView.reopen("replace");
    } else {
      toast(mkWhy(res), 5000);
    }
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}

// ------------------------------------------------------------ X / Y 快捷键 (R-80)
// 按焦点在哪定: 列表的一行里有按钮 -> Y = 第一个、X = 第二个 (不用先往右走到按钮上);
// 没有就看这一页: 主页 Y = 模拟这场、X = 开始比赛; 战术页 Y = 一键排阵、X = 恢复自动。都没有就顶一下。
const FACE_ROW = "tr, .row, .tr-row, .news-row, .tac-row, .mk-row";
function faceAction(which) {
  if (confirmDone || kick || cer || ovOpen()) return null;
  const inPage = !$("#modal").hidden;
  const ph = phoneOpen();
  const layer = ph ? $("#phone") : inPage ? $("#modal") : $("#app");
  const el = document.activeElement;
  const row = el && el !== document.body && layer.contains(el) ? el.closest(FACE_ROW) : null;
  if (row && layer.contains(row)) {
    const btns = [...row.querySelectorAll("button[data-act]:not([disabled])")].filter((b) => b !== row && b.offsetParent !== null);
    const b = btns[which === "y" ? 0 : 1];
    if (b) return { label: b.textContent.replace(/\s+/g, " ").trim(), run: () => b.click() };
    if (btns.length) return null;   // 这一行只有一个按钮: X 没东西, 不落到整页的操作上 (免得以为是这一行的)
  }
  if (ph) return null;
  if (!inPage && state && state.career) {
    const sacked = state.board && state.board.sacked;
    if (state.next && !state.career.finished && !sacked) {
      return which === "y" ? { label: t("sim-mine"), run: () => ACTIONS.sim() } : { label: t("kickoff"), run: () => ACTIONS.kickoff() };
    }
    return null;
  }
  if (inPage && tacOnLineup()) {
    return which === "y" ? { label: t("tac-best"), run: () => ACTIONS["tac-best"]() } : { label: t("tac-auto"), run: () => ACTIONS["tac-auto"]() };
  }
  return null;
}
function faceAct(which) {
  const a = faceAction(which);
  if (!a) return UI.sound("edge");
  UI.sound("ok");
  a.run();
}
// 焦点换了 (换了一行), 提示条上的 X / Y 跟着换; 一帧里只画一次
let hintsRaf = 0;
document.addEventListener("focusin", () => {
  if (UI.mode === "pointer" || hintsRaf) return;
  hintsRaf = requestAnimationFrame(() => { hintsRaf = 0; renderHints(); });
});

function renderHints() {
  syncTabKeys();
  const h = $("#hints");
  const keys = UI.mode === "key";           // 键盘也给提示条 (R-57): 以前只有接手柄才出, 键盘的快捷键哪里都没写
  if (!keys && (UI.mode !== "pad" || !UI.padKind)) {
    h.hidden = true;
    return;
  }
  const g = keys ? { ok: "Enter", back: "Esc", l: "Q", r: "E", l2: "PgUp", r2: "PgDn", view: "Tab", x: "X", y: "Y" }
    : UI.padKind === "ps" ? { ok: "✕", back: "○", l: "L1", r: "R1", l2: "L2", r2: "R2", view: "Create", x: "□", y: "△" }
    : { ok: "A", back: "B", l: "LB", r: "RB", l2: "LT", r2: "RT", view: "View", x: "X", y: "Y" };
  if (phoneOpen()) {   // 手机 (R-82): 确认 / 关上 / 换应用 + 这一行的 X / Y
    const fy = faceAction("y"), fx = faceAction("x");
    h.innerHTML = `<span><kbd class="round">${g.ok}</kbd>${t("hint-ok")}</span><span><kbd class="round">${g.back}</kbd>${t("hint-back")}</span>
      ${fy ? `<span class="hint-face"><kbd class="round">${g.y}</kbd>${esc(fy.label)}</span>` : ""}${fx ? `<span class="hint-face"><kbd class="round">${g.x}</kbd>${esc(fx.label)}</span>` : ""}
      <span><kbd>${g.l}</kbd><kbd>${g.r}</kbd>${t("hint-tabs")}</span>`;
    h.hidden = false;
    return;
  }
  if (ovOpen()) {   // 全部栏目 (R-72): 选中跳过去 / 关上
    h.innerHTML = `<span><kbd class="round">${g.ok}</kbd>${t("ov-go")}</span><span><kbd class="round">${g.back}</kbd>${t("ov-close")}</span>`;
    h.hidden = false;
    return;
  }
  if (kick) {   // 开球时只有两个键
    h.innerHTML = `<span><kbd class="round">${g.ok}</kbd>${t("to-game")}</span><span><kbd class="round">${g.back}</kbd>${t("cancel")}</span>`;
    h.hidden = false;
    return;
  }
  if (cer) {    // 颁奖典礼: 下一项 / 跳过
    h.innerHTML = `<span><kbd class="round">${g.ok}</kbd>${t("cer-next")}</span><span><kbd class="round">${g.back}</kbd>${t("cer-skip")}</span>`;
    h.hidden = false;
    return;
  }
  const inPage = !$("#modal").hidden;
  const layer = inPage ? $("#modal") : $("#app");
  const shoulder = tabHost() ? "hint-tabs" : !inPage && $(".tile") ? "hint-switch" : null;
  const long = [...layer.querySelectorAll(".scroller")].some((s) => s.scrollHeight > s.clientHeight + 1);
  const fy = faceAction("y"), fx = faceAction("x");
  h.innerHTML = `<span><kbd class="round">${g.ok}</kbd>${t("hint-ok")}</span><span><kbd class="round">${g.back}</kbd>${t("hint-back")}</span>
    ${fy ? `<span class="hint-face"><kbd class="round">${g.y}</kbd>${esc(fy.label)}</span>` : ""}${fx ? `<span class="hint-face"><kbd class="round">${g.x}</kbd>${esc(fx.label)}</span>` : ""}
    ${shoulder ? `<span><kbd>${g.l}</kbd><kbd>${g.r}</kbd>${t(shoulder)}</span>` : ""}
    ${long || (!inPage && $(".tile")) ? `<span><kbd>${g.l2}</kbd><kbd>${g.r2}</kbd>${t("hint-page")}</span>` : ""}
    ${!inPage && $(".tile") ? `<span><kbd>${g.view}</kbd>${t("ov-title")}</span>` : ""}
    ${!keys && tacOnLineup() ? `<span><kbd>${UI.padKind === "ps" ? "Options" : "Menu"}</kbd>${t("hint-save")}</span>` : ""}
    ${UI.padKind === "xbox" && !keys ? `<span><kbd>Xbox</kbd>${t("hint-game")}</span>` : ""}`;
  h.hidden = false;
}

// 焦点的「身份」: 重画之后按它找回同一个元素 (手柄操作时重画不能把焦点弄丢)
function focusKey(el) {
  if (!el || el === document.body || !el.dataset) return null;
  if (el.id) return "#" + CSS.escape(el.id);
  for (const a of ["k", "spot", "act", "fixture", "pid", "team", "load", "cid", "add", "mine", "del", "tab", "md", "wl", "dvn"]) {
    const v = el.dataset[a];
    if (v !== undefined) return `${el.tagName.toLowerCase()}[data-${a}="${CSS.escape(v)}"]`;
  }
  return null;
}

// ------------------------------------------------------------ 页面 (全屏, 盖在主页上)
// 页面里再点开别的 (球队 -> 球员、历史对局 -> 战报、往季 -> 球队…) 就把当前这页压栈:
// ← 返回 / × / Esc / ○ 退回上一层, 退到底回主页。
// 每页一个 view: { label: () => 返回按钮上的名字, reopen: (nav) => 重新打开这页 }。
// nav: "push" 压栈打开 (默认) / "replace" 原地重画 (切语言、球员页载完) / "back" 退回来 (不压栈, 恢复滚动和焦点)
// 切换用 View Transitions: 进页放大淡入, 退回缩小淡出; 点的是队徽 / 比分 / 头像时, 它会飞到新页面里对应的位置。
const backStack = [];   // [{ view, scroll, opened, focus }]
let currentView = null;
let backTo = null;      // 正在退回的那层: 它的滚动位置、展开过的折叠块、焦点
let openSeq = 0;        // 每次开页面 +1: 慢请求回来时已经点开了别的, 就别再盖上去
let hubFocus = null;    // 从主页进来时焦点在哪, 回主页时放回去

// 这页展开着的 <details> 序号 (往季的「最终积分榜」): 退回来要照原样展开, 不然滚动位置也对不上
const openedDetails = () => [...document.querySelectorAll("#modal-body details")].flatMap((d, i) => (d.open ? [i] : []));

// 最近一次点 (或 ✕) 的东西: 开新页面时拿它的队徽 / 比分 / 头像做形变
let activated = null;
document.addEventListener("click", (e) => { activated = (e.target.closest && e.target.closest("[data-pid], [data-fixture], [data-team]")) || null; }, true);
function morphSource() {
  const el = activated;
  activated = null;
  if (!el || !el.isConnected) return null;
  if (el.matches("[data-pid]")) return el.matches(".face") ? el : null;
  if (el.matches("[data-fixture]")) return el.querySelector(".s");
  return el.querySelector(".emb");
}

// 页面里画出来就要放一次的入场 (R-89): 积分榜的升降淡入、领奖台二一三站上来、「模拟这场」后的战报 (两队从两边进来, 比分一个个砸下来)
function enterFx(root) {
  const M = motion();
  if (!M || !root) return;
  const mv = root.querySelectorAll(".mv");
  if (mv.length) M.from(mv, { opacity: 0, duration: 0.6, delay: 0.2, ease: "power3.out", clearProps: "opacity" });
  root.querySelectorAll(".podium:not(.cer-podium) .pod").forEach((el) => M.from(el, { y: 28, opacity: 0, duration: 0.55, ease: "expo.out",
    delay: el.classList.contains("r1") ? 0.06 : el.classList.contains("r3") ? 0.12 : 0, clearProps: "transform,opacity" }));
  const rh = root.querySelector(".report-head.reveal");
  if (rh) {
    rh.classList.remove("reveal");
    const side = { opacity: 0, duration: 0.55, ease: "power3.out", clearProps: "transform,opacity" };
    M.timeline()
      .from($(".team.home", rh), { ...side, x: -40 }, 0)
      .from($(".team.away", rh), { ...side, x: 40 }, 0)
      .from(rh.querySelectorAll(".score i"), { opacity: 0, duration: 0.3, ease: "power3.out", clearProps: "opacity" }, 0.2)
      .from(rh.querySelectorAll(".score .d"), { yPercent: -45, scale: 1.3, opacity: 0, filter: "blur(4px)", duration: 0.55, ease: "expo.out",
        stagger: 0.22, clearProps: "transform,opacity,filter" }, 0.3);
  }
}

// view 还可以带: tabs (标签页, 见 renderTab)、ui (这页自己的小状态: 在哪个标签、左栏选中第几个, 退回来照原样)、
// after(页面主体, restored) 画完之后接线 (没有标签的页面用)
function openModal(html, wide = false, view = null, nav = "push") {
  if (typeof nav !== "string") nav = "push";   // 直接当点击回调用时第一个参数是事件
  if (ovOpen()) closeOverview(false);
  const m = $("#modal");
  const here = { scroll: m.scrollTop, scrolls: scrollState($("#modal-body")), opened: openedDetails(), focus: focusKey(document.activeElement),
    ui: currentView && currentView.ui ? { ...currentView.ui } : null };
  if (m.hidden) {
    backStack.length = 0;
    hubFocus = focusKey(document.activeElement);
  } else if (nav === "push" && currentView) {
    backStack.push({ view: currentView, ...here });
  }
  const restore = nav === "back" ? backTo : nav === "replace" ? here : null;
  if (view) {
    view.ui = { ...(view.ui || {}), ...((restore && restore.ui) || {}) };
    view.root = $("#modal-body");
    if (view.tabs && !view.tabs.length) view.tabs = null;
  }
  currentView = view;
  const tabbed = !!(view && view.tabs);
  const prev = backStack[backStack.length - 1];
  const apply = () => {
    const body = $("#modal-body");
    body.classList.toggle("fl-competition-page", !!view?.competitionTabs);
    body.innerHTML = `<div class="page-top"><button class="pill" id="modal-back" data-sound="back" data-nav-skip>← ${esc(tf("back-to", { n: prev ? prev.view.label() : t("home") }))}</button>
      ${prev ? `<button class="pill ghost" data-act="home" data-sound="back" data-nav-skip>${t("home")}</button>` : ""}
      <button class="pill to-game" data-act="game" data-nav-skip>${t("to-game")}</button><span class="clock"></span></div>` + html
      + (tabbed ? tabsHtml(view.tabs, view.ui.tab) + pageBody("", "tabbed") : "");
    tickClock();
    enterFx(body);
    bindLangToggle();   // 球员页页头有语言按钮
    $("#modal-back").addEventListener("click", goBack);
    $(".modal-box").classList.toggle("wide", wide);
    m.hidden = false;
    const details = document.querySelectorAll("#modal-body details");
    for (const i of (restore && restore.opened) || []) if (details[i]) details[i].open = true;
    m.scrollTop = restore ? restore.scroll || 0 : 0;
    // 原地重画 (球员页载完、切语言) 时焦点在返回按钮上不算数: 放到内容里
    const keep = restore && restore.focus && !(nav === "replace" && /modal-back|data-act="(home|game)"/.test(restore.focus)) ? restore : null;
    if (tabbed) {   // 标签页自己管内容、滚动和焦点
      renderTab(view, view.ui.tab, 0, restore ? { scrolls: restore.scrolls, focus: keep && keep.focus } : null);
      return;
    }
    const main = body.querySelector(".page-body");
    if (view && view.after && main) view.after(main, !!restore);
    UI.prepScrollers(body);
    if (restore) restoreScrolls(body, restore.scrolls);
    renderHints();
    if (UI.mode !== "pointer") {
      const el = keep && $(keep.focus, body);
      if (el) UI.focus(el, true);
      else UI.focusDefault(m);
    }
  };
  if (nav === "replace") return apply();
  UI.transition(apply, { dir: nav === "back" ? "back" : "forward", from: nav === "push" ? morphSource() : null,
    to: () => $("#modal-body .morph-target") });
}
function goBack() {
  if (tacLeaveGuard(goBack)) return;
  const prev = backStack.pop();
  if (!prev) return closeModal();
  backTo = prev;
  prev.view.reopen("back");
}
function closeModal() {
  const m = $("#modal");
  backStack.length = 0;
  currentView = null;
  openSeq++;              // 还在路上的请求回来也别再把页面打开
  delete m.dataset.player;
  if (location.hash) history.replaceState(null, "", location.pathname);
  if (m.hidden) return;
  UI.transition(() => {
    m.hidden = true;
    holdCounts = false;
    playCounts();
    renderHints();
    if (UI.mode !== "pointer") {
      const el = hubFocus && $(hubFocus, $("#app"));
      if (el) UI.focus(el, true);
      else UI.focusDefault($("#app"));
    }
  }, { dir: "back" });
}

// ------------------------------------------------------------ 比赛统计 (战报)
// 统计的键和中文名来自 efootball-re 宿主的 LABELS (服务端随战报发 stat_names); 这里只管分组和顺序。
// tests/test_web.py 锁住: 这里的键和 LABELS 一一对应, 不多不少不重复。
const STAT_GROUPS = [
  { id: "sg-attack", keys: ["goals", "assists", "penalty_goals", "penalties_taken", "finesse_goals", "chip_shots", "shots", "shots_on_target",
    "shots_a", "shots_b", "shots_c", "offsides", "corners"] },
  { id: "sg-passing", keys: ["passes", "passes_completed", "ground_passes", "ground_passes_completed",
    "through_passes", "through_passes_completed", "lofted_passes", "lofted_passes_completed",
    "lofted_through_passes", "lofted_through_passes_completed", "crosses", "crosses_completed",
    "low_passes", "low_passes_completed", "high_passes", "high_passes_completed",
    "into_space_passes", "into_space_passes_completed",
    "passes_group_a", "passes_group_a_completed", "passes_group_a_part",
    "passes_group_b", "passes_group_b_completed", "passes_group_b_part",
    "passes_group_c", "passes_group_c_completed", "passes_group_c_part",
    "lofted_through_extra_a", "lofted_through_extra_b"] },
  { id: "sg-possession", keys: ["possession_time", "possessions", "possessions_retained", "ball_receptions",
    "ball_touches", "sprints", "possession_lost", "passes_intercepted",
    "passes_intercepted_a", "passes_intercepted_b", "passes_intercepted_c", "passes_intercepted_d"] },
  { id: "sg-defending", keys: ["tackles", "tackles_won", "interceptions",
    "interceptions_a", "interceptions_b", "interceptions_c", "interceptions_d",
    "ball_recoveries", "recoveries_a", "recoveries_b", "recoveries_c", "duels", "duels_won", "offsides_won"] },
  { id: "sg-gk", keys: ["saves", "saves_alt", "saves_a", "saves_b", "gk_shots_faced", "gk_shots_on_target_faced"] },
  { id: "sg-discipline", keys: ["fouls", "yellow_cards", "red_cards"] },
];
let statNames = {};   // 英文键 -> 中文名 (openReport 从服务端拿)
// 英文界面: 键名本身就是英文 (lofted_through_passes -> Lofted through passes), 不另维护一张表
const statLabel = (k) => (lang === "zh" && statNames[k]) || px("stat." + k) || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " "));
// 「X」和「X_completed」合成一行「成功/尝试」
const statRows = (keys) => keys.filter((k) => !k.endsWith("_completed"))
  .map((k) => ({ key: k, done: keys.includes(k + "_completed") ? k + "_completed" : null }));
// 控球时长: 宿主单位是 1/48 秒
const statValue = (k, v) => (k === "possession_time" ? `${Math.floor(v / 48 / 60)}:${String(Math.round(v / 48) % 60).padStart(2, "0")}` : String(v));
const statCell = (row, s) => {
  const a = s[row.key] || 0;
  if (!row.done) return a ? statValue(row.key, a) : "";
  return a ? `${s[row.done] || 0}/${a}` : "";
};
// 细分项 (A/B/C 类、其中一部分、另一计数) 缩进显示, 不和主项抢眼
const isSubStat = (k) => /_(a|b|c|d|part|alt|extra_a|extra_b)$/.test(k);

// 一行两队对比: 左主右客, 中间是名字和占比条
function mstatRow(row, hs, as) {
  const a = hs[row.key] || 0, b = as[row.key] || 0;
  const pa = a + b ? Math.round((100 * a) / (a + b)) : 50;
  const pct = row.key === "possession_time" && a + b ? ` (${pa}% / ${100 - pa}%)` : "";
  return `<div class="mstat ${isSubStat(row.key) ? "sub" : ""}">
    <b class="l${a > b ? " lead" : ""}">${statCell(row, hs)}</b>
    <div class="mid"><span>${esc(statLabel(row.key))}${row.done ? ` <i class="muted">${t("succ-of")}</i>` : ""}${pct}</span>
      <div class="bar"><i style="width:${pa}%"></i></div></div>
    <b class="r${b > a ? " lead" : ""}">${statCell(row, as)}</b></div>`;
}

// 比赛统计 (完整 76 项): 六组分到三栏里 (哪栏短放哪栏), 一屏看完, 不再一长条往下拉
function matchStatsHtml(f, r) {
  const hs = (r.team_stats || {})[f.home] || {}, as = (r.team_stats || {})[f.away] || {};
  const blocks = STAT_GROUPS.map((g) => {
    const rows = statRows(g.keys).filter((row) => hs[row.key] || as[row.key]);
    return rows.length ? { n: rows.length + 1.5, html: `<div class="mstat-block"><div class="mstat-group">${t(g.id)}</div>${rows.map((row) => mstatRow(row, hs, as)).join("")}</div>` } : null;
  }).filter(Boolean);
  if (!blocks.length) return "";
  const cols = [0, 1, 2].map(() => ({ n: 0, html: "" }));
  for (const b of blocks) {
    const c = cols.reduce((x, y) => (y.n < x.n ? y : x));
    c.n += b.n;
    c.html += b.html;
  }
  return `<div class="mstats-cols">${cols.filter((c) => c.html).map((c) => `<div class="mstats">${c.html}</div>`).join("")}</div>`;
}

// 概况页的主要数据: 从完整统计里挑十来项
const KEY_STATS = ["possession_time", "shots", "shots_on_target", "passes", "tackles", "interceptions", "saves", "corners", "offsides", "fouls", "yellow_cards", "red_cards"];
function keyStatsHtml(f, r) {
  const hs = (r.team_stats || {})[f.home] || {}, as = (r.team_stats || {})[f.away] || {};
  const rows = statRows(STAT_GROUPS.flatMap((g) => g.keys)).filter((row) => KEY_STATS.includes(row.key) && (hs[row.key] || as[row.key]));
  rows.sort((x, y) => KEY_STATS.indexOf(x.key) - KEY_STATS.indexOf(y.key));
  return rows.length ? `<div class="mstats">${rows.map((row) => mstatRow(row, hs, as)).join("")}</div>` : "";
}

function playerStatsHtml(s) {
  return STAT_GROUPS.map((g) => {
    const chips = statRows(g.keys).filter((row) => s[row.key])
      .map((row) => `<span class="motion ${isSubStat(row.key) ? "sub" : ""}">${esc(statLabel(row.key))} <b>${statCell(row, s)}</b></span>`);
    return chips.length ? `<div class="pstat-group"><span class="muted">${t(g.id)}</span>${chips.join("")}</div>` : "";
  }).join("");
}

// 红黄牌画成小牌子 (CSS), 不用 emoji
function cardsBadge(p) {
  const one = (n, cls) => (n ? `<i class="bk ${cls}"></i>${n > 1 ? `<span class="bkn">×${n}</span>` : ""}` : "");
  return one(p.yellow_cards, "y") + one(p.red_cards, "r");
}

// ------------------------------------------------------------ 伤停 (R-21)
// 伤是红色小胶囊、停赛是黄色 (和红黄牌一个意思), 胶囊里都有字, 不只靠颜色; 体能数字低了变橙 / 红
const injType = (x) => t("inj-" + x.type);
// 还要多久: 真实日历写哪天回来, 自选联赛没有日期, 写大约几周
const injWhen = (x) => (x.back ? tf("inj-back", { d: fmtDate(x.back, false) }) : tf("inj-weeks", { n: Math.max(1, Math.ceil((x.days || 0) / 7)) }));
const banText = (b) => `${b.comp && b.comp !== "L" ? `${esc(compName(b.comp))} · ` : ""}${tf("ban-n", { n: b.left })}`;
const condHtml = (c) => `<span class="cond${c < 70 ? " low" : c < 85 ? " mid" : ""}" title="${t("cond-tip")}">${c}</span>`;
// 缺阵名单里的一个人: 名字 + 伤 / 停 (悬停看伤情、停几场)
const fitTag = (x) => (x.why === "inj"
  ? `<span class="fit-tag inj" title="${esc(injType(x))} · ${esc(injWhen(x))}">${t("fit-inj")}</span>`
  : `<span class="fit-tag ban" title="${esc(banText(x))}">${t("fit-ban")}</span>`);
// 球队页、本队表格的「状态」一格: 伤了只写伤情, 不然写体能, 有停赛再跟上
function fitCell(st) {
  if (!st) return "";
  if (st.inj) return `<span class="fit-tag inj">${t("fit-inj")} · ${esc(injWhen(st.inj))}</span>`;
  return condHtml(st.cond) + (st.bans || []).map((b) => `<span class="fit-tag ban">${banText(b)}</span>`).join("");
}
// 「下一场」每队名下一行: 缺阵的前三个, 多了写 +N
function absentLine(list) {
  if (!list || !list.length) return "";
  const names = list.slice(0, 3).map((x) => `${esc(dispPlayer(x).main)}${fitTag(x)}`).join(lang === "zh" ? "、" : ", ");
  return `<div class="absent">${t("absent")} ${names}${list.length > 3 ? ` <span class="n">+${list.length - 3}</span>` : ""}</div>`;
}
// 战报: 这场谁伤了、谁要停赛、谁带伤 / 停赛中上了场
function fitEventsHtml(fit) {
  if (!fit) return "";
  const who = (x) => `<b>${esc(dispPlayer(x).main)}</b>`;
  const line = (x, tag, text, cls = "") => `<div class="fit-ev${cls}">${emblem(x.team, "sm")}${tag}<span>${text}</span></div>`;
  const lines = [
    ...(fit.inj || []).map((x) => line(x, `<span class="fit-tag inj">${t("fit-inj")}</span>`, tf("fx-inj", { p: who(x), t: esc(injType(x)), w: esc(injWhen(x)) }))),
    ...(fit.ban || []).map((x) => line(x, `<span class="fit-tag ban">${t("fit-ban")}</span>`,
      tf("fx-ban", { p: who(x), why: x.why === "red" ? t("why-red") : tf("why-yellow", { n: x.yellows }), b: banText(x) }))),
    ...(fit.bad || []).map((x) => line(x, "", tf(x.why === "inj" ? "fx-bad-inj" : "fx-bad-ban", { p: who(x) }), " bad")),
  ];
  return lines.length ? `<h2 class="panel-head sub-head">${t("fit-title")}</h2><div class="fit-evs">${lines.join("")}</div>` : "";
}

// ------------------------------------------------------------ 成长 (R-23)
// 身份是一枚小徽章 (字 + 颜色, 不只靠颜色); 潜力是球探给的字母 (S 最高), 真实上限不给看
const roleTag = (r) => (r ? `<span class="role-tag ${r}">${t("role-" + r)}</span>` : "");
const gradeTag = (g) => (g ? `<span class="grade g${g}" title="${esc(t("grade-tip"))}">${g}</span>` : "");
function gdelta(v) {
  const n = Math.round((v || 0) * 10) / 10;
  return n ? `<span class="gdelta ${n > 0 ? "up" : "down"}" title="${esc(t("gr-grow-tip"))}">${n > 0 ? "+" : ""}${n}</span>` : "";
}
const gbar = (v, max) => `<span class="gbar"><i style="width:${max ? Math.max(0, Math.min(100, (100 * v) / max)).toFixed(1) : 0}%"></i></span>`;
const pct = (x) => Math.floor((100 * x.prog) / x.need);
// 能力短名 (Finish / LowPass…): 中文界面显示中文名, 英文界面就用短名 (和球员页能力表一样)
// 能力短名的英文 (中文从服务端 state.ab_names 来)
const AB_EN = { OffAware: "Offensive Awareness", BallCtrl: "Ball Control", Dribble: "Dribbling", TightPoss: "Tight Possession",
  LowPass: "Low Pass", LoftPass: "Lofted Pass", Finish: "Finishing", Header: "Heading", SetPiece: "Set Piece Taking", Curl: "Curl",
  DefAware: "Defensive Awareness", Tackle: "Tackling", Aggress: "Aggression", DefEngage: "Defensive Engagement",
  GKAware: "GK Awareness", GKCatch: "GK Catching", GKReflex: "GK Reflexes", GKParry: "GK Parrying", GKReach: "GK Reach",
  Speed: "Speed", Accel: "Acceleration", KickPow: "Kicking Power", Jump: "Jump", Physical: "Physical Contact", Balance: "Balance", Stamina: "Stamina" };
const abName = (k) => (lang === "zh" ? state && state.ab_names && state.ab_names[k] : px("ab." + k) || AB_EN[k]) || k;
// ["Finish", "Finish", "Speed"] -> 射门 +2、速度 +1
function gainText(keys, sign = "+") {
  const n = {};
  for (const k of keys || []) n[k] = (n[k] || 0) + 1;
  return Object.entries(n).map(([k, c]) => `${esc(abName(k))} ${sign}${c}`).join(lang === "zh" ? "、" : ", ");
}
const countsToKeys = (d) => Object.entries(d || {}).flatMap(([k, n]) => Array(n).fill(k));
const seasonOf = (x) => (x.label ? esc(x.label) : tf("season", { n: x.s }));
// 年龄阶段跟着经验倍数走 (倍数是服务端按 GrowthConfig.age_xp 给的)
const stageOf = (f) => (f >= 1.6 ? 1 : f >= 1.3 ? 2 : f >= 1 ? 3 : f >= 0.6 ? 4 : f >= 0.3 ? 5 : 6);
// 在练的 / 练成的: 技能给名字, 位置训练 (R-48) 给「RWF（擅长）」
const skillName = (x) => (x.ab ? esc(abName(x.ab)) : x.pos && !x.skill ? esc(tf("tr-pos-name", { p: x.pos, l: t("apt-" + x.lvl) })) : esc(gname("skill", x.skill_cn, x.skill)));
const pname = (x) => esc(dispPlayer(x).main);
const ROLE_ORDER = ["prospect", "regular", "star", "superstar", "legend"];

// ------------------------------------------------------------ 董事会 (R-26)
const goalText = (tgt) => (!tgt || !tgt.league ? "" : tf("bd-goal-" + tgt.label, { t: tgt.league }));
function confBar(b) {
  const pct = Math.max(0, Math.min(100, b.conf));
  return `<div class="conf-bar" title="${esc(t("bd-conf"))}"><i style="width:${pct}%" class="${b.conf < b.sack ? "low" : b.conf < b.warn ? "mid" : ""}"></i>
    <span class="mark" style="left:${b.sack}%"></span><span class="mark" style="left:${b.warn}%"></span><span class="mark hi" style="left:${b.poach}%"></span></div>`;
}
function offerRows(b) {
  return (b.offers || []).map((o) => `<div class="tr-row">${emblem(o.team, "md")}<div class="grow">${tf(o.kind === "sacked" ? "bd-offer-sacked" : "bd-offer-poach",
    { t: `<b>${esc(teamName(o.team))}</b>`, s: o.strength.toFixed(1), m: b.mine_strength.toFixed(1) })}</div>
    <button class="pill${o.kind === "sacked" ? " primary" : ""}" data-act="bd-accept" data-team="${o.team}">${t("bd-accept")}</button></div>`).join("");
}
function heroSacked() {
  const b = state.board;
  return heroInfo(`<div class="hero-kicker">${t("bd-title")}</div>
    <h1 class="hero-title">${t("bd-sacked")}</h1>
    <p class="hero-note">${b.sacked_mid ? tf("bd-sacked-sub-mid", { t: esc(teamName(state.career.user_team)), p: b.position ?? "-", g: (b.target || {}).league ?? "-" })
      : tf("bd-sacked-sub", { t: esc(teamName(state.career.user_team)) })}</p>`)
    + heroSide(`<div class="hero-panel scroller"><h2 class="panel-head">${t("bd-offers")}</h2>${offerRows(b)}</div>`);
}

// ------------------------------------------------------------ 荣誉和历史 (R-27)
const HN_PARTS = ["form", "att", "def", "tro", "star"];
const fmtScore = (x) => (x == null ? "-" : Number(x).toFixed(1));
const partsText = (parts) => HN_PARTS.filter((k) => parts && parts[k]).map((k) => `${t("hp-" + k)} ${parts[k] > 0 ? "+" : ""}${parts[k]}`).join(" · ");
// 一个奖 / 冠军叫什么: 年度最佳分名次; 真实日历里联赛级的奖带联赛名, 杯赛带赛事名, 大赛带大赛名
function awardLabel(e, world) {
  const k = e.a || e.k;   // 新闻那条的 k 是新闻种类 ("award"), 奖项在 a 里; 荣誉页的条目只有 k
  if (k === "poty") return e.x > 1 ? t("aw-poty-" + e.x) : t(world ? "aw-poty-eu" : "aw-poty");
  const base = t("aw-" + k);
  if (!world || e.x == null) return base;
  if (k === "cup") return compName(e.x);
  if (k === "nat" || k === "nat_boot") return `${t("comp-" + e.x)} · ${base}`;
  return `${leagueName(e.x)} · ${base}`;
}
// 年度评分领奖台 (R-19 的领奖台, 数字换成评分)
function scorePodium(rows) {
  const mine = state.career.user_team;
  const top = rows.slice(0, 3).map((p, i) => ({ p, i }));
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return `<div class="podium">${order.map(({ p, i }) => `
    <figure class="pod r${i + 1}${p.team === mine ? " mine" : ""}">
      ${boardCard(p, { live: "always" })}
      <figcaption>
        <div class="pod-line"><span class="pod-rank">${i + 1}</span><b class="pod-num">${fmtScore(p.score)}</b><span class="pod-unit">${t("unit-pts")}</span></div>
        <div class="pod-name">${esc(dispPlayer(p).main)}</div>
        <div class="pod-team">${emblem(p.team, "sm")}<span>${esc(teamName(p.team))}</span></div>
      </figcaption>
    </figure>`).join("")}</div>`;
}
// 年度评分表: 每一项都写出来 (每个数字都有出处)
// 窄栏: 球队并进球员那一格; 各项用短表头 (悬停看全名)
function raceTable(rows, from = 0) {
  const mine = state.career.user_team;
  return `<table class="compact race"><tr><th class="pos">#</th><th></th><th>${t("th-player")}</th><th class="num">${t("th-apps")}</th>
    <th class="num">${t("th-goals")}</th><th class="num">${t("th-assists")}</th>${HN_PARTS.map((k) => `<th class="num" title="${esc(t("hp-" + k))}">${t("hp-" + k + "-s")}</th>`).join("")}<th class="num">${t("th-score")}</th></tr>
    ${rows.map((p, i) => `<tr class="click${p.team === mine ? " mine" : ""}" tabindex="0" data-pid="${p.pid}"><td class="pos">${from + i + 1}</td><td>${face(p.pid, p.team)}</td>
      <td><div role="link">${pname(p)}</div><div class="teamline">${emblem(p.team, "sm")}${esc(teamName(p.team))}</div></td><td class="num">${p.apps ?? ""}</td><td class="num">${p.goals ?? ""}</td><td class="num">${p.assists ?? ""}</td>
      ${HN_PARTS.map((k) => `<td class="num muted">${p.parts && p.parts[k] ? p.parts[k] : ""}</td>`).join("")}<td class="num"><b>${fmtScore(p.score)}</b></td></tr>`).join("")}</table>`;
}
function bootTable(rows) {
  const mine = state.career.user_team;
  return `<table><tr><th class="pos">#</th><th></th><th>${t("th-player")}</th><th class="num">${t("th-goals")}</th><th class="num">${t("th-apps")}</th></tr>
    ${rows.map((p, i) => `<tr${p.team === mine ? ' class="mine"' : ""}><td class="pos">${i + 1}</td><td>${face(p.pid, p.team)}</td>
      <td><div>${pname(p)}</div><div class="teamline">${emblem(p.team, "sm")}${esc(teamName(p.team))}</div></td>
      <td class="num"><b>${p.goals}</b>${p.weighted != null && p.weighted !== p.goals ? ` <span class="muted">(${p.weighted})</span>` : ""}</td><td class="num muted">${p.apps ?? ""}</td></tr>`).join("")}</table>`;
}
// 一个奖一行: 头像、奖名、谁、数
function awardRow(label, p, val) {
  if (!p) return "";
  return `<div class="aw-row click${p.team === state.career.user_team ? " mine" : ""}" tabindex="0" role="button" data-pid="${p.pid}" data-team="${p.team}">${face(p.pid, p.team)}<div class="grow"><div class="aw-name">${label}</div>
    <div>${pname(p)} <span class="teamline">${emblem(p.team, "sm")}${esc(teamName(p.team))}</span></div></div><span class="n">${val}</span></div>`;
}
// 最佳阵容: 4-3-3 从前锋排到门将
function xiHtml(xi) {
  const by = (ln) => xi.filter((p) => p.line === ln);
  return `<div class="xi">${["FWD", "MID", "DEF", "GK"].map((ln) => `<div class="xi-row">${by(ln).map((p) => `<div class="xi-p${p.team === state.career.user_team ? " mine" : ""}">
    ${face(p.pid, p.team)}<span class="xi-name">${pname(p)}</span><span class="xi-team">${emblem(p.team, "sm")}</span></div>`).join("")}</div>`).join("")}</div>`;
}
// 一季的颁奖: 左边年度最佳领奖台 (真实日历: 欧洲的), 右边其余奖项和最佳阵容
function awardsHtml(s, world) {
  const podium = world && s.europe ? s.europe.poty : s.poty;
  const g = (p) => (p ? `${p.goals} ${t("unit-goals")}` : "");
  const lines = [];
  if (world && s.europe) {
    const e = s.europe;
    lines.push(awardRow(t("aw-eboot"), e.eboot[0], e.eboot[0] ? `${e.eboot[0].goals} · ${e.eboot[0].weighted}` : ""));
    lines.push(awardRow(t("aw-ucl_poty"), e.ucl_poty[0], e.ucl_poty[0] && fmtScore(e.ucl_poty[0].score)));
    lines.push(awardRow(t("aw-ucl_boot"), e.ucl_boot[0], g(e.ucl_boot[0])));
    for (const n of s.nat || []) lines.push(awardRow(`${t("comp-" + n.kind)} · ${t("aw-nat_boot")}`, n.boot[0], g(n.boot[0])));
    lines.push(`<h2 class="panel-head sub-head">${esc(leagueName(s.league))}</h2>`);
    lines.push(awardRow(t("aw-lpoty"), s.poty[0], s.poty[0] && fmtScore(s.poty[0].score)));
  }
  lines.push(awardRow(t("aw-boot"), s.boot[0], g(s.boot[0])));
  lines.push(awardRow(t("aw-assist"), s.assist[0], s.assist[0] ? `${s.assist[0].assists} ${t("unit-assists")}` : ""));
  lines.push(awardRow(t("aw-glove"), s.glove[0], s.glove[0] ? `${s.glove[0].cs} ${t("th-cs")}` : ""));
  lines.push(awardRow(t("aw-young"), s.young[0], s.young[0] && fmtScore(s.young[0].score)));
  const leagues = world && s.leagues ? `<h2 class="panel-head sub-head">${t("hn-leagues")}</h2><table><tr><th></th><th>${t("hn-winner")}</th><th>${t("aw-lpoty")}</th><th>${t("aw-boot")}</th></tr>
    ${Object.entries(s.leagues).map(([cid, x]) => `<tr><td>${esc(leagueName(cid))}</td><td>${x.champion != null ? `<div class="teamcell">${emblem(x.champion)}${esc(teamName(x.champion))}</div>` : ""}</td>
      <td>${x.poty ? `${pname(x.poty)} <span class="muted">${fmtScore(x.poty.score)}</span>` : ""}</td><td>${x.boot ? `${pname(x.boot)} <span class="muted">${x.boot.goals}</span>` : ""}</td></tr>`).join("")}</table>` : "";
  const top = podium[0];
  const head = `<h2 class="panel-head">${t(world ? "aw-poty-eu" : "aw-poty")} <span class="muted">${top ? esc(partsText(top.parts)) : ""}</span></h2>`;
  return `<div class="cols board-cols" data-nav-sides><section class="podium-stage">${head}${podium.length ? scorePodium(podium) : `<div class="empty">${t("no-data")}</div>`}</section>
    ${fillPanel(`${lines.join("")}<h2 class="panel-head sub-head">${t("aw-xi")}</h2>${xiHtml(s.xi)}${leagues}`,
      `<h2 class="panel-head">${esc(s.label || tf("season", { n: s.season }))}
        <button class="pill compact" data-act="ceremony" data-season="${s.season}">${t("cer-replay")}</button></h2>`)}</div>`;
}
// 历届: 一季一行
function rollHtml(seasons, world) {
  return `<table><tr><th class="num">${t("th-season")}</th>${world ? `<th>${t("aw-poty-eu")}</th>` : ""}<th>${t(world ? "aw-lpoty" : "aw-poty")}</th>
    <th>${t("aw-boot")}</th><th>${t("hn-winner")}</th></tr>
    ${seasons.map((s) => { const eu = s.europe && s.europe.poty[0], p = s.poty[0], b = s.boot[0];
      return `<tr><td class="num">${esc(s.label || s.season)}</td>${world ? `<td>${eu ? `${face(eu.pid, eu.team)} ${pname(eu)}` : ""}</td>` : ""}
      <td>${p ? `${face(p.pid, p.team)} ${pname(p)}` : ""}</td><td>${b ? `${pname(b)} <span class="muted">${b.goals}</span>` : ""}</td>
      <td>${s.champion != null ? `<div class="teamcell">${emblem(s.champion)}${esc(teamName(s.champion))}</div>` : ""}</td></tr>`; }).join("")}</table>`;
}
const HOF_BITS = ["awards", "trophies", "goals", "apps", "role", "legacy"];
const bitsText = (b) => HOF_BITS.filter((k) => b && b[k]).map((k) => `${t("hof-b-" + k)} ${b[k]}`).join(" · ");
function coachStatus(x) {
  if (!x) return "";
  if (x.status === "head") return tf("co-st-head", { t: esc(teamName(x.team)) });
  if (x.status === "badge") return tf("co-st-badge", { s: esc(x.ready_label) });
  return t("co-st-" + x.status);
}
function hofHtml(h) {
  const rule = `<p class="hero-note">${tf("hof-rule", { n: h.rules.hof_line })}</p>`;
  if (!h.hof.length) return fillPanel(`${rule}<div class="empty">${t("hof-none")}</div>`);
  return fillPanel(`${rule}<table><tr><th></th><th>${t("th-player")}</th><th>${t("th-pos")}</th><th>${t("hof-main")}</th><th>${t("th-season")}</th>
      <th class="num">${t("unit-pts")}</th><th></th><th>${t("nt-coach")}</th></tr>
    ${h.hof.map((x) => `<tr class="click" tabindex="0" data-pid="${x.pid}"><td>${face(x.pid, x.team)}</td><td><span role="link">${pname(x)}</span></td><td>${esc(x.pos || "")}</td>
      <td><div class="teamcell">${emblem(x.team)}${esc(teamName(x.team))}</div></td><td>${esc(x.label)}</td><td class="num"><b>${fmtScore(x.pts)}</b></td>
      <td class="muted">${esc(bitsText(x.bits))}</td><td class="muted">${x.coach ? coachStatus(x.coach) : ""}</td></tr>`).join("")}</table>`);
}
function legendLine(x, extra = "") {
  return `<div class="tr-row click" tabindex="0" role="button" data-pid="${x.pid}">${face(x.pid, x.main)}<div class="grow"><div>${pname(x)} <span class="muted">${esc(x.position || "")}</span>${x.hof ? `<span class="fit-tag hof">${t("hof-tag")}</span>` : ""}</div>
    <div class="muted">${emblem(x.main, "sm")} ${esc(teamName(x.main))} · ${tf("co-pr", { p: fmtScore(x.pr), c: x.ceiling })} · ${coachStatus(x)}</div></div>${extra}</div>`;
}
function coachesHtml(co) {
  const staff = co.staff.map((x) => legendLine(x, `<button class="pill" data-act="hn-release" data-pid="${x.pid}" data-who="${pname(x)}">${t("co-release")}</button>`)
    + (x.skills.length ? `<div class="chips co-skills">${x.skills.map((k) => `<span class="skill">${esc(gname("skill", k.cn, k.en))}</span>`).join("")}</div>` : "")).join("");
  const pool = co.pool.map((x) => legendLine(x, x.why ? `<span class="muted co-why">${t("co-why-" + x.why)}</span>`
    : `<button class="pill primary" data-act="hn-hire" data-pid="${x.pid}" data-who="${pname(x)}">${t("co-hire")}</button>`)).join("");
  const heads = co.head.map((x) => `<div class="tr-row click" tabindex="0" role="button" data-pid="${x.pid}">${face(x.pid, x.team)}<div class="grow"><div>${pname(x)}${x.hof ? `<span class="fit-tag hof">${t("hof-tag")}</span>` : ""}</div>
    <div class="muted">${emblem(x.team, "sm")} ${esc(teamName(x.team))} · ${tf("co-since", { s: esc(x.since_label || "") })}</div></div></div>`).join("");
  const left = `<p class="hero-note">${tf("co-rule", { m: co.mentor_skill, a: co.aura_age, x: co.aura, n: co.max })}</p>
    <p><b class="n">${tf("co-slots", { a: co.slots, b: co.base_slots, c: co.staff.length })}</b></p>
    ${staff || `<div class="empty">${t("co-empty-staff")}</div>`}`;
  const right = `<p class="hero-note">${tf("co-pool-rule", { g: co.gap })}</p>${pool || `<div class="empty">${t("co-empty-pool")}</div>`}
    <h2 class="panel-head sub-head">${t("co-heads")}</h2>${heads || `<div class="empty">${t("co-empty-heads")}</div>`}`;
  return `<div class="cols" data-nav-sides>${fillPanel(left, `<h2 class="panel-head">${t("co-staff")} <span class="muted">${co.staff.length} / ${co.max}</span></h2>`)}
    ${fillPanel(right, `<h2 class="panel-head">${t("co-pool")}</h2>`)}</div>`;
}
function recordsHtml(h) {
  const r = h.records;
  const tbl = (rows, key) => `<table><tr><th class="pos">#</th><th></th><th>${t("th-player")}</th><th class="num">${t("th-goals")}</th><th class="num">${t("th-apps")}</th><th class="num">${t("th-assists")}</th></tr>
    ${rows.map((p, i) => `<tr><td class="pos">${i + 1}</td><td>${face(p.pid)}</td><td>${pname(p)}</td><td class="num">${key === "goals" ? `<b>${p.goals}</b>` : p.goals}</td>
      <td class="num">${key === "apps" ? `<b>${p.apps}</b>` : p.apps}</td><td class="num muted">${p.assists || ""}</td></tr>`).join("")}</table>`;
  if (!r.scorers.length && !h.trophies.length) return `<section class="panel"><div class="empty">${t("rc-none")}</div></section>`;
  const sb = r.season;
  const left = `${sb ? `<div class="aw-row">${face(sb.pid, sb.team)}<div class="grow"><div class="aw-name">${t("rc-season")}</div>
      <div>${tf("rc-season-line", { p: pname(sb), n: sb.goals, s: esc(sb.label) })} <span class="teamline">${emblem(sb.team, "sm")}${esc(teamName(sb.team))}</span></div></div></div>` : ""}
    <h2 class="panel-head sub-head">${t("rc-scorers")}</h2>${tbl(r.scorers, "goals")}<h2 class="panel-head sub-head">${t("rc-apps")}</h2>${tbl(r.apps, "apps")}`;
  const world = h.europe;
  const inv = (h.invincible || []).length ? `<h2 class="panel-head sub-head">${t("rc-invincible")}</h2>${h.invincible.map((x) => `<div class="tr-row click" tabindex="0" role="button" data-team="${x.team}">
      ${emblem(x.team)}<div class="grow"><div>${esc(teamName(x.team))}</div><div class="muted">${esc(tf("rc-inv-line", { s: x.label, l: x.league != null ? leagueName(x.league) : state.career.league_name || "", w: x.won, d: x.drawn, pts: x.points }))}</div></div></div>`).join("")}` : "";
  const right = `${inv}<table><tr><th></th><th>${t("th-team")}</th><th class="num">${t("th-titles")}</th>${world ? `<th class="num">${t("th-cups")}</th><th class="num">${t("th-ucl")}</th>` : ""}</tr>
    ${h.trophies.map((x, i) => `<tr${x.team === state.career.user_team ? ' class="mine"' : ""}><td class="pos">${i + 1}</td><td><div class="teamcell">${emblem(x.team)}${esc(teamName(x.team))}</div></td>
      <td class="num">${x.title || ""}</td>${world ? `<td class="num">${x.cup || ""}</td><td class="num">${x.ucl || ""}</td>` : ""}</tr>`).join("")}</table>`;
  return `<div class="cols" data-nav-sides>${fillPanel(left, `<h2 class="panel-head">${t("hn-tab-records")}</h2>`)}${fillPanel(right, `<h2 class="panel-head">${t("rc-trophies")}</h2>`)}</div>`;
}
function raceHtml(h) {
  const rows = h.race.poty;
  const note = `<p class="hero-note">${t("hn-race-note")} ${tf("hn-score-rule", { e: Math.round(h.rules.elig * 100) })}${h.europe ? " " + tf("hn-score-rule-eu", { g: h.rules.europe_games }) : ""}</p>`;
  if (!rows.length) return `<section class="panel">${note}<div class="empty">${t("hn-race-empty")}</div></section>`;
  return `<div class="cols board-cols" data-nav-sides><section class="podium-stage"><h2 class="panel-head">${t(h.europe ? "hn-race-eu" : "hn-race")}</h2>${scorePodium(rows)}</section>
    ${fillPanel(`${note}${raceTable(rows)}<h2 class="panel-head sub-head">${t("hn-boot-race")}</h2>${bootTable(h.race.boot)}`)}</div>`;
}
async function openHonors(nav = "push", tab = null) {
  const seq = ++openSeq;
  let h;
  try {
    h = await api("/api/honors");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const mine = state.career.user_team, latest = h.seasons[0];
  const lead = (h.race.poty[0] || {}).team;
  const view = { label: () => t("hn-title"), reopen: (n) => openHonors(n), ui: { tab: tab || (h.race.poty.length || !latest ? "race" : "awards") } };
  const none = `<section class="panel"><div class="empty">${t("hn-no-awards")}</div></section>`;
  view.tabs = [
    { k: "race", label: t("hn-tab-race"), html: () => raceHtml(h), after: () => { if (lead != null) swapGlow($("#modal-body"), lead); } },
    { k: "awards", label: t("hn-tab-awards"), html: () => (latest ? awardsHtml(latest, h.europe) : none),
      after: () => { const w = latest && ((latest.europe || latest).poty[0] || {}).team; if (w != null) swapGlow($("#modal-body"), w); } },
    { k: "seasons", label: t("hn-tab-seasons"), html: () => (h.seasons.length ? fillPanel(rollHtml(h.seasons, h.europe)) : none) },
    { k: "hof", label: t("hn-tab-hof"), html: () => hofHtml(h) },
    { k: "coaches", label: t("hn-tab-coaches"), html: () => coachesHtml(h.coaches) },
    { k: "records", label: t("hn-tab-records"), html: () => recordsHtml(h) },
  ];
  const meta = [h.hof.length ? tf("hn-hof-n", { n: h.hof.length }) : "", latest && (latest.europe || latest).poty[0]
    ? tf("hn-last", { p: pname((latest.europe || latest).poty[0]) }) : t("hn-first")].filter(Boolean).join(" · ");
  openModal(glowHtml(lead ?? mine) + pageHead(t("hn-title"), leagueKicker(), meta), true, view, nav);
}
// 主页「荣誉」: 年度最佳候选前五和评分; 上季的年度最佳; 名人堂几人
function heroHonors() {
  const b = state.honors, lead = b.race[0];
  const rows = b.race.map((p, i) => `<div class="tr-row">${face(p.pid, p.team)}<div class="grow"><div>${i + 1}. ${pname(p)} <span class="muted">${esc(teamName(p.team))}</span></div>
    <div class="muted">${esc(partsText(p.parts))}</div></div><span class="n">${fmtScore(p.score)}</span></div>`).join("");
  const boot = b.boot.map((p) => `<div class="tr-row">${face(p.pid, p.team)}<div class="grow">${pname(p)} <span class="muted">${esc(teamName(p.team))}</span></div><span class="n">${p.goals}</span></div>`).join("");
  return heroInfo(`<div class="hero-kicker">${t("hn-title")}</div>
    <h1 class="hero-title">${lead ? tf("hn-race-lead", { p: pname(lead), s: fmtScore(lead.score) }) : t(b.europe ? "hn-race-eu" : "hn-race")}</h1>
    <div class="hero-meta">${[b.last && b.last.poty ? tf("hn-last", { p: pname(b.last.poty) }) : t("hn-first"), b.hof ? tf("hn-hof-n", { n: b.hof }) : ""].filter(Boolean).join(" · ")}</div>
    <div class="hero-actions"><button class="pill" data-act="open-honors">${t("hn-open")}</button>
      <button class="pill" data-act="open-honors" data-tab="hof">${t("hn-tab-hof")}</button><button class="pill" data-act="open-honors" data-tab="coaches">${t("hn-tab-coaches")}</button></div>
    <p class="hero-note">${t("hn-race-note")}</p>`)
    + heroSide(`<div class="hero-panel scroller"><h2 class="panel-head">${t(b.europe ? "hn-race-eu" : "hn-race")}</h2>${rows || `<div class="empty">${t("hn-race-empty")}</div>`}
      ${boot ? `<h2 class="panel-head sub-head">${t("hn-boot-race")}</h2>${boot}` : ""}</div>`);
}
async function staffAct(b, hire) {
  if (busy) return;
  const who = b.dataset.who;
  // 请人随时能请走, 不用确认; 请走会停掉多出来的训练, 要确认
  if (!hire && !(await askConfirm(tf("co-release-confirm", { p: who }), t("co-release"), true))) return;
  busy = true;
  try {
    const r = await api("/api/honors/staff", { pid: Number(b.dataset.pid), hire });
    state = r.state;
    render();
    if (r.result && r.result.ok) toast(tf(hire ? "co-ok-hire" : "co-ok-release", { p: who }), 3000);
    else toast(t("co-why-" + ((r.result || {}).why || "who")));
    if (currentView) currentView.reopen("replace");
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}
// 球员页「荣誉」: 左边这个存档里的生涯和名人堂, 右边奖项和冠军、教练生涯
function playerHonorsHtml(p) {
  const h = p.honors, world = isWorld();
  const c = h.career;
  const clubs = c ? c.clubs.map(([tid, n]) => `<div class="tr-row">${emblem(tid, "md")}<div class="grow">${esc(teamName(tid))}</div><span class="n">${tf("ph-seasons-n", { n })}</span></div>`).join("") : "";
  const hof = h.hof ? `<div class="hof-card"><span class="fit-tag hof">${t("hof-tag")}</span> <b>${tf("hof-in", { s: esc(h.hof.label), n: fmtScore(h.hof.pts) })}</b>
      <div class="muted">${esc(bitsText(h.hof.bits))}</div></div>`
    : h.hof_now ? `<p class="muted">${tf("hof-now", { n: fmtScore(h.hof_now.pts), l: h.hof_line })} · ${esc(bitsText(h.hof_now.bits))}</p>` : "";
  const left = `${hof}${c ? `<div class="gr-line"><span>${t("ph-career")}</span><b class="n">${tf("ph-line", { s: c.seasons, a: c.apps, g: c.goals, as: c.assists })}</b></div>
      ${c.peak_ovr ? `<div class="gr-line"><span></span><span>${tf("ph-peak", { o: c.peak_ovr })}${c.peak_role ? roleTag(c.peak_role) : ""}</span></div>` : ""}` : ""}
    ${h.now ? `<div class="gr-line"><span></span><span>${tf("ph-now", { s: fmtScore(h.now.score) })} <span class="muted">${esc(partsText(h.now.parts))}</span></span></div>` : ""}
    ${clubs ? `<h2 class="panel-head sub-head">${t("ph-clubs")}</h2>${clubs}` : ""}`;
  const list = h.list.map((e) => `<div class="tr-row"><span class="fit-tag ${TROPHY_KINDS.includes(e.k) ? "up" : "hof"}">${esc(e.label)}</span>
    <div class="grow">${esc(awardLabel(e, world))}</div>${e.team != null ? `${emblem(e.team, "sm")}<span class="muted">${esc(teamName(e.team))}</span>` : ""}</div>`).join("");
  const btn = !h.coach ? "" : h.coach.status === "staff"
    ? `<button class="pill" data-act="hn-release" data-pid="${p.pid}" data-who="${esc(cardDisplayName(p))}">${t("co-release")}</button>`
    : h.coach.why === null ? `<button class="pill primary" data-act="hn-hire" data-pid="${p.pid}" data-who="${esc(cardDisplayName(p))}">${t("co-hire")}</button>`
    : h.coach.why ? `<span class="muted co-why">${t("co-why-" + h.coach.why)}</span>` : "";
  const co = h.coach ? `<h2 class="panel-head sub-head">${t("ph-coach")}</h2><div class="tr-row"><div class="grow">${coachStatus(h.coach)}
      <div class="muted">${tf("co-pr", { p: fmtScore(h.coach.pr), c: h.coach.ceiling })}</div></div>${btn}</div>
    ${(h.coach.hist || []).map(([label, tid]) => `<div class="tr-row"><span class="fit-tag">${esc(label)}</span>
      <div class="grow">${tid === -1 ? t("co-st-staff") : `${emblem(tid, "sm")} ${esc(teamName(tid))}`}</div></div>`).join("")}` : "";
  return `<div class="cols" data-nav-sides>${fillPanel(left || `<div class="empty">${t("ph-list-none")}</div>`, `<h2 class="panel-head">${t("ph-career")}</h2>`)}
    ${fillPanel(`${list || `<div class="empty">${t("ph-list-none")}</div>`}${co}`, `<h2 class="panel-head">${t("ph-list")}</h2>`)}</div>`;
}
const TROPHY_KINDS = ["title", "cup", "ucl", "nat"];
// 球队页页头: 主教练 (你 / 传奇 / dt200 的教练)、荣誉室、俱乐部传奇
function teamHonorsLine(team) {
  const co = team.coach;
  const who = !co ? "" : co.k === "you" ? t("co-you") : co.k === "L" ? `${pname(co)}<span class="fit-tag learn">${t("co-legend-tag")}</span>`
    : esc(lang === "zh" ? co.name : co.roman || co.name);
  const tr = team.trophies;
  const legends = (team.legends || []).map((x) => `<span class="leg">${face(x.pid, team.id)}${pname(x)}</span>`).join("");
  return `${co ? `<div class="hero-meta">${tf("co-line", { c: who })}</div>` : ""}
    ${tr && (tr.title || tr.cup || tr.ucl || tr.inv) ? `<div class="hero-meta">${tf("tm-trophies", { a: tr.title, b: tr.cup, c: tr.ucl })}${tr.inv ? esc(tf("tm-inv", { n: tr.inv })) : ""}</div>` : ""}
    ${legends ? `<div class="hero-meta legends">${t("tm-legends")}：${legends}</div>` : ""}`;
}
// 往季页: 这季的年度最佳和金靴
function seasonHonorsHtml(h) {
  if (!h) return "";
  const line = h.poty ? tf("sl-honors", { p: pname(h.poty), b: h.boot ? pname(h.boot) : "-", n: h.boot ? h.boot.goals : 0 }) : "";
  const eu = h.europe ? tf("sl-honors-eu", { p: pname(h.europe) }) : "";
  return line || eu ? `<h2 class="panel-head sub-head">${t("hn-tab-awards")} <span class="muted">${[eu, line].filter(Boolean).join(" · ")}</span></h2>` : "";
}

// ------------------------------------------------------------ 赛季颁奖典礼 (R-28)
// 换季时整屏放一遍刚踢完那季的故事: 冠军 → 你的赛季 (名次、董事会) → 年度最佳 (第三、第二、第一依次揭晓) → 其他奖项
// → 最佳阵容 (从门将往前一个个站上球场) → 名人堂 → 传奇的下一站 → 新赛季。荣誉页「颁奖」能回放。
// ✕ / A / 回车 / 点一下: 这一幕还在揭晓就直接揭完, 揭完了就下一幕; ○ / B / Esc: 跳到最后一幕。每幕停一会儿自己往下走。
let cer = null;   // 正在放的典礼: { d, steps, i, timers, revealed, focus, closed, replay }
const CER_HOLD = { champion: 4800, mine: 5600, poty: 7600, awards: 6000, xi: 6600, hof: 6000, legacy: 5600 };
const cerName = (tid) => {
  const n = cer && cer.d.names && cer.d.names[tid];
  return n ? (lang === "zh" ? n.zh : n.latin || n.zh) : teamName(tid);
};
// 典礼里的头像不能点 (点了会在典礼下面开球员页)
const cerFace = (pid, cls = "", team = 0) => `<img class="face ${cls}" src="${img("face", pid)}" ${faceErr(team)} alt="">`;
function cerAwards(d) {
  const hn = d.honors, out = [];
  const add = (label, p, val, unit, dec = 0) => { if (p) out.push({ label, p, val, unit, dec }); };
  if (d.world && hn.europe) {
    const e = hn.europe;
    add(t("aw-eboot"), e.eboot[0], e.eboot[0] && e.eboot[0].goals, t("unit-goals"));
    add(t("aw-ucl_poty"), e.ucl_poty[0], e.ucl_poty[0] && e.ucl_poty[0].score, t("unit-pts"), 1);
    add(t("aw-ucl_boot"), e.ucl_boot[0], e.ucl_boot[0] && e.ucl_boot[0].goals, t("unit-goals"));
    add(`${esc(leagueName(hn.league))} · ${t("aw-lpoty")}`, hn.poty[0], hn.poty[0] && hn.poty[0].score, t("unit-pts"), 1);
  }
  add(t("aw-boot"), hn.boot[0], hn.boot[0] && hn.boot[0].goals, t("unit-goals"));
  add(t("aw-assist"), hn.assist[0], hn.assist[0] && hn.assist[0].assists, t("unit-assists"));
  add(t("aw-glove"), hn.glove[0], hn.glove[0] && hn.glove[0].cs, t("th-cs"));
  add(t("aw-young"), hn.young[0], hn.young[0] && hn.young[0].score, t("unit-pts"), 1);
  for (const n of hn.nat || []) add(`${t("comp-" + n.kind)} · ${t("aw-nat_boot")}`, n.boot[0], n.boot[0] && n.boot[0].goals, t("unit-goals"));
  return out;
}
const cerPoty = (d) => (d.honors ? ((d.world && d.honors.europe ? d.honors.europe.poty : d.honors.poty) || []) : []);
function cerSteps(d) {
  const steps = ["champion"];
  if (d.position) steps.push("mine");
  if (cerPoty(d).length) steps.push("poty");
  if (d.honors && cerAwards(d).length) steps.push("awards");
  if (d.honors && d.honors.xi && d.honors.xi.length === 11) steps.push("xi");
  if (d.hof.length) steps.push("hof");
  if (d.coaches.length || d.farewell.length) steps.push("legacy");
  steps.push("next");
  return steps;
}
const cerSeason = (d) => (d.label || tf("season", { n: d.season }));
const cerLeague = (d) => (d.world ? leagueName(d.league) : state.career.league_name);
// 一个会滚的数: data-to 终值, data-dec 小数位 (揭晓时从 0 滚上去)
const cerNum = (v, dec = 0, cls = "n") => `<b class="${cls}" data-to="${v}" data-dec="${dec}">${Number(0).toFixed(dec)}</b>`;
// 一幕的内容。rv + data-at: 这一幕开始后多少毫秒揭晓 (data-snd: 揭晓时的音效)
function cerStepHtml(k, d) {
  const hn = d.honors, mine = d.user_team;
  if (k === "champion") {
    const ch = d.champion;
    const extra = [d.ucl != null ? [d.ucl, t("cer-ucl")] : null, ...d.national.map((n) => [n.winner, `${n.year} ${t("comp-" + n.kind)}`])].filter(Boolean);
    return `<div class="cer-trophy rv" data-at="150" data-snd="fanfare">${emblem(ch.team, "xl")}<span class="cer-burst" aria-hidden="true"></span></div>
      <div class="hero-kicker">${esc(cerLeague(d))} · ${esc(cerSeason(d))}</div>
      <h1 class="cer-title rv" data-at="500">${tf("cer-champ-title", { t: esc(cerName(ch.team)) })}</h1>
      <div class="cer-meta rv" data-at="900">${cerNum(ch.points)} ${t("pts")} · ${tf("w-d-l", { w: ch.won, d: ch.drawn, l: ch.lost })}</div>
      ${extra.map(([tid, what], i) => `<div class="cer-sub rv" data-at="${1700 + i * 450}">${emblem(tid, "md")}<span>${esc(what)} · <b>${esc(cerName(tid))}</b></span></div>`).join("")}`;
  }
  if (k === "mine") {
    const b = d.board, sb = state.board || { sack: 20, warn: 35, poach: 75 };
    const before = b ? Math.max(0, Math.min(100, b.conf - b.delta)) : null;
    const mv = d.moves && (d.moves.up.includes(mine) ? "up" : d.moves.down.includes(mine) ? "down" : null);
    return `<div class="hero-kicker">${t("cer-mine-kicker")} · ${esc(cerSeason(d))}</div>
      <div class="cer-mine-head rv" data-at="150">${emblem(mine, "lg")}<div class="cer-pos">${cerNum(d.position, 0, "")}<span>/ ${d.n}</span></div></div>
      <h1 class="cer-title rv" data-at="400">${tf("cer-mine-title", { t: esc(cerName(mine)), p: d.position })}</h1>
      ${mv ? `<div class="cer-sub rv" data-at="800"><span class="fit-tag ${mv === "up" ? "up" : "inj"}">${t("cer-" + mv)}</span></div>` : ""}
      ${b ? `<div class="cer-board rv" data-at="1100" data-snd="${b.met ? "reveal" : ""}">
        <div class="cer-verdict ${b.met ? "met" : "miss"}">${tf("cer-board", { t: b.target, r: t(b.met ? "nw-verdict-met" : "nw-verdict-miss") })}</div>
        <div class="conf-bar cer-conf"><i class="${b.conf < sb.sack ? "low" : b.conf < sb.warn ? "mid" : ""}" style="width:${before}%" data-w="${Math.max(0, Math.min(100, b.conf))}"></i>
          <span class="mark" style="left:${sb.sack}%"></span><span class="mark" style="left:${sb.warn}%"></span><span class="mark hi" style="left:${sb.poach}%"></span></div>
        <div class="cer-meta">${t("bd-conf")} ${cerNum(b.conf, 1)} <span class="cer-delta ${b.delta >= 0 ? "up" : "down"}">${b.delta >= 0 ? "+" : "−"}${Math.abs(b.delta)}</span>
          ${b.bonus ? ` · ${tf("cer-bonus", { b: money(b.bonus) })}` : ""}</div>
        ${b.sacked ? `<div class="cer-sacked">${t("cer-sacked")}</div>` : ""}</div>` : ""}`;
  }
  if (k === "poty") {
    const rows = cerPoty(d).slice(0, 3);
    const order = [[rows[1], 2], [rows[0], 1], [rows[2], 3]].filter(([p]) => p);
    const at = { 3: 500, 2: 1700, 1: 3100 };
    return `<div class="hero-kicker">${esc(cerSeason(d))}</div>
      <h1 class="cer-title">${t(d.world && d.honors.europe ? "aw-poty-eu" : "aw-poty")}</h1>
      <div class="podium cer-podium">${order.map(([p, r]) => `<figure class="pod r${r}${p.team === mine ? " mine" : ""} rv" data-at="${at[r]}" data-snd="${r === 1 ? "fanfare" : "reveal"}">
        ${boardCard(p, { live: "always", open: false })}
        <figcaption><div class="pod-line"><span class="pod-rank">${r}</span>${cerNum(p.score, 1, "pod-num")}<span class="pod-unit">${t("unit-pts")}</span></div>
          <div class="pod-name">${esc(dispPlayer(p).main)}</div><div class="pod-team">${emblem(p.team, "sm")}<span>${esc(cerName(p.team))}</span></div></figcaption></figure>`).join("")}</div>
      ${rows[0] ? `<div class="cer-meta rv" data-at="4000">${esc(partsText(rows[0].parts))}</div>` : ""}`;
  }
  if (k === "awards") {
    return `<div class="hero-kicker">${esc(cerSeason(d))}</div><h1 class="cer-title">${t("cer-awards")}</h1>
      <div class="cer-awards">${cerAwards(d).map((a, i) => `<div class="cer-aw${a.p.team === mine ? " mine" : ""} rv" data-at="${250 + i * 220}"${i === 0 ? ' data-snd="reveal"' : ""}>
        <div class="aw-name">${a.label}</div>${cerFace(a.p.pid, "", a.p.team || a.team)}<div class="cer-aw-who">${esc(dispPlayer(a.p).main)}</div>
        <div class="teamline">${emblem(a.p.team, "sm")}${esc(cerName(a.p.team))}</div>
        <div class="val">${cerNum(a.val, a.dec, "")} <span class="unit">${a.unit}</span></div></div>`).join("")}</div>`;
  }
  if (k === "xi") {
    const xi = hn.xi;
    const lines = ["FWD", "MID", "DEF", "GK"].map((ln) => xi.filter((p) => p.line === ln));
    const order = [...xi].sort((a, b) => ["GK", "DEF", "MID", "FWD"].indexOf(a.line) - ["GK", "DEF", "MID", "FWD"].indexOf(b.line));
    const at = (p) => 300 + order.indexOf(p) * 190;
    return `<div class="hero-kicker">${esc(cerSeason(d))}</div><h1 class="cer-title">${t("aw-xi")}</h1>
      <div class="cer-pitch">${lines.map((row) => `<div class="cer-line">${row.map((p) => `<div class="cer-xi-p${p.team === mine ? " mine" : ""} rv" data-at="${at(p)}">
        ${cerFace(p.pid, "", p.team)}<span class="nm">${esc(dispPlayer(p).main)}</span><span class="tm">${emblem(p.team, "sm")}</span></div>`).join("")}</div>`).join("")}</div>`;
  }
  if (k === "hof") {
    return `<div class="hero-kicker">${esc(cerSeason(d))}</div><h1 class="cer-title">${t("cer-hof")}</h1>
      <div class="cer-hofs">${d.hof.slice(0, 5).map((x, i) => `<div class="cer-hof-c rv" data-at="${400 + i * 800}" data-snd="${i === 0 ? "fanfare" : "reveal"}">
        <span class="fit-tag hof">${t("hof-tag")}</span>${cerFace(x.pid, "", x.team)}<div class="cer-aw-who">${esc(dispPlayer(x).main)}</div>
        <div class="teamline">${emblem(x.team, "sm")}${esc(cerName(x.team))} · ${esc(x.pos || "")}</div>
        <div class="pts">${cerNum(x.pts, 1, "")}</div><div class="muted cer-bits">${esc(bitsText(x.bits))}</div></div>`).join("")}</div>`;
  }
  if (k === "legacy") {
    const rows = [...d.coaches.map((x) => ({ x, txt: tf("cer-coach", { t: `<b>${esc(cerName(x.team))}</b>` }), tag: `<span class="fit-tag learn">${t("co-legend-tag")}</span>` })),
      ...d.farewell.map((x) => ({ x, txt: tf("cer-farewell", { t: `<b>${esc(cerName(x.team))}</b>` }), tag: `<span class="fit-tag inj">${t("nt-retired")}</span>` }))];
    return `<div class="hero-kicker">${esc(cerSeason(d))}</div><h1 class="cer-title">${t("cer-legacy")}</h1>
      <div class="cer-legacy">${rows.slice(0, 8).map((r, i) => `<div class="cer-row rv" data-at="${300 + i * 260}">${cerFace(r.x.pid, "", r.x.team)}
        <div class="grow"><div><b>${esc(dispPlayer(r.x).main)}</b> ${r.tag}</div><div class="muted">${r.txt}</div></div>${emblem(r.x.team, "md")}</div>`).join("")}</div>`;
  }
  const next = d.next_label || tf("season", { n: d.season + 1 });
  return `<div class="hero-kicker">${esc(cerLeague(d))}${cer && cer.replay ? "" : ` · ${t("cer-new-kicker")}`}</div>
    <h1 class="cer-title cer-big rv" data-at="100">${esc(cer && cer.replay ? cerSeason(d) : next)}</h1>
    <p class="cer-meta rv" data-at="400">${t(cer && cer.replay ? "cer-replay-end" : "cer-new-sub")}</p>`;
}
// 数从 0 (或 from) 滚到终值; 揭完 (fin) 时直接给终值
function countUp(el, to, dec = 0, dur = 1000, from = 0) {
  const show = (v) => { el.textContent = Number(v).toFixed(dec); };
  const M = motion();
  if (!M || el.dataset.fin) return show(to);
  const o = { v: from };
  show(from);
  const tw = M.to(o, { v: to, duration: dur / 1000, ease: "power2.out", onUpdate() {
    if (el.dataset.fin) { tw.kill(); show(to); } else show(o.v);
  } });
}
function cerReveal(el, now = false) {
  if (el.classList.contains("in")) return;
  if (now) el.classList.add("now");
  el.classList.add("in");
  if (!now && el.dataset.snd) UI.sound(el.dataset.snd);
  const burst = !now && $(".cer-burst", el), M = burst && motion();
  if (M) M.to(burst, { keyframes: { "0%": { opacity: 0, scale: 0.4 }, "30%": { opacity: 1 }, "100%": { opacity: 0, scale: 1.5 } }, duration: 1.6, delay: 0.35, ease: "power3.out" });
  for (const n of [el, ...el.querySelectorAll("[data-to]")]) {
    if (n.dataset.to === undefined) continue;
    if (now) n.dataset.fin = "1";
    countUp(n, Number(n.dataset.to), Number(n.dataset.dec || 0));
  }
  el.querySelectorAll("[data-w]").forEach((bar) => requestAnimationFrame(() => { bar.style.width = bar.dataset.w + "%"; }));
}
function cerClear(me) {
  me.timers.forEach(clearTimeout);
  me.timers = [];
}
// 放第 i 幕: 旧的一幕往上淡出, 新的从下面进来; 按 data-at 一个个揭晓, 揭完停一会儿自己往下走
function cerShow(me, i) {
  cerClear(me);
  me.i = i;
  me.revealed = false;
  const el = $("#ceremony"), k = me.steps[i];
  const stage = $(".cer-stage", el);
  const old = stage.querySelector(".cer-step:not(.out)");
  const M = motion();
  if (old) {
    old.classList.add("out");
    if (M) M.to(old, { opacity: 0, y: -14, scale: 0.985, duration: 0.28, ease: "power3.out" });
    setTimeout(() => old.remove(), M ? 280 : 0);
  }
  stage.insertAdjacentHTML("beforeend", `<div class="cer-step k-${k}" aria-live="polite">${cerStepHtml(k, me.d)}</div>`);
  const step = stage.lastElementChild;
  if (M) M.from(step, { opacity: 0, y: 22, scale: 0.985, duration: 0.5, ease: "power3.out", clearProps: "transform,opacity" });
  el.querySelectorAll(".cer-prog i").forEach((b, j) => { b.classList.toggle("on", j === i); b.classList.toggle("done", j < i); });
  const last = k === "next";
  $("#cer-next", el).textContent = t(last ? (me.replay ? "cer-close" : "cer-go") : "cer-next");
  $("#cer-skip", el).hidden = last;
  const bg = { champion: me.d.champion.team, mine: me.d.user_team }[k];
  if (bg != null) swapGlow(el, bg);
  const items = [...step.querySelectorAll("[data-at]")];
  let end = 0;
  for (const it of items) {
    const at = UI.reduced ? 0 : Number(it.dataset.at);
    end = Math.max(end, at);
    me.timers.push(setTimeout(() => cerReveal(it), at));
  }
  me.timers.push(setTimeout(() => { me.revealed = true; }, UI.reduced ? 0 : end + 700));
  if (!last) me.timers.push(setTimeout(() => cerNext(me), (UI.reduced ? 0 : end) + (CER_HOLD[k] || 5000) - Math.min(end, 2500)));
}
function cerNext(me = cer) {
  if (!me || me.closed) return;
  const step = $("#ceremony .cer-step:not(.out)");
  if (!me.revealed && step) {        // 还在揭晓: 先一下子揭完, 停在这一幕
    cerClear(me);
    step.querySelectorAll("[data-at]").forEach((it) => cerReveal(it, true));
    me.revealed = true;
    if (me.steps[me.i] !== "next") me.timers.push(setTimeout(() => cerNext(me), 4000));
    return;
  }
  if (me.i >= me.steps.length - 1) return cerClose(me);
  cerShow(me, me.i + 1);
}
function cerSkip(me = cer) {
  if (!me || me.closed) return;
  if (me.i >= me.steps.length - 1) return cerClose(me);
  UI.sound("back");
  cerShow(me, me.steps.length - 1);
}
async function ceremony(season, replay = false) {
  if (cer) return;
  let d;
  try {
    d = await api("/api/ceremony" + (season ? `?season=${season}` : ""));
  } catch (e) {
    holdCounts = false;
    playCounts();
    return toast(e.message);
  }
  const el = $("#ceremony");
  const me = cer = { d, steps: cerSteps(d), i: 0, timers: [], revealed: false, closed: false, replay, focus: focusKey(document.activeElement) };
  if (phoneOpen()) closePhone(true);
  renderDock();   // 颁奖典礼时快讯条只留按键提示 (R-82)
  el.innerHTML = `${glowHtml(d.champion.team)}
    <div class="cer-top"><span class="hero-kicker">${tf("cer-kicker", { s: esc(cerSeason(d)) })}</span>
      <div class="cer-prog" aria-hidden="true">${me.steps.map(() => "<i></i>").join("")}</div></div>
    <div class="cer-stage" role="dialog" aria-modal="true" aria-label="${esc(tf("cer-kicker", { s: cerSeason(d) }))}"></div>
    <div class="cer-bottom"><button class="pill primary" id="cer-next" data-nav-default></button>
      <button class="pill ghost" id="cer-skip" data-sound="back">${t("cer-skip")}</button></div>`;
  el.hidden = false;
  $("#cer-next", el).addEventListener("click", () => cerNext(me));
  $("#cer-skip", el).addEventListener("click", () => cerSkip(me));
  $(".cer-stage", el).addEventListener("click", (e) => { if (!e.target.closest("button")) cerNext(me); });
  void el.offsetWidth;
  el.classList.add("on");
  renderHints();
  UI.focus($("#cer-next", el), true);
  cerShow(me, 0);
}
function cerClose(me = cer) {
  if (!me || me.closed) return;
  me.closed = true;
  cerClear(me);
  const el = $("#ceremony");
  const fin = () => {
    if (cer === me) cer = null;
    renderDock();
    el.hidden = true;
    el.innerHTML = "";
    el.classList.remove("on");
    renderHints();
    const layer = !$("#modal").hidden ? $("#modal") : $("#app");
    const f = me.focus && $(me.focus, layer);
    if (f) UI.focus(f, true);
    else UI.focusDefault(layer);
    holdCounts = false;
    playCounts();
  };
  if (UI.reduced) return fin();
  el.classList.remove("on");
  setTimeout(fin, 320);
}

// ------------------------------------------------------------ 转会和合同 (R-25)
const money = (x) => (x == null ? "-" : "€" + (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)) + "M");
const windowText = (w) => (!w ? t("mk-window-closed") : w.date ? tf("mk-window-open", { d: esc(fmtDate(w.date, false)) }) : tf("mk-window-open-r", { n: w.round }));
// 窗口关着时, 什么时候开放一句副标题里说 (R-69: 以前整句带括号塞进大标题, 占三行)
const windowWhen = (w) => (w ? "" : `${t("mk-window-when")} · `);
const moneyLine = (m) => tf("mk-money", { c: money(m.cash), w: money(m.wage_bill), b: money(m.wage_budget), r: money(m.revenue) });
const clubName = (tid) => (tid == null ? t("mk-free-agent") : esc(teamName(tid)));
function mkLogText(x) {
  const p = `<b>${pname(x.p)}</b>`;
  if (x.kind === "buy") return tf("mk-log-buy", { p, a: clubName(x.from), b: clubName(x.to), f: money(x.fee) });
  if (["clause", "loan", "loan_back", "loan_buy", "swap"].includes(x.kind)) return tf("mk-log-" + x.kind, { p, a: clubName(x.from), b: clubName(x.to), f: money(x.fee) });
  if (x.kind === "free") return tf("mk-log-free", { p, b: clubName(x.to) });
  if (x.kind === "expire") return tf("mk-log-expire", { p, a: clubName(x.from) });
  return tf("mk-log-release", { p, a: clubName(x.from) });
}
function heroMarket() {
  const m = state.market;
  const rows = (m.latest || []).map((x) => `<div class="tr-row">${face(x.p.pid, x.to)}<div class="grow">${mkLogText(x)}</div></div>`).join("");
  const exp = (m.exp || []).map((x) => `<div class="tr-row">${face(x.pid, state.career.user_team)}<div class="grow">${pname(x)} <span class="muted">${esc(x.position || "")} · ${x.overall ?? ""}</span></div></div>`).join("");
  return heroInfo(`<div class="hero-kicker">${t("mk-title")}</div>
    <h1 class="hero-title">${windowText(m.window)}</h1>
    <div class="hero-meta">${windowWhen(m.window)}${moneyLine(m)}</div>
    <div class="hero-actions"><button class="pill" data-act="open-market">${t("mk-title")}</button>
      ${m.bids ? `<button class="pill" data-act="open-market" data-tab="bids">${tf("mk-bids-n", { n: m.bids })}</button>` : ""}</div>
    ${m.expiring ? `<p class="hero-note buff">${tf("mk-exp-n", { n: m.expiring })}</p>` : ""}
    <p class="hero-note">${t("mk-hint")}</p>`)
    + heroSide(`<div class="hero-panel scroller">${exp ? `<h2 class="panel-head">${t("mk-exp-title")}</h2>${exp}` : ""}
      ${rows ? `<h2 class="panel-head${exp ? " sub-head" : ""}">${t("mk-latest")}</h2>${rows}` : ""}
      ${exp || rows ? "" : `<div class="empty">${t("mk-no-log")}</div>`}</div>`);
}
// offer: 每行最后一个「出价」按钮, 直接进这个人的合同标签 (找人、自由身两个列表用, R-57)
// 找人的条件 (R-86): 这次打开程序期间记着, 离开转会页再回来还在
const MK_POS = { GK: ["GK"], DEF: ["CB", "LB", "RB"], MID: ["DMF", "CMF", "LMF", "RMF", "AMF"], FWD: ["LWF", "RWF", "SS", "CF"] };
const MK_ROLES = ["prospect", "regular", "star", "superstar", "legend"];
const MK_CONFEDS = ["UEFA", "CONMEBOL", "CONCACAF", "AFC", "CAF", "OFC", "OTHER"];
const mkFilterDefault = () => ({ line: "", pos: "", role: "", nat: "", natName: "", confed: "", league: 0, sort: "ovr", omin: 70, omax: null, amin: null, amax: 35,
  value: null, wage: null, q: "", ok: true, exp: false, listed: false, loan: false });
let mkFilter = mkFilterDefault();
let mkSearchSeq = 0;
let mkPicking = null;            // 国籍 / 联赛的列表开着: { kind, from }
let mkPickClose = () => false;   // 关上那张列表 (B 键先关它)
function mkTable(rows, withClub = true, offer = false, clause = true) {
  const mine = state.career.user_team;
  if (!rows.length) return `<div class="empty">${t("mk-none")}</div>`;
  const tags = (r) => (r.listed || r.ai_listed ? `<span class="tag">${t("mk-tag-listed")}</span>` : "") + (r.loan ? `<span class="tag">${t("mk-tag-loan")}</span>` : "") + (r.request ? `<span class="tag">${t("mk-tag-request")}</span>` : "");
  return `<table><tr><th></th><th>${t("th-player")}</th>${withClub ? `<th>${t("th-club")}</th>` : ""}<th>${t("th-pos")}</th><th class="num">${t("th-age")}</th>
    <th class="num">${t("th-ovr")}</th><th class="num">${t("th-value")}</th><th class="num">${t("th-wage")}</th>${clause ? `<th class="num">${t("th-clause")}</th>` : ""}<th class="num">${t("th-contract")}</th>${offer ? "<th></th>" : ""}</tr>
    ${rows.map((r) => `<tr${r.expiring && r.team === mine ? ' class="mine"' : r.willing === false ? ' class="bench"' : ""}><td>${face(r.pid, r.team ?? r.nt)}</td><td>${pname(r)}${r.nt != null ? `<span class="tag">${t("mk-tag-gen")}</span>` : ""}${r.role && r.role !== "regular" ? roleTag(r.role) : ""}${tags(r)}${r.willing === false ? `<span class="tag">${t("mk-no-way")}</span>` : ""}</td>
      ${withClub ? `<td><div class="teamcell">${r.nt != null ? `${emblem(r.nt)}${esc(tf("mk-nt-club", { t: teamName(r.nt) }))}`
        : `${r.team != null ? emblem(r.team) : ""}${clubName(r.team)}`}</div></td>` : ""}<td>${esc(r.position || "")}</td>
      <td class="num">${r.age ?? ""}</td><td class="num">${r.overall ?? ""}</td><td class="num">${money(r.value)}</td><td class="num">${money(r.ask_wage ?? r.wage)}</td>
      ${clause ? `<td class="num">${r.clause != null ? money(r.clause) : ""}</td>` : ""}
      <td class="num">${r.expiring ? `<span class="fit-tag ban">${esc(r.end_label || "")}</span>` : esc(r.end_label || "")}</td>
      ${offer ? `<td class="num">${r.team === mine ? "" : `<button class="pill mk-offer" data-act="mk-offer" data-offer="${r.pid}" data-team="${r.team ?? ""}">${t("mk-offer-btn")}</button>`}</td>` : ""}</tr>`).join("")}</table>`;
}
// 转会市场: 找人 / 我的合同 / 报价 / 自由身 / 转会动态
async function openMarket(nav = "push", tab = null) {
  const seq = ++openSeq;
  let m;
  try {
    m = await api("/api/market");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const mine = state.career.user_team;
  const view = { label: () => t("mk-title"), reopen: (n) => openMarket(n), ui: { tab: tab || "search" } };
  const lines = ["", "GK", "DEF", "MID", "FWD"];
  // 找人 (R-86): 左边筛选 (改了就找), 右边结果; 国籍、联赛按了在右边换成一张列表, 挑一个回来
  const F = mkFilter;
  const chip = (f, v, label) => `<button type="button" class="mk-chip${String(F[f]) === String(v) ? " on" : ""}" data-f="${f}" data-v="${esc(String(v))}">${esc(label)}</button>`;
  const flag = (f, label) => `<button type="button" class="mk-chip${F[f] ? " on" : ""}" data-flag="${f}" aria-pressed="${!!F[f]}">${esc(label)}</button>`;
  const numIn = (f, lo, hi, step = 1) => `<input type="number" data-num="${f}" value="${F[f] ?? ""}" min="${lo}" max="${hi}" data-pad-step="${step}" placeholder="${esc(t("mk-f-any"))}">`;
  const natLabel = () => (F.nat ? esc(F.natName || F.nat) : F.confed ? esc(tf("mk-pick-all", { c: t("cf-" + F.confed) })) : t("mk-f-any"));
  const searchHtml = () => {
    const pos = MK_POS[F.line] || [];
    return `<div class="cols mk-find" data-nav-sides>
    <section class="panel fill mk-filters">${scroller(`<div class="mk-fhead"><h2 class="panel-head">${t("mk-f-filters")}</h2><button type="button" class="pill compact ghost" data-mk-reset>${t("mk-f-reset")}</button></div>
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-line")}</span><div class="mk-chips">${["", "GK", "DEF", "MID", "FWD"].map((k) => chip("line", k, t(k ? "mk-f-" + k : "mk-f-all"))).join("")}</div></div>
      ${pos.length > 1 ? `<div class="mk-frow"><span class="mk-fcap">${t("mk-f-pos")}</span><div class="mk-chips">${chip("pos", "", t("mk-f-all"))}${pos.map((k) => chip("pos", k, k)).join("")}</div></div>` : ""}
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-ages")}</span><div class="mk-range">${numIn("amin", 15, 45)}<span>–</span>${numIn("amax", 15, 45)}</div></div>
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-ovrs")}</span><div class="mk-range">${numIn("omin", 40, 150)}<span>–</span>${numIn("omax", 40, 150)}</div></div>
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-money")}</span><div class="mk-range">${numIn("value", 0, 100000, 5)}</div></div>
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-wage")}</span><div class="mk-range">${numIn("wage", 0, 1000, 1)}</div></div>
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-role")}</span><div class="mk-chips">${chip("role", "", t("mk-f-all"))}${MK_ROLES.map((r) => chip("role", r, t("role-" + r))).join("")}</div></div>
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-nat")}</span><button type="button" class="mk-chip mk-pickbtn${F.nat || F.confed ? " on" : ""}" data-mk-pick="nat">${natLabel()} ›</button></div>
      ${isWorld() ? `<div class="mk-frow"><span class="mk-fcap">${t("mk-f-league")}</span><button type="button" class="mk-chip mk-pickbtn${F.league ? " on" : ""}" data-mk-pick="league">${F.league ? esc(leagueName(F.league)) : t("mk-f-any")} ›</button></div>` : ""}
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-more")}</span><div class="mk-chips">${flag("ok", t("mk-f-ok"))}${flag("exp", t("mk-f-exp"))}${flag("listed", t("mk-f-listed"))}${flag("loan", t("mk-f-loan"))}</div></div>
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-sort")}</span><div class="mk-chips">${chip("sort", "ovr", t("mk-s-ovr"))}${chip("sort", "value", t("mk-s-value"))}${chip("sort", "age", t("mk-s-age"))}</div></div>
      <div class="mk-frow"><span class="mk-fcap">${t("mk-f-name")}</span><form class="mk-name" onsubmit="return false"><input type="text" data-num="q" value="${esc(F.q || "")}"><button type="submit" class="pill compact">${t("mk-f-go")}</button></form></div>`)}</section>
    <section class="panel fill mk-res"><h2 class="panel-head mk-count">${t("tab-mk-search")} <span class="muted">${t("mk-search-hint")}</span></h2>
      ${scroller(`<div class="mk-results"><div class="muted">${t("loading")}</div></div>`)}</section></div>`;
  };
  const bindSearch = (pane) => {
    let timer = 0;
    const box = () => pane.querySelector(".mk-results");
    const run = async (facets = false) => {
      const qs = new URLSearchParams({ line: F.line, pos: F.pos, role: F.role, nat: F.nat, confed: F.confed || "", league: F.league || "", sort: F.sort,
        min: F.omin ?? "", max: F.omax ?? "", amin: F.amin ?? "", age: F.amax ?? "", value: F.value ?? "", wage: F.wage ?? "",
        q: F.q || "", ok: F.ok ? "1" : "0", exp: F.exp ? "1" : "0", listed: F.listed ? "1" : "0", loan: F.loan ? "1" : "0", facets: facets ? "1" : "0" });
      const seq = ++mkSearchSeq;
      try {
        const r = await api("/api/market/search?" + qs);
        if (seq !== mkSearchSeq || !pane.isConnected) return r;
        if (!mkPicking) {
          box().innerHTML = mkTable(r.rows, true, true, false);
          pane.querySelector(".mk-count").innerHTML = `${esc(tf("mk-found", { n: r.total }))}${r.total > r.rows.length ? `<span class="muted">${esc(t("mk-found-cap"))}</span>` : ""}`;
        }
        UI.prepScrollers(pane);
        return r;
      } catch (e) {
        if (box()) box().innerHTML = `<div class="error">${esc(e.message)}</div>`;
        return null;
      }
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => run(), 250); };
    const redraw = () => { const k = focusKey(document.activeElement); renderTab(currentView, "search", 0).then(() => { const el = k && $(k, pane); if (el && UI.mode !== "pointer") UI.focus(el, true); }); };
    pane.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
      const f = b.dataset.f;
      F[f] = b.dataset.v;
      if (f === "line") F.pos = "";                          // 换了位置线, 具体位置清掉 (那一排胶囊也跟着换)
      if (f === "line") return redraw();
      pane.querySelectorAll(`[data-f="${f}"]`).forEach((x) => x.classList.toggle("on", x === b));
      run();
    }));
    pane.querySelectorAll("[data-flag]").forEach((b) => b.addEventListener("click", () => {
      const f = b.dataset.flag;
      F[f] = !F[f];
      b.classList.toggle("on", F[f]);
      b.setAttribute("aria-pressed", String(F[f]));
      run();
    }));
    pane.querySelectorAll("input[data-num]").forEach((el) => el.addEventListener("input", () => {
      const f = el.dataset.num;
      F[f] = f === "q" ? el.value : el.value === "" ? null : Number(el.value);
      if (f !== "q") soon();
    }));
    pane.querySelector(".mk-name").addEventListener("submit", () => run());
    pane.querySelector("[data-mk-reset]").addEventListener("click", () => { mkFilter = mkFilterDefault(); currentView.reopen("replace"); });
    // 国籍 / 联赛: 右边换成一张列表 (R-86)。国籍先挑大洲 (每洲几个人), 再挑这个洲的国家, 头一项是「整个某洲」;
    // B 一层层往回退: 国家 -> 大洲 -> 结果
    const pickRow = (v, label, n, on, attr = "data-pick-v") => `<button type="button" class="mk-pick${on ? " on" : ""}" ${attr}="${esc(v)}" data-pick-label="${esc(label)}">${esc(label)}${n != null ? `<span class="muted">${n}</span>` : ""}</button>`;
    const drawPick = () => {
      const P = mkPicking, r = P.data;
      let head, back, rows;
      if (P.kind === "league") {
        head = t("mk-pick-league");
        back = `<button type="button" class="pill compact ghost" data-pick-back>${t("mk-pick-back")}</button>`;
        rows = pickRow("", t("mk-f-any"), null, !F.league) + r.leagues.map((x) => pickRow(String(x.id), leagueName(x.id), x.n, F.league === x.id)).join("");
      } else if (!P.confed) {
        const sums = {};
        for (const x of r.nats) sums[x.confed] = (sums[x.confed] || 0) + x.n;
        head = t("mk-pick-confed");
        back = `<button type="button" class="pill compact ghost" data-pick-back>${t("mk-pick-back")}</button>`;
        rows = pickRow("", t("mk-f-any"), null, !F.nat && !F.confed)
          + MK_CONFEDS.filter((k) => sums[k]).map((k) => pickRow(k, t("cf-" + k), sums[k], F.confed === k || (F.nat && r.nats.some((x) => x.nat === F.nat && x.confed === k)), "data-pick-cf")).join("");
      } else {
        const list = r.nats.filter((x) => x.confed === P.confed);
        const cname = t("cf-" + P.confed);
        head = tf("mk-pick-in", { c: cname });
        back = `<button type="button" class="pill compact ghost" data-pick-up>${t("mk-pick-up")}</button>`;
        rows = pickRow("@" + P.confed, tf("mk-pick-all", { c: cname }), list.reduce((a, x) => a + x.n, 0), F.confed === P.confed && !F.nat)
          + list.map((x) => pickRow(x.nat, x.team != null ? teamName(x.team) : x.nat, x.n, F.nat === x.nat)).join("");
      }
      pane.querySelector(".mk-count").textContent = head;
      box().innerHTML = `<div class="mk-picklist">${back}${rows}</div>`;
      const q = (sel) => box().querySelector(sel);
      if (q("[data-pick-back]")) q("[data-pick-back]").addEventListener("click", () => mkPickClose());
      if (q("[data-pick-up]")) q("[data-pick-up]").addEventListener("click", () => mkPickClose());
      box().querySelectorAll("[data-pick-cf]").forEach((x) => x.addEventListener("click", () => {
        if (!x.dataset.pickCf) return choose(() => { F.nat = ""; F.natName = ""; F.confed = ""; });
        mkPicking.confed = x.dataset.pickCf;
        UI.sound("move");
        drawPick();
      }));
      box().querySelectorAll("[data-pick-v]").forEach((x) => x.addEventListener("click", () => {
        const v = x.dataset.pickV;
        if (P.kind === "league") return choose(() => { F.league = Number(v) || 0; });
        if (!v) return choose(() => { F.nat = ""; F.natName = ""; F.confed = ""; });
        if (v[0] === "@") return choose(() => { F.confed = v.slice(1); F.nat = ""; F.natName = ""; });
        choose(() => { F.nat = v; F.natName = x.dataset.pickLabel || ""; F.confed = ""; });
      }));
      UI.prepScrollers(pane);
      box().closest(".scroller").scrollTop = 0;
      if (UI.mode !== "pointer") UI.focus(box().querySelector(".mk-pick.on") || box().querySelector(".mk-pick"), true);
    };
    const choose = (set) => {
      set();
      mkPicking = null;
      redraw();
    };
    pane.querySelectorAll("[data-mk-pick]").forEach((b) => b.addEventListener("click", async () => {
      const kind = b.dataset.mkPick;
      mkPicking = { kind, from: b, confed: null, data: null };
      box().innerHTML = `<div class="muted">${t("loading")}</div>`;
      const r = await run(true);
      if (!r || !mkPicking) return;
      mkPicking.data = r;
      // 已经挑了某个国家 / 某个洲: 直接打开那个洲
      if (kind === "nat") mkPicking.confed = F.confed || (F.nat && (r.nats.find((x) => x.nat === F.nat) || {}).confed) || null;
      drawPick();
    }));
    mkPickClose = () => {
      if (!mkPicking) return false;
      UI.sound("back");
      if (mkPicking.kind === "nat" && mkPicking.confed) {     // 国家 -> 大洲
        const from = mkPicking.confed;
        mkPicking.confed = null;
        drawPick();
        const el = box().querySelector(`[data-pick-cf="${from}"]`);
        if (el && UI.mode !== "pointer") UI.focus(el, true);
        return true;
      }
      const from = mkPicking.from;
      mkPicking = null;
      run().then(() => { if (from && from.isConnected && UI.mode !== "pointer") UI.focus(from, true); });
      return true;
    };
    run();
  };
  const mineHtml = () => fillPanel(mkTable([...m.mine].sort((a, b) => (a.end ?? 99) - (b.end ?? 99) || (b.overall ?? 0) - (a.overall ?? 0)), false),
    `<h2 class="panel-head">${t("tab-mk-mine")} <span class="muted">${moneyLine(m)}</span></h2>`);
  // 报价 (R-44): 转会报价能还价 (对方耐心给个大概), 租借报价看条款接受或拒绝
  const bidRow = (b) => {
    const who = `${emblem(b.buyer, "sm")} ${esc(teamName(b.buyer))}`;
    const loan = b.kind === "loan" && b.loan;
    const text = loan
      ? tf("mk-bid-loan-line", { t: who, p: `<b>${pname(b.p)}</b>`, f: `<b>${money(b.loan.fee)}</b>`, s: pctOf(b.loan.split),
        b: b.loan.buy ? tf(b.loan.must ? "mk-loan-buy-must" : "mk-loan-buy-opt", { x: money(b.loan.buy) }) : "" })
      : tf("mk-bid-line", { t: who, f: `<b>${money(b.fee)}</b>`, p: `<b>${pname(b.p)}</b>` })
        + (b.swap_p ? `<div class="muted">${tf("mk-bid-swap", { p: `<b>${pname(b.swap_p)}</b>`, v: money(b.swap_v),
          c: money(Math.max(0, b.fee - b.swap_v)) })}</div>` : "")
        + (b.wk ? ` <span class="fit-tag up">${t("mk-bid-wk")}</span>` : "");
    const hist = !loan && b.hist && b.hist.length > 1
      ? `<div class="muted mk-hist">${b.hist.map(([w, x]) => `${t(w === "ai" ? "mk-h-ai" : "mk-h-you")} ${money(x)}`).join(" → ")}</div>` : "";
    const mood = b.mood ? ` <span class="fit-tag ${{ high: "up", mid: "ban", low: "inj" }[b.mood]}">${t("mk-mood-" + b.mood)}</span>` : "";
    const acts = b.status !== "open" ? `<span class="fit-tag">${t("mk-st-" + b.status)}</span>`
      : `<button class="pill primary" data-act="mk-bid" data-id="${b.id}" data-yes="1">${t("mk-accept")}</button>
        ${loan ? "" : `<input class="mk-counter" type="number" step="0.1" min="0" data-pad-step="1" id="mk-c-${b.id}" value="${(b.fee * 1.2).toFixed(1)}" aria-label="${t("mk-counter-ph")}">
        <button class="pill" data-act="mk-counter" data-id="${b.id}">${t("mk-counter")}</button>`}
        <button class="pill" data-act="mk-bid" data-id="${b.id}">${t("mk-reject")}</button>`;
    return `<div class="news-row mk-bid${b.status === "open" ? " unread" : ""}">${face(b.pid, mine)}<div class="grow">${text}${mood}${hist}</div>${acts}</div>`;
  };
  const bidsHtml = () => fillPanel(m.bids.length ? m.bids.map(bidRow).join("") : `<div class="empty">${t("mk-no-bids")}</div>`,
    `<h2 class="panel-head">${t("tab-mk-bids")}</h2>`);
  const loansIn = m.mine.filter((r) => r.loan && r.loan.to === mine);
  const loansHtml = () => fillPanel(loansIn.length || m.loans_out.length
    ? `${loansIn.length ? `<h2 class="panel-head sub-head">${t("mk-loan-in-title")}</h2>${mkTable(loansIn, false)}` : ""}
       ${m.loans_out.length ? `<h2 class="panel-head sub-head">${t("mk-loan-out-title")}</h2>${mkTable(m.loans_out)}` : ""}`
    : `<div class="empty">${t("mk-no-loans")}</div>`, `<h2 class="panel-head">${t("tab-mk-loans")}</h2>`);
  const freeHtml = () => fillPanel((m.free.length ? mkTable(m.free, false, true) : `<div class="empty">${t("mk-no-free")}</div>`)
    + ((m.nt_free || []).length ? `<h2 class="panel-head sub-head">${t("mk-nt-free")} <span class="muted">${m.nt_free.length}</span></h2>
      <p class="muted mk-nt-note">${t("mk-nt-free-note")}</p>${mkTable(m.nt_free, true, true)}` : ""), `<h2 class="panel-head">${t("tab-mk-free")}</h2>`);
  const logHtml = () => fillPanel(m.log.length ? m.log.map((x) => `<div class="news-row"><span class="news-when">${esc(x.label || "")}</span>${face(x.p.pid, x.to)}
      <div class="grow">${mkLogText(x)}</div></div>`).join("") : `<div class="empty">${t("mk-no-log")}</div>`, `<h2 class="panel-head">${t("tab-mk-log")}</h2>`);
  // 财政 (R-46): 左边各项 (到现在 / 赛季末估算 / 上季), 右边账本
  const fin = m.finance;
  const sgn = (x) => (x ? `<span class="${x < 0 ? "neg" : "pos"}">${x < 0 ? "−" : "+"}${money(Math.abs(x))}</span>` : `<span class="muted">-</span>`);
  const finHtml = () => {
    const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
    const rows = fin.keys.filter((k) => fin.now[k] || fin.est[k] || (fin.last && fin.last[k]))
      .map((k) => `<tr><td>${t("fin-k-" + k)}</td><td class="num">${sgn(fin.now[k])}</td><td class="num">${sgn(fin.est[k])}</td>${fin.last ? `<td class="num">${sgn(fin.last[k])}</td>` : ""}</tr>`).join("");
    const table = `<table class="fin-table"><tr><th>${t("fin-item")}</th><th class="num">${t("fin-now")}</th><th class="num">${t("fin-est")}</th>${fin.last ? `<th class="num">${t("fin-last")}</th>` : ""}</tr>${rows}
      <tr class="fin-total"><td>${t("fin-net")}</td><td class="num">${sgn(sum(fin.now))}</td><td class="num">${sgn(fin.est_net)}</td>${fin.last ? `<td class="num">${sgn(sum(fin.last))}</td>` : ""}</tr></table>
      <p class="muted">${tf("fin-note", { p: fin.pos ?? "-" })}</p>
      ${fin.revenue ? `<p class="${fin.cost > fin.cost_share * fin.revenue ? "neg" : "muted"}">${tf("fin-cost", { c: money(fin.cost), r: money(fin.revenue),
        p: Math.round((100 * fin.cost) / fin.revenue), l: Math.round(100 * fin.cost_share) })}</p>` : ""}`;
    const book = fin.items.length ? fin.items.map((x) => `<div class="news-row"><span class="news-when">${esc(x.label || "")}</span>${x.p ? face(x.p.pid, mine) : ""}
      <div class="grow">${t("fin-k-" + x.k)}${x.p ? ` · ${pname(x.p)}` : ""}</div><b class="num">${sgn(x.x)}</b></div>`).join("") : `<div class="empty">${t("fin-empty")}</div>`;
    return `<div class="cols">${fillPanel(table, `<h2 class="panel-head">${t("fin-sum")} <span class="muted">${moneyLine(m)}</span></h2>`)}
      ${fillPanel(book, `<h2 class="panel-head">${t("fin-book")}</h2>`)}</div>`;
  };
  view.tabs = [
    { k: "search", label: t("tab-mk-search"), html: searchHtml, after: bindSearch },
    { k: "mine", label: t("tab-mk-mine"), html: mineHtml },
    { k: "bids", label: t("tab-mk-bids") + (m.bids.some((b) => b.status === "open") ? ` <span class="n">${m.bids.filter((b) => b.status === "open").length}</span>` : ""), html: bidsHtml },
    { k: "loans", label: t("tab-mk-loans") + (loansIn.length + m.loans_out.length ? ` <span class="n">${loansIn.length + m.loans_out.length}</span>` : ""), html: loansHtml },
    { k: "free", label: t("tab-mk-free"), html: freeHtml },
    { k: "log", label: t("tab-mk-log"), html: logHtml },
    ...(fin ? [{ k: "fin", label: t("tab-mk-fin"), html: finHtml }] : []),
  ];
  openModal(glowHtml(mine) + pageHead(t("mk-title"), esc(teamName(mine)), `${windowText(m.window)} · ${windowWhen(m.window)}${moneyLine(m)}`), true, view, nav);
}
// 球员页「合同」: 身价、合同、解约金; 别人的人出价 (还价、按解约金买)、租借 / 自由身签下 / 你的人续约 (定解约金)、挂牌、解约 (R-44)
function playerContractHtml(p) {
  const q = p.market;
  if (!q) return `<section class="panel"><div class="empty">${t("no-career")}</div></section>`;
  const mine = state.career.user_team;
  const kv = (k, v) => `<div class="kv2"><span>${k}</span><b>${v}</b></div>`;
  const ln = q.loan;
  const loanWhen = (l) => (l && l.end_label ? tf("pc-loan-end-" + l.end_label.w, { s: esc(l.end_label.s) }) : "");
  const info = `<div class="kvgrid one">${kv(t("pc-club"), q.free ? t("mk-free-agent") : `${emblem(q.team, "sm")} ${esc(teamName(q.team))}`)}
    ${kv(t("pc-value"), money(q.value))}${q.contract ? kv(t("pc-wage"), money(q.contract[1])) : ""}
    ${q.contract ? kv(t("pc-contract"), `${esc(q.end_label || "")} · <span class="muted">${q.years_left > 0 ? tf("pc-left", { n: q.years_left }) : t("pc-expiring")}</span>`) : ""}
    ${q.clause != null ? kv(t("pc-clause"), money(q.clause)) : ""}
    ${ln ? kv(t("pc-loan-title"), tf("pc-on-loan", { a: clubName(ln.from), b: clubName(ln.to), w: loanWhen(ln), s: pctOf(ln.split) })) : ""}
    ${q.listed ? kv(t("pc-list-title"), t("pc-list-" + q.listed.mode)) : ""}</div>`;
  const years = (d) => segHtml("mk-years", [1, 2, 3, 4, 5].map((n) => [n, String(n)]), d, t("pc-years"));
  // 新合同的解约金倍数: 一改他要的工资跟着变 (document 上的 change 监听)
  const bq = q.beta;
  const wageAt = (base, beta) => (base * (1 + bq.k * Math.max(0, beta - 2))).toFixed(2);
  const betaSel = (base) => segHtml("mk-beta", [1.5, 2, 2.5, 3, 3.5].map((b) => [b, b + "×"]), bq.default, t("pc-beta"), `data-base="${base}" data-k="${bq.k}"`);
  let form;
  if (q.mine) {
    const loanedIn = ln && ln.to === mine;
    const listSel = segHtml("mk-list", ["", "discount", "par", "premium", "loan"].map((mode) => [mode, t(mode ? "pc-list-" + mode : "pc-list-none")]),
      q.listed ? q.listed.mode : "");
    form = loanedIn
      ? `<h2 class="panel-head">${t("pc-loan-title")}</h2><p class="muted">${tf("pc-on-loan", { a: clubName(ln.from), b: clubName(ln.to), w: loanWhen(ln), s: pctOf(ln.split) })}</p>
        ${ln.buy && !ln.must ? `<div class="mk-form"><button class="pill primary" data-act="mk-loanbuy" data-pid="${p.pid}">${tf("pc-go-loanbuy", { x: money(ln.buy) })}</button></div>` : ""}`
      : `<h2 class="panel-head">${t("pc-renew-title")}</h2>${q.renew_refuse ? `<p class="hero-note buff">${t("pc-renew-refuse")}</p>` : ""}<p class="muted">${tf("pc-renew-ask", { w: money(Number(wageAt(q.renew_wage, bq.default))) })} ${t("pc-beta-note")}</p>
      <div class="mk-form"><label>${t("pc-offer-wage")} <input id="mk-wage" type="number" step="0.01" min="0" data-pad-step="0.1" value="${wageAt(q.renew_wage, bq.default)}"></label>${years(3)}${betaSel(q.renew_wage)}
        <button class="pill primary" data-act="mk-renew" data-pid="${p.pid}">${t("pc-go-renew")}</button></div>
      <h2 class="panel-head sub-head">${t("pc-list-title")}</h2><p class="muted">${t("pc-list-note")}</p>
      <div class="mk-form">${listSel}<button class="pill" data-act="mk-list" data-pid="${p.pid}">${t("pc-go-list")}</button></div>
      <h2 class="panel-head sub-head">${t("pc-release")}</h2><p class="muted">${t("pc-release-note")}</p>
      <div class="mk-form"><button class="pill danger" data-act="mk-release" data-pid="${p.pid}" data-who="${pname(p)}"
        data-cost="${q.contract ? (0.5 * q.contract[1] * (q.years_left + 1)).toFixed(2) : 0}">${t("pc-release")}</button></div>`;
  } else {
    const status = q.walked ? `<p class="hero-note buff">${tf("pc-walked", { d: q.walked_label ? esc(fmtDate(q.walked_label, false)) : t("pc-walked-soon") })}</p>`
      : q.talking && q.swap_value ? `<p class="hero-note">${tf("pc-talking-swap", { f: `<b>${money(q.fee)}</b>`, v: money(q.swap_value),
        c: money(Math.max(0, q.fee - q.swap_value)), m: t("mk-mood-" + q.mood) })}</p>`
      : q.talking ? `<p class="hero-note">${tf("pc-talking", { f: `<b>${money(q.fee)}</b>`, m: t("mk-mood-" + q.mood) })}</p>` : "";
    const picked = new Set(q.swap || []);
    const swap = q.swap_opts && q.swap_opts.length ? `<h2 class="panel-head sub-head">${t("pc-swap-title")}</h2>
      <p class="muted">${tf("pc-swap-note", { n: q.swap_max })}</p>
      <div class="mk-swaps" data-nav-group="swap">${q.swap_opts.slice(0, 24).map((x) => `<label class="mk-swap-row${x.willing ? "" : " bench"}">
        <input type="checkbox" class="mk-swap" value="${x.pid}" data-v="${x.value}" data-no="${x.willing ? 0 : 1}"${picked.has(x.pid) ? " checked" : ""}${x.willing ? "" : " disabled"}>
        ${face(x.pid, mine)}<span class="grow">${pname(x.p)} <span class="muted">${esc(x.p.position || "")}</span></span>
        <b class="num">${x.willing ? money(x.value) : t("pc-swap-no")}</b></label>`).join("")}</div>
      <p class="muted" id="mk-swap-sum" data-max="${q.swap_max}"></p>` : "";
    const clause = !q.free && q.clause != null ? `<p class="muted">${t("pc-clause-note")}</p>
      <div class="mk-form"><button class="pill" data-act="mk-buy" data-pid="${p.pid}" data-fee="${q.clause}" ${q.window ? "" : "disabled"}>${tf("pc-go-clause", { x: money(q.clause) })}</button></div>` : "";
    const loan = q.loanable ? `<h2 class="panel-head sub-head">${t("pc-loan-title")}</h2>
      <p class="muted">${tf("pc-loan-note", { f: money(q.loan_fee), h: money(q.loan_half_fee) })}</p>
      <div class="mk-form">${segHtml("mk-loan-half", [["0", t("pc-loan-full")], ["1", t("pc-loan-half")]], "0")}
        ${segHtml("mk-loan-buy", [["", t("pc-loan-buy-none")], ["option", tf("pc-loan-buy-option", { x: money(q.loan_option) })],
          ["must", tf("pc-loan-buy-must", { x: money(q.loan_must) })]], "")}
        <button class="pill" data-act="mk-loan" data-pid="${p.pid}" ${q.window ? "" : "disabled"}>${t("pc-go-loan")}</button></div>` : "";
    form = `<h2 class="panel-head">${t(q.free ? "pc-sign-title" : "pc-bid-title")}</h2>
      <p class="muted">${tf("pc-ask", { f: money(q.fee), w: money(Number(wageAt(q.wage, bq.default))) })}</p>${status}
      ${q.window ? "" : `<p class="hero-note buff">${t("pc-window-closed")}</p>`}${q.willing ? "" : `<p class="hero-note buff">${t("pc-unwilling")}</p>`}
      <div class="mk-form">${q.free ? "" : `<label>${t("pc-fee")} <input id="mk-fee" type="number" step="0.1" min="0" data-pad-step="1" value="${q.fee}"></label>`}
        <label>${t("pc-offer-wage")} <input id="mk-wage" type="number" step="0.01" min="0" data-pad-step="0.1" value="${wageAt(q.wage, bq.default)}"></label>${years(3)}${betaSel(q.wage)}
        <button class="pill primary" data-act="mk-buy" data-pid="${p.pid}" ${q.window ? "" : "disabled"}>${t(q.free ? "pc-go-sign" : "pc-go-bid")}</button></div>
      ${swap}${clause}${loan}
      <p class="muted">${tf("mk-money-short", { c: money(q.cash), w: money(q.wage_bill), b: money(q.wage_budget) })}</p>`;
  }
  return `<div class="cols contract-cols" data-nav-sides>${fillPanel(info, `<h2 class="panel-head">${t("tab-contract")}</h2>`)}
    ${fillPanel(form + `<p class="mk-msg" id="mk-msg" role="status"></p>`)}</div>`;
}
const mkWhy = (r) => (r.why === "counter" && r.swap_value
  ? tf("mkw-counter-swap", { x: money(r.ask), v: money(r.swap_value), c: money(r.cash_ask), m: r.mood ? t("mk-mood-" + r.mood) : "" })
  : tf("mkw-" + r.why, { x: money(r.ask ?? r.fee), n: 2, m: r.mood ? t("mk-mood-" + r.mood) : "" }));
const mkSwaps = () => [...document.querySelectorAll(".mk-swap:checked")].map((x) => Number(x.value));
// 分段选择 (R-57): 代替 <select> —— 一排胶囊, 手柄左右走、A 选 (下拉框手柄选不了)。值在容器的 data-value 上, segVal 读;
// 选了在容器上发一个 change (和 select 一样, 解约金倍数改了工资跟着变靠它)
function segHtml(id, opts, value, cap = "", attrs = "") {
  return `<span class="seg-field">${cap ? `<span class="seg-cap">${esc(cap)}</span>` : ""}<span class="seg" id="${id}" role="radiogroup" data-value="${esc(String(value))}"${attrs ? " " + attrs : ""}>${
    opts.map(([v, label]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-seg-v="${esc(String(v))}">${esc(label)}</button>`).join("")}</span></span>`;
}
const segVal = (id) => { const el = $("#" + id); return el ? el.dataset.value : undefined; };
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-seg-v]");
  if (!b) return;
  const box = b.closest(".seg");
  box.dataset.value = b.dataset.segV;
  box.querySelectorAll("[data-seg-v]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  box.dispatchEvent(new Event("change", { bubbles: true }));
});
// 搭人抵价 (R-47): 勾了谁、现金多少, 合计跟着变; 勾满了其余的变灰
function mkSwapSum() {
  const box = $("#mk-swap-sum");
  if (!box) return;
  const on = [...document.querySelectorAll(".mk-swap")];
  const v = on.filter((x) => x.checked).reduce((a, x) => a + Number(x.dataset.v), 0);
  const cash = Number(($("#mk-fee") || {}).value || 0);
  const full = on.filter((x) => x.checked).length >= Number(box.dataset.max);
  on.forEach((x) => { x.disabled = x.dataset.no === "1" || (!x.checked && full); });
  box.textContent = tf("pc-swap-sum", { v: money(v), c: money(cash), t: money(v + cash) });
}
// 换阵型: 槽位标签换一套 (R-65), 11 个人按熟悉度重新对号入座 (R-68, tacRemap)
document.addEventListener("change", (e) => {
  const box = e.target;
  if (!box || box.id !== "tac-formation" || !tacPage) return;
  const P = tacPage;
  P.formation = box.dataset.value;
  P.xi = tacRemap(P.xi, tacCodes(P), new Map(P.tr.squad.map((p) => [p.pid, p])));
  P.sel = null;
  openTactics("replace", true);
});
document.addEventListener("change", (e) => { if (e.target && (e.target.classList.contains("mk-swap") || e.target.id === "mk-fee")) mkSwapSum(); });
document.addEventListener("input", (e) => { if (e.target && e.target.id === "mk-fee") mkSwapSum(); });
const mkBeta = () => Number(segVal("mk-beta") || 0) || null;
// 解约金倍数一改, 他要的工资跟着变 (R-44): 基准 × (1 + k × (β − 2)), β 不到 2 不打折
document.addEventListener("change", (e) => {
  const sel = e.target;
  if (!sel || sel.id !== "mk-beta") return;
  const w = $("#mk-wage");
  if (w) w.value = (Number(sel.dataset.base) * (1 + Number(sel.dataset.k) * Math.max(0, Number(sel.dataset.value) - 2))).toFixed(2);
});
async function mkAct(path, body, okText) {
  if (busy) return;
  busy = true;
  try {
    const r = await api(path, body);
    const msg = $("#mk-msg");
    if (r.result && r.result.ok) {
      state = r.state;
      render();
      toast(okText(r.result), 3000, true);
      if (currentView) currentView.reopen("replace");
    } else if (r.result && (r.result.why === "counter" || r.result.why === "walked")) {
      // 还价、谈崩 (R-44): 不是出错 —— 页面按新的报价 / 冷却重画, 对方怎么回的弹出来
      state = r.state;
      render();
      toast(mkWhy(r.result), 5000);
      if (currentView) currentView.reopen("replace");
    } else if (msg) {
      msg.textContent = "";
      msg.innerHTML = mkWhy(r.result || {});
    } else {
      toast(mkWhy(r.result || {}));
    }
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}

// ------------------------------------------------------------ 球员的一生 (R-24): 新闻、身份标签
const posName = (x) => esc(x || "");
function newsText(x) {
  const who = x.p ? `<b>${pname(x.p)}</b>` : "";
  switch (x.k) {
    case "farewell": return tf("nw-farewell", { p: who, a: x.age ?? "-" });
    case "retired": return tf("nw-retired", { p: who, a: x.age ?? "-" });
    case "left": return tf("nw-left", { p: who, a: x.age ?? "-" });
    case "youth": return tf("nw-youth", { p: who, a: x.age ?? (x.p && x.p.age), pos: posName(x.pos), o: x.out_p ? pname(x.out_p) : "" });
    case "signing": return tf("nw-signing", { p: who, a: x.age ?? (x.p && x.p.age), pos: posName(x.pos), o: x.out_p ? pname(x.out_p) : "" });
    case "wonderkid": return tf("nw-wonderkid", { t: esc(teamName(x.team)), p: who, a: x.age ?? "-", pos: posName(x.pos) });
    // 转世 (R-42): 他本人回到青训; 老存档 (R-33) 的是一个新人「X 的转世」, 带 of_p
    case "reborn": if (!x.of_p && x.from === x.team) return tf("nw-reborn-home", { p: who, pos: posName(x.pos) });
      if (!x.of_p) return tf("nw-reborn-back", { p: who, t: esc(teamName(x.team)), a: x.age ?? 16, pos: posName(x.pos) });
      return tf("nw-reborn", { o: x.of_p ? `<b>${pname(x.of_p)}</b>` : "?", p: who, t: esc(teamName(x.team)),
      a: x.p ? x.p.age : "-", pos: posName(x.p && x.p.position) });
    case "grow_role": return tf("nw-grow_role", { p: who, r: t("role-" + x.role) });
    case "grow_break": return tf("nw-grow_break", { p: who, v: x.perf });
    case "grow_skill": return tf("nw-grow_skill", { p: who, k: skillName(x) });
    case "grow_pos": return tf("nw-grow_pos", { p: who, k: skillName(x) });
    case "grow_ab": return tf("nw-grow_ab", { p: who, k: skillName(x) });
    case "academy": return tf("nw-academy", { n: x.n });
    case "mood_request": case "mood_settled": case "mood_kept": case "mood_broke": return tf("nw-" + x.k, { p: who });
    case "mood_sulk": return tf("nw-mood_sulk-" + (x.why || "ignored"), { p: who, t: x.buyer != null ? esc(teamName(x.buyer)) : "" });
    case "transfer": return x.kind === "free" ? tf("mk-log-free", { p: who, b: clubName(x.team) })
      : x.kind === "clause" ? tf("nw-transfer-clause", { p: who, a: clubName(x.from), b: clubName(x.team), f: money(x.fee) })
      : x.kind === "swap" ? tf("mk-log-swap", { p: who, a: clubName(x.from), b: clubName(x.team), f: money(x.fee) })
      : x.wk ? tf("nw-transfer-wk", { p: who, a: clubName(x.from), b: clubName(x.team), f: money(x.fee), n: x.age ?? "-" })
      : tf("nw-transfer", { p: who, a: clubName(x.from), b: clubName(x.team), f: money(x.fee) });
    case "bid": return x.loan ? tf("nw-bid-loan", { t: esc(teamName(x.team)), p: who })
      : tf(x.wk ? "nw-bid-wk" : x.swap_p ? "nw-bid-swap" : "nw-bid", { t: esc(teamName(x.team)), f: money(x.fee), p: who, s: x.swap_p ? pname(x.swap_p) : "" });
    case "loan": return tf("nw-loan", { p: who, a: clubName(x.from), b: clubName(x.team), f: money(x.fee) });
    case "loan_back": return tf("nw-loan_back", { p: who, b: clubName(x.team) });
    case "expired": return tf("nw-expired", { p: who });
    case "warn_expire": return tf("nw-warn_expire", { p: who });
    case "warn_loan": return tf("nw-warn_loan", { p: who, a: clubName(x.from), b: clubName(x.team) });
    case "warn_clause": return tf("nw-warn_clause", { p: who, f: money(x.fee) });
    case "bid_missed": return tf("nw-bid_missed", { t: esc(teamName(x.team)), f: money(x.fee), p: who });
    case "board_check": case "board_warn": return tf("nw-" + x.k, { p: x.pos, t: x.target, c: Math.round(x.conf) });
    case "ultimatum": return tf("nw-ultimatum", { c: Math.round(x.conf) });
    case "verdict": return tf("nw-verdict", { p: x.position, t: x.target, r: t(x.met ? "nw-verdict-met" : "nw-verdict-miss"), c: Math.round(x.conf) });
    case "sacked": if (x.mid) return tf("nw-sacked-mid", { t: esc(teamName(x.team)), p: x.pos, g: x.target });
    // falls through
    case "offer": case "hired": return tf("nw-" + x.k, { t: esc(teamName(x.team)) });
    case "award": return x.n ? tf("nw-award-n", { p: who, a: esc(awardLabel(x, isWorld())), n: x.n }) : tf("nw-award", { p: who, a: esc(awardLabel(x, isWorld())) });
    case "hof": return tf("nw-hof", { p: who, n: fmtScore(x.pts) });
    case "invincible":
      return tf("nw-invincible", { t: `<b>${esc(teamName(x.team))}</b>`, l: esc(x.league != null ? leagueName(x.league) : state.career.league_name || ""),
        w: x.won, d: x.drawn, gf: x.gf, ga: x.ga });
    case "upset": {   // 比分按赢的一方在前写
      const s = x.team === x.home ? `${x.hg}-${x.ag}` : `${x.ag}-${x.hg}`;
      return tf("nw-upset", { c: esc(compName(x.comp)), w: `<b>${esc(teamName(x.team))}</b>`, l: esc(teamName(x.lose)), s, p: pctOf(x.p) });
    }
    case "coach_badge": case "staff_in": return tf("nw-" + x.k, { p: who });
    case "nt_offer": case "nt_hired": case "nt_left": return tf("nw-" + x.k, { t: `<b>${esc(teamName(x.team))}</b>` });
    case "coach_hired": return tf("nw-coach_hired", { p: who, t: esc(teamName(x.team)) });
    case "coach_after_you": return tf("nw-coach_after_you", { c: `<b>${esc(x.coach ? (lang === "zh" ? x.coach.name : x.coach.roman || x.coach.name) : "?")}</b>`, t: esc(teamName(x.team)) });
    default: return esc(x.k);
  }
}
const NEWS_TAG = { farewell: ["nt-farewell", "ban"], retired: ["nt-retired", "inj"], left: ["nt-left", "inj"], youth: ["nt-youth", "up"],
  signing: ["nt-signing", "up"], wonderkid: ["nt-wonderkid", "learn"], reborn: ["nt-reborn", "brk"], grow_role: ["ge-tag-up", "up"], grow_break: ["ge-tag-break", "brk"], grow_skill: ["ge-tag-skill", "learn"], grow_pos: ["tr-pos-title", "learn"], grow_ab: ["tr-ab-title", "learn"], academy: ["nt-youth", "up"],
  mood_request: ["nt-mood", "inj"], mood_sulk: ["nt-mood", "inj"], mood_settled: ["nt-mood", "up"], mood_kept: ["nt-mood", "up"], mood_broke: ["nt-mood", "inj"],
  transfer: ["nt-transfer", "up"], bid: ["nt-bid", "ban"], expired: ["nt-expired", "inj"],
  warn_expire: ["nt-warn", "ban"], warn_loan: ["nt-warn", "ban"], warn_clause: ["nt-warn", "ban"], bid_missed: ["nt-bid", ""],
  board_check: ["nt-board", ""], board_warn: ["nt-board", "ban"], ultimatum: ["nt-board", "inj"], verdict: ["nt-board", "up"], sacked: ["nt-sacked", "inj"], offer: ["nt-offer", "learn"],
  hired: ["nt-offer", "up"], award: ["nt-award", "hof"], hof: ["nt-hof", "hof"], coach_badge: ["nt-coach", "learn"], coach_hired: ["nt-coach", "learn"],
  coach_after_you: ["nt-coach", ""], staff_in: ["nt-coach", "up"], upset: ["nt-upset", "brk"], loan: ["nt-loan", "up"], loan_back: ["nt-loan", ""],
  nt_offer: ["nt-ntjob", "learn"], nt_hired: ["nt-ntjob", "up"], nt_left: ["nt-ntjob", ""] };
const newsWhen = (x) => (x.date ? esc(fmtDate(x.date, false)) : x.round ? tf("round-tag", { n: x.round }) : "");
function newsRow(x, seen) {
  const [k, cls] = NEWS_TAG[x.k] || ["news-title", ""];
  const label = t(k);
  // 爆冷那条点了进战报 (data-fixture, 和赛程行一样)
  return `<div class="news-row${x.id > seen ? " unread" : ""}"${x.fid ? ` tabindex="0" role="button" data-fixture="${esc(x.fid)}"` : ""}>
    <span class="news-when">${x.id > seen ? `<span class="news-dot"></span><span class="sr-only">${t("unread")} · </span>` : ""}${newsWhen(x)}</span>${x.p ? face(x.p.pid, x.team) : `<span class="face-gap"></span>`}
    <div class="grow"><div class="teamline">${x.team ? emblem(x.team, "sm") + esc(teamName(x.team)) : ""}</div><div>${newsText(x)}</div></div>
    <span class="fit-tag ${cls}">${esc(label)}</span></div>`;
}
// 新闻页: 按赛季分组 (最新的在上); 打开就算都看过了
async function openNews(nav = "push") {
  const seq = ++openSeq;
  let n;
  try {
    n = await api("/api/news");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const groups = [];
  for (const x of n.items) {
    const key = x.label || tf("season", { n: x.s });
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
    groups[groups.length - 1].items.push(x);
  }
  const body = groups.length ? groups.map((g) => `<h2 class="panel-head sub-head">${esc(g.key)}</h2>${g.items.map((x) => newsRow(x, n.seen)).join("")}`).join("")
    : `<div class="empty">${t("news-none")}</div>`;
  openModal(glowHtml(state.career.user_team) + pageHead(t("news-title"), leagueKicker(), n.items.length ? t("news-hint") : "")
    + pageBody(fillPanel(body)), false, { label: () => t("news-title"), reopen: (x) => openNews(x) }, nav);
  if (n.items.length && n.items[0].id > n.seen) {
    try {
      state = await api("/api/news/seen", { id: n.items[0].id });
      render();
    } catch (e) { /* 标已读失败不要紧 */ }
  }
}
// 球员页页头: 告别赛季 / 已经退役、离开 / 青训出身、外面签来
function lifeTags(p) {
  const out = [];
  if (p.leaving === "r") out.push(`<span class="fit-tag ban">${t("tag-farewell")}</span>`);
  if (p.gone) out.push(`<span class="fit-tag inj">${tf(p.gone.why === "l" ? "tag-left" : "tag-retired", { s: p.gone.label || tf("season", { n: p.gone.s }) })}</span>`);
  if (p.regen) out.push(`<span class="fit-tag up">${t(p.regen.kind === "youth" ? "tag-youth" : "tag-signing")}</span>`);
  // 转世 (R-42): 他本人回来的, 写哪季回到哪队、当初在哪退役
  const rb = p.reborn;
  if (rb) {
    const nm = (c) => (c ? esc(lang === "zh" ? c.zh : c.latin) : "?");
    out.push(`<span class="fit-tag brk">${tf("tag-reborn-back", { s: rb.label || tf("season", { n: rb.s }), t: nm(rb.team),
      w: rb.was.label || tf("season", { n: rb.was.s }), wt: nm(rb.was.team) })}</span>`);
  }
  // 转世 (R-33 老存档): 小妖写「X 的转世」, X 写「转世为 Y」, 点了去对方的球员页
  for (const [k, q] of [["tag-reborn-of", p.reborn_of], ["tag-reborn-as", p.reborn_as]]) {
    if (q) out.push(`<span class="fit-tag brk clickable" tabindex="0" role="button" data-pid="${q.pid}">${tf(k, { p: pname(q) })}</span>`);
  }
  const hn = p.honors;   // 荣誉 (R-27): 名人堂、传奇教练
  if (hn && hn.hof) out.push(`<span class="fit-tag hof">${t("hof-tag")}</span>`);
  if (hn && hn.coach && (hn.coach.status === "head" || hn.coach.status === "staff")) out.push(`<span class="fit-tag learn">${coachStatus(hn.coach)}</span>`);
  return out.join("");
}

// 战报「成长」: 你的队每个人涨了什么 (和谁同场翻倍); 两队谁升了身份、谁突破、谁练成了技能
function growEventsHtml(list) {
  if (!list || !list.length) return "";
  const mine = state.career.user_team;
  const line = (x, tag, text) => `<div class="fit-ev">${emblem(x.team, "sm")}${tag}<span>${text}</span></div>`;
  const tag = (k, cls) => `<span class="fit-tag ${cls}">${t(k)}</span>`;
  const lines = [];
  for (const x of [...list].sort((a, b) => (b.team === mine) - (a.team === mine))) {
    const who = `<b>${pname(x)}</b>`;
    if (x.k === "pt" && x.team === mine) {
      lines.push(line(x, tag("ge-tag-up", "up"), tf("ge-pt", { p: who, k: gainText(x.gain) }) + (x.aura_p ? tf("ge-aura", { m: pname(x.aura_p) }) : "")));
    } else if (x.k === "role") {
      lines.push(line(x, roleTag(x.role), tf("ge-role", { p: who, r: t("role-" + x.role) })));
    } else if (x.k === "break") {
      lines.push(line(x, tag("ge-tag-break", "brk"), tf("ge-break", { p: who, v: x.perf })));
    } else if (x.k === "skill") {
      lines.push(line(x, tag("ge-tag-skill", "learn"), tf("ge-skill", { p: who, k: skillName(x) }) + (x.mentor_p ? tf("ge-skill-m", { m: pname(x.mentor_p) }) : "")));
    } else if (x.k === "pos") {
      lines.push(line(x, tag("tr-pos-title", "learn"), tf("nw-grow_pos", { p: who, k: skillName(x) })));
    } else if (x.k === "ab") {
      lines.push(line(x, tag("tr-ab-title", "learn"), tf("ge-ab", { p: who, k: skillName(x), v: x.to != null ? tf("ge-ab-to", { v: x.to }) : "" })));
    }
  }
  return lines.length ? `<h2 class="panel-head sub-head">${t("gr-title")}</h2><div class="fit-evs">${lines.join("")}</div>` : "";
}

// 成长记录的一条
function histText(x) {
  const who = x.name ? `<b>${pname(x)}</b>` : "";
  if (x.k === "mentor") return x.n === 1 ? tf("gh-mentor1", { p: who }) : tf("gh-mentor", { p: who, n: x.n });
  if (x.k === "role") return tf("gh-role", { r: roleTag(x.role) });
  if (x.k === "break") return tf("gh-break", { v: x.perf });
  if (x.k === "skill") return tf("gh-skill", { k: `<b>${skillName(x)}</b>` });
  if (x.k === "pos") return tf("nw-grow_pos", { p: "", k: `<b>${skillName(x)}</b>` });
  if (x.k === "ab") return tf("gh-ab", { k: `<b>${skillName(x)}</b>`, n: x.n });
  if (x.k === "decline") return tf("gh-decline", { k: gainText(x.keys, "-") });
  if (x.k === "season") return tf("gh-season", { n: x.points }) + (x.d ? ` <span class="muted">${gainText(countsToKeys(x.d))}</span>` : "");
  return esc(x.k);
}

// 球员页「成长」: 左边身份、总评、潜力、经验和年龄阶段; 中间能力变化和技能 (你的人还有训练); 右边师从和成长记录
function playerGrowthHtml(p) {
  const g = p.growth;
  if (!g) return `<section class="panel"><div class="empty">${t("no-career")}</div></section>`;
  const next = g.next_role
    ? `${gbar(g.rep, g.next_rep)}<div class="muted">${tf("gr-next-role", { r: t("role-" + g.next_role), rep: g.next_rep, o: g.next_ovr })}${g.next_age ? tf("gr-next-age", { a: g.next_age }) : ""}</div>`
    : `<div class="muted">${t("gr-top")}</div>`;
  const left = `<div class="gr-role">${roleTag(g.role)}</div>
    <div class="gr-block"><div class="gr-line"><span>${t("gr-rep")}</span><b class="n">${g.rep}</b></div>${next}</div>
    <div class="gr-block"><div class="gr-line"><span>${t("gr-ovr")}</span><b class="n">${Math.round(g.ovr0)} → ${Math.round(g.ovr)}</b>${gdelta(g.ovr - g.ovr0)}</div></div>
    <div class="gr-block"><div class="gr-line"><span>${t("gr-pot")}</span>${gradeTag(g.grade)}<b>${t("grade-" + g.grade)}</b></div>
      ${g.capped ? `<div class="muted warn">${t("gr-capped")}</div>` : ""}${g.brk ? `<div class="muted">${tf("gr-breaks", { n: g.brk })}</div>` : ""}</div>
    <div class="gr-block"><div class="gr-line"><span>${t("gr-xp")}</span><b class="n">${g.xp} / ${g.xp_need}</b></div>${gbar(g.xp, g.xp_need)}
      <div class="muted">${tf("gr-xp-next", { n: Math.max(1, Math.ceil(g.xp_need - g.xp)) })}</div></div>
    <div class="gr-block"><div class="gr-line"><span>${t("gr-stage")}</span><b>${tf("stage-" + stageOf(g.age_xp), { x: g.age_xp })}</b></div>
      ${g.gtype ? `<div class="gr-line"><span>${t("gr-gtype")}</span><b>${t("gt-" + g.gtype)}</b></div>` : ""}
      ${g.declining ? `<div class="muted warn">${t("gr-declining")}</div>` : ""}</div>`;
  const changed = (p.abilities || []).filter((a) => a.delta).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const rows = changed.map((a) => `<div class="arow"><span>${esc(gname("ab", a.cn, a.en))}</span>
    <span><span class="muted">${a.base} →</span> <b class="${abCls(a.value)}">${a.value}</b>${gdelta(a.delta)}</span></div>`).join("");
  const season = Object.entries(g.season_d || {}).sort((a, b) => b[1] - a[1]);
  const learned = (p.skills || []).filter((s) => s.learned);
  const tr = g.training;
  const train = !g.mine ? "" : `<h2 class="panel-head sub-head">${t("gr-training")}</h2>
    ${tr ? `<div class="gr-line"><span>${tf("gr-training-now", { k: skillName(tr) })}</span><b class="n">${Math.floor(tr.prog)} / ${tr.need}</b></div>${gbar(tr.prog, tr.need)}`
      : `<div class="muted">${t("gr-training-none")}</div>`}
    <div class="hero-actions compact"><button class="pill" data-act="open-training" data-train="${p.pid}">${t("open-training")}</button></div>`;
  const mid = `${rows ? `<div class="gr-abil">${rows}</div>` : `<div class="empty">${tf("gr-changes-none", { n: g.xp_need })}</div>`}
    ${season.length ? `<h2 class="panel-head sub-head">${t("gr-this-season")}</h2><div class="chips">${season.map(([k, n]) => `<span class="motion">${esc(abName(k))} <b>+${n}</b></span>`).join("")}</div>` : ""}
    ${learned.length ? `<h2 class="panel-head sub-head">${t("gr-learned")}</h2><div class="chips">${learned.map((s) => `<span class="skill learned" title="${esc(t("learned-tip"))}">${esc(gname("skill", s.cn, s.en))}</span>`).join("")}</div>` : ""}
    ${train}`;
  const mentors = (g.mentors || []).map((m) => `<div class="gr-mentor">${face(m.pid)}<span>${pname(m)}</span><span class="muted">${tf("gr-mentor-n", { n: m.times })}</span></div>`).join("");
  const hist = (g.hist || []).map((x) => `<div class="gh"><span class="gh-s">${seasonOf(x)}</span><span>${histText(x)}</span></div>`).join("");
  const right = `${mentors ? `<div class="gr-mentors">${mentors}</div><h2 class="panel-head sub-head">${t("gr-hist")}</h2>` : ""}
    ${hist ? `<div class="gh-list">${hist}</div>` : `<div class="empty">${t("gr-hist-none")}</div>`}`;
  return `<div class="cols growth-cols" data-nav-sides>${fillPanel(left, `<h2 class="panel-head">${t("gr-identity")}</h2>`)}
    ${fillPanel(mid, `<h2 class="panel-head">${t("gr-changes")}${g.season_points ? ` <span class="muted">${tf("gr-season-pts", { n: g.season_points })}</span>` : ""}</h2>`)}
    ${fillPanel(right, `<h2 class="panel-head">${t(mentors ? "gr-mentors" : "gr-hist")}</h2>`)}</div>`;
}

// ------------------------------------------------------------ 训练中心 (R-23)
// 三个标签: 技能训练 (左边全队, 右边这个人的成长和能练的技能) / 成长榜 / 老带新
async function openTraining(nav = "push", focusPid = null, tab = null) {
  const seq = ++openSeq;
  let tr;
  try {
    tr = await api("/api/training");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const mine = state.career.user_team;
  // 年轻的在上 (训练场先看新人); 顺序不随开练 / 停练变, 原地重画时还停在同一个人上
  const rows = [...tr.squad].sort((a, b) => (a.age ?? 99) - (b.age ?? 99) || (b.overall ?? 0) - (a.overall ?? 0) || a.pid - b.pid);
  const opts = new Map();   // 这次打开页面里拿过的「能练的技能」
  const fillOpts = async (r) => {
    const box = () => document.querySelector(`.tr-opts[data-opts="${r.pid}"]`);
    let o = opts.get(r.pid);
    if (!o) {
      try {
        o = await api("/api/training/options/" + r.pid);
      } catch (e) {
        const el = box();
        if (el) el.innerHTML = `<div class="error">${esc(e.message)}</div>`;
        return;
      }
      opts.set(r.pid, o);
    }
    const el = box();
    if (!el) return;
    const full = !r.training && tr.used >= tr.slots;
    const locked = ROLE_ORDER.indexOf(r.role) < ROLE_ORDER.indexOf("star") ? `<div class="muted">${t("tr-special-lock")}</div>` : "";
    // 位置训练 (R-48): 现在会踢哪些位置, 能练的下一级
    const aptNow = Object.entries(o.apt || {}).filter(([k, v]) => v > 0 && k !== o.main).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${t("apt-" + v)}`).join(" · ");
    const posHtml = o.positions && o.positions.length ? `<div class="tr-group"><h4>${t("tr-pos-title")} <span class="muted">${tf("tr-pos-now", { a: esc(o.main || "") + (aptNow ? " · " + aptNow : "") })}</span></h4>
      <div class="tr-grid">${o.positions.map((x) => {
        const on = r.training && r.training.pos === x.pos;
        return `<button class="tr-opt${on ? " on" : ""}" data-act="train-start" data-train="${r.pid}" data-pos="${esc(x.pos)}" data-who="${pname(r)}"${full || on ? " disabled" : ""}>
          <span class="tr-opt-name">${esc(tf("tr-pos-name", { p: x.pos, l: t("apt-" + x.lvl) }))}</span><span class="tr-opt-sub">${tf("tr-matches", { n: x.matches })}</span></button>`;
      }).join("")}</div><div class="muted">${t("tr-pos-note")}</div></div>` : "";
    // 能力训练 (R-74): 按球员页的分组, 每项「现值 → 下一点」和涨 1 点大约几场
    const abGroups = [];
    for (const x of o.abilities || []) {
      let grp = abGroups.find((g) => g.k === x.group);
      if (!grp) abGroups.push((grp = { k: x.group, xs: [] }));
      grp.xs.push(x);
    }
    const abHtml = abGroups.length ? `<div class="tr-group"><h4>${t("tr-ab-title")}</h4>${abGroups.map((g) => `<div class="tr-sub muted">${esc(AB_GROUP_EN[g.k] ? t(AB_GROUP_EN[g.k]) : g.k || "")}</div>
      <div class="tr-grid">${g.xs.map((x) => {
        const on = r.training && r.training.ab === x.key;
        return `<button class="tr-opt${on ? " on" : ""}" data-act="train-start" data-train="${r.pid}" data-ab="${esc(x.key)}" data-name="${esc(abName(x.key))}" data-who="${pname(r)}"${full || on ? " disabled" : ""}>
          <span class="tr-opt-name">${esc(abName(x.key))}${x.cur != null ? ` <span class="n">${tf("tr-ab-opt", { v: x.cur, n: x.cur + 1 })}</span>` : ""}</span><span class="tr-opt-sub">${tf("tr-ab-sub", { n: x.matches })}</span></button>`;
      }).join("")}</div>`).join("")}<div class="muted">${tf("tr-ab-note", { m: o.ab_mentor_min ?? 85 })}</div></div>` : "";
    if (!o.options.length && !posHtml && !abHtml) {
      el.innerHTML = `<div class="empty">${t("tr-none-left")}</div>`;
      return;
    }
    el.innerHTML = (full ? `<div class="muted warn">${t("tr-full")}</div>` : "") + abHtml + posHtml + ["minor", "regular", "special"].map((tier) => {
      const xs = o.options.filter((x) => x.tier === tier);
      return xs.length ? `<div class="tr-group"><h4>${t("tier-" + tier)}</h4><div class="tr-grid">${xs.map((x) => {
        const on = r.training && r.training.skill === x.en;
        return `<button class="tr-opt${on ? " on" : ""}" data-act="train-start" data-train="${r.pid}" data-skill="${esc(x.en)}" data-who="${pname(r)}"${full || on ? " disabled" : ""}>
          <span class="tr-opt-name">${esc(gname("skill", x.cn, x.en))}</span><span class="tr-opt-sub">${tf("tr-matches", { n: x.matches })}</span></button>`;
      }).join("")}</div></div>` : "";
    }).join("") + locked;
    UI.prepScrollers(el.closest(".md-detail") || el);
  };
  const detail = (i) => {
    const r = rows[i], now = r.training;
    setTimeout(() => fillOpts(r), 0);
    return `<h2 class="panel-head">${t("tab-train")} <span class="muted">${tf("tr-slots", { a: tr.used, b: tr.slots })}</span></h2>
      ${scroller(`<div class="tr-head">${face(r.pid, mine)}<div class="grow"><div class="tr-name">${pname(r)}${roleTag(r.role)}</div>
          <div class="muted">${esc(r.position || "")} · ${r.age ?? "-"} ${t("age-u")} · ${t("th-ovr")} <b class="n">${r.overall ?? "-"}</b>${gdelta(r.grow)} · ${t("gr-pot")} ${gradeTag(r.grade)}</div></div></div>
        <div class="gr-line"><span>${t("gr-xp")}</span><b class="n">${r.xp} / ${r.xp_need}</b>${r.season_points ? `<span class="muted">${tf("gr-season-pts", { n: r.season_points })}</span>` : ""}</div>${gbar(r.xp, r.xp_need)}
        ${now ? `<div class="tr-now"><div class="gr-line"><span>${tf("gr-training-now", { k: skillName(now) })}</span><b class="n">${Math.floor(now.prog)} / ${now.need}</b></div>${gbar(now.prog, now.need)}
          ${now.ab && now.n ? `<div class="muted">${tf("tr-ab-gained", { n: now.n })}</div>` : ""}
          ${now.mentor ? `<div class="muted">${tf("tr-mentor-on", { m: pname(now.mentor) })}</div>` : ""}
          <div class="hero-actions compact"><button class="pill" data-act="train-stop" data-train="${r.pid}" data-who="${pname(r)}">${t("tr-stop")}</button></div></div>` : ""}
        <h2 class="panel-head sub-head">${t("tr-options")}${now ? ` <span class="muted">${t("tr-switch")}</span>` : ""}</h2>
        <div class="tr-opts" data-opts="${r.pid}"><div class="muted">${t("loading")}</div></div>`)}`;
  };
  const items = rows.map((r) => ({ label: `${pname(r)}${roleTag(r.role)}`,
    sub: `${esc(r.position || "")} · ${r.age ?? "-"} ${t("age-u")} · ${t("gr-pot")} ${r.grade}`,
    badge: r.training ? `<span class="md-res tr-badge"><span class="n">${pct(r.training)}%</span></span>`
      : r.season_points ? `<span class="md-res"><span class="n up">${tf("pts-n", { n: r.season_points })}</span></span>` : "" }));
  const view = { label: () => t("tr-title"), reopen: (n) => openTraining(n), ui: { tab: tab || "train" } };
  if (focusPid != null) {
    const i = rows.findIndex((r) => r.pid === focusPid);
    if (i >= 0) view.ui.who = i;
  }
  view.tabs = [
    { k: "train", label: t("tab-train"), html: () => (rows.length ? mdHtml(items, 0) : `<section class="panel"><div class="empty">${t("no-data")}</div></section>`),
      after: (pane, restored) => bindMd(pane, view.ui, "who", rows.length, detail, restored) },
    { k: "grow", label: t("tab-grow"), html: () => fillPanel(growTable(rows)) },
    { k: "mentor", label: t("tab-mentor"), html: () => mentorHtml(rows, tr) },
    ...(tr.academy ? [{ k: "academy", label: t("tab-academy") + (tr.academy.list.length && tr.academy.open ? ` <span class="n">${tr.academy.list.length}</span>` : ""),
      html: () => academyHtml(tr.academy) }] : []),
  ];
  openModal(glowHtml(mine) + pageHead(t("tr-title"), esc(teamName(mine)), tf("tr-slots", { a: tr.used, b: tr.slots })), true, view, nav);
}

// ------------------------------------------------------------ 手动首发 (R-65)
// 左边球场站位 (点卡就是选槽位), 右边这个槽位换谁上 (同线的在前)。草稿只活在 tacPage 里, 点保存才进存档;
// 从球员页退回来时还停在同一个槽位、草稿还在
let tacPage = null;   // { tr, formation, xi, bench, sel }
// 和服务端 validate 同一口径 (服务端是最终裁决): 硬错拦保存, 错线只标出来
function tacValidate(xi, codes, byPid) {
  const errors = [], warns = new Set();
  if (xi.length !== 11 || xi.some((x) => x == null)) errors.push(t("tac-err-size"));
  const seen = new Set();
  xi.forEach((pid, i) => {
    const p = byPid.get(pid);
    if (!p) {
      if (pid != null) errors.push(tf("tac-err-out", { n: "#" + pid }));
      return;
    }
    if (seen.has(pid)) errors.push(tf("tac-err-dup", { n: dispPlayer(p).main }));
    seen.add(pid);
    if (i === 0) { if (p.position !== "GK") errors.push(t("tac-err-gk")); }
    else if ((TAC_LINE_OF[p.position] || "MID") !== (TAC_LINE_OF[codes[i]] || "MID")) warns.add(i);
  });
  return { errors, warns };
}
// compact: 首发名单那一栏窄, 只写「伤 / 停」, 天数场数放 title (R-68 审查: 以前长标签把名字挤成「P..」)
const tacOutTag = (p, compact = false) => {
  const o = p.out;
  if (!o) return "";
  const [cls, word, full] = o.why === "inj" ? ["inj", t("fit-inj"), `${t("fit-inj")} · ${o.days}${t("unit-day")}`]
    : ["ban", t("fit-ban"), `${t("fit-ban")} · ${o.left}${t("unit-match")}`];
  return `<span class="fit-tag ${cls}"${compact ? ` title="${esc(full)}"` : ""}>${esc(compact ? word : full)}</span>`;
};
// 两步交换 (R-66): 选中 A (待换高亮) 再选 B, 两处互换。预备队没有固定槽位, 对方掉进预备池; 预备之间只换待选。
// R-68: 选中以后每个能换的位置直接标出「换过来是多少」(比现在高绿、低红、错线带 ⚠), 不用一个个悬停去看
function tacBench(P) {
  const inXi = new Set(P.xi);
  const seen = new Set(inXi), out = [];
  const byPid = new Map(P.tr.squad.map((p) => [p.pid, p]));
  for (const pid of P.bench || []) {
    if (byPid.has(pid) && !seen.has(pid)) { seen.add(pid); out.push(pid); }
  }
  const rest = P.tr.squad.filter((p) => !seen.has(p.pid)).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  while (out.length < TAC_BENCH_N && rest.length) { const p = rest.shift(); seen.add(p.pid); out.push(p.pid); }
  P.bench = out.slice(0, TAC_BENCH_N);
  return P.bench;
}
function tacSpotPid(P, spot) {
  if (!spot) return null;
  if (spot.startsWith("xi:")) return P.xi[Number(spot.slice(3))] ?? null;
  if (spot.startsWith("sub:")) return P.bench[Number(spot.slice(4))] ?? null;
  if (spot.startsWith("res:")) return Number(spot.slice(4));
  return null;
}
function tacSpotOf(P, pid) {
  const i = P.xi.indexOf(pid);
  if (i >= 0) return { t: "xi", i };
  const j = P.bench.indexOf(pid);
  if (j >= 0) return { t: "sub", j };
  return { t: "res" };
}
function tacSwap(P, a, b) {
  const A = tacSpotOf(P, a), B = tacSpotOf(P, b);
  if (A.t === "xi" && B.t === "xi") { const t = P.xi[A.i]; P.xi[A.i] = P.xi[B.i]; P.xi[B.i] = t; }
  else if (A.t === "sub" && B.t === "sub") { const t = P.bench[A.j]; P.bench[A.j] = P.bench[B.j]; P.bench[B.j] = t; }
  else {
    if (A.t === "xi") P.xi[A.i] = b; else if (A.t === "sub") P.bench[A.j] = b;
    if (B.t === "xi") P.xi[B.i] = a; else if (B.t === "sub") P.bench[B.j] = a;
  }
  tacBench(P);
}
const tacCodes = (P) => P.tr.preset_slots[P.formation] || P.tr.slots;
// 改没改: 和打开页面时的样子比 (P.orig; 自动阵容打开时已经对好号位, 见 openTactics)
const tacDirty = (P) => P.formation !== P.orig.formation || P.xi.join(",") !== P.orig.xi || P.bench.join(",") !== P.orig.bench;
function tacSelect(spot) {
  const P = tacPage;
  if (!P || !spot) return;
  tacBench(P);
  const pid = tacSpotPid(P, spot);
  if (pid == null) return;
  if (P.sel == null || P.sel === pid) P.sel = P.sel === pid ? null : pid;
  else if (tacSpotOf(P, P.sel).t === "res" && tacSpotOf(P, pid).t === "res") P.sel = pid;
  else {
    const pair = [P.sel, pid];
    const before = tacRects(pair);
    tacSwap(P, P.sel, pid);
    P.sel = null;
    return openTactics("replace", true).then(() => requestAnimationFrame(() => tacArc(pair, before)));
  }
  openTactics("replace", true);
}
// 交换的两个人 (R-88): 换之前量一下位置, 重画以后从原来的位置沿弧线走到新位置 (一个往上拱、一个往下拱, 交叉而过)。
// 球场卡自己靠 transform 定位, 所以动的是 translate 这个属性, 两样叠在一起不打架; R-89 起由 GSAP 推进度
const tacRects = (pids) => new Map(pids.map((pid) => { const el = $(`#modal [data-tp="${pid}"]`); return [pid, el ? el.getBoundingClientRect() : null]; }));
function tacArc(pids, before) {
  const G = motion();
  if (!G) return;
  pids.forEach((pid, i) => {
    const el = $(`#modal [data-tp="${pid}"]`), a = before.get(pid);
    if (!el || !a) return;
    const b = el.getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2), dy = a.top + a.height / 2 - (b.top + b.height / 2);
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    const lift = Math.min(60, Math.hypot(dx, dy) * 0.25) * (i ? 1 : -1);
    // 控制点取在中点再拱 2 倍, 曲线正好经过「中点拱 lift」那一点
    const cx = dx / 2, cy = dy / 2 + lift * 2, o = { k: 0 };
    el.style.translate = `${dx}px ${dy}px`;
    G.to(o, { k: 1, duration: 0.42, ease: "power2.inOut",
      onUpdate() { const k = o.k, u = 1 - k; el.style.translate = `${u * u * dx + 2 * u * k * cx}px ${u * u * dy + 2 * u * k * cy}px`; },
      onComplete() { el.style.translate = ""; } });
  });
}
// 选中 sel 以后点 spot: 谁会站到哪个槽位、总评变成多少 (R-68)。-> { v, cur, m } / null (点了不进首发的不标)
function tacIncoming(P, spot, byPid, codes) {
  if (P.sel == null) return null;
  const pid = tacSpotPid(P, spot);
  if (pid == null || pid === P.sel) return null;
  const at = tacSpotOf(P, P.sel);
  let who, slot;
  if (spot.startsWith("xi:")) { who = byPid.get(P.sel); slot = Number(spot.slice(3)); }
  else if (at.t === "xi") { who = byPid.get(pid); slot = at.i; }
  else return null;
  if (!who || who.overall == null || !codes[slot]) return null;
  const occ = byPid.get(P.xi[slot]), m = tacMalus(who.position, codes[slot]);
  return { v: who.overall + m, m, cur: occ && occ.overall != null ? occ.overall + tacMalus(occ.position, codes[slot]) : null };
}
// 换后总评 + 比现在多 / 少多少 (R-68 审查: 强弱写成 +2 / −36, 不只靠颜色; 不用 ⚠ 这种符号当图标)。
// pitch: 球场卡上只标「换过去更强」的 (名单里全标; 两处都标满是一片红, 挑不出该放哪)
const tacCmpDelta = (c) => (c.cur == null ? "" : c.v > c.cur ? `+${c.v - c.cur}` : c.v < c.cur ? `−${c.cur - c.v}` : "±0");
const tacCmpHtml = (c, pitch = false) => {
  if (!c) return pitch ? "" : `<span class="tac-cmp"></span>`;
  const cls = c.cur == null || c.v > c.cur ? "up" : c.v < c.cur ? "down" : "eq";
  const tip = `${c.v}${c.m < 0 ? ` · ${tf("tac-cmp-off", { m: c.m })}` : ""}`;
  return `<span class="tac-cmp ${cls}" title="${esc(tip)}">${pitch ? tacCmpDelta(c) || c.v : `${c.v}<i>${tacCmpDelta(c)}</i>`}</span>`;
};
const tacPopcount = (x) => { let n = 0; for (; x; x &= x - 1) n++; return n; };
// 换阵型 (R-68): 门将不动, 其余 10 人重新对号入座, 熟悉度扣得最少 (10 人 1024 种状态, 直接动态规划求最优);
// 扣得一样多时尽量留在原来的号位
function tacRemap(xi, codes, byPid) {
  if (xi.length !== 11) return xi;
  const L = xi.slice(1), n = L.length, N = 1 << n;
  const score = (k, i) => { const p = byPid.get(L[k]); return (p ? tacMalus(p.position, codes[i + 1]) : -99) + (k === i ? 0.01 : 0); };
  const dp = new Float64Array(N).fill(-Infinity), from = new Int8Array(N).fill(-1);
  dp[0] = 0;
  for (let mask = 0; mask < N; mask++) {
    if (dp[mask] === -Infinity) continue;
    const i = tacPopcount(mask);
    if (i >= n) continue;
    for (let k = 0; k < n; k++) {
      if (mask & (1 << k)) continue;
      const nm = mask | (1 << k), v = dp[mask] + score(k, i);
      if (v > dp[nm]) { dp[nm] = v; from[nm] = k; }
    }
  }
  const out = new Array(n);
  for (let mask = N - 1, i = n - 1; i >= 0; i--) { const k = from[mask]; out[i] = L[k]; mask ^= 1 << k; }
  return [xi[0], ...out];
}
// 一键排阵 (R-68): 能上的人 (伤停的不算) 按「总评 + 熟悉度 − 体能扣分」从高到低对号入座, 门将槽只放门将;
// 替补席 = 最好的替补门将 + 其余能上的人里最强的。只改草稿, 要保存才算。
// 体能扣分和模拟同一口径 (fitness.FitConfig 的 perf_line / perf_k, test_web 锁死): 累了的人模拟里也是这么打折的
const TAC_PERF = { line: 90, k: 0.15 };
const tacFresh = (p) => (p.overall ?? 0) - TAC_PERF.k * Math.max(0, TAC_PERF.line - (p.cond ?? 100));
function tacBest(P, codes) {
  const pool = P.tr.squad.filter((p) => !p.out && p.overall != null);
  const pairs = [];
  for (const p of pool) codes.forEach((c, i) => { if ((i === 0) === (p.position === "GK")) pairs.push([tacFresh(p) + tacMalus(p.position, c), p.cond ?? 100, p.pid, i]); });
  pairs.sort((a, b) => b[0] - a[0] || b[1] - a[1] || a[2] - b[2]);
  const xi = new Array(11).fill(null), used = new Set();
  for (const [, , pid, i] of pairs) if (xi[i] == null && !used.has(pid)) { xi[i] = pid; used.add(pid); }
  const byOvr = [...P.tr.squad].sort((a, b) => tacFresh(b) - tacFresh(a) || a.pid - b.pid);
  for (let i = 0; i < 11; i++) {        // 能上的人凑不齐 (门将全伤了之类): 空位随便补, 保存时照样拦 / 警告
    if (xi[i] != null) continue;
    const p = byOvr.find((q) => !used.has(q.pid) && !q.out) || byOvr.find((q) => !used.has(q.pid));
    if (p) { xi[i] = p.pid; used.add(p.pid); }
  }
  const left = byOvr.filter((p) => !used.has(p.pid) && !p.out);
  const gk = left.find((p) => p.position === "GK");
  return { xi, bench: [...(gk ? [gk] : []), ...left.filter((p) => p !== gk)].map((p) => p.pid).slice(0, TAC_BENCH_N) };
}
function tacPickBest() {
  const P = tacPage;
  if (!P) return;
  const r = tacBest(P, tacCodes(P));
  P.xi = r.xi;
  P.bench = r.bench;
  P.sel = null;
  tacBench(P);
  openTactics("replace", true);
  toast(tf("tac-best-done", { f: P.formation }), 3000);
}
// LB / RB: 跳到左栏 / 右栏第一处 (R-66)
// 改了没保存就离开战术页: 先问一句 (R-68), 放弃才扔草稿。then: 确认以后接着做的事 (返回 / 回主页)
function tacLeaveGuard(then) {
  if (!(currentView && currentView.tac && tacPage && !$("#modal").hidden && tacDirty(tacPage))) return false;
  askConfirm(t("tac-leave"), t("tac-leave-yes"), true).then((ok) => {
    if (!ok) return;
    tacPage = null;
    then();
  });
  return true;
}
function tacOnLineup() {   // 战术页的首发标签开着 (提示条 / 标签条在页面载完前也会问, 所以用函数声明)
  return !!(currentView && currentView.tac && !$("#modal").hidden && (!currentView.ui || currentView.ui.tab !== "room"));
}

async function openTactics(nav = "push", reuse = false) {
  const seq = ++openSeq;
  if (!(reuse && tacPage)) {
    try {
      const tr = await api("/api/tactics");
      if (seq !== openSeq) return;
      let xi = tr.xi.length ? [...tr.xi] : [...tr.squad].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99)).slice(0, 11).map((p) => p.pid);
      // 自动阵容按建队的槽位摆, 和显示的阵型常对不上 (R-66 的老问题): 打开时先对好号位 (R-68), 算作没改动 ——
      // 以前一动一个人, 全队突然冒出一片错线
      if (tr.mode !== "manual") xi = tacRemap(xi, tr.preset_slots[tr.formation] || tr.slots, new Map(tr.squad.map((p) => [p.pid, p])));
      tacPage = { tr, formation: tr.formation, xi, bench: [...(tr.subs || [])], sel: null };
      tacBench(tacPage);
      tacPage.orig = { formation: tr.formation, xi: xi.join(","), bench: tacPage.bench.join(",") };
    } catch (e) {
      return toast(e.message);
    }
  } else if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const mine = state.career.user_team;
  const P = tacPage, byPid = new Map(P.tr.squad.map((p) => [p.pid, p]));
  const codes = tacCodes(P);
  const v = tacValidate(P.xi, codes, byPid);
  const coords = TAC_PITCH[P.formation] || TAC_PITCH["4-4-2"];
  const dotTag = (p) => (p && p.out ? `<span class="tac-dot ${p.out.why === "inj" ? "inj" : "ban"}" title="${esc(p.out.why === "inj"
    ? `${t("fit-inj")} · ${p.out.days}${t("unit-day")}` : `${t("fit-ban")} · ${p.out.left}${t("unit-match")}`)}"></span>` : "");
  const sel = P.sel;
  const roomByPid = new Map((P.tr.room ? P.tr.room.list : []).map((r) => [r.pid, r]));
  const moodDot = (pid) => {   // 行内心情点 + 转会旗 (R-67): 和表内同口径
    const r = roomByPid.get(pid);
    if (!r || r.mood == null) return "";
    const cls = r.mood < (P.tr.room.request ?? 25) ? "bad" : r.mood < 45 ? "warn" : r.mood >= 65 ? "good" : "ok";
    return `<span class="tac-mdot ${cls}" title="${r.mood}"></span>${r.request ? `<span class="fit-tag inj">${t(r.sulk ? "rm-sulk" : "rm-request")}</span>` : ""}`;
  };
  const bench = tacBench(P);
  const dirty = tacDirty(P);
  const live = P.tr.mode === "manual" || dirty;   // 手动/改过才显示折扣: 未改动的自动后端不扣, 显示了反而是谎话
  const mal = (p, code) => (live && p ? tacMalus(p.position, code) : 0);
  const inXi = new Set(P.xi), inBench = new Set(bench);
  const reserves = P.tr.squad.filter((p) => !inXi.has(p.pid) && !inBench.has(p.pid)).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  const faceImg = (pid) => `<img class="face" src="${img("face", pid)}" loading="lazy" ${faceErr(mine)} alt="">`;
  const cmp = (spot, pitch = false) => tacCmpHtml(tacIncoming(P, spot, byPid, codes), pitch);
  const pend = (pid) => (sel == null ? "" : pid === sel ? " pending" : " target");
  // 左栏: 球场 (R-81: 旁边的首发名单去掉了, 球场是首发唯一的一处 —— 名字一直写着, 错线、心情、转会都标在卡上);
  // 错线金框、门将错红框, 数字是扣完的; 待换时每个位置都标「换过来是多少」
  const cardBadges = (p, code) => {
    if (!p) return "";
    const r = roomByPid.get(p.pid);
    const off = p.position && p.position !== code ? `<span class="tac-pos off">${esc(p.position)}</span>` : "";
    // 心情只标不高兴的 (红 / 橙): 11 张卡都挂绿点就是噪音
    const mood = r && r.mood != null && r.mood < 45 ? `<span class="tac-mdot ${r.mood < (P.tr.room.request ?? 25) ? "bad" : "warn"}" title="${r.mood}"></span>` : "";
    const req = r && r.request ? `<span class="fit-tag inj">${t(r.sulk ? "rm-sulk" : "tac-req-short")}</span>` : "";
    return off + mood + req;
  };
  const cards = P.xi.map((pid, i) => {
    const p = byPid.get(pid), m = mal(p, codes[i]);
    const [x, y] = coords[i] || [50, 50];
    const st = (i === 0 && p && p.position !== "GK") ? "bad" : m < 0 ? "warn" : "";
    return `<button class="md-item tac-card${st ? " " + st : ""}${pend(pid)}" data-act="tac-sel" data-spot="xi:${i}" data-tp="${pid}"${i === 0 ? " data-nav-default" : ""} style="left:${x}%;top:${y}%"`
      + ` title="${esc(p ? `${dispPlayer(p).main} · ${p.position || ""} · ${p.overall ?? ""}${m < 0 ? `→${p.overall + m}` : ""}` : "?")}">`
      + `${p ? tacCard({ ...p, overall: p.overall == null ? null : p.overall + m }, codes[i], mine, dotTag(p), cardBadges(p, codes[i])) : `<span class="tac-nm">?</span>`}`
      + `${sel != null && pid !== sel ? cmp(`xi:${i}`, true) : ""}</button>`;
  }).join("");
  // 右栏: 替补席 + 预备队 (号码、位置、体力条、总评、状态箭头)
  const rRow = (pid, spot) => {
    const p = byPid.get(pid);
    if (!p) return "";
    const arrow = p.form == null ? "" : p.form > 0.5 ? ["▲", "up"] : p.form < -0.5 ? ["▼", "down"] : ["–", "flat"];
    return `<li><button class="tac-row${pend(pid)}" data-act="tac-sel" data-spot="${spot}" data-tp="${pid}"`
      + ` title="${esc(`${dispPlayer(p).main} · ${p.position || ""} · ${p.overall ?? ""}`)}">`
      + `<span class="tac-num">${p.num ?? ""}</span>${faceImg(p.pid)}<span class="tac-nm">${pname(p)}</span>${p.out ? tacOutTag(p) : ""}${moodDot(pid)}`
      + `<span class="tac-pos">${esc(p.position || "")}</span>`
      + `<span class="tac-condbar${(p.cond ?? 100) < 40 ? " low" : ""}" title="${p.cond ?? ""}"><i style="width:${Math.max(0, Math.min(100, p.cond ?? 0))}%"></i></span>`
      + `${cmp(spot)}<span class="num">${p.overall ?? ""}</span>`
      + (arrow ? `<span class="tac-arrow ${arrow[1]}" title="${p.form}">${arrow[0]}</span>` : `<span class="tac-arrow"></span>`)
      + `</button></li>`;
  };
  const pitch = `<div class="cols tac-split" data-nav-sides>`
    + `<section class="panel fill" id="tac-left" data-nav-group="tac-xi"><h2 class="panel-head">${t("tac-xi")} · ${esc(P.formation)}</h2>`
    + `<div class="tac-lpane"><div class="md-list tac-pitch adjust${sel != null ? " selecting" : ""}">${tacPitchSvg()}<i class="tac-circle" aria-hidden="true"></i>${cards}</div></div></section>`
    + `<section class="panel fill" id="tac-right" data-nav-group="tac-list">${scroller(
      `<h2 class="panel-head">${t("tac-subs")} <span class="muted">${bench.length} · ${t("tac-subs-max")}</span></h2><ul class="tac-rlist">${bench.map((pid, j) => rRow(pid, `sub:${j}`)).join("")}</ul>`
      + `<h2 class="panel-head sub-head">${t("tac-reserves")} <span class="muted">${reserves.length}</span></h2>`
      + (reserves.length ? `<ul class="tac-rlist">${reserves.map((p) => rRow(p.pid, `res:${p.pid}`)).join("")}</ul>` : `<div class="empty">${t("tac-no-res")}</div>`))}</section></div>`;
  // 状态条 (R-68): 固定一行高, 待换 > 硬错 > 首发里有人伤停 > 操作说明; 以前待换条和预览行一出现整页往下跳
  const selP = sel != null ? byPid.get(sel) : null;
  const outXi = P.xi.map((pid) => byPid.get(pid)).filter((p) => p && p.out);
  const status = selP ? `<span class="tac-st pend">${tf("tac-pending", { n: pname(selP) })}</span>`
      + `<button class="pill compact" data-act="tac-cancel" data-sound="back">${t("tac-cancel")}</button>`
    : v.errors.length ? `<span class="tac-st err">${esc(v.errors[0])}</span>`
    : outXi.length ? `<span class="tac-st warn">${tf("tac-out-warn", { n: outXi.map((p) => pname(p)).join(lang === "zh" ? "、" : ", ") })}</span>`
    : `<span class="tac-st">${t("tac-note")}</span>`;
  const bar = `<div class="tac-bar">${segHtml("tac-formation", P.tr.presets.map((n) => [n, n]), P.formation, t("tac-formation"))}
    <span class="tag">${t(P.tr.mode === "manual" ? "tac-manual" : "tac-auto")}</span>${dirty ? `<span class="fit-tag ban">${t("tac-dirty")}</span>` : ""}
    <span class="tac-btns"><button class="pill" data-act="tac-best" title="${esc(t("tac-best-tip"))}">${t("tac-best")}</button>
    <button class="pill primary" data-act="tac-save"${dirty ? "" : " disabled"}>${t("tac-save")}</button>
    <button class="pill ghost" data-act="tac-auto"${P.tr.mode === "manual" ? "" : " disabled"}>${t("tac-auto-back")}</button>
    <button class="pill" data-act="superxi" title="${esc(t(dirty ? "sx-dirty" : "sx-tip"))}"${dirty ? " disabled" : ""}>${t("sx-btn")}</button></span></div>
    <div class="tac-status${selP ? " pend" : v.errors.length ? " err" : outXi.length ? " warn" : ""}" aria-live="polite">${status}</div>`;
  const reqN = P.tr.room ? P.tr.room.list.filter((r) => r.request).length : 0;
  const view = { label: () => t("tac-title"), reopen: (n) => openTactics(n, true), ui: { tab: "lineup" }, tac: true,
    tabs: [
      { k: "lineup", label: t("tac-xi"), html: () => bar + pitch },
      ...(P.tr.room ? [{ k: "room", label: t("tab-room") + (reqN ? ` <span class="n">${reqN}</span>` : ""), html: () => roomHtml(P.tr.room) }] : []),
    ] };
  openModal(glowHtml(mine) + pageHead(t("tac-title"), esc(teamName(mine))), true, view, nav);
}
// 更衣室里的操作 (R-79): 在战术页里就只换底数据、草稿保留 (同承诺出场), 不然走 mkAct
function roomAct(path, body, okText) {
  return currentView && currentView.tac && tacPage ? tacRoomAct(path, body, okText) : mkAct(path, body, okText);
}
function tacPromise(pid, who) {   // 战术页内承诺 (R-67)
  return tacRoomAct("/api/morale/promise", { pid }, (r) => tf("rm-ok", { p: who, m: Math.round(r.mood) }));
}
async function tacRoomAct(path, body, okText) {   // 战术页内的更衣室操作: 成功后只换底数据, 草稿保留
  if (busy || !tacPage) return;
  busy = true;
  try {
    const r = await api(path, body);
    if (r.result && r.result.ok) {
      state = r.state;
      tacPage.tr = await api("/api/tactics");
      render();
      toast(okText(r.result), 3000, true);
      openTactics("replace", true);
    } else {
      toast(mkWhy(r.result || {}));
    }
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}
// 存完以后写进游戏没有 (首发超人、战术页共用): 游戏没开 -> 开球前写; 写失败 -> 说原因
function ingameTail(g) {
  return !g ? t("sx-later") : g.error ? tf("sx-failed", { e: g.error }) : tf("sx-applied", { ms: g.reload_ms ?? "-" });
}
async function tacSave() {
  if (busy || !tacPage) return;
  const P = tacPage, byPid = new Map(P.tr.squad.map((p) => [p.pid, p]));
  if (!tacDirty(P)) return UI.sound("edge");
  const v = tacValidate(P.xi, tacCodes(P), byPid);
  if (v.errors.length) return toast(v.errors[0]);
  busy = true;
  try {
    const r = await api("/api/tactics", { formation: P.formation, xi: P.xi, bench: P.bench });
    state = r.state;
    render();
    const w = (r.result && r.result.warns) || [];
    toast(w.length ? w.map((x) => { const p = byPid.get(P.xi[x.slot]); return tf("tac-warn-line", { n: p ? dispPlayer(p).main : "?", c: x.want }); }).join("；") : `${t("tac-saved")} · ${ingameTail(r.ingame)}`, w.length ? 6000 : 3000, !w.length);
    tacPage = null;
    if (currentView) currentView.reopen("replace");
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}
async function tacAuto() {
  if (busy || !tacPage) return;
  if (!(await askConfirm(t("tac-auto-confirm"), t("tac-auto-back"), true))) return;
  busy = true;
  try {
    const r = await api("/api/tactics/auto", {});
    state = r.state;
    render();
    toast(`${t("tac-auto-done")} · ${ingameTail(r.ingame)}`, 3000);
    tacPage = null;
    if (currentView) currentView.reopen("replace");
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}

// 更衣室 (R-49, R-67 起嵌在战术页底): 默契条、每个人的心情 / 状态 / 磨合, 承诺出场
function roomHtml(a) {
  const mine = state.career.user_team;
  const moodCls = (m) => (m < a.request ? "inj" : m < 45 ? "ban" : m >= 65 ? "up" : "");
  const sgnF = (x) => (Math.abs(x) < 0.05 ? `<span class="muted">0</span>` : `<span class="gdelta ${x > 0 ? "up" : "down"}">${x > 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}</span>`);
  const promiseAct = (r) => (r.promise ? `<span class="fit-tag">${tf("rm-promised", { p: r.promise.p, n: a.promise_need })}</span>`
    : r.promised ? `<span class="muted">${t("rm-promise-used")}</span>`
    : `<button class="pill" data-act="rm-promise" data-pid="${r.pid}" data-who="${pname(r)}">${t("rm-promise")}</button>`);
  // 提了转会要求 (R-79): 放他走 / 不放 (挂了牌、消极了就不再给按钮)
  const reqAct = (r) => (!r.request || r.listed || r.sulk ? ""
    : `<button class="pill" data-act="rm-let-go" data-pid="${r.pid}" data-who="${pname(r)}">${t("rm-let-go")}</button> `
      + `<button class="pill" data-act="rm-refuse" data-pid="${r.pid}" data-who="${pname(r)}">${t("rm-refuse")}</button> `);
  const act = (r) => reqAct(r) + promiseAct(r);
  const reqTags = (r) => (!r.request ? "" : `<span class="fit-tag inj">${t("rm-request")}</span>`
    + (r.sulk ? `<span class="fit-tag inj">${t("rm-sulk")}</span>` : r.listed ? `<span class="fit-tag">${t("rm-listed")}</span>`
      : r.promise ? "" : `<span class="fit-tag ban">${tf("rm-wait", { n: r.wait || 0, m: a.req_wait })}</span>`));
  const list = a.list.length ? `<table><tr><th></th><th>${t("th-player")}</th><th>${t("th-pos")}</th><th>${t("th-role")}</th><th class="num">${t("rm-mood")}</th>
    <th class="num">${t("rm-form")}</th><th class="num">${t("rm-games")}</th><th></th></tr>
    ${a.list.map((r) => `<tr${r.request ? ' class="mine"' : ""}><td>${face(r.pid, mine)}</td><td>${pname(r)}${reqTags(r)}</td>
      <td>${esc(r.position || "")}</td><td>${t("rl-" + r.squad_role)}</td>
      <td class="num"><span class="fit-tag ${moodCls(r.mood)}">${r.mood}</span></td><td class="num">${sgnF(r.form)}</td>
      <td class="num">${Math.min(r.games, a.chem_games)}/${a.chem_games}</td><td class="num">${act(r)}</td></tr>`).join("")}</table>` : `<div class="empty">${t("rm-empty")}</div>`;
  const pctC = Math.round(a.chem * 100);
  return `${a.cfg_error ? `<p class="hero-note buff">${tf("rm-cfg-error", { e: esc(a.cfg_error) })}</p>` : ""}
    <p class="hero-note tr-rule">${tf("rm-note", { f: a.form_max, r: a.request, g: a.promise_games, n: a.promise_need })}</p>
    ${a.list.some((r) => r.request) ? `<p class="hero-note tr-rule">${tf("rm-req-note", { w: a.req_wait, f: a.sulk_form, t: a.sulk_train })}</p>` : ""}
    ${fillPanel(list, `<h2 class="panel-head">${t("tab-room")} · ${tf("rm-chem", { x: pctC })} <span class="muted">${tf("rm-chem-note", { n: a.chem_games, p: a.chem_pen })}</span></h2>${gbar(pctC, 100)}`)}`;
}

// 青训营 (R-48): 这个夏窗来的孩子, 挑谁提拔
function academyHtml(a) {
  const mine = state.career.user_team;
  const list = a.list.length ? `<table><tr><th></th><th>${t("th-player")}</th><th>${t("th-pos")}</th><th class="num">${t("th-age")}</th><th class="num">${t("th-ovr")}</th><th class="num">${t("th-pot")}</th><th></th></tr>
    ${a.list.map((r) => `<tr><td>${face(r.pid, mine)}</td><td>${pname(r)}</td><td>${esc(r.position || "")}</td><td class="num">${r.age ?? ""}</td><td class="num">${r.overall ?? ""}</td>
      <td class="num">${gradeTag(r.grade)}</td><td class="num"><button class="pill primary" data-act="ac-promote" data-pid="${r.pid}" data-who="${pname(r)}"${a.open && a.squad < a.max ? "" : " disabled"}>${t("ac-promote")}</button></td></tr>`).join("")}</table>`
    : `<div class="empty">${t(a.open ? "ac-empty" : "ac-closed")}</div>`;
  return `<p class="hero-note tr-rule">${tf("ac-note", { n: a.n })}</p>
    ${fillPanel(list, `<h2 class="panel-head">${t("ac-head")} <span class="muted">${tf("ac-squad", { a: a.squad, b: a.max })}</span></h2>`)}`;
}

// 成长榜: 全队按联赛里涨了多少排
function growTable(rows) {
  const mine = state.career.user_team;
  const sorted = [...rows].sort((a, b) => b.grow - a.grow || b.season_points - a.season_points);
  return `<table><tr><th></th><th>${t("th-player")}</th><th>${t("th-pos")}</th><th class="num">${t("th-age")}</th><th>${t("th-role")}</th><th class="num">${t("th-ovr")}</th>
    <th class="num">${t("th-grow")}</th><th class="num">${t("th-season-pts")}</th><th class="num">${t("th-pot")}</th><th>${t("th-xp")}</th><th>${t("tr-in")}</th></tr>
    ${sorted.map((r) => `<tr><td>${face(r.pid, mine)}</td><td>${pname(r)}</td><td>${esc(r.position || "")}</td><td class="num">${r.age ?? ""}</td><td>${roleTag(r.role)}</td>
      <td class="num">${r.overall ?? ""}</td><td class="num">${gdelta(r.grow) || `<span class="muted">–</span>`}</td><td class="num">${r.season_points ? "+" + r.season_points : ""}</td>
      <td class="num">${gradeTag(r.grade)}</td><td class="xpcell">${gbar(r.xp, r.xp_need)}</td>
      <td>${r.training ? `${skillName(r.training)} <span class="muted">${pct(r.training)}%</span>` : ""}</td></tr>`).join("")}</table>`;
}

// 老带新: 左边队里的导师, 右边新人跟着谁踢、踢了几场、这季涨了多少
function mentorHtml(rows, tr) {
  const mine = state.career.user_team;
  const mentors = rows.filter((r) => r.mentor).sort((a, b) => ROLE_ORDER.indexOf(b.role) - ROLE_ORDER.indexOf(a.role));
  const youth = rows.filter((r) => (r.age ?? 99) <= tr.aura_age).sort((a, b) => b.mentor_times - a.mentor_times || a.age - b.age);
  // 为什么能带人: 巨星 / 传奇写身份, 不然写「队长」或「会队长技能」
  const why = (r) => (r.mentor === "role" ? roleTag(r.role) : `<span class="tag">${t("mw-" + r.mentor)}</span>`);
  const left = mentors.length ? `<div class="gr-mentors">${mentors.map((r) => `<div class="gr-mentor">${face(r.pid, mine)}<span>${pname(r)}</span>${why(r)}</div>`).join("")}</div>`
    : `<div class="empty">${t("tr-no-mentors")}</div>`;
  const right = youth.length ? `<table><tr><th></th><th>${t("th-player")}</th><th class="num">${t("th-age")}</th><th>${t("th-mentor")}</th><th class="num">${t("th-season-pts")}</th><th class="num">${t("th-pot")}</th></tr>
    ${youth.map((r) => `<tr><td>${face(r.pid, mine)}</td><td>${pname(r)}${roleTag(r.role)}</td><td class="num">${r.age}</td>
      <td>${r.mentors.length ? `${pname(r.mentors[0])} <span class="muted">${tf("gr-mentor-n", { n: r.mentor_times })}</span>` : `<span class="muted">${t("tr-no-mentor")}</span>`}</td>
      <td class="num">${r.season_points ? "+" + r.season_points : ""}</td><td class="num">${gradeTag(r.grade)}</td></tr>`).join("")}</table>`
    : `<div class="empty">${tf("tr-no-youth", { a: tr.aura_age })}</div>`;
  return `<p class="hero-note tr-rule">${tf("tr-aura-rule", { a: tr.aura_age, m: tr.aura_mult })}</p>
    <div class="cols mentor-cols" data-nav-sides>${fillPanel(left, `<h2 class="panel-head">${t("tr-mentors")}</h2>`)}${fillPanel(right, `<h2 class="panel-head">${t("tr-youth")}</h2>`)}</div>`;
}

// 主页「训练」: 在练的人和进度, 这季你的队进步最多的三个人
function heroTraining() {
  const tr = state.training, mine = state.career.user_team;
  const rows = tr.list.map((x) => `<div class="tr-row">${face(x.pid, mine)}<div class="grow"><div>${pname(x)} <span class="muted">${skillName(x)}</span></div>${gbar(x.prog, x.need)}</div><span class="n">${pct(x)}%</span></div>`).join("");
  const risers = tr.risers.map((x) => `<div class="tr-row">${face(x.pid, mine)}<div class="grow">${pname(x)}${roleTag(x.role)}</div><span class="n up">${tf("pts-n", { n: x.ps })}</span></div>`).join("");
  return heroInfo(`<div class="hero-kicker">${t("tr-title")}</div>
    <h1 class="hero-title">${tr.used ? tf("tr-hero-n", { n: tr.used }) : t("tr-hero-none")}</h1>
    <div class="hero-meta">${tf("tr-slots", { a: tr.used, b: tr.slots })}</div>
    <div class="hero-actions"><button class="pill" data-act="open-training">${t("tr-title")}</button></div>
    <p class="hero-note">${t("tr-sub")}</p>`)
    + heroSide(`<div class="hero-panel scroller">${rows ? `<h2 class="panel-head">${t("tr-in")}</h2>${rows}` : ""}
      ${risers ? `<h2 class="panel-head${rows ? " sub-head" : ""}">${t("tr-risers")}</h2>${risers}` : ""}
      ${rows || risers ? "" : `<div class="empty">${t("tr-hero-empty")}</div>`}</div>`);
}

// 开练 / 停练: 存档改完原地重画 (训练中心停在同一个人上), 主页图块也跟着变
async function trainAct(path, body, msg) {
  if (busy) return;
  busy = true;
  try {
    state = await api(path, body);
    lastEvent = state.event_id;
    render();
    if (currentView) currentView.reopen("replace");
    if (msg) toast(msg, 3000);
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}

// 往季的人员变动 (R-24): 全世界退役 / 离开 / 新人各多少, 你的队走了谁、来了谁
function seasonLifeHtml(l) {
  if (!l) return "";
  const row = (x) => `<div class="tr-row">${face(x.pid)}<div class="grow">${pname(x)} <span class="muted">${esc(x.position || "")} · ${x.age ?? "-"}</span></div></div>`;
  return `<h2 class="panel-head sub-head">${t("sl-title")}</h2><div class="muted">${tf(l.reborn && !l.new ? "sl-counts-rw" : "sl-counts", { r: l.retired, l: l.left, n: l.new, b: l.reborn || 0 })}</div>
    ${l.mine_out.length ? `<h4 class="sl-h">${t("sl-out")}</h4>${l.mine_out.map(row).join("")}` : ""}
    ${l.mine_in.length ? `<h4 class="sl-h">${t("sl-in")}</h4>${l.mine_in.map(row).join("")}` : ""}`;
}

// 往季的成长: 全联赛进步最多的五个, 你的队每个涨了的人, 你的人练成 / 自学的技能和老将的衰退
function seasonGrowthHtml(g) {
  if (!g) return "";
  const row = (x, extra = "") => `<div class="tr-row">${face(x.pid)}<div class="grow"><div>${pname(x)}${roleTag(x.role)}</div>${extra}</div><span class="n up">${tf("pts-n", { n: x.ps })}</span></div>`;
  const top = g.top.slice(0, 5).map((x) => row(x)).join("");
  const mine = g.mine.map((x) => row(x, `<div class="muted">${gainText(countsToKeys(x.d))}</div>`)).join("");
  const ev = g.events.map((e) => `<div class="fit-ev">${e.k === "skill" ? `<span class="fit-tag learn">${t("ge-tag-skill")}</span>${tf("ge-skill", { p: `<b>${pname(e)}</b>`, k: skillName(e) })}`
    : e.k === "pos" ? `<span class="fit-tag learn">${t("tr-pos-title")}</span>${tf("nw-grow_pos", { p: `<b>${pname(e)}</b>`, k: skillName(e) })}`
    : `<span class="fit-tag inj">${t("gr-stage")}</span>${pname(e)} · ${gainText(e.lost, "-")}`}</div>`).join("");
  return `${top ? `<h2 class="panel-head sub-head">${t("sg-top")}</h2>${top}` : ""}
    ${mine || ev ? `<h2 class="panel-head sub-head">${t("sg-mine")}</h2>${mine}${ev ? `<div class="fit-evs">${ev}</div>` : ""}` : ""}`;
}

function playerRows(players) {
  return `<table><tr><th></th><th>${t("th-player")}</th><th>${t("th-pos")}</th><th class="num">${t("th-rating1")}</th><th class="num">${t("th-goals")}</th><th class="num">${t("th-shots")}</th>
    <th class="num">${t("th-passes")}</th><th class="num">${t("th-tackles")}</th><th class="num">${t("th-int")}</th><th class="num">${t("th-cards")}</th></tr>
    ${players.map((p) => {
      // 红黄牌以完整统计为准: 旧宿主的导出 actions 里没有牌, 存档里记成了 0, 原始计数里有
      const cards = p.stats ? { yellow_cards: p.stats.yellow_cards || 0, red_cards: p.stats.red_cards || 0 } : p;
      return `<tr class="prow" tabindex="0" aria-expanded="false" title="${t("stats-row-hint")}"><td>${face(p.pid, p.team)}</td><td>${esc(dispPlayer(p).main)}</td><td>${esc(p.position)}</td>
      <td class="num">${ratingBadge(p.rating)}</td><td class="num">${p.goals || ""}</td>
      <td class="num">${p.shots ? `${p.shots_on_target}/${p.shots}` : ""}</td>
      <td class="num">${p.passes ? `${p.passes_completed}/${p.passes}` : ""}</td>
      <td class="num">${p.tackles || ""}</td><td class="num">${p.interceptions || ""}</td><td class="num">${cardsBadge(cards)}</td></tr>
      <tr class="pdetail" hidden><td colspan="10">${playerStatsHtml(p.stats || {})}</td></tr>`;
    }).join("")}
  </table>`;
}

// 战报: 页头是比分 (两队可点进球队页), 下面分标签 —— 概况 (进球、本场最佳、主要数据) / 比赛统计 / 两队各一页球员
async function openReport(fid, nav = "push") {
  const seq = ++openSeq;
  let f;
  try {
    f = await api("/api/fixture/" + encodeURIComponent(fid));
  } catch (e) {
    holdCounts = false;          // 战报没开成: 主页的数别一直憋着不滚
    playCounts();
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  statNames = f.stat_names || statNames;
  const r = f.result;
  const mine = state.career.user_team;
  // 「模拟这场」后自己打开的战报: 比分一个个砸下来 (点比分进来的已经有比分飞过来的形变, 不再叠一层)
  const reveal = r && nav === "push" && !UI.reduced && !(activated && activated.isConnected && activated.matches("[data-fixture]"));
  if (reveal) setTimeout(() => UI.sound("lock"), 700);
  // 比分压在最上面, 哪一轮 / 怎么来的放比分下面 (R-69, 和页头一样不在标题上方加小眉标)
  const head = glowHtml([f.home, f.away]) + `<div class="report-head${reveal ? " reveal" : ""}">
      <div class="team home" tabindex="0" role="button" data-team="${f.home}"><span>${esc(teamName(f.home))}</span>${emblem(f.home, "lg")}</div>
      <div class="score morph-target">${r ? `<span class="d">${r.home_goals}</span><i>–</i><span class="d">${r.away_goals}</span>` : t("vs")}</div>
      <div class="team away" tabindex="0" role="button" data-team="${f.away}">${emblem(f.away, "lg")}<span>${esc(teamName(f.away))}</span></div>
    </div><div class="report-kicker">${f.comp ? `${esc(fxLabel(f))} · ${esc(fmtDate(f.date))}` : tf("round-tag", { n: f.round })}${r ? ` · ${sourceTag(r.source)}` : ""}${f.buff ? ` · <span class="buff-tag">${tf("buff-tag", { d: f.buff.delta })}</span>` : ""}</div>${f.comp && tieNote(f) ? `<div class="report-tie">${tieNote(f)}</div>` : ""}${r && r.pre ? preOddsHtml(r) : ""}`;
  const score = r ? `${r.home_goals}-${r.away_goals}` : "VS";
  const view = { label: () => `${teamName(f.home)} ${score} ${teamName(f.away)}`, reopen: (n) => openReport(fid, n), tabs: [] };
  if (!r) {
    openModal(head + pageBody(`<section class="panel"><div class="empty">${t("no-results")}</div></section>`), true, { ...view, tabs: null }, nav);
    return;
  }
  const players = r.players || [];
  const scorerList = (tid) => r.scorers.filter((s) => s.team === tid).map((s) => `<div>${esc(dispPlayer(s).main)}${s.goals > 1 ? `<span class="x">×${s.goals}</span>` : ""}</div>`).join("");
  const best = players.filter((p) => p.rating != null).sort((a, b) => b.rating - a.rating)[0];
  const motm = best ? `<div class="motm">${face(best.pid, best.team)}<div class="grow"><div class="hero-kicker">${t("motm")}</div>
      <div class="motm-name">${esc(dispPlayer(best).main)}</div><div class="teamline">${emblem(best.team, "sm")}${esc(teamName(best.team))} · ${esc(best.position || "")}</div></div>${ratingBadge(best.rating)}</div>` : "";
  // 概况 (R-69): 进球按主客两栏、对着两队队名; 本场最佳下面是两队评分前三 —— 以前下半屏空着
  const topRated = (tid) => players.filter((p) => p.team === tid && p.rating != null && p !== best).sort((a, b) => b.rating - a.rating).slice(0, 3)
    .map((p) => `<div class="top-row">${face(p.pid, p.team)}<span class="grow">${esc(dispPlayer(p).main)} <span class="muted">${esc(p.position || "")}</span></span>${ratingBadge(p.rating)}</div>`).join("");
  const tops = players.some((p) => p.rating != null) ? `<h3 class="sum-sub">${t("top-rated")}</h3><div class="sum-two">
      <div>${topRated(f.home) || `<div class="muted">–</div>`}</div><div>${topRated(f.away) || `<div class="muted">–</div>`}</div></div>` : "";
  const keys = keyStatsHtml(f, r);
  const basic = r.full_stats ? "" : ` <span class="muted">${t("stats-basic-only")}</span>`;
  view.tabs.push({ k: "sum", label: t("tab-summary"), html: () => `<div class="cols report-sum" data-nav-sides>
    ${fillPanel(`<div class="scorers"><div class="sc-team">${emblem(f.home, "sm")}${esc(teamName(f.home))}</div><div class="sc-team">${emblem(f.away, "sm")}${esc(teamName(f.away))}</div>
      <div>${scorerList(f.home) || `<div class="muted">${t("no-goals")}</div>`}</div><div>${scorerList(f.away) || `<div class="muted">${t("no-goals")}</div>`}</div></div>${motm}${tops}
      ${players.length ? (r.source === "manual" ? `<div class="muted manual-note">${t("manual-sim")}</div>` : "") : `<div class="empty">${r.source === "sim" ? t("sim-only") : t("manual-only")}</div>`}${fitEventsHtml(r.fit)}${growEventsHtml(r.grow)}`, `<h2 class="panel-head">${t("goals-list")}</h2>`)}
    ${keys ? fillPanel(keys, `<h2 class="panel-head">${t("key-stats")}${basic}</h2>`) : ""}</div>` });
  const stats = matchStatsHtml(f, r);
  if (stats) view.tabs.push({ k: "stats", label: t("match-stats"), html: () => fillPanel(stats, `<h2 class="panel-head">${t("match-stats")}${basic}</h2>`) });
  if (players.length) {
    const side = (tid) => players.filter((p) => p.team === tid).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    const first = f.away === mine ? f.away : f.home;   // 我的队排前面
    for (const tid of [first, first === f.home ? f.away : f.home]) {
      view.tabs.push({ k: "t" + tid, label: `${emblem(tid, "sm")}${esc(teamName(tid))}`,
        html: () => fillPanel(playerRows(side(tid)), `<h2 class="panel-head">${emblem(tid)}${esc(teamName(tid))} <span class="muted">${t("stats-row-hint")}</span></h2>`),
        // 点球员那一行 (头像除外, 头像进球员页) 展开 / 收起他这场的全部数据
        after: (pane) => pane.querySelectorAll("tr.prow").forEach((tr) => tr.addEventListener("click", (e) => {
          if (e.target.closest("[data-pid]")) return;
          tr.nextElementSibling.hidden = !tr.nextElementSibling.hidden;
          tr.setAttribute("aria-expanded", !tr.nextElementSibling.hidden);
          UI.prepScrollers(pane);
        })) });
    }
  }
  openModal(head, true, view, nav);
}

// 战报页头下面: 赛前胜平负的概率 (模型算的, R-39); 赢的一方赛前不到 15% 标「爆冷」
const pctOf = (x) => `${Math.round(x * 100)}%`;
function preOddsHtml(r) {
  const [h, d, a] = r.pre;
  const win = r.home_goals > r.away_goals ? h : r.away_goals > r.home_goals ? a : null;
  return `<div class="report-pre">${tf("pre-odds", { h: pctOf(h), d: pctOf(d), a: pctOf(a) })}${win != null && win < UPSET_P ? ` <span class="fit-tag brk">${t("nt-upset")}</span>` : ""}</div>`;
}
const UPSET_P = 0.15;   // 和 league/sim.py 的 UPSET_P 一样

// 球队页: 页头队徽和实力, 下面整队名单在一块面板里滚
async function openTeam(tid, nav = "push") {
  if (!Number.isFinite(tid)) return;   // 日志里出现过 /api/team/NaN
  const seq = ++openSeq;
  let team;
  try {
    team = await api("/api/team/" + tid);
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const tn = dispTeam(team);
  const view = { label: () => dispTeam(team).main, reopen: (n) => openTeam(tid, n) };
  openModal(`${glowHtml(tid)}<div class="team-head">
      ${emblem(tid, `lg morph-target${team.trophies && team.trophies.inv && !fxOf(tid) ? " fx-inv" : ""}`)}<div><div class="tname">${esc(tn.main)}</div>
      <div class="hero-meta">${esc(tn.sub)} · ${tf("team-strength", { s: team.strength ?? "-", n: team.squad.length })}</div>
      ${team.elo ? `<div class="hero-meta">${esc(tf("team-elo", { e: team.elo.now, r: team.elo.rank, n: team.elo.of, b: team.elo.base, s: team.elo.sim }))}</div>` : ""}
      ${team.rating ? `<div class="hero-meta">${tf(team.elo ? "team-rating-w" : "team-rating", { a: team.rating.attack.toFixed(1), as: "+" + (team.rating.attack_skill + team.rating.team_skill).toFixed(1),
        d: team.rating.defense.toFixed(1), ds: "+" + (team.rating.defense_skill + team.rating.team_skill).toFixed(1) })}</div>` : ""}
      ${teamHonorsLine(team)}</div></div>`
    + pageBody(fillPanel(`<table><tr><th class="num">${t("th-num")}</th><th></th><th>${t("th-player")}</th><th>${t("th-pos")}</th><th class="num">${t("th-age")}</th><th class="num">${t("th-ovr")}</th>${team.squad.some((p) => p.value != null) ? `<th class="num">${t("th-value")}</th>` : ""}
      <th>${t("th-fit")}</th><th class="num">${t("th-apps")}</th><th class="num">${t("th-goals")}</th><th class="num">${t("th-assists")}</th><th class="num">${t("th-rating")}</th><th class="num">${t("th-fouls")}</th><th class="num">${t("th-cards")}</th></tr>
    ${team.squad.map((p) => `<tr${p.starter ? "" : ' class="bench"'}><td class="num">${p.shirt_number}</td><td>${face(p.pid, tid)}</td>
      <td>${esc(dispPlayer(p).main)}${p.role && p.role !== "regular" ? roleTag(p.role) : ""}${p.regen ? `<span class="fit-tag up">${t(p.regen === "youth" ? "tag-new-youth" : "tag-new-signing")}</span>` : ""}${p.leaving === "r" ? `<span class="fit-tag ban">${t("tag-farewell")}</span>` : ""}${p.card ? `<span class="fit-tag brk">${esc(cardKindName(p.card.kind))}</span>` : ""}${p.slot === 11 ? `<span class="tag">${t("tag-sub")}</span>` : ""}</td><td>${esc(p.position)}</td>
      <td class="num">${p.age ?? ""}</td><td class="num">${p.overall ?? ""}${gdelta(p.grow)}</td>${p.value != null ? `<td class="num">${money(p.value)}</td>` : ""}<td class="fit">${fitCell(p.fit)}</td><td class="num">${p.apps || ""}</td>
      <td class="num">${p.goals || ""}</td><td class="num">${p.assists || ""}</td><td class="num">${p.avg_rating ? ratingBadge(p.avg_rating) : ""}</td><td class="num">${p.fouls || ""}</td><td class="num">${cardsBadge(p)}</td></tr>`).join("")}
    </table>`)), true, view, nav);
}

// ------------------------------------------------------------ 球员页
// 页头是头像、名字和总评; 下面五个标签: 概览 (卡、能力值、雷达和位置) / 技能与风格 / 联赛数据 / 档案 / 外观
const POS_GRID = [["LWF", "SS", "CF", "RWF"], ["LMF", "DMF", "CMF", "AMF", "RMF"], ["LB", "CB", "RB"], ["GK"]];
const abCls = (v) => (v >= 90 ? "ab-gold" : v >= 80 ? "ab-green" : v >= 70 ? "ab-orange" : "");

async function openPlayer(pid, team, nav = "push", tab = null) {
  const seq = ++openSeq;
  const view = { label: () => t("loading-player"), reopen: (n) => openPlayer(pid, team, n), ui: tab ? { tab } : {} };
  // 记下这页是谁 (点他自己的头像不再重进)。不能叫 data-pid / data-team: 页面里的点击委托按 closest("[data-team]") 找,
  // 会找到弹页本身, 以前看过一次球员页之后, 在别的页面随便点一下空白处就会打开那支球队
  $("#modal").dataset.player = pid;
  // 新开的先放「正在载入」占位 (压栈就在这一步), 载完原地换掉; 退回 / 切语言不放占位, 不然滚动位置被短内容清零。
  // 占位里的头像和载完的页头头像在同一个位置: 点的头像先飞到这里, 换内容时它不动
  if (nav === "push") {
    openModal(`${glowHtml(team)}<div class="player-head"><img class="face morph-target" src="${img("face", pid)}" ${faceErr(team)} alt="">
      <div class="grow"><div class="muted">${t("loading-player")}</div></div></div>`, true, view, "push");
    nav = "replace";
  }
  let p;
  try {
    p = await api("/api/player/" + pid + (team ? `?team=${team}` : ""));
  } catch (e) {
    if (seq === openSeq) openModal(`<div class="error">${esc(e.message)}</div>`, true, view, nav);
    return;
  }
  if (seq !== openSeq) return;
  view.label = () => cardDisplayName(p);
  view.tabs = playerTabs(p);
  openModal(playerHtml(p), true, view, nav);
}

function playerHtml(p) {
  const nat2 = p.nationality2 && p.nationality2 !== "(无)" ? tf("second-nat", { n: p.nationality2 }) : "";
  const meta = [p.position, p.age + " " + t("age-u"), p.nationality || "", nat2, p.names.shirt || ""].filter(Boolean).join(" · ");
  const sub = lang === "zh" ? p.names.roman : p.names.cn;
  // 伤停 (R-21): 伤了 / 停赛中就在名字下面写出来
  const st = p.fit;
  const fit = !st ? "" : st.inj ? `<span class="fit-tag inj">${t("fit-inj-long")} · ${esc(injType(st.inj))} · ${esc(injWhen(st.inj))}</span>`
    : (st.bans || []).map((b) => `<span class="fit-tag ban">${t("fit-ban-long")} · ${banText(b)}</span>`).join("");
  return `${glowHtml((p.emblem || p.clubs.club || {}).id)}
  <div class="player-head">
    <img class="face morph-target" src="${img("face", p.pid)}" ${faceErr((p.emblem || p.clubs.club || {}).id)} alt="">
    <div class="grow">
      <div class="pname">${esc(cardDisplayName(p))} <span class="muted">${esc(sub || "")}</span></div>
      <div class="muted">${esc(meta)}${p.growth ? roleTag(p.growth.role) : ""}${lifeTags(p)}${fit}</div>
    </div>
    ${langToggleHtml()}
    <div class="ovr ${abCls(p.overall ?? 0)}" title="${t("ovr-title")}">${p.overall ?? "?"}</div>
  </div>`;
}

function playerTabs(p) {
  const byCn = Object.fromEntries(p.abilities.map((a) => [a.cn, a]));
  const [skills, style] = playerSkillsHtml(p);
  return [
    { k: "overview", label: t("tab-overview"), after: () => drawRadar(p.radar), html: () => `<div class="cols player-cols" data-nav-sides>
      <section class="panel pcard-col">${playerCardHtml(p)}</section>
      ${fillPanel(playerAbilityHtml(p, byCn), `<h2 class="panel-head">${t("sec-ovr")} ${p.overall ?? "?"} <span class="muted">${p.overall_base != null && p.abilities.some((a) => a.delta)
        ? tf("gr-note", { o: p.overall_base }) : t("raw-note")}</span></h2>`)}
      ${fillPanel(playerPosHtml(p))}</div>` },
    ...(p.growth ? [{ k: "growth", label: t("tab-growth"), html: () => playerGrowthHtml(p) }] : []),
    ...(p.market ? [{ k: "contract", label: t("tab-contract"), html: () => playerContractHtml(p), after: mkSwapSum }] : []),
    ...(p.cards && p.cards.length ? [{ k: "cards", label: `${t("tab-cards")} <span class="n">${p.cards.length}</span>`, html: () => playerCardsHtml(p) }] : []),
    ...(p.growth && p.growth.mine ? [{ k: "edit", label: t("tab-edit"), html: () => playerEditHtml(p) }] : []),
    ...(p.honors ? [{ k: "honors", label: t("tab-honors"), html: () => playerHonorsHtml(p) }] : []),
    { k: "skills", label: t("tab-skills"), html: () => `<div class="cols skills-cols" data-nav-sides>
      ${fillPanel(skills, `<h2 class="panel-head">${t("sec-skills")} <span class="muted">${p.skills.length} / ${p.skills_total}</span></h2>`)}${fillPanel(style)}</div>` },
    { k: "league", label: t("sec-league"), html: () => playerLeagueHtml(p) },
    { k: "profile", label: t("tab-profile"), html: () => `<div class="cols profile-cols" data-nav-sides>${fillPanel(playerBasicHtml(p))}${fillPanel(playerCardInfoHtml(p))}</div>` },
    { k: "look", label: t("sec-app"), html: () => fillPanel(playerAppearanceHtml(p), `<h2 class="panel-head">${t("sec-app")}</h2>`) },
  ];
}

// ------------------------------------------------------------ 内置修改器 (R-61)
// 只有你的队的人有这个标签 (p.growth.mine)。整份一次保存: 没动过的项不发 (data-orig 比对),
// 动过的整组发 (后端 ap/sk/ai/motions/face 都是整份换)。下拉一律用 seg (R-57 手柄规则),
// 187 个国籍太多做不成分段, 用带提示的文本框, 后端校验。
// 修改器滑动条: 代替数字框。手柄左右直调、LT/RT 大步 (pad.js), 鼠标拖、键盘方向键原生可用。
// value 先按 step 对齐并夹进 [min, max], data-orig 存同一个数 —— 后端值万一对不齐也不会一打开就"被改过"。
const edDec = (step) => (String(step).split(".")[1] || "").length;
function edSnap(v, min, max, step) {
  const n = Number(v);
  const c = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  return Number((Math.round(c / step) * step).toFixed(edDec(step)));
}
// 空值 (身高/体重/出场/解约金/无合同年薪): data-ed-null="1" 表示空, 显示"—"; 动一下条就解除;
// × 按钮 / 手柄在最小处再按左回到空。clearable 才有 × (年薪不能清空: 空只是"没填")。
function edSlider(label, o) {
  const empty = o.val === "" || o.val === null || o.val === undefined;
  const v = empty ? o.min : edSnap(o.val, o.min, o.max, o.step);
  const pct = o.max > o.min ? ((v - o.min) / (o.max - o.min)) * 100 : 0;
  const clear = o.clearable ? `<button type="button" class="ed-clear" data-act="ed-clear" aria-label="${t("ed-clear")}" title="${t("ed-clear")}">×</button>` : "";
  const title = o.clearable ? ` title="${t("ed-clear-min")}"` : "";
  return `<div class="ed-arow${empty ? " is-null" : ""}"><span>${esc(label)}</span>`
    + `<input type="range" class="ed-range" min="${o.min}" max="${o.max}" step="${o.step}" value="${v}" data-orig="${empty ? "" : v}" data-pad-step="${o.padStep || o.step}" style="--p: ${pct}%"${o.attrs ? " " + o.attrs : ""}${o.dis ? " disabled" : ""}${empty ? ' data-ed-null="1"' : ""}${o.clearable ? ' data-ed-clearable="1"' : ""}${title}>`
    + `<output class="ed-val">${empty ? "—" : v.toFixed(edDec(o.step))}</output>${clear}</div>`;
}
function edPaintRange(el, nulled) {
  const row = el.closest(".ed-arow");
  const out = row && row.querySelector(".ed-val");
  if (out) out.textContent = nulled ? "—" : Number(el.value).toFixed(edDec(Number(el.step) || 1));
  const p = Number(el.max) > Number(el.min) ? ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100 : 0;
  el.style.setProperty("--p", (nulled ? 0 : p) + "%");
  if (row) row.classList.toggle("is-null", !!nulled);
}
function edSetNull(el, nulled) {
  if (nulled) el.dataset.edNull = "1"; else delete el.dataset.edNull;
  edPaintRange(el, nulled);
}
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el && el.matches && el.matches("input.ed-range")) edSetNull(el, false);
});
document.addEventListener("ed-clear-range", (e) => {
  const el = e.target;
  if (el && el.matches && el.matches("input.ed-range[data-ed-clearable]")) edSetNull(el, true);
});
// 修改器八段折叠: 默认只展开能力, 开过哪些记在 edOpen 里, 重画不丢。
const edOpen = new Set(["ab"]);
const edSec = (key, title, body) => body ? `<details class="ed-sec" data-sec="${key}"${edOpen.has(key) ? " open" : ""}><summary class="ed-sec-head">${title}</summary><div class="ed-sec-body">${body}</div></details>` : "";
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d && d.matches && d.matches("details.ed-sec")) {
    if (d.open) edOpen.add(d.dataset.sec); else edOpen.delete(d.dataset.sec);
  }
}, true);
async function playerEditHtml(p) {
  let E;
  try {
    E = await api("/api/edit/enums");
  } catch (e) {
    return `<section class="panel"><div class="error">${esc(e.message)}</div></section>`;
  }
  const byCn = Object.fromEntries(p.abilities.map((a) => [a.cn, a]));
  const saveBtn = `<div class="ed-save-row"><button class="pill primary" data-act="ed-save" data-pid="${p.pid}">${t("ed-save")}</button></div>`;
  // ---- 能力: 26 项按六组排, 和概览同一套分组
  const abGroups = p.groups.map((g) => `
    <div class="agroup"><h4>${esc(t(AB_GROUP_EN[g.label] || g.label))}</h4>
      ${g.keys.map((k) => {
        const a = byCn[k];
        return edSlider(gname("ab", a.cn, a.en), { min: 40, max: 103, step: 1, val: a.value, attrs: 'data-ed-ab="' + esc(a.en) + '"' });
      }).join("")}
    </div>`).join("");
  const abSec = `
    ${edSlider(t("ed-pot"), { min: 40, max: 99, step: 1, val: p.growth.pot, attrs: 'id="ed-pot"' })}
    ${edSlider(t("ed-age"), { min: 15, max: 50, step: 1, val: p.age, attrs: 'id="ed-age"' })}
    <div class="agroups">${abGroups}</div>`;
  // ---- 位置: 主位置 + 13 个熟练度 (GK 没有独立的适性段, 后端存着、写游戏时跳过)
  const aptSeg = (pos) => {
    const cur = p.aptitudes[pos] ?? (pos === p.position ? 2 : 0);
    return segHtml(`ed-ap-${pos}`, [[0, t("pos-c")], [1, t("pos-b")], [2, t("pos-a")]], cur, pos, `data-orig="${cur}"`);
  };
  const posSec = `
    <div class="mk-form">${segHtml("ed-pos", E.positions.map((x) => [x, x]), p.position, t("ed-pos"), `data-orig="${esc(p.position)}"`)}</div>
    <div class="ed-ap">${E.positions.map(aptSeg).join("")}</div>`;
  // ---- 技能: 67 个全列出来打勾
  const owned = new Set(p.skills.map((s) => s.en));
  const skSec = `
    <div class="ed-checks">${E.skills.map((s) => {
      const on = owned.has(s.en);
      return `<label class="ed-check" title="${esc(galt(s.cn, s.en))}"><input type="checkbox" data-ed-sk="${esc(s.en)}"${on ? " checked" : ""} data-orig="${on ? 1 : 0}">${esc(gname("skill", s.cn, s.en))}</label>`;
    }).join("")}</div>`;
  // ---- 档案
  const fh = (v) => (v === "Left" || v === "Right" ? v : String(v || "").includes("左") ? "Left" : "Right");
  const natList = (id, extra = "") => `<datalist id="${id}">${extra}${E.nats.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
  const profSec = `
    <div class="mk-form"><label>${t("nm-cn")} <input data-ed-name="cn" value="${esc(p.names.cn || "")}" data-orig="${esc(p.names.cn || "")}" maxlength="60"></label>
      <label>${t("nm-roman")} <input data-ed-name="roman" value="${esc(p.names.roman || "")}" data-orig="${esc(p.names.roman || "")}" maxlength="60"></label>
      <label>${t("nm-shirt")} <input data-ed-name="shirt" value="${esc(p.names.shirt || "")}" data-orig="${esc(p.names.shirt || "")}" maxlength="60"></label>
      <label>${t("nm-full")} <input data-ed-name="full" value="${esc(p.names.full || "")}" data-orig="${esc(p.names.full || "")}" maxlength="60"></label></div>
    <div class="mk-form"><label>${t("ed-nat")} <input data-ed-nat list="ed-nats" value="${esc(p.nationality || "")}" data-orig="${esc(p.nationality || "")}"></label>${natList("ed-nats")}
      <label>${t("ed-nat2")} <input data-ed-nat2 list="ed-nats2" value="${esc(p.nationality2 || "")}" data-orig="${esc(p.nationality2 || "")}" placeholder="(无)"></label>${natList("ed-nats2", `<option value="(无)">`)}</div>
    <div class="mk-form">${edSlider(t("ed-height"), { min: 150, max: 220, step: 1, val: p.height ?? "", attrs: "data-ed-height", clearable: true })}
      ${edSlider(t("ed-weight"), { min: 40, max: 120, step: 1, val: p.weight ?? "", attrs: "data-ed-weight", clearable: true })}
      ${segHtml("ed-foot", [["Left", t("ed-left")], ["Right", t("ed-right")]], fh(p.foot), t("foot"), `data-orig="${fh(p.foot)}"`)}
      ${segHtml("ed-hand", [["Left", t("ed-left")], ["Right", t("ed-right")]], fh(p.hand), t("hand"), `data-orig="${fh(p.hand)}"`)}</div>
    <div class="mk-form">${segHtml("ed-form", E.forms.map((x) => [x, x]), p.form, t("form"), `data-orig="${esc(p.form)}"`)}
      ${segHtml("ed-injury", E.injuries.map((x) => [x, x]), p.injury, t("injury"), `data-orig="${esc(p.injury)}"`)}
      ${segHtml("ed-wfa", E.wfas.map((x) => [x, x]), p.wfa, t("wfa"), `data-orig="${esc(p.wfa)}"`)}
      ${segHtml("ed-wfu", E.wfus.map((x) => [x, x]), p.wfu, t("wfu"), `data-orig="${esc(p.wfu)}"`)}
      ${edSlider(t("caps"), { min: 0, max: 999, step: 1, val: p.caps ?? "", attrs: "data-ed-caps", clearable: true })}
      <label class="ed-check"><input type="checkbox" data-ed-golden${p.golden_ball ? " checked" : ""} data-orig="${p.golden_ball ? 1 : 0}">${t("golden")}</label></div>
    <div class="ed-save-row"><button class="pill" data-act="ed-revert-profile" data-pid="${p.pid}">${t("ed-revert-profile")}</button></div>`;
  // ---- 风格: 主风格、副风格、AI 风格
  const aiOwned = new Set(p.ai_styles.map((s) => s.en));
  const styleSec = `
    <div class="mk-form">${segHtml("ed-att", E.styles.map((x) => [x, x]), p.att_style || "", t("st-atk"), `data-orig="${esc(p.att_style || "")}"`)}
      ${segHtml("ed-df", E.styles.map((x) => [x, x]), p.def_style || "", t("st-def"), `data-orig="${esc(p.def_style || "")}"`)}</div>
    <div class="ed-checks">${E.ai.map((s) => {
      const on = aiOwned.has(s.en);
      return `<label class="ed-check" title="${esc(galt(s.cn, s.en))}"><input type="checkbox" data-ed-ai="${esc(s.en)}"${on ? " checked" : ""} data-orig="${on ? 1 : 0}">${esc(gname("ai", s.cn, s.en))}</label>`;
    }).join("")}</div>`;
  // ---- 动作: 显示值, 范围后端给
  const moRange = Object.fromEntries(E.motions.map((m) => [m.name, m]));
  const moSec = `
    <div class="mk-form">${p.motions.map((m) => {
      const r = moRange[m.name] || { lo: 1, hi: 99 };
      const label = motionName(m.name);
      return edSlider(label, { min: r.lo, max: r.hi, step: 1, val: m.value, attrs: 'data-ed-mo="' + esc(m.name) + '"' });
    }).join("")}</div>`;
  // ---- 合同: 年限、年薪、解约金 (空 = 去掉)
  let ctSec = "";
  if (p.market) {
    const q = p.market;
    const years = q.contract ? q.years_left + 1 : 3;
    const wage = q.contract ? q.contract[1] : (q.renew_wage ?? "");
    const clause = q.clause ?? "";
    const wageMax = Math.max(30, Math.ceil(Number(wage || 0) * 2));
    const clauseMax = Math.max(500, Math.ceil(Number(clause || 0) * 2));
    ctSec = `
      <div class="mk-form">${segHtml("ed-years", [1, 2, 3, 4, 5].map((n) => [n, String(n)]), years, t("pc-years"), `data-orig="${years}"`)}
        ${edSlider(t("pc-offer-wage"), { min: 0, max: wageMax, step: 0.01, padStep: 0.1, val: wage, attrs: 'id="ed-wage"' })}
        ${edSlider(t("pc-clause"), { min: 0, max: clauseMax, step: 0.1, padStep: 1, val: clause, attrs: 'id="ed-clause"', clearable: true })}</div>`;
  }
  // ---- 外观: 有真脸先把勾去掉才能捏 (可以和要捏的一起保存, 后端同单里先关后捏)
  let faceSec = "";
  if (p.appearance.found) {
    const locked = !!p.appearance.face_flag;
    const groups = p.appearance.groups.map((g) =>
      `<div class="app-group"><h4>${esc(appCatName(g))}</h4>
       <div class="ed-face-grid">${g.fields.map((f) => {
        const r = E.apps[f.name] || [0, 99];
        return edSlider(appFieldName(f.name), { min: r[0], max: r[1], step: 1, val: f.value, attrs: 'data-ed-face="' + esc(f.name) + '" title="' + esc(f.name) + '"', dis: locked });
      }).join("")}</div></div>`).join("");
    faceSec = `
      <div class="mk-form"><label class="ed-check"><input type="checkbox" id="ed-faceflag"${locked ? " checked" : ""} data-orig="${locked ? 1 : 0}">${t("ed-face")}</label>
        <span class="muted" id="ed-face-note"${locked ? "" : " hidden"}>${t("ed-face-locked")}</span></div>
      ${groups}`;
  }
  return fillPanel(`<p class="hero-note">${t("ed-note")}</p>${saveBtn}${edSec("ab", t("ed-sec-ab"), abSec)}${edSec("pos", t("ed-sec-pos"), posSec)}${edSec("sk", t("sec-skills"), skSec)}${edSec("prof", t("ed-sec-profile"), profSec)}${edSec("style", t("ed-sec-style"), styleSec)}${edSec("mo", t("sec-motions"), moSec)}${edSec("ct", t("ed-sec-contract"), ctSec)}${edSec("face", t("sec-app"), faceSec)}${saveBtn}`,
    `<h2 class="panel-head">${t("tab-edit")}</h2>`);
}

// 真脸的勾一去就把外观输入打开 (和要捏的一起保存); 勾回来再锁上
document.addEventListener("change", (e) => {
  if (!e.target || e.target.id !== "ed-faceflag") return;
  const locked = e.target.checked;
  document.querySelectorAll("[data-ed-face]").forEach((x) => { x.disabled = locked; });
  const note = $("#ed-face-note");
  if (note) note.hidden = !locked;
});

// 收整份改动: 和 data-orig 一样的不发; ap/sk/ai/motions/face 动了就整组发 (后端整份换)
function collectEditPatch() {
  const patch = {};
  const segChanged = (id) => {
    const el = document.getElementById(id);
    return el && el.dataset.value !== el.dataset.orig ? el.dataset.value : undefined;
  };
  const numChanged = (el, allowNull) => {
    if (!el) return undefined;
    if (el.dataset.edNull === "1") return el.dataset.orig === "" ? undefined : (allowNull ? null : undefined);
    const raw = el.value.trim(), orig = el.dataset.orig;
    if (raw === orig) return undefined;
    if (raw === "") return allowNull ? null : undefined;
    const v = Number(raw);
    return Number.isFinite(v) ? v : undefined;
  };
  const ab = {};
  document.querySelectorAll("[data-ed-ab]").forEach((x) => {
    const v = numChanged(x, false);
    if (v !== undefined && Number.isInteger(v)) ab[x.dataset.edAb] = v;
  });
  if (Object.keys(ab).length) patch.ab = ab;
  const pot = numChanged($("#ed-pot"), false);
  if (pot !== undefined && Number.isInteger(pot)) patch.pot = pot;
  const age = numChanged($("#ed-age"), false);
  if (age !== undefined && Number.isInteger(age)) patch.age = age;
  const pos = segChanged("ed-pos");
  if (pos !== undefined) patch.pos = pos;
  const ap = {}, apOrig = {};
  document.querySelectorAll('[id^="ed-ap-"]').forEach((el) => {
    ap[el.id.slice(6)] = Number(el.dataset.value);
    apOrig[el.id.slice(6)] = Number(el.dataset.orig);
  });
  if (Object.keys(ap).length && JSON.stringify(ap) !== JSON.stringify(apOrig)) patch.ap = ap;
  const skNow = [...document.querySelectorAll("[data-ed-sk]")].filter((x) => x.checked).map((x) => x.dataset.edSk).sort();
  const skOrig = [...document.querySelectorAll("[data-ed-sk]")].filter((x) => x.dataset.orig === "1").map((x) => x.dataset.edSk).sort();
  if (skNow.join("|") !== skOrig.join("|")) patch.sk = skNow;
  const names = {};
  document.querySelectorAll("[data-ed-name]").forEach((x) => {
    const v = x.value.trim();
    if (v !== x.dataset.orig) names[x.dataset.edName] = v;
  });
  if (Object.keys(names).length) patch.names = names;
  for (const [sel, key] of [["[data-ed-nat]", "nat"], ["[data-ed-nat2]", "nat2"]]) {
    const x = document.querySelector(sel);
    if (x && x.value.trim() !== x.dataset.orig) patch[key] = x.value.trim();
  }
  for (const [sel, key] of [["[data-ed-height]", "height"], ["[data-ed-weight]", "weight"], ["[data-ed-caps]", "caps"]]) {
    const v = numChanged(document.querySelector(sel), true);
    if (v !== undefined && (v === null || Number.isInteger(v))) patch[key] = v;
  }
  for (const [id, key] of [["ed-foot", "foot"], ["ed-hand", "hand"], ["ed-form", "form"], ["ed-injury", "injury"],
      ["ed-wfa", "wfa"], ["ed-wfu", "wfu"], ["ed-att", "att"], ["ed-df", "df"]]) {
    const v = segChanged(id);
    if (v !== undefined) patch[key] = v;
  }
  const aiNow = [...document.querySelectorAll("[data-ed-ai]")].filter((x) => x.checked).map((x) => x.dataset.edAi).sort();
  const aiOrig = [...document.querySelectorAll("[data-ed-ai]")].filter((x) => x.dataset.orig === "1").map((x) => x.dataset.edAi).sort();
  if (aiNow.join("|") !== aiOrig.join("|")) patch.ai = aiNow;
  const mo = {}, moOrig = {};
  document.querySelectorAll("[data-ed-mo]").forEach((x) => {
    if (x.value.trim() === "" || !Number.isInteger(Number(x.value))) return;
    mo[x.dataset.edMo] = Number(x.value);
    moOrig[x.dataset.edMo] = Number(x.dataset.orig);
  });
  if (Object.keys(mo).length && JSON.stringify(mo) !== JSON.stringify(moOrig)) patch.motions = mo;
  const ct = {};
  const years = segChanged("ed-years");
  if (years !== undefined) ct.years = Number(years);
  const wage = numChanged($("#ed-wage"), false);
  if (wage !== undefined) ct.wage = wage;
  const clause = numChanged($("#ed-clause"), true);
  if (clause !== undefined) ct.clause = clause;
  if (Object.keys(ct).length) patch.contract = ct;
  const flag = $("#ed-faceflag");
  if (flag && (flag.checked ? "1" : "0") !== flag.dataset.orig) patch.face_flag = flag.checked ? null : false;
  const face = {}, faceOrig = {};
  document.querySelectorAll("[data-ed-face]").forEach((x) => {
    if (x.value.trim() === "" || !Number.isInteger(Number(x.value))) return;
    face[x.dataset.edFace] = Number(x.value);
    faceOrig[x.dataset.edFace] = Number(x.dataset.orig);
  });
  if (Object.keys(face).length && JSON.stringify(face) !== JSON.stringify(faceOrig)) patch.face = face;
  const golden = document.querySelector("[data-ed-golden]");
  if (golden && (golden.checked ? "1" : "0") !== golden.dataset.orig) patch.golden = golden.checked;
  return patch;
}

async function edSavePatch(pid, patch) {
  if (busy) return;
  busy = true;
  let r;
  try {
    r = await api("/api/player/edit", { pid, patch });
  } catch (e) {
    busy = false;
    return toast(e.message);
  }
  busy = false;
  const g = r.ingame;
  toast(!g ? t("ed-later") : g.error ? tf("ed-failed", { e: g.error }) : tf("ed-applied", { ms: g.reload_ms ?? "-" }));
  await refresh();
  if (currentView && currentView.ui) currentView.ui.tab = "edit";
  openPlayer(pid, null, "replace");
}

// 变体卡 (R-34): 你的人的每张卡 (有卡面素材的显示卡面, 没有的显示卡种), 选一张给他用
const cardKindName = (k) => (!k ? t("vc-kind-base") : STRINGS["vc-kind-" + k] ? t("vc-kind-" + k) : k);
function playerCardsHtml(p) {
  const cur = p.cards.find((x) => x.current);
  const items = p.cards.map((x) => `<button class="vcard${x.current ? " on" : ""}" data-act="card-pick" data-owner="${p.pid}" data-vid="${x.vid}"${x.current ? " disabled" : ""}>
      <span class="vcard-art"><span class="vcard-ph">${esc(cardKindName(x.kind))}</span>${x.art ? `<img src="${img("card", x.vid)}" loading="lazy" onload="this.classList.add('in')" onerror="this.remove()" alt="">` : ""}</span>
      <span class="vcard-kind">${esc(cardKindName(x.kind))}${x.base ? ` <span class="muted">· ${t("vc-orig")}</span>` : ""}</span>
      <span class="vcard-pack">${esc(x.pack || "")}</span>
      <span class="vcard-ovr">${tf("vc-card-ovr", { n: x.overall ?? "-" })}${x.current ? ` <span class="tag">${t("vc-current")}</span>` : ""}</span></button>`).join("");
  return fillPanel(`<p class="hero-note vc-note">${tf("vc-note", { o: p.overall ?? "-" })}</p><div class="vcard-grid">${items}</div>`,
    `<h2 class="panel-head">${t("tab-cards")} <span class="muted">${tf("vc-now", { k: esc(cardKindName(cur && cur.kind)) })}</span></h2>`);
}

function playerCardHtml(p) {
  const emb = p.emblem || p.clubs.club;   // 后端已按所在球队算好，clubs.club 只是兜底
  const clubId = emb.id;
  const clubTitle = esc(lang === "zh" ? emb.zh : emb.latin);
  const faceCard = `
    <div class="pcard-fallback">
      <div class="pcard-face-wrap">
        <img class="pcard-face" src="${img("face", p.pid)}" ${faceErr(clubId)} alt="">
        ${clubId ? `<img class="pcard-emblem" src="${img("emblem", clubId)}" onerror="this.classList.add('missing')" title="${clubTitle}" alt="">` : ""}
      </div>
      <div class="pcard-ovr ${abCls(p.overall ?? 0)}">${p.overall ?? "?"}</div>
      <div class="pcard-pos">${esc(p.position)}</div>
      <div class="pcard-name">${esc(cardDisplayName(p))}</div>
    </div>`;
  // 换了卡 (R-34) 就画换上的那张: 卡面地址和分层缓存都按它取, 不然还是原来那张 (p.card 是服务端的 card_brief, kind 为空 = 换回了基础卡)
  const vid = p.card ? p.card.vid : p.pid;
  if (p.card ? !p.card.kind : p.is_base) {
    return `<h2 class="panel-head">${t("sec-card")}</h2><div class="pcard">${faceCard}</div>
      <div class="muted">PID ${p.pid} · ${t("base-card")}</div>`;
  }
  return `<h2 class="panel-head">${t("sec-card")}</h2>
  <div class="pcard">
    <div class="pcard-art-wrap gcard" style="--w:240px" data-card="${vid}" data-live="always">
      <img class="pcard-img gcard-still" src="${img("card", vid)}" alt="${t("sec-card")}"
        onerror="this.parentElement.dataset.live='off';this.parentElement.hidden=true;this.parentElement.nextElementSibling.hidden=false">
      ${clubId ? `<img class="pcard-art-emblem" src="${img("emblem", clubId)}" onerror="this.classList.add('missing')" title="${clubTitle}" alt="">` : ""}
      <div class="pcard-art-name">${esc(cardDisplayName(p))}</div>
    </div>
    <div hidden><div class="pcard-ribbon">${t("var-card")}${p.card && p.card.pack ? " · " + esc(p.card.pack) : ""}</div>${faceCard}<div class="pcard-note">${t("no-material")}</div></div>
  </div>
  <div class="muted">PID ${p.pid} · ${t("var-card")}${p.card && p.card.pack ? " · " + esc(p.card.pack) : ""}</div>`;
}

// 能力值: 六组排成三栏
function playerAbilityHtml(p, byCn) {
  const groups = p.groups.map((g) => `
    <div class="agroup"><h4>${esc(t(AB_GROUP_EN[g.label] || g.label))}</h4>
      ${g.keys.map((k) => {
        const a = byCn[k];
        const tip = a.stored !== a.value ? ` title="${tf("stored-tip", { v: a.stored })}"` : "";
        const label = gname("ab", a.cn, a.en);
        return `<div class="arow"${tip}><span>${esc(label)}</span><span><b class="${abCls(a.value)}">${a.value}</b>${gdelta(a.delta)}</span></div>`;
      }).join("")}
    </div>`).join("");
  return `<div class="agroups">${groups}</div>
  ${p.abilities_scaled ? `<div class="muted">${t("scaled-note")}</div>` : ""}`;
}

// 雷达图和位置熟练度 (概览页右栏)
function playerPosHtml(p) {
  const cells = POS_GRID.map((row) => `<div class="pos-row">${row.map((pos) => {
    const main = pos === p.position;
    const apt = main ? 2 : (p.aptitudes[pos] ?? 0);
    const cls = main ? "pos-main" : apt === 2 ? "pos-a" : apt === 1 ? "pos-b" : "pos-c";
    const mark = main ? "★" : apt === 2 ? "A" : apt === 1 ? "B" : "–";
    const tip = main ? t("pos-main") : apt === 2 ? t("pos-a") : apt === 1 ? t("pos-b") : t("pos-c");
    return `<span class="pos ${cls}" title="${tip}">${pos} ${mark}</span>`;
  }).join("")}</div>`).join("");
  // 格子里只有字母, 第一次看的人要个图例
  const legend = [["pos-main", "★ " + t("pos-main")], ["pos-a", "A " + t("pos-a")], ["pos-b", "B " + t("pos-b")], ["pos-c", t("pos-c")]]
    .map(([cls, label]) => `<span><i class="pos ${cls}"></i>${label}</span>`).join("");
  return `<canvas id="radar" width="230" height="190"></canvas>
  <h2 class="panel-head">${t("sec-pos")}</h2>${cells}<div class="pos-legend">${legend}</div>`;
}

// 技能 (左栏) 和风格、状态 (右栏)
function playerSkillsHtml(p) {
  const skillChip = (s) => {
    const main = gname("skill", s.cn, s.en);
    const sub = galt(s.cn, s.en);
    return `<span class="skill${s.showtime ? " st" : ""}${s.learned ? " learned" : ""}" title="${esc(sub)}${s.showtime ? " (ShowTime)" : ""}${s.learned ? " · " + esc(t("learned-tip")) : ""}">${esc(main)}</span>`;
  };
  const aiChip = (s) => `<span class="skill" title="${esc(galt(s.cn, s.en))}">${esc(gname("ai", s.cn, s.en))}</span>`;
  const skills = p.skills.length ? p.skills.map(skillChip).join("") : `<span class="muted">${t("none")}</span>`;
  const ai = p.ai_styles.length ? p.ai_styles.map(aiChip).join("") : t("none");
  const na = t("none");
  return [`<div class="chips">${skills}</div>`,
    `<h2 class="panel-head">${t("sec-style")}</h2>
  <div class="kv"><span>${t("st-atk")}</span><b>${esc(p.att_style || na)}</b><span>${t("st-def")}</span><b>${esc(p.def_style || na)}</b></div>
  <div class="kv"><span>${t("st-ai")}</span><span class="chips">${ai}</span></div>
  <h2 class="panel-head sub-head">${t("sec-cond")}</h2>
  <div class="kv"><span>${t("form")}</span><b>${esc(p.form)}</b><span>${t("injury")}</span><b>${esc(p.injury)}</b></div>
  <div class="kv"><span>${t("wfu")}</span><b>${esc(p.wfu)}</b><span>${t("wfa")}</span><b>${esc(p.wfa)}</b></div>
  <div class="kv"><span>${t("foot")}</span><b>${esc(p.foot)}</b><span>${t("hand")}</span><b>${esc(p.hand)}</b></div>`];
}

function playerPastHtml(past) {
  if (!past || !past.length) return "";
  return `<table><tr><th class="num">${t("th-season")}</th><th>${t("th-team")}</th><th class="num">${t("th-apps")}</th>
    <th class="num">${t("th-goals")}</th><th class="num">${t("th-assists")}</th><th class="num">${t("th-rating")}</th><th class="num">${t("th-fouls")}</th><th class="num">${t("th-cards")}</th></tr>
    ${past.map((s) => `<tr><td class="num">${s.season}</td><td><div class="teamcell">${emblem(s.team)}${esc(teamName(s.team))}</div></td>
      <td class="num">${s.apps}</td><td class="num">${s.goals || ""}</td><td class="num">${s.assists || ""}</td><td class="num">${s.avg_rating ? ratingBadge(s.avg_rating) : ""}</td>
      <td class="num">${s.fouls || ""}</td><td class="num">${cardsBadge(s)}</td></tr>`).join("")}</table>`;
}

// 联赛数据: 左边本季每一场, 右边往季 (有的话)
function playerLeagueHtml(p) {
  if (!p.league) return `<section class="panel"><h2 class="panel-head">${t("sec-league")}</h2><div class="muted">${t("no-career")}</div></section>`;
  const tot = p.league.totals;
  const totals = tot
    ? tf("season-line", { s: p.league.season, a: tot.apps, g: tot.goals, as: tot.assists || 0,
        r: tot.avg_rating ? Number(tot.avg_rating).toFixed(1) : "-", f: tot.fouls ?? 0, c: cardsBadge(tot) || "-" })
    : tf("no-apps", { s: p.league.season });
  const cond = p.fit ? ` · ${t("fit-cond")} ${condHtml(p.fit.cond)}` : "";
  const rows = p.league.matches.map((m) =>
    `<tr><td class="num">${m.round}</td><td>${esc(teamName(m.home))} ${m.hg} - ${m.ag} ${esc(teamName(m.away))}</td>
     <td class="num">${m.goals || ""}</td><td class="num">${m.assists || ""}</td><td class="num">${m.rating ? ratingBadge(m.rating) : ""}</td><td class="num">${m.fouls || ""}</td><td class="num">${cardsBadge(m)}</td></tr>`).join("");
  const now = fillPanel(rows ? `<table><tr><th class="num">${t("th-round")}</th><th>${t("th-match")}</th><th class="num">${t("th-goals")}</th><th class="num">${t("th-assists")}</th><th class="num">${t("th-rating1")}</th><th class="num">${t("th-fouls")}</th><th class="num">${t("th-cards")}</th></tr>${rows}</table>` : "",
    `<h2 class="panel-head">${t("sec-league")}</h2><div class="totals">${totals}${cond}</div>`);
  const past = playerPastHtml(p.league.past);
  return past ? `<div class="cols league-p-cols" data-nav-sides>${now}${fillPanel(past, `<h2 class="panel-head">${t("seasons")}</h2>`)}</div>` : now;
}

const motionName = (n) => (lang === "zh" ? n : px("motion." + MOTION_EN[n]) || MOTION_EN[n] || n);
const MOTION_EN = { "盘带动作": "Dribbling move", "任意球姿态": "Free-kick stance", "点球姿态": "Penalty stance", "角球姿态": "Corner stance", "盘带前倾": "Dribbling lean", "盘带摆臂": "Dribbling arm swing", "跑动前倾": "Running lean", "跑动摆臂": "Running arm swing", "庆祝动作1": "Celebration 1" };

function playerBasicHtml(p) {
  const club = (c) => {
    if (!c.id) return t("none");
    const n = dispTeam(c);
    return `${esc(n.main)} <span class="muted">${esc(n.sub)}</span>`;
  };
  const kv = (k, v) => `<div class="kv2"><span>${k}</span><b>${v}</b></div>`;
  const na = t("none");
  return `<h2 class="panel-head">${t("sec-basic")}</h2><div class="kvgrid">
    ${kv(t("nm-cn"), esc(p.names.cn || na))}${kv(t("nm-roman"), esc(p.names.roman || na))}
    ${kv(t("nm-shirt"), esc(p.names.shirt || na))}${kv(t("nm-full"), esc(p.names.full || na))}
    ${kv(t("human-id"), p.base_id)}${kv(t("hw"), tf("cm-kg", { h: p.height, w: p.weight }))}
    ${kv(t("club"), club(p.clubs.club))}${kv(t("youth"), club(p.clubs.youth))}
    ${kv(t("owner"), club(p.clubs.owner))}${kv(t("contract"), esc(p.contract_end || na))}
    ${kv(t("loan"), esc(p.loan_end || na))}${kv(t("mv"), p.market_value)}${kv(t("caps"), p.caps)}
    ${kv(t("teams"), p.teams.length ? p.teams.map((tm) => `${emblem(tm.id)} ${esc(dispTeam(tm).main)}`).join(" · ") : na)}
  </div>
  <h2 class="panel-head sub-head">${t("sec-motions")}</h2><div class="chips">${p.motions.map((m) => `<span class="motion" title="${esc(galt(m.name, MOTION_EN[m.name] || m.name))}">${esc(motionName(m.name))} ${m.value}</span>`).join("")}</div>`;
}

function playerCardInfoHtml(p) {
  if (!p.card) return `<h2 class="panel-head">${t("sec-cardinfo")}</h2><div class="muted">${t("base-note")}</div>`;
  const c = p.card;
  const yn = (b) => (b ? t("yes") : t("no"));
  const rows = [
    c.vid_rule ? [t("kind-num"), `${c.kind} / ${c.number}`] : null,
    [t("pack"), esc(c.pack || t("none"))],
    [t("theme"), c.theme], [t("str-ab"), `${c.str_a} / ${c.str_b}`],
    [t("golden"), yn(c.golden_ball)],
    [t("special"), c.special_block.join(" / ")],
    [t("nt-card"), yn(c.nt)], [t("gk-flag"), yn(c.gk_flag)],
  ].filter(Boolean).map(([k, v]) => `<div class="kv2"><span>${k}</span><b>${v}</b></div>`).join("");
  return `<h2 class="panel-head">${t("sec-cardinfo")}</h2><div class="kvgrid one">${rows}</div>`;
}

const appCatName = (g) => (lang === "zh" ? g.label : px("appcat." + APP_CAT_EN[g.key]) || APP_CAT_EN[g.key] || g.label);
const APP_CAT_EN = { "appearance_cat_body": "Body", "appearance_cat_equip": "Equipment", "appearance_cat_face": "Face", "appearance_cat_eyes": "Eyes", "appearance_cat_eyebrows": "Eyebrows", "appearance_cat_nose": "Nose", "appearance_cat_mouth": "Mouth", "appearance_cat_ears": "Ears", "appearance_cat_hair": "Hair", "appearance_cat_facialhair": "Facial hair" };
// 外观字段名要么纯英文 ("Jawline")，要么 "中文 + 英文" ("颈长 Neck Length")：英文模式去中文前缀即可
const appFieldName = (n) => {
  if (lang === "zh") return n;
  return n.replace(/^[一-鿿·、\s]+/, "") || n;
};

// 外观: 以前每组折起来要一个个点开, 现在各组直接摊开排成几栏 (整页有自己的滚动区)
function playerAppearanceHtml(p) {
  if (!p.appearance.found) return `<div class="muted">${t("no-app")}</div>`;
  const groups = p.appearance.groups.map((g) =>
    `<div class="app-group"><h4>${esc(appCatName(g))} <span class="muted">${g.fields.length}</span></h4>
     <div class="chips">${g.fields.map((f) => `<span class="motion" title="${esc(f.name)}">${esc(appFieldName(f.name))} ${f.value}</span>`).join("")}</div></div>`).join("");
  return `<div class="app-flag">${t("face-flag")}<b>${p.appearance.face_flag ? t("face-on") : t("face-off")}</b>
    <span class="muted">${t("face-note")}</span></div><div class="app-groups">${groups}</div>`;
}

function drawRadar(radar) {
  const cv = $("#radar");
  if (!cv || !radar) return;
  const ctx = cv.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  const cx = 115, cy = 98, R = 68;
  const pt = (r, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = color("--fill-hi");
  ctx.lineWidth = 1;
  for (const f of [1 / 3, 2 / 3, 1]) {
    ctx.beginPath();
    radar.forEach((_, i) => {
      const [x, y] = pt(R * f, i);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.fillStyle = color("--ink-2");
  ctx.font = `600 11px ${color("--font-ui")}`;
  ctx.textAlign = "center";
  radar.forEach((d, i) => {
    const [x0, y0] = pt(R, i);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x0, y0);
    ctx.stroke();
    const [lx, ly] = pt(R + 16, i);
    ctx.fillText(d.axis, lx, ly + 4);
  });
  ctx.beginPath();
  radar.forEach((d, i) => {
    const [x, y] = pt(R * d.value, i);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = color("--accent");
  ctx.globalAlpha = 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color("--accent");
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ------------------------------------------------------------ 事件轮询 (踢完一场自动结算、重画主页)
// ------------------------------------------------------------ 开发者模式 (R-30): 把存档的副本快进几季, 每季一份体检
// 第一个标签是「快进」(选几季、开始 / 停下、进度、托管规则), 后面每组体检一个标签: 一行一个数, 一列一季, 最前面是参考值和 dt200 原样
const DV_SEASONS = [1, 3, 5, 10];
let dvSeasons = 3;
let dvTimer = null;
const dvTeam = (rep, tid) => { const x = rep && rep.teams[String(tid)]; return x ? (lang === "zh" ? x.zh : x.latin) : teamName(tid); };
const dvClock = (s) => (s == null ? "–" : s < 60 ? tf("dv-sec", { n: Math.round(s) }) : tf("dv-min", { m: Math.floor(s / 60), s: Math.round(s % 60) }));
// 一个人那格后面跟的数: 转会费是钱, 名人堂是分, 射手是球, 最强的人是总评
const DV_N = { k_top: (n) => money(n), h_hof_top: (n) => tf("dv-pts", { n: n.toFixed(1) }), m_boot: (n) => tf("dv-goals", { n }), h_boot: (n) => tf("dv-goals", { n }) };
const DV_TEXT = new Set(["t", "champ", "drift", "job", "p"]);   // 字多的格子: 左对齐, 太长截断 (悬停看全)
function dvLabel(k) {
  const i = k.indexOf(":");   // 年龄段: p_age:21–23
  return i < 0 ? t("dv-" + k) : tf("dv-" + k.slice(0, i), { b: k.slice(i + 1) });
}
function dvCell(r, v, rep) {
  if (v == null) return "–";
  switch (r.fmt) {
    case "i": return String(Math.round(v));
    case "f1": return Number(v).toFixed(1);
    case "f2": return Number(v).toFixed(2);
    case "s1": return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
    case "pct": return Math.round(v * 100) + "%";
    case "m": return money(v);
    case "sec": return esc(tf("dv-sec", { n: v.toFixed(1) }));
    case "mb": return v.toFixed(1) + " MB";
    case "t": return esc(dvTeam(rep, v));
    case "frac": case "pos": return v[1] == null ? String(v[0]) : `${v[0]} / ${v[1]}`;
    case "champ": return `${esc(dvTeam(rep, v.team))} <span class="muted">${esc(tf("dv-rank", { n: v.rank }))}</span>`;
    case "drift": return `${esc(dvTeam(rep, v.team))} <span class="muted">${v.base.toFixed(1)}→${v.now.toFixed(1)}</span>`;
    case "job": return v.sacked ? esc(t("dv-sacked")) : v.offers ? esc(tf("dv-poached", { n: v.offers })) : "–";
    case "p": { const n = v.n == null ? "" : (DV_N[r.k] || String)(v.n); return `${pname(v)}${n ? ` <span class="muted">${esc(n)}</span>` : ""}`; }
    default: return esc(String(v));
  }
}
function dvTable(rep, g) {
  const head = `<tr><th>${t("dv-th-metric")}</th><th class="num">${t("dv-th-ref")}</th><th class="num">dt200</th>${rep.cols.map((c) => `<th class="num">${esc(c.label)}</th>`).join("")}</tr>`;
  const rows = g.rows.map((r) => {
    const cls = DV_TEXT.has(r.fmt) ? "dv-text" : "num";
    const cell = (v, bad) => `<td class="${cls}${bad ? " bad" : ""}">${dvCell(r, v, rep)}${bad ? `<b class="dv-flag" title="${esc(t("dv-flag"))}">!</b>` : ""}</td>`;
    return `<tr><td class="dv-lbl">${esc(dvLabel(r.k))}</td><td class="num muted">${esc(r.ref || "")}</td>${cell(r.base, false)}${r.v.map((v, i) => cell(v, r.bad[i])).join("")}</tr>`;
  }).join("");
  return `<table class="dv-table">${head}${rows}</table>`;
}
function dvEventText(e, rep) {
  return e.k === "hired" ? tf(e.mid ? "dv-ev-hired-mid" : "dv-ev-hired", { s: e.s, t: dvTeam(rep, e.to) }) : tf("dv-ev-decide", { s: e.s, w: dvTeam(rep, e.winner), l: dvTeam(rep, e.loser) });
}
function dvRunHtml(d) {
  const j = d.job, rep = d.report, cur = d.current;
  let left;
  if (j && j.running) {
    const p = j.progress || {};
    const where = p.today ? fmtDate(p.today) : p.round ? tf("dv-round", { r: p.round }) : "";
    left = `<h2 class="panel-head">${esc(tf("dv-running", { i: Math.min((p.i || 0) + 1, j.n), n: j.n, s: p.label || "" }))}${where ? ` <span class="muted">${esc(where)}</span>` : ""}</h2>
      <span class="gbar dv-bar"><i style="width:${Math.round(j.overall * 100)}%"></i></span>
      <p class="dv-clock">${esc(tf("dv-elapsed", { a: dvClock(j.elapsed) }))}${j.eta != null ? " · " + esc(tf("dv-eta", { b: dvClock(j.eta) })) : ""}</p>
      <div class="hero-actions"><button class="pill" data-act="dv-stop"${j.stopped ? " disabled" : ""}>${t(j.stopped ? "dv-stopping" : "dv-stop")}</button></div>
      <p class="hero-note">${esc(tf("dv-copy-note", { f: j.file }))}</p>`;
  } else {
    const last = !j ? "" : j.error ? tf("dv-last-error", { e: j.error }) : j.stopped ? tf("dv-last-stopped", { d: j.done, n: j.n })
      : tf("dv-last-done", { d: j.done, n: j.n, a: dvClock(j.elapsed) });
    left = `<h2 class="panel-head">${t("dv-seasons")}</h2>
      <div class="chips" role="group">${DV_SEASONS.map((n) => `<button type="button" data-dvn="${n}" aria-pressed="${n === dvSeasons}">${esc(n === 1 ? t("dv-n1") : tf("dv-n", { n }))}</button>`).join("")}</div>
      <div class="hero-actions"><button class="pill primary" data-act="dv-run">${t("dv-start")}</button>
        ${j && !j.active && j.done ? `<button class="pill" data-act="dv-open" data-file="${esc(j.file)}">${t("dv-open-copy")}</button>` : ""}
        ${rep ? `<button class="pill" data-act="dv-report">${t("dv-see-report")}</button>` : ""}</div>
      ${cur ? `<p class="hero-note">${esc(tf("dv-from", { n: cur.name }))}</p>` : ""}
      ${last ? `<p class="hero-note${j.error ? " error" : ""}">${esc(last)}</p>` : ""}
      ${j && j.active ? `<p class="hero-note">${t("dv-on-copy")}</p>` : ""}`;
  }
  const evs = rep ? rep.runs.flatMap((r) => r.events) : j ? j.events : [];
  const evHtml = evs.length ? evs.map((e) => `<div class="tr-row"><div class="grow">${esc(dvEventText(e, rep))}</div></div>`).join("") : `<div class="empty">${t("dv-no-events")}</div>`;
  return `<div class="cols" data-nav-sides>${fillPanel(left)}
    ${fillPanel(`<ul class="dv-rules">${[1, 2, 3, 4].map((i) => `<li>${t("dv-auto-" + i)}</li>`).join("")}</ul>
      <h2 class="panel-head sub-head">${t("dv-events")}</h2>${evHtml}`, `<h2 class="panel-head">${t("dv-auto-title")}</h2>`)}</div>`;
}
function bindDevRun(pane) {
  pane.querySelectorAll("[data-dvn]").forEach((b) => b.addEventListener("click", () => {
    dvSeasons = Number(b.dataset.dvn);
    pane.querySelectorAll("[data-dvn]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
}
async function openDev(nav = "push", tab = null) {
  const seq = ++openSeq;
  let d;
  try {
    d = await api("/api/dev");
  } catch (e) {
    return toast(e.message);
  }
  if (seq !== openSeq) return;
  delete $("#modal").dataset.player;
  const rep = d.report;
  const view = { label: () => t("dv-title"), reopen: (n) => openDev(n), dev: d, cols: rep ? rep.cols.length : 0, ui: { tab: tab || "run" } };
  view.tabs = [{ k: "run", label: t("dv-tab-run"), html: () => dvRunHtml(view.dev), after: bindDevRun }].concat((rep ? rep.groups : []).map((g) => ({
    k: g.k, label: t("dv-g-" + g.k),
    html: () => `<p class="hero-note dv-note">${t("dv-note-" + g.k)}</p>` + fillPanel(dvTable(rep, g)),
    after: (pane) => pane.querySelectorAll("td.dv-text").forEach((td) => (td.title = td.textContent)) })));
  const meta = rep ? tf("dv-report-of", { n: rep.name }) : t("dv-no-report");
  // 原地重画会沿用上一次停的标签 (openModal 的 restore.ui): 点名要哪个标签就先改掉它
  if (tab && nav === "replace" && currentView && currentView.ui) currentView.ui.tab = tab;
  openModal(glowHtml(state.career && state.career.user_team) + pageHead(t("dv-title"), t("dv-kicker"), esc(meta)), true, view, nav);
  if (d.job && d.job.running) devWatch();
}
// 快进中: 开发者页开着就每 1.5 秒看一眼。跑完一季 (报告多一列) / 跑完了: 整页重画; 不然只重画「快进」标签里的进度
function devWatch() {
  clearTimeout(dvTimer);
  dvTimer = setTimeout(async () => {
    const v = currentView;
    if (!v || !v.dev || $("#modal").hidden) return;
    let d;
    try {
      d = await api("/api/dev");
    } catch (e) {
      return devWatch();
    }
    if (currentView !== v) return;
    if (!d.job || !d.job.running || (d.report ? d.report.cols.length : 0) !== v.cols) return openDev("replace", v.ui.tab);
    v.dev = d;
    const body = $("#modal-body .page-body");
    if (v.ui.tab === "run" && body) renderTab(v, "run", 0, { scrolls: scrollState(body), focus: focusKey(document.activeElement) });
    devWatch();
  }, 1500);
}

async function pollEvents() {
  try {
    const r = await api(`/api/events?since=${lastEvent}&client=${CLIENT}&boot=${boot}`);
    const events = r.events;
    lastEvent = r.event_id;
    boot = r.boot || boot;   // 服务重启过: 它这次按 since=0 全给了, 编号也换成新的
    if (events.length) {
      const applied = events.filter((e) => e.type === "match_applied").pop();
      const unmatched = events.filter((e) => e.type === "unmatched").pop();
      const buffed = events.filter((e) => e.type === "buffed").pop();
      if (buffed) {
        UI.sound("notify");
        toast(tf("buff-applied", { d: buffed.delta, n: buffed.streak }), 12000);
        await refresh();
      }
      if (events.some((e) => e.type === "assets_changed")) await refresh();  // 换了 pak: 按新版本重画
      const devDone = events.filter((e) => e.type === "dev_done").pop();
      if (devDone) {   // 开发者模式快进跑完 (R-30): 提示一下, 页头的「快进中」换回来, 开发者页开着就重画
        UI.sound("notify");
        toast(devDone.error ? tf("dv-err-toast", { e: devDone.error }) : tf("dv-done-toast", { d: devDone.done, n: devDone.n }), 10000);
        await refresh();
        if (currentView && currentView.dev) openDev("replace");
      }
      if (applied) {   // 踢完一场: 重画主页, 名次、信任度滚到新值; 不再自己弹战报 (R-29), 想看从赛果点进去
        await refresh();
        UI.sound("notify");
      } else if (unmatched) {
        toast(tf("unmatched", { a: unmatched.teams.join(lang === "zh" ? " 对 " : " vs "), b: unmatched.expected }), 12000);
      }
    }
  } catch (e) {
    /* 服务重启中, 下一轮再试 */
  }
  setTimeout(pollEvents, 2000);
}

// ------------------------------------------------------------ 接线: 点击分发、手柄 / 键盘回调
// ← 返回 / Esc / ○ 退一层 (退到底回主页); 「主页」/ PS 键 / Home 一步回主页

// 主页选中图块: 焦点到哪个图块就选哪个 (手柄、键盘、鼠标都一样); 标签也一样, 焦点到哪个标签就翻到哪一页
document.addEventListener("focusin", (e) => {
  if (!e.target.matches) return;
  if (e.target.matches(".tile")) selectTile(e.target.dataset.k);
  else if (e.target.matches(".tab")) selectTabEl(e.target);
});
// 鼠标点图块: 第一下只是选中, 已经选中的再点才打开; 回车 / ✕ (detail = 0) 直接打开
let tileWasOn = false;
document.addEventListener("pointerdown", (e) => {
  const tile = e.target.closest && e.target.closest(".tile");
  tileWasOn = !!(tile && tile.classList.contains("on"));
}, true);

// 一处分发: data-act 按钮、图块、战报行、球队 (头像在下面单独处理)
document.addEventListener("click", (e) => {
  const actEl = e.target.closest("[data-act]");
  if (actEl) {
    if (!actEl.disabled && ACTIONS[actEl.dataset.act]) ACTIONS[actEl.dataset.act](actEl);
    return;
  }
  const tile = e.target.closest(".tile");
  if (tile) {
    if (e.detail === 0 || tileWasOn) { const sec = hubSections().find((x) => x.k === tile.dataset.k); if (sec) sec.open(); }
    return;
  }
  const tab = e.target.closest(".tab");
  if (tab) {
    selectTabEl(tab);
    // ✕ / 回车按在标签上: 进这一页的内容
    if (e.detail === 0 && UI.mode !== "pointer") { const host = tabHost(); if (host) UI.focusDefault(host.root.querySelector(".pane")); }
    return;
  }
  if (e.target.closest("[data-pid]")) return;
  const fx = e.target.closest("[data-fixture]");
  if (fx) return openReport(fx.dataset.fixture);
  const tm = e.target.closest("[data-team]");
  if (tm) openTeam(Number(tm.dataset.team));
});

$("#overview").addEventListener("click", (e) => { if (e.target.id === "overview") closeOverview(); });   // 点网格外面关上
UI.layer(() => (!$("#confirm").hidden ? $("#confirm") : phoneOpen() ? $("#phone") : ovOpen() ? $("#overview") : cer ? $("#ceremony") : kick ? $("#kickoff") : !$("#modal").hidden ? $("#modal") : $("#app")));
UI.on({
  back() {
    if (confirmDone) return confirmDone(false);
    if (phoneOpen()) return closePhone();
    if (mkPicking && mkPickClose()) return;
    if (ovOpen()) return closeOverview();
    if (cer) return cerSkip();
    if (kick) return kickClose();
    if (tacPage && tacPage.sel != null && tacOnLineup()) { tacPage.sel = null; openTactics("replace", true); return; }
    if (!$("#modal").hidden) return goBack();
    const tile = $(".tile.on");   // 主页: 回到选中的图块
    if (tile && document.activeElement !== tile) UI.focus(tile, true);
  },
  home() {
    if (phoneOpen()) closePhone(true);
    if (ovOpen()) return closeOverview();
    if (cer) return cerClose();
    if (kick) return kickClose();
    if (!confirmDone && !tacLeaveGuard(closeModal)) closeModal();
  },
  // L1 / R1 (键盘 Q / E): 页面里换标签, 主页换栏目; 没有标签的页面没东西可换, 顶一下
  shoulder(d) {
    if (confirmDone || kick || cer) return;
    if (phoneOpen()) return phoneStep(d);
    const host = tabHost();
    if (host) return stepTab(host, d);
    if ($("#modal").hidden && $(".tile")) return hubStep(d);
    UI.sound("edge");
  },
  menu() {
    if (phoneOpen()) return;
    if (!confirmDone && tacOnLineup()) return tacSave();   // 战术页: Start / Options = 保存 (R-68)
    const b = $(".hub-util button:not([disabled])");
    if (b && $("#modal").hidden && !confirmDone && !kick && !cer) UI.focus(b);
  },
  input: () => { renderHints(); renderDock(); },
  face: faceAct,                // R-80: X / Y (PS □ / △) = 这一行 / 这一页的快捷操作
  phone: togglePhone,           // R-82: R3 / P 开关手机
  beforeMove: flushHero,
  // View 键 / Tab (R-72): 主页上开关「全部栏目」; 页面里、开球、颁奖时不管 (Tab 照常走焦点)
  view() {
    if (phoneOpen()) return true;
    if (ovOpen()) { closeOverview(); return true; }
    if (confirmDone || kick || cer || !$("#modal").hidden || !$(".tile")) return false;
    openOverview();
    return true;
  },
  pageTiles: tilesPage,
  edgeTiles: tilesEdge,
});

// 点任何头像都进球员页（阵容表、战报、射手榜、球队弹窗里都有头像）
// 已经在看这人就不再重进，免得闪一下像自动刷新
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-pid]");
  if (!el || e.target.closest("[data-act]")) return;   // 行里的按钮 (请进教练组) 不进球员页
  if (!$("#modal").hidden && Number(el.dataset.pid) === Number($("#modal").dataset.player)) return;
  openPlayer(Number(el.dataset.pid), el.dataset.team || null);
});

// 关窗口 (或刷新) 时告诉服务; 刷新的话新页面几秒内就会连上, 服务不会退
window.addEventListener("pagehide", () => navigator.sendBeacon("/api/bye?client=" + CLIENT));

(async () => {
  await refresh();
  const tile = $(".tile.on");            // 刚打开: 焦点先放在选中的图块上 (R-57), 第一下方向键就是在走, 不是「落位」
  if (tile && document.activeElement === document.body) UI.focus(tile, true);
  if (window.Globe) Globe.prewarm();   // 地球仪的点阵先在空闲时算好, 点「开始比赛」时不卡
  pollEvents();
  noticePlugin();
})();
