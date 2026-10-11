"use strict";
// 动态球员卡 (R-19)。游戏的卡面是几层叠出来的: 背景、特效视频、边框、人、光点、签名、外框光。
// 服务端给出每一层的图 / 视频和混合方式 (/api/card/<球员>), 这里用 CSS mix-blend-mode 现场叠:
// 和 playercard.card 用 numpy 逐帧合成 MP4 是同一个公式 (滤色 1-(1-底)(1-层)), 只是不用等服务端合成几秒。
//
// 游戏文件里没有视频层的卡 (Selection、POTS…) 用我们自己的镭射扫光, 背景图慢慢左右平移 (R-98, 游戏的卡正面材质这么动);
// 连卡面都没有的头像卡掠过一道高光。
//
// 用法全是声明式的, app.js 只管写 HTML: <div class="gcard" data-card="球员或卡的 PID" data-live="...">
//   data-live="always"  放进页面就动 (领奖台、展台看得见的几张、球员页)
//   data-live="hover"   鼠标指着 / 焦点在上面时动
//   data-live="off"     不动 (展台转到背后的卡)
// 卡被移出页面、改成 off 就停下并放掉视频解码器; 窗口到后台 (切去踢游戏) 时全部暂停, 不和游戏抢显卡。
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let info = new Map();     // data-card -> Promise<{vid, animated, layers} | null>
  const awake = new Set();  // 正在动 (或正在准备动) 的 .gcard

  function fetchInfo(id) {
    if (!info.has(id)) {
      info.set(id, fetch("/api/card/" + id).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    }
    return info.get(id);
  }

  const ready = (m) => new Promise((res) => {
    if (m.tagName === "VIDEO") {
      if (m.readyState >= 3) return res();
      m.addEventListener("canplaythrough", res, { once: true });
      m.addEventListener("error", res, { once: true });
    } else if (m.complete) {
      res();
    } else {
      m.addEventListener("load", res, { once: true });
      m.addEventListener("error", res, { once: true });
    }
  });

  const video = (url) => Object.assign(document.createElement("video"), { muted: true, loop: true, playsInline: true, preload: "auto", src: url });
  const div = (cls) => Object.assign(document.createElement("div"), { className: cls });

  async function wake(el) {
    if (awake.has(el) || reduced.matches) return;
    awake.add(el);
    const c = await fetchInfo(el.dataset.card);
    if (!awake.has(el) || !el.isConnected) {
      awake.delete(el);
      return;
    }
    // 几张卡的扫光别一起走: 每张随机错开 (扫光和高光共用这个延迟, 一起过)
    const at = `${(-Math.random() * 6).toFixed(2)}s`;
    if (!c || !c.vid || !c.layers) {          // 头像卡 (没有卡面素材): 只有一道掠过的高光
      const g = div("gcard-gloss solo");
      g.style.setProperty("--foil-at", at);
      const face = el.querySelector(".gcard-face");
      (face ? face.after(g) : el.prepend(g));
      return;
    }
    const live = div("gcard-live");
    live.setAttribute("aria-hidden", "true");
    // 没有视频层的卡 (Selection、POTS…): 我们自己的镭射扫光。纹理是游戏的 FoilEffect, 插在人那一层下面,
    // 只刷过背景和边框, 不刷到人身上; 最上面再掠过一道很淡的高光
    const foiled = !c.animated;
    if (foiled) {
      live.classList.add("foiled");
      live.style.setProperty("--foil-at", at);
      live.style.setProperty("--pan-at", `${(-Math.random() * 16).toFixed(2)}s`);
    }
    // 静态背景的卡, 游戏里整张背景图慢慢左右平移 (卡正面材质算的, 文件里没有, 用户 2026-10-04 看游戏确认)。
    // 只移背景 f01; 人画在 f01 里的新周最佳 (没有单独的人那层) 不移, 不然人也跟着晃
    const pan = foiled && c.layers.some((l) => l.layer === "PLAYER");
    for (const l of c.layers) {
      if (foiled && l.layer === "PLAYER") {
        const f = div("gcard-foil");
        if (c.foil) f.appendChild(video(c.foil));
        live.appendChild(f);
      }
      const m = l.video ? video(l.url) : Object.assign(document.createElement("img"), { alt: "", src: l.url });
      if (l.screen) m.className = "screen";
      if (pan && l.layer === "f01" && !l.video) m.classList.add("gcard-pan");
      live.appendChild(m);
    }
    if (foiled) live.appendChild(div("gcard-gloss"));
    const media = [...live.querySelectorAll("img, video")];
    // 先在屏幕外把每层都载好, 再一起从第 0 帧开始放, 盖到静态卡上淡入 (换的那一下看不出来)
    await Promise.all(media.map(ready));
    if (!awake.has(el) || !el.isConnected) return drop(live);
    const still = el.querySelector(".gcard-still");
    (still ? still.after(live) : el.prepend(live));
    const run = !document.hidden && document.hasFocus();
    for (const m of media) {
      if (m.tagName !== "VIDEO") continue;
      m.currentTime = 0;
      if (run) m.play().catch(() => {});
    }
    requestAnimationFrame(() => live.classList.add("on"));
  }

  function sleep(el) {
    if (!awake.delete(el)) return;
    el.querySelectorAll(".gcard-gloss.solo").forEach((g) => g.remove());
    const live = el.querySelector(".gcard-live");
    if (!live) return;
    live.classList.remove("on");
    setTimeout(() => { if (!awake.has(el)) drop(live); }, 400);
  }

  function drop(live) {
    live.querySelectorAll("video").forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();   // 放掉解码器
    });
    live.remove();
  }

  // 按 data-live 决定动不动。hovering: 指着 / 焦点在上面的那张
  let hovering = null;
  function sync(el) {
    const want = el.isConnected && (el.dataset.live === "always" || (el.dataset.live === "hover" && hovering === el));
    if (want) wake(el);
    else sleep(el);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches(".gcard[data-live]")) sync(root);
    root.querySelectorAll(".gcard[data-live='always']").forEach(sync);
  }

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") sync(r.target);
      else r.addedNodes.forEach(scan);
    }
    for (const el of awake) if (!el.isConnected) sleep(el);   // 被移出页面的
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-live"] });

  function point(el) {
    if (el === hovering) return;
    const was = hovering;
    hovering = el;
    if (was) sync(was);
    if (el) sync(el);
  }
  const cardAt = (t) => (t && t.closest ? t.closest(".gcard[data-live]") : null);
  addEventListener("pointerover", (e) => point(cardAt(e.target)), { passive: true });
  addEventListener("focusin", (e) => point(cardAt(e.target)));
  document.addEventListener("pointerleave", () => point(null));

  // 窗口到后台 (在踢游戏) 就停, 回来接着放。扫光是 CSS 动画, 靠根上的 .cards-paused 停
  function playAll(on) {
    document.documentElement.classList.toggle("cards-paused", !on);
    for (const el of awake) {
      el.querySelectorAll(".gcard-live video").forEach((v) => (on ? v.play().catch(() => {}) : v.pause()));
    }
  }
  addEventListener("blur", () => playAll(false));
  addEventListener("focus", () => playAll(true));
  document.addEventListener("visibilitychange", () => playAll(!document.hidden && document.hasFocus()));
  reduced.addEventListener("change", () => { if (reduced.matches) [...awake].forEach(sleep); });

  window.Cards = {
    // 换了资源包: 卡面和分层都可能变了, 下次按新的取
    reset() { info = new Map(); },
  };
})();
