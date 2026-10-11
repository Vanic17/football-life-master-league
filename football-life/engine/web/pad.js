"use strict";
// 输入与动效: 手柄 / 键盘的焦点导航、界面音效、页面切换动画。和联赛逻辑无关, app.js 通过 window.UI 用它。
// 手柄只在本窗口是前台时生效: 游戏在前台时手柄是给游戏的, 界面不能跟着动 (不然踢球时按键会在这边乱点)。
(() => {
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const hooks = {};   // app.js 挂的回调: back / home / shoulder / menu / input
  const call = (name, ...a) => hooks[name] && hooks[name](...a);

  // ------------------------------------------------------------ 输入方式
  // pointer = 鼠标, 不画焦点框; key / pad = 键盘 / 手柄, 画 PS5 那种白色焦点框
  let mode = "pointer";
  let padKind = null;   // "ps" / "xbox" / null (没接手柄)
  root.dataset.input = mode;
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    root.dataset.input = m;
    call("input", m);
  }
  // 页面滚动时鼠标没动也会有 pointermove, 看位移才算真在用鼠标
  addEventListener("pointermove", (e) => { if (e.movementX || e.movementY) setMode("pointer"); }, { passive: true });
  addEventListener("pointerdown", () => setMode("pointer"), { passive: true, capture: true });

  // ------------------------------------------------------------ 音效: Web Audio 现合成, 不带音频文件
  let soundOn = true;
  try { soundOn = localStorage.getItem("ml-sound") !== "off"; } catch (e) { /* 无痕等极端情况 */ }
  let actx = null;
  function audio() {
    if (!actx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      actx = new C();
    }
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }
  // 每个音: 频率从 f 滑到 f2, 时长 d 秒, 峰值音量 g, 波形 w, t = 相对起点的延迟, a = 渐强多久 (默认一下就到)
  const SOUNDS = {
    move: [{ f: 1760, f2: 1560, d: 0.03, g: 0.03, w: "sine" }],
    ok: [{ f: 880, f2: 1175, d: 0.07, g: 0.04, w: "triangle" }, { f: 1760, f2: 2350, d: 0.06, g: 0.012, w: "sine", t: 0.012 }],
    back: [{ f: 760, f2: 480, d: 0.075, g: 0.04, w: "triangle" }],
    edge: [{ f: 190, f2: 140, d: 0.06, g: 0.05, w: "sine" }],
    notify: [{ f: 988, f2: 988, d: 0.16, g: 0.035, w: "sine" }, { f: 1319, f2: 1319, d: 0.24, g: 0.03, w: "sine", t: 0.11 }],
    // 开球动画 (R-17): 镜头推进的风声、锁定、对阵亮相、冲进比赛
    fly: [{ f: 70, f2: 150, d: 1.9, g: 0.06, w: "sine", a: 1.2 }, { f: 700, f2: 1900, d: 1.7, g: 0.005, w: "triangle", a: 1.3 }],
    lock: [{ f: 1568, f2: 1568, d: 0.09, g: 0.03, w: "sine" }, { f: 2093, f2: 2093, d: 0.16, g: 0.024, w: "sine", t: 0.07 }],
    vs: [{ f: 118, f2: 52, d: 0.6, g: 0.1, w: "sine" }, { f: 440, f2: 220, d: 0.22, g: 0.018, w: "triangle" }, { f: 1760, f2: 1760, d: 0.4, g: 0.008, w: "sine", t: 0.03 }],
    dive: [{ f: 180, f2: 960, d: 0.7, g: 0.045, w: "sine", a: 0.5 }],
    // 颁奖典礼 (R-28): 揭晓一个人 / 冠军和第一名的号角 (大三和弦往上走)
    reveal: [{ f: 520, f2: 1040, d: 0.22, g: 0.028, w: "sine" }, { f: 1560, f2: 1560, d: 0.18, g: 0.01, w: "sine", t: 0.08 }],
    fanfare: [{ f: 523, f2: 523, d: 0.5, g: 0.03, w: "triangle" }, { f: 659, f2: 659, d: 0.5, g: 0.028, w: "triangle", t: 0.09 },
      { f: 784, f2: 784, d: 0.55, g: 0.028, w: "triangle", t: 0.18 }, { f: 1047, f2: 1047, d: 0.8, g: 0.026, w: "triangle", t: 0.27 },
      { f: 60, f2: 45, d: 0.6, g: 0.07, w: "sine", t: 0.27 }],
    // 图块上的数变了 (回到主页时滚到新值)
    tick: [{ f: 2200, f2: 2000, d: 0.035, g: 0.012, w: "sine" }],
  };
  function sound(name) {
    if (!soundOn) return;
    const a = audio();
    if (!a || a.state !== "running") return;
    const now = a.currentTime + 0.005;
    for (const s of SOUNDS[name] || []) {
      const t0 = now + (s.t || 0);
      const o = a.createOscillator(), g = a.createGain();
      o.type = s.w;
      o.frequency.setValueAtTime(s.f, t0);
      if (s.f2 !== s.f) o.frequency.exponentialRampToValueAtTime(s.f2, t0 + s.d);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(s.g, t0 + (s.a || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + s.d);
      o.connect(g).connect(a.destination);
      o.start(t0);
      o.stop(t0 + s.d + 0.03);
    }
  }
  // 浏览器要先有一次用户操作才准出声: 第一次按键 / 点击时把音频叫醒
  for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, () => { if (soundOn) audio(); }, { capture: true, passive: true });
  // 点到能点的东西就「嗒」一声; 返回类的按钮用返回音
  addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest("button, summary, [tabindex]");
    if (!el || el.disabled) return;
    sound(el.matches("[data-sound=back]") ? "back" : "ok");
  }, true);

  // ------------------------------------------------------------ 焦点导航 (按方位跳)
  const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), summary, [tabindex]:not([tabindex="-1"])';
  let layerFn = () => document.body;   // 当前最上层 (确认框 > 弹页 > 主页), app.js 提供
  function focusables(scope) {
    return [...scope.querySelectorAll(FOCUSABLE)].filter((el) => {
      if (el.closest("[hidden], [inert]")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  // data-nav-group 容器记住上次停在里面的元素: 从外面回来时回到它 (像 PS5 从下面回到刚才选中的那个图块)
  const memory = new WeakMap();
  addEventListener("focusin", (e) => {
    const g = e.target.closest && e.target.closest("[data-nav-group]");
    if (g) memory.set(g, e.target);
  });

  // 在 dir 方向上挑下一个: 先找那个方向上最近的「一排」(主轴距离差 24px 以内算同一排),
  // 再在这一排里挑横向最对齐的; 同类元素 (头像一列往下还是头像) 优先。
  // 只看「正下方最近」的话, 在左边的按钮会被下面整行宽的表格行抢走
  function nearest(from, dir, list) {
    const a = from.getBoundingClientRect();
    const horiz = dir === "left" || dir === "right";
    const sign = dir === "right" || dir === "down" ? 1 : -1;
    const acx = (a.left + a.right) / 2, acy = (a.top + a.bottom) / 2;
    const cands = [];
    for (const el of list) {
      if (el === from || el.contains(from) || from.contains(el)) continue;
      const b = el.getBoundingClientRect();
      const bcx = (b.left + b.right) / 2, bcy = (b.top + b.bottom) / 2;
      if ((horiz ? bcx - acx : bcy - acy) * sign <= 1) continue;   // 中心没越过 = 不在那个方向
      // R-80: 两条边都要越过去, 而且主轴上重叠不到较短那个的一半 —— 不然是「同一排」或「旁边一块高面板」:
      // 以前中心低 1px 就算在下面, 按下会横着跳到右边那块高高的预览面板 / 同一排高一点的按钮上, 下面的东西就永远走不到
      const lead = horiz ? (sign > 0 ? b.left - a.left : a.right - b.right) : (sign > 0 ? b.top - a.top : a.bottom - b.bottom);
      const trail = horiz ? (sign > 0 ? b.right - a.right : a.left - b.left) : (sign > 0 ? b.bottom - a.bottom : a.top - b.top);
      if (lead <= 1 || trail <= 1) continue;
      const lap = horiz ? Math.min(a.right, b.right) - Math.max(a.left, b.left) : Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (lap > 0.5 * (horiz ? Math.min(a.width, b.width) : Math.min(a.height, b.height))) continue;
      const gap = horiz ? (sign > 0 ? b.left - a.right : a.left - b.right) : (sign > 0 ? b.top - a.bottom : a.top - b.bottom);
      cands.push({
        el,
        main: Math.max(0, gap),
        cross: horiz ? Math.max(0, b.top - a.bottom, a.top - b.bottom) : Math.max(0, b.left - a.right, a.left - b.right),
        center: horiz ? Math.abs(bcy - acy) : Math.abs(bcx - acx),
        same: el.tagName === from.tagName && el.className === from.className ? 1 : 0,
      });
    }
    // 左右只在同一行里走 (上下要有重叠), 到头就停: PS5 按右不会跳到上面那一排去。上下才跨排
    let pool = horiz ? cands.filter((c) => c.cross <= 8) : cands;
    if (!horiz && pool.length) {
      // R-80 上下先在同一列里走 (横向有重叠的); 同一列没有了, 在列表里的也不斜着跳出这个列表
      // (左边积分榜到底按下, 以前会跳到右边赛果里) —— 换列用左右。不在列表里的 (页头、标签条、按钮排) 照旧可以斜着下去
      const col = pool.filter((c) => c.cross === 0);
      if (col.length) pool = col;
      else {
        const sc = from.closest(".scroller");
        if (sc) pool = pool.filter((c) => c.el.closest(".scroller") === sc);
      }
    }
    if (!pool.length && horiz) {
      // 例外: 左右两栏 (data-nav-sides, 主页详情的字和预览、页面的分栏) 之间, 同一高度没有东西也能过去,
      // 落到那一栏里离得最近的; 进的是导航组就回到组里上次停的地方 (move 里处理)
      const box = from.closest("[data-nav-sides]");
      const side = box ? cands.filter((c) => box.contains(c.el)) : [];
      side.sort((x, y) => x.main + x.cross - (y.main + y.cross));
      return side.length ? side[0].el : null;
    }
    if (!pool.length) return null;
    const row = Math.min(...pool.map((c) => c.main)) + 24;
    const band = pool.filter((c) => c.main <= row);
    band.sort((x, y) => x.cross - y.cross || y.same - x.same || x.center - y.center);
    return band[0].el;
  }

  function move(dir) {
    call("beforeMove", dir);   // 让 app 先把还没画的内容画完 (比如刚换栏目、详情还在等), 不然焦点会落在马上要被换掉的元素上
    const scope = layerFn();
    const list = focusables(scope);
    const cur = document.activeElement;
    if (!cur || cur === document.body || !scope.contains(cur) || !list.includes(cur)) return focusDefault(scope, false);
    // 焦点在一块纯文字的滚动区上 (比赛统计、档案): 上下先滚它, 滚到头了再走出去
    if ((dir === "up" || dir === "down") && cur.matches("[data-scroll-focus]") && canMove(cur, dir === "down" ? 1 : -1)) {
      cur.scrollBy({ top: (dir === "down" ? 1 : -1) * Math.max(60, cur.clientHeight * 0.4), behavior: reduced.matches ? "auto" : "smooth" });
      sound("move");
      return;
    }
    // 行里还有能点的 (战报里球员行的头像): 往右进去, 往左没路了就退回行
    if (dir === "right") {
      const inner = list.find((el) => el !== cur && cur.contains(el));
      if (inner) return focus(inner);
    }
    let next = nearest(cur, dir, list);
    if (!next && dir === "left") next = list.find((el) => el !== cur && el.contains(cur)) || null;
    // 一排走到头 (主页图块, data-nav-wrap): 绕到另一头, 不用一格格倒回去
    const wrap = !next && (dir === "left" || dir === "right") ? cur.closest("[data-nav-wrap]") : null;
    if (wrap) {
      const row = list.filter((el) => wrap.contains(el));
      if (row.length > 1) return focus(dir === "right" ? row[0] : row[row.length - 1]);
    }
    if (!next) {
      sound("edge");
      bump(cur, dir);
      return;
    }
    const g = next.closest("[data-nav-group]");
    if (g && !g.contains(cur)) {
      let back = memory.get(g);
      // 重画过: 回到组里的默认项 (选中的图块 / 当前的标签)
      if (!back || !back.isConnected) back = g.querySelector("[data-nav-default]") || g.querySelector('[aria-selected="true"]');
      if (back && list.includes(back)) next = back;
    }
    focus(next);
  }

  // ------------------------------------------------------------ 滚动区 (R-20)
  // 页面自己不滚, 像主机游戏一样一屏装下: 长列表装在 .scroller 里, 只在自己那块面板里滚。
  // 焦点走到哪列表跟到哪 (reveal); LT / RT (键盘 PageUp / PageDown) 一次翻一屏, Home / End 到头到尾;
  // 右摇杆、滚轮滚的是焦点所在的那一块, 指在页面空白处滚轮也滚页面的主列表。
  const canScrollY = (el) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
  const canMove = (el, sign) => (sign > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0);
  function scrollParent(el, scope) {
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      if (canScrollY(p)) return p;
      if (p === scope) break;
    }
    return null;
  }
  // 这一层里藏着最多内容的那块 (页面的主列表)
  function mainScroller(scope) {
    const all = [...scope.querySelectorAll(".scroller")].filter((el) => !el.closest("[hidden], [inert]") && canScrollY(el));
    if (scope !== document.body && canScrollY(scope)) all.push(scope);   // 窄窗: 整页回到能滚
    all.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    return all[0] || null;
  }
  // 焦点所在的那一块 (列表不长、没在滚也算: 翻页就是跳到它的最后一行), 焦点不在列表里就是页面的主列表
  function currentScroller() {
    const scope = layerFn();
    const cur = document.activeElement;
    const inside = cur && cur !== document.body && scope.contains(cur);
    return (inside && (scrollParent(cur, scope) || cur.closest(".scroller"))) || mainScroller(scope);
  }
  // 纯文字的滚动区 (里面没有能点的) 自己能拿焦点: 手柄停在上面时上下键滚它。app 每次画完一页调一次
  function prepScrollers(root) {
    (root || layerFn()).querySelectorAll(".scroller").forEach((sc) => {
      const own = canScrollY(sc) && !sc.querySelector(FOCUSABLE);
      if (own && !sc.hasAttribute("data-scroll-focus")) {
        sc.tabIndex = 0;
        sc.setAttribute("data-scroll-focus", "");
      } else if (!own && sc.hasAttribute("data-scroll-focus")) {
        sc.removeAttribute("tabindex");
        sc.removeAttribute("data-scroll-focus");
      }
    });
  }
  let prepTimer = 0;
  addEventListener("resize", () => { clearTimeout(prepTimer); prepTimer = setTimeout(() => prepScrollers(), 200); });

  // 同一列 (横向有重叠) 里、在 dir 方向上的可聚焦元素
  function column(sc, cur, dir) {
    const a = cur.getBoundingClientRect();
    return focusables(sc).filter((el) => {
      if (el === cur || el === sc || el.contains(cur) || cur.contains(el)) return false;
      const b = el.getBoundingClientRect();
      return b.left < a.right && b.right > a.left && (b.top - a.top) * dir > 1;
    });
  }

  // 翻一屏: 焦点跳到一屏之外的那一行, 列表跟着翻过去, 焦点留在屏幕上原来的高度 (像主机游戏的列表翻页)
  function page(dir) {
    if (call("pageTiles", dir)) return;   // 焦点在主页图块上: 那一排翻一屏 (app.js)
    const scope = layerFn();
    const sc = currentScroller();
    if (!sc) return sound("edge");
    const behavior = reduced.matches ? "auto" : "smooth";
    const cur = document.activeElement;
    const box = sc.getBoundingClientRect();
    const step = Math.max(80, sc.clientHeight * 0.8);
    if (!cur || cur === sc || !sc.contains(cur) || !scope.contains(cur)) {
      if (!canMove(sc, dir)) return sound("edge");
      sc.scrollBy({ top: dir * step, behavior });
      return sound("move");
    }
    const cands = column(sc, cur, dir);
    if (!cands.length) {
      sound("edge");
      return bump(cur, dir > 0 ? "down" : "up");
    }
    const a = cur.getBoundingClientRect();
    const want = a.top + dir * step;
    let best = cands[0], bd = Infinity;
    for (const el of cands) {
      const d = Math.abs(el.getBoundingClientRect().top - want);
      if (d < bd) { bd = d; best = el; }
    }
    best.focus({ preventScroll: true });
    sc.scrollBy({ top: best.getBoundingClientRect().top - box.top - (a.top - box.top), behavior });
    sound("move");
  }

  // 到头 / 到尾: 列表里第一个 / 最后一个
  function edge(dir) {
    if (call("edgeTiles", dir)) return;   // 主页图块: 第一个 / 最后一个
    const sc = currentScroller();
    if (!sc) return sound("edge");
    const cur = document.activeElement;
    const inside = cur && cur !== sc && sc.contains(cur);
    const cands = inside ? column(sc, cur, dir) : [];
    if (inside && !cands.length) {
      if (!canMove(sc, dir)) return sound("edge");
    }
    if (cands.length) {
      const el = cands[dir > 0 ? cands.length - 1 : 0];
      el.focus({ preventScroll: true });
    }
    sc.scrollTo({ top: dir > 0 ? sc.scrollHeight : 0, behavior: reduced.matches ? "auto" : "smooth" });
    sound("move");
  }

  // 滚轮指在不能滚的地方 (页头、另一块面板的空白处): 交给页面的主列表, 不然整页纹丝不动像坏了
  addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.defaultPrevented || !e.deltaY) return;
    const scope = layerFn();
    if (!scope.contains(e.target)) return;
    const sign = Math.sign(e.deltaY);
    for (let p = e.target; p && p.nodeType === 1; p = p.parentElement) {
      if (canScrollY(p) && canMove(p, sign)) return;   // 底下那块自己能滚, 交给浏览器
      if (p === scope) break;
    }
    if (canScrollY(document.scrollingElement)) return;   // 窄窗: 整页在滚
    const sc = mainScroller(scope);
    if (!sc || sc.contains(e.target) || !canMove(sc, sign)) return;
    e.preventDefault();
    sc.scrollBy({ top: e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? sc.clientHeight : 1) });
  }, { passive: false });

  // 撞到边: 轻轻顶一下 (PS5 到头时的那一下)。R-89 起用 GSAP 推; 动的是 translate 属性, 不碰元素自己的 transform (焦点放大、球场卡定位)
  function bump(el, dir) {
    const G = window.gsap;
    if (reduced.matches || !G || el.tagName === "TR") return;
    const d = 5 * (dir === "right" || dir === "down" ? 1 : -1), h = dir === "left" || dir === "right";
    const o = { v: 0 };
    G.to(o, { v: d, duration: 0.1, ease: "power2.out", yoyo: true, repeat: 1,
      onUpdate() { el.style.translate = h ? `${o.v}px 0` : `0 ${o.v}px`; },
      onComplete() { el.style.translate = ""; } });
  }

  function focus(el, quiet = false) {
    if (!el) return;
    el.focus({ preventScroll: true });
    reveal(el);
    if (!quiet) sound("move");
  }

  // 聚焦的那一层默认落点: [data-nav-default] > 第一个不是关闭 / 返回的
  function focusDefault(scope, quiet = true) {
    const list = focusables(scope || layerFn());
    const d = (scope || layerFn()).querySelector("[data-nav-default]");
    const el = d && list.includes(d) ? d : list.find((x) => !x.matches("[data-nav-skip]")) || list[0];
    focus(el, quiet);
  }

  // 把元素滚进视野: 一层层往外 (列表 -> 弹页 / 窗口), 离边留点余量, 横竖都管
  function reveal(el) {
    const behavior = reduced.matches ? "auto" : "smooth";
    let offX = 0, offY = 0;   // 里层滚过之后元素会挪的量, 外层按挪完的位置算
    for (let p = el.parentElement; ; p = p.parentElement) {
      const doc = !p;
      const sc = doc ? document.scrollingElement : p;
      if (!doc) {
        const cs = getComputedStyle(p);
        const y = /(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1;
        const x = /(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1;
        if (!x && !y) { if (cs.position === "fixed") return; continue; }
      }
      const r = el.getBoundingClientRect();
      const top = r.top - offY, bottom = r.bottom - offY, left = r.left - offX, right = r.right - offX;
      const box = doc ? { top: 0, bottom: innerHeight, left: 0, right: innerWidth } : p.getBoundingClientRect();
      const padY = Math.min(96, (box.bottom - box.top) * 0.2), padX = Math.min(64, (box.right - box.left) * 0.1);
      let dy = 0, dx = 0;
      if (sc.scrollHeight > sc.clientHeight + 1) {
        if (top < box.top + padY) dy = top - box.top - padY;
        else if (bottom > box.bottom - padY) dy = Math.min(bottom - box.bottom + padY, top - box.top - padY);
      }
      if (sc.scrollWidth > sc.clientWidth + 1) {
        if (left < box.left + padX) dx = left - box.left - padX;
        else if (right > box.right - padX) dx = right - box.right + padX;
      }
      if (dx || dy) (doc ? window : p).scrollBy({ left: dx, top: dy, behavior });
      offX += dx; offY += dy;
      if (doc || getComputedStyle(p).position === "fixed") return;
    }
  }

  // 右摇杆: 滚焦点所在的那一块 (没有就滚页面的主列表; 窄窗整页在滚就滚整页)
  function scrollLayer(dy, behavior = "auto") {
    (currentScroller() || window).scrollBy({ top: dy, behavior });
  }

  // ------------------------------------------------------------ 键盘
  addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const tgt = e.target;
    const typing = tgt instanceof HTMLElement && tgt.matches("input, textarea, select, [contenteditable]");
    const dir = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[e.key];
    if (dir) {
      if (typing) return;   // 输入框里的方向键归输入框 (数字框上下调数)
      e.preventDefault();
      setMode("key");
      move(dir);
    } else if (e.key === "Enter" || e.key === " ") {
      if (typing) return;
      setMode("key");
      const el = document.activeElement;
      // 按钮自己会响应回车 / 空格; 可点的行、头像要替它点
      if (el && el !== document.body && !el.matches("button, summary, a[href]")) {
        e.preventDefault();
        el.click();
      }
    } else if (e.key === "Escape" || (e.key === "Backspace" && !typing)) {
      e.preventDefault();
      sound("back");
      call("back");
    } else if ((e.key === "PageDown" || e.key === "PageUp") && !typing) {
      e.preventDefault();
      setMode("key");
      page(e.key === "PageDown" ? 1 : -1);
    } else if ((e.key === "Home" || e.key === "End") && !typing) {
      e.preventDefault();
      setMode("key");
      edge(e.key === "End" ? 1 : -1);
    } else if ((e.key === "q" || e.key === "e" || e.key === "Q" || e.key === "E") && !typing) {
      // Q / E = 手柄的 L1 / R1: 换标签 (主页换栏目)。PC 上的主机风格游戏都这么配
      e.preventDefault();
      setMode("key");
      call("shoulder", e.key.toLowerCase() === "q" ? -1 : 1);
    } else if ((e.key === "p" || e.key === "P") && !typing) {
      // P = 手柄的 R3 (按右摇杆): 开 / 关手机 (R-82)
      e.preventDefault();
      setMode("key");
      call("phone");
    } else if ((e.key === "x" || e.key === "y" || e.key === "X" || e.key === "Y") && !typing) {
      // X / Y = 手柄的 X / Y (PS 的 □ / △): 这一行 / 这一页的快捷操作 (R-80)
      e.preventDefault();
      setMode("key");
      call("face", e.key.toLowerCase());
    } else if (e.key === "Tab" && !typing) {
      setMode("key");
      if (call("view")) e.preventDefault();   // 主页: 打开 / 关上「全部栏目」(手柄 View 键); 别处照常走焦点
    } else if (e.key === "Tab") {
      setMode("key");
    }
  });

  // ------------------------------------------------------------ 手柄 (标准布局: 0 ✕/A, 1 ○/B, 2 □/X, 3 △/Y, 4 L1, 5 R1, 6 L2, 7 R2, 8 View / Create, 9 Options, 11 R3, 12-15 十字键, 16 PS 键)
  const DIRS = ["up", "down", "left", "right"];
  const DELAY = 360, RATE = 90;   // 按住方向: 360ms 后开始连发, 之后每 90ms 一格
  const PAGE_RATE = 240;          // 按住 L2 / R2: 一屏一屏往下翻
  const HOME_TAP = 450;           // Xbox / PS 键: 短按 (松开时不到这么久) = 回主页; 长按是服务那边切游戏用的, 这边不管
  const FOCUS_GRACE = 400;        // 窗口刚到前台这么久里「新按下」的键不算: 长按 Xbox 键切过来时那个键还按着
  const held = {}, nextAt = {}, downAt = {};
  let raf = 0;
  let focusAt = -Infinity;
  function read(gp) {
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    return {
      up: b(12) || y < -0.6, down: b(13) || y > 0.6, left: b(14) || x < -0.6, right: b(15) || x > 0.6,
      ok: b(0), back: b(1), x: b(2), y: b(3), l1: b(4), r1: b(5), l2: b(6), r2: b(7), view: b(8), menu: b(9), r3: b(11), home: b(16),
    };
  }
  function firstPad() {
    return [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((g) => g && g.connected) || null;
  }
  function poll(ts) {
    raf = requestAnimationFrame(poll);
    const gp = firstPad();
    if (!gp) return;
    const s = read(gp);
    // 窗口不在前台: 手柄是给游戏的。把按着的键都记成「一直按着」, 切回来时不会被当成新按下
    if (!document.hasFocus() || document.hidden) {
      for (const k in s) held[k] = s[k];
      return;
    }
    // 索尼的厂商号 054c; DS4 在 Windows 上叫 "Wireless Controller (...)", Xbox 手柄也有 "Xbox Wireless Controller", 所以只认开头
    const kind = /054c|dualsense|dualshock|playstation|^wireless controller/i.test(gp.id) ? "ps" : "xbox";
    if (kind !== padKind) { padKind = kind; call("input", mode); }
    for (const k in s) {
      if (!s[k]) {
        // Xbox / PS 键在松开时才算: 短按回主页, 按久了 (切游戏) 什么都不做
        if (k === "home" && held[k] && downAt[k] && ts - downAt[k] < HOME_TAP) press(k);
        held[k] = false;
        downAt[k] = 0;
        continue;
      }
      if (!held[k]) {
        held[k] = true;
        if (performance.now() - focusAt < FOCUS_GRACE) continue;
        downAt[k] = ts;
        nextAt[k] = ts + DELAY;
        if (k !== "home") press(k);
      } else if (DIRS.includes(k) && downAt[k] && ts >= nextAt[k]) {
        nextAt[k] = ts + RATE;
        press(k);
      } else if ((k === "l2" || k === "r2") && downAt[k] && ts >= nextAt[k]) {
        nextAt[k] = ts + PAGE_RATE;
        press(k);
      }
    }
    // 右摇杆上下: 连续滚动当前页 (长表格)
    const ry = gp.axes[3] || 0;
    if (Math.abs(ry) > 0.25) scrollLayer(Math.sign(ry) * (Math.abs(ry) - 0.25) * 30);
  }
  function press(k) {
    setMode("pad");
    const el = document.activeElement;
    if (DIRS.includes(k)) {
      // 滑动条 (修改器 R-61): 焦点在上面时左右直调, 上下移走; 可清空的在最小处再按左回到空
      if (el && el.matches('input[type="range"]') && (k === "left" || k === "right")) {
        if (el.dataset.edNull === "1") {
          if (k === "left" && Number(el.value) <= Number(el.min)) return;
          padStep(el, k === "right" ? 1 : -1);
          return;
        }
        if (k === "left" && el.dataset.edClearable === "1" && el.dataset.edNull !== "1" && Number(el.value) <= Number(el.min)) {
          el.dispatchEvent(new CustomEvent("ed-clear-range", { bubbles: true }));
          sound("back");
          return;
        }
        padStep(el, k === "right" ? 1 : -1);
        return;
      }
      // 手柄没法打字: 数字框里上下直接调数 (一格按 data-pad-step, 金额框一格一百万 / 十万, R-57), 左右照常走
      if (el && el.matches('input[type="number"]') && (k === "up" || k === "down")) {
        padStep(el, k === "up" ? 1 : -1);
        return;
      }
      return move(k);
    }
    if (k === "ok") {
      if (!el || el === document.body || !layerFn().contains(el)) return focusDefault(layerFn(), false);
      if (!el.matches("input") || el.matches('input[type="checkbox"], input[type="radio"]')) el.click();   // 勾选框按 A 勾 (R-57)
    } else if (k === "back") {
      sound("back");
      call("back");
    } else if (k === "x" || k === "y") {
      call("face", k);                  // R-80: 这一行 / 这一页的快捷操作
    } else if (k === "r3") {
      call("phone");                    // R-82: 按右摇杆开 / 关手机
    } else if (k === "l1" || k === "r1") {
      call("shoulder", k === "l1" ? -1 : 1);
    } else if (k === "l2" || k === "r2") {
      if (el && el.matches('input[type="number"], input[type="range"]')) return padStep(el, k === "l2" ? -10 : 10);   // 数字框 / 滑动条里 LT / RT 一次十格
      page(k === "l2" ? -1 : 1);
    } else if (k === "home") {
      call("home");
    } else if (k === "menu") {
      call("menu");
    } else if (k === "view") {
      call("view");                     // Xbox View / PS Create: 主页「全部栏目」
    }
  }
  // 数字框调 n 格: 一格 = data-pad-step (没有就 step), 守住 min / max, 小数位跟一格的一样
  function padStep(el, n) {
    const step = Number(el.dataset.padStep || el.step) || 1;
    const dec = (String(step).split(".")[1] || "").length;
    let v = (Number(el.value) || 0) + n * step;
    if (el.min !== "") v = Math.max(Number(el.min), v);
    if (el.max !== "") v = Math.min(Number(el.max), v);
    el.value = v.toFixed(Math.max(dec, (String(el.value).split(".")[1] || "").length));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    sound("move");
  }
  function startPad() {
    if (!raf) raf = requestAnimationFrame(poll);
  }
  addEventListener("gamepadconnected", startPad);
  // 窗口被切到前台 (多半是长按 Xbox 键从游戏切过来): 接着用手柄, 直接进手柄模式、把焦点放好
  addEventListener("focus", () => {
    focusAt = performance.now();
    if (!firstPad()) return;
    setMode("pad");
    const el = document.activeElement;
    if (!el || el === document.body) focusDefault(layerFn(), true);
  });
  addEventListener("gamepaddisconnected", () => {
    if (firstPad()) return;
    cancelAnimationFrame(raf);
    raf = 0;
    padKind = null;
    call("input", mode);
  });
  if (firstPad()) startPad();

  // ------------------------------------------------------------ 页面切换 (R-89: GSAP)
  // 旧页先拍一张「照片」: 把那一层整个复制一份 (去掉 id、不能点, 滚动位置、画布照抄) 盖在原处; 然后 update 改 DOM,
  // 新旧两层一起动: 进页 = 新页从右边推进来、旧页往左退一截并变暗 (Telegram 进聊天那种纵深); 返回反过来。
  // from = 被点的队徽 / 比分 / 头像, to() = 新页面里对应的元素: 复制一个飞过去, 落地时和真的交叉淡入淡出。
  // 没有 GSAP、减少动效、页面在后台: 直接改, 不做动画。上一次还没放完又切: 先让它一步放完 (收掉照片) 再拍
  let pageTl = null;
  const layerEl = () => {
    const m = document.getElementById("modal");
    return m && !m.hidden ? m : document.getElementById("app");
  };
  // 复制一份, 带上计算后的样式 (飞到 body 下面就没了原来的上下文, 大小、字体全靠这个)
  function lift(el) {
    const src = [el, ...el.querySelectorAll("*")].slice(0, 40);
    const copy = el.cloneNode(true);
    const dst = [copy, ...copy.querySelectorAll("*")];
    src.forEach((e, i) => {
      const c = dst[i], cs = getComputedStyle(e);
      for (const k of cs) c.style.setProperty(k, cs.getPropertyValue(k));
      c.removeAttribute("id");
    });
    return copy;
  }
  function snapshot(layer, z, backdrop) {
    const src = [layer, ...layer.querySelectorAll("*")];
    const copy = layer.cloneNode(true);
    const dst = [copy, ...copy.querySelectorAll("*")];
    const later = [];
    src.forEach((e, i) => {
      const c = dst[i];
      if (c.id) { c.dataset.gid = c.id; c.removeAttribute("id"); }
      if (e.scrollTop || e.scrollLeft) later.push(() => { c.scrollTop = e.scrollTop; c.scrollLeft = e.scrollLeft; });
      if (e.tagName === "CANVAS" && e.width && e.height) later.push(() => { try { c.getContext("2d").drawImage(e, 0, 0); } catch (err) { /* 画布读不了就空着 */ } });
      if (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT") { c.value = e.value; c.checked = e.checked; }
    });
    const r = layer.getBoundingClientRect();
    const wrap = document.createElement("div");
    wrap.className = "pg-ghost";
    wrap.setAttribute("aria-hidden", "true");
    wrap.inert = true;
    wrap.style.zIndex = z;
    if (backdrop) wrap.style.background = "var(--bg)";
    Object.assign(copy.style, { position: "absolute", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: layer.id === "modal" ? r.height + "px" : "auto", margin: "0" });
    copy.removeAttribute("hidden");
    wrap.appendChild(copy);
    document.body.appendChild(wrap);
    later.forEach((f) => f());
    return { wrap, copy };
  }
  function transition(update, { dir = "forward", from = null, to = null } = {}) {
    const G = window.gsap;
    if (pageTl) pageTl.progress(1);
    if (!G || reduced.matches || document.hidden) {
      update();
      return;
    }
    const fwd = dir !== "back";
    const old = layerEl();
    const src = from && from.isConnected && from.getClientRects().length ? from : null;
    const sr = src && src.getBoundingClientRect();
    const flyer = src && lift(src);
    if (src) src.dataset.morphSrc = "";
    // 进页: 照片垫在新页下面 (带底色, 挡住更底下的主页); 返回: 照片盖在上面往右滑走
    const { wrap, copy } = snapshot(old, fwd ? 9 : 11, fwd);
    if (src) {
      delete src.dataset.morphSrc;
      const twin = copy.querySelector("[data-morph-src]");
      if (twin) twin.style.visibility = "hidden";
    }
    update();
    const neo = layerEl();
    const target = flyer && to ? to() : null;
    const tr = target && target.getClientRects().length ? target.getBoundingClientRect() : null;
    const ease = "power3.out";
    const tl = G.timeline({
      onComplete() {
        wrap.remove();
        if (flyer) flyer.remove();
        G.set(neo, { clearProps: "transform,opacity,filter" });
        if (target) G.set(target, { clearProps: "opacity" });
        if (pageTl === tl) pageTl = null;
      },
    });
    pageTl = tl;
    if (fwd) {
      tl.to(copy, { xPercent: -12, autoAlpha: 0, filter: "brightness(.55)", duration: 0.28, ease }, 0);
      tl.fromTo(neo, { xPercent: 22, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.32, ease }, 0);
    } else {
      tl.to(copy, { xPercent: 22, autoAlpha: 0, duration: 0.24, ease }, 0);
      tl.fromTo(neo, { xPercent: -12, opacity: 0.4, filter: "brightness(.55)" }, { xPercent: 0, opacity: 1, filter: "brightness(1)", duration: 0.32, ease }, 0);
    }
    if (tr && sr.width && sr.height) {
      // 被点的东西飞到新页面里它的位置 (按新页落定后的位置算), 最后一小段和真的交叉淡入淡出
      Object.assign(flyer.style, { position: "fixed", left: sr.left + "px", top: sr.top + "px", margin: "0", zIndex: 12, pointerEvents: "none",
        transform: "none", transformOrigin: "0 0", animation: "none", transition: "none" });
      flyer.setAttribute("aria-hidden", "true");
      document.body.appendChild(flyer);
      tl.set(target, { opacity: 0 }, 0);
      tl.to(flyer, { x: tr.left - sr.left, y: tr.top - sr.top, scaleX: tr.width / sr.width, scaleY: tr.height / sr.height,
        duration: 0.46, ease: "expo.out" }, 0);
      tl.to(flyer, { opacity: 0, duration: 0.14 }, 0.32);
      tl.to(target, { opacity: 1, duration: 0.14 }, 0.32);
    }
  }

  window.UI = {
    on(h) { Object.assign(hooks, h); },
    layer(fn) { layerFn = fn; },
    focus,
    focusDefault,
    move,
    reveal,
    scrollLayer,
    prepScrollers,
    page,
    edge,
    sound,
    transition,
    get mode() { return mode; },
    get padKind() { return padKind; },
    get soundOn() { return soundOn; },
    setSound(on) {
      soundOn = !!on;
      try { localStorage.setItem("ml-sound", soundOn ? "on" : "off"); } catch (e) { /* 同上 */ }
      if (soundOn) sound("ok");
    },
    get reduced() { return reduced.matches; },
  };
})();
