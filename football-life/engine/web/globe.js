"use strict";
// 地球仪 (R-17): 点阵陆地 + 大气辉光 + 发光航线 + 锁定标记, Canvas 2D 现画, 不依赖库 (离线、打包版都能用)。
// 陆地来自 land.js 的 LAND (Natural Earth 1:50m, 0.25° 栅格); 颜色由 app.js 从 style.css 的变量读出来传进来。
//
//   const g = Globe.create(canvas, { colors, reduced, onFrame, bare });   // bare: 不画星空, 底透明 (放在面板里)
//   g.set({ lat, lon, dist });                 // 镜头: 看向哪个经纬度, 离球心几个半径; cy = 球心在画面上的高度 (0-1)
//   await g.flyTo({ lat, lon, dist }, 2000);   // 运镜 (方向走大圆, 距离单独缓动, hump = 中途拉远多少)
//   g.lock(lat, lon);  await g.arc(a, b, 1200);  g.project(lat, lon, alt) -> { x, y, visible } (CSS 像素)
//
// 相机: 看向点 T 时先绕 y 轴转 -经度、再绕 x 轴转纬度, T 落到 (0, 0, 1); 相机在 (0, 0, D), 透视投影。
// 单位球上 Z > 1/D 的点朝着相机 (地平线); 球在画面上的半径 = K / sqrt(D² - 1)。
(() => {
  const RAD = Math.PI / 180;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const EASE = {
    linear: (t) => t,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inQuart: (t) => t ** 4,
  };

  // ------------------------------------------------------------ 陆地栅格 (每行游程编码, 先海后陆)
  let mask = null, MW = 0, MH = 0;
  function landMask() {
    if (mask) return;
    const L = window.LAND;
    MW = L.w; MH = L.h;
    const bin = atob(L.rle);
    mask = new Uint8Array(MW * MH);
    let p = 0;
    for (let j = 0; j < MH; j++) {
      const row = j * MW;
      for (let i = 0, cur = 0; i < MW; cur ^= 1) {
        let n = 0, sh = 0, b;
        do { b = bin.charCodeAt(p++); n |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80);
        if (cur) mask.fill(1, row + i, row + i + n);
        i += n;
      }
    }
  }
  const isLand = (lat, lon) => {
    const j = clamp(Math.floor(((90 - lat) * MH) / 180), 0, MH - 1);
    const i = ((Math.floor(((lon + 180) * MW) / 360) % MW) + MW) % MW;
    return mask[j * MW + i] === 1;
  };

  // 点阵: 三档密度 (度), 远看用粗的, 推近换细的, 中间交叉淡变。每档一行一行排, 隔行错开半格 (蜂窝状)
  const STEPS = [1.2, 0.6, 0.3];
  const grids = {};
  function grid(step) {
    if (grids[step]) return grids[step];
    landMask();
    const xyz = [];
    const rows = Math.round(180 / step);
    for (let r = 0; r < rows; r++) {
      const lat = -90 + (r + 0.5) * step;
      const c = Math.cos(lat * RAD), y = Math.sin(lat * RAD);
      const n = Math.max(1, Math.round((360 * c) / step));
      const off = r % 2 ? 0.5 : 0;
      for (let k = 0; k < n; k++) {
        const lon = -180 + ((k + 0.5 + off) * 360) / n;
        if (isLand(lat, lon)) xyz.push(c * Math.sin(lon * RAD), y, c * Math.cos(lon * RAD));
      }
    }
    return (grids[step] = new Float32Array(xyz));
  }
  // 最细那档十几万个点, 第一次推近时现算会卡一帧: 空闲时先算好
  function prewarm() {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    STEPS.forEach((s, i) => idle(() => grid(s), { timeout: 1500 + i * 500 }));
  }

  const vec = (lat, lon) => {
    const c = Math.cos(lat * RAD);
    return [c * Math.sin(lon * RAD), Math.sin(lat * RAD), c * Math.cos(lon * RAD)];
  };
  const toLatLon = (v) => ({ lat: Math.asin(clamp(v[1], -1, 1)) / RAD, lon: Math.atan2(v[0], v[2]) / RAD });
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function slerp(a, b, t) {
    const d = clamp(dot3(a, b), -1, 1);
    const w = Math.acos(d);
    if (w < 1e-5) return a.slice();
    const s = Math.sin(w), k0 = Math.sin((1 - t) * w) / s, k1 = Math.sin(t * w) / s;
    return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
  }
  const angle = (a, b) => Math.acos(clamp(dot3(vec(a.lat, a.lon), vec(b.lat, b.lon)), -1, 1)) / RAD;
  const midpoint = (a, b) => toLatLon(norm(slerp(vec(a.lat, a.lon), vec(b.lat, b.lon), 0.5)));

  // oklch(...) / 任何 CSS 颜色 -> 带透明度的版本 (canvas 的 fillStyle 直接吃 oklch)
  const alpha = (c, a) => (c.startsWith("oklch(") && !c.includes("/") ? c.replace(/\)\s*$/, ` / ${a})`) : c);

  function create(canvas, opts = {}) {
    const ctx = canvas.getContext("2d");
    const C = Object.assign({ land: "oklch(0.93 0.012 70)", ocean: "oklch(0.16 0.02 260)", oceanHi: "oklch(0.24 0.03 255)",
      atmo: "oklch(0.8 0.06 250)", accent: "oklch(0.8 0.1 355)", space: "oklch(0.1 0.01 260)" }, opts.colors || {});
    const reduced = !!opts.reduced;
    let W = 0, H = 0, dpr = 1, stars = null;
    const cam = { lat: 20, lon: 0, dist: 3, cy: 0.5 };
    let tween = null, drift = 0, last = 0, raf = 0, dead = false;
    const locks = [];   // { v, t0, still, radius }
    const arcs = [];    // { pts, t0, dur, done }
    let view = null;    // 这一帧的投影参数, project() 用

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (w === W && h === H) return;
      W = canvas.width = w; H = canvas.height = h;
      stars = null;
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // 星空: 画一次存成离屏图, 每帧按镜头经度平移一点 (视差)
    function starfield() {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const g = c.getContext("2d");
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const n = Math.round((W * H) / (5200 * dpr * dpr));
      for (let i = 0; i < n; i++) {
        const big = rnd() < 0.06;
        g.globalAlpha = big ? 0.5 + rnd() * 0.4 : 0.12 + rnd() * 0.35;
        g.fillStyle = C.land;
        const r = (big ? 0.9 + rnd() * 0.7 : 0.4 + rnd() * 0.5) * dpr;
        g.beginPath();
        g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2);
        g.fill();
      }
      return c;
    }

    // 这一帧的旋转矩阵 (世界 -> 相机) 和投影参数
    function camera() {
      const p = cam.lat * RAD, l = cam.lon * RAD;
      const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
      const D = Math.max(1.004, cam.dist);
      const K = (Math.min(W, H) / 2) / Math.tan(15 * RAD);   // 竖直视角 30°
      return {
        m: [cl, 0, -sl, -sp * sl, cp, -sp * cl, cp * sl, sp, cp * cl],
        D, K, hz: 1 / D, cx: W / 2, cy: H * cam.cy, Rs: K / Math.sqrt(D * D - 1),
      };
    }
    // 世界坐标 (可以离地) -> 屏幕; 被球挡住的算看不见
    function proj(v, alt, V) {
      const x = v[0] * (1 + alt), y = v[1] * (1 + alt), z = v[2] * (1 + alt);
      const m = V.m;
      const X = m[0] * x + m[2] * z, Y = m[3] * x + m[4] * y + m[5] * z, Z = m[6] * x + m[7] * y + m[8] * z;
      const s = V.K / (V.D - Z);
      let visible = Z < V.D;
      if (visible) {
        // 相机 (0,0,D) 到这点的线段先碰到球就是被挡住了
        const dx = X, dy = Y, dz = Z - V.D;
        const a = dx * dx + dy * dy + dz * dz, b = 2 * V.D * dz, c = V.D * V.D - 1;
        const disc = b * b - 4 * a * c;
        if (disc > 0) {
          const t1 = (-b - Math.sqrt(disc)) / (2 * a);
          if (t1 > 0 && t1 < 0.9999) visible = false;
        }
      }
      return { x: V.cx + X * s, y: V.cy - Y * s, s, Z, visible };
    }

    function drawSphere(V) {
      const { cx, cy, Rs } = V;
      // 海: 左上方来光, 中心略亮
      const g = ctx.createRadialGradient(cx - Rs * 0.35, cy - Rs * 0.4, Rs * 0.05, cx, cy, Rs);
      g.addColorStop(0, C.oceanHi);
      g.addColorStop(1, C.ocean);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, Rs, 0, Math.PI * 2);
      ctx.fill();
    }
    function drawAtmosphere(V) {
      const { cx, cy, Rs } = V;
      // 推得很近时球的边缘整个在画面外, 这两层光也全在外面: 不画 (不然每帧白填两遍整屏渐变)
      if (Rs * 0.86 > Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))) return;
      ctx.globalCompositeOperation = "lighter";
      const rim = ctx.createRadialGradient(cx, cy, Rs * 0.86, cx, cy, Rs);
      rim.addColorStop(0, alpha(C.atmo, 0));
      rim.addColorStop(1, alpha(C.atmo, 0.22));
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(cx, cy, Rs, 0, Math.PI * 2);
      ctx.fill();
      const halo = ctx.createRadialGradient(cx, cy, Rs * 0.995, cx, cy, Rs * 1.22);
      halo.addColorStop(0, alpha(C.atmo, 0.3));
      halo.addColorStop(0.35, alpha(C.atmo, 0.08));
      halo.addColorStop(1, alpha(C.atmo, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, Rs * 1.22, 0, Math.PI * 2);
      ctx.arc(cx, cy, Rs * 0.995, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }

    // 经纬网: 每 15° 一条, 只画朝着相机的那半
    function drawGraticule(V) {
      ctx.strokeStyle = alpha(C.land, 0.07);
      ctx.lineWidth = dpr;
      ctx.beginPath();
      const line = (fn, n) => {
        let pen = false;
        for (let i = 0; i <= n; i++) {
          const q = proj(fn(i / n), 0, V);
          if (q.Z > V.hz) { pen ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); pen = true; } else pen = false;
        }
      };
      for (let lon = -180; lon < 180; lon += 15) line((t) => vec(-80 + 160 * t, lon), 64);
      for (let lat = -75; lat <= 75; lat += 15) line((t) => vec(lat, -180 + 360 * t), 144);
      ctx.stroke();
    }

    // 点阵陆地: 按亮度分 8 桶, 每桶一个 Path2D 一次填完 (几万个点一帧几毫秒)
    const LIGHT = norm([-0.45, 0.55, 0.7]);
    function drawDots(pts, fade, step, V, now) {
      if (fade <= 0.01) return;
      const { m, D, K, hz, cx, cy } = V;
      const NB = 8, HB = 4;
      const paths = Array.from({ length: NB }, () => new Path2D());
      const hot = Array.from({ length: HB }, () => new Path2D());
      const world = step * RAD * 0.19;   // 点的半径 (世界单位): 格距的五分之一左右
      const minR = 0.55 * dpr, maxR = 4.2 * dpr;
      const hl = locks.map((L) => ({ v: L.v, cos: Math.cos(L.radius * RAD), front: L.still ? L.radius : L.radius * EASE.outQuart(clamp((now - L.t0) / 900, 0, 1)), R: L.radius }));
      for (let i = 0, n = pts.length; i < n; i += 3) {
        const x = pts[i], y = pts[i + 1], z = pts[i + 2];
        const Z = m[6] * x + m[7] * y + m[8] * z;
        if (Z <= hz) continue;
        const s = K / (D - Z);
        const X = m[0] * x + m[2] * z, Y = m[3] * x + m[4] * y + m[5] * z;
        const sx = cx + X * s, sy = cy - Y * s;
        if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue;
        const r = clamp(world * s, minR, maxR);
        // 亮度: 边缘暗 (地平线附近) × 朝光面亮
        const limb = (Z - hz) / (1 - hz);
        const lit = 0.4 + 0.6 * Math.max(0, X * LIGHT[0] + Y * LIGHT[1] + Z * LIGHT[2]);
        let heat = 0;
        for (const h of hl) {
          const d = x * h.v[0] + y * h.v[1] + z * h.v[2];
          if (d <= h.cos) continue;
          const th = Math.acos(Math.min(1, d)) / RAD;
          if (th > h.front) continue;
          const band = Math.exp(-(((th - h.front) / 0.45) ** 2)) * (h.front < h.R ? 1 : 0);   // 锁定时一圈光往外扩
          heat = Math.max(heat, (1 - th / h.R) ** 1.3 * 0.85 + band * 0.6);
        }
        const p = heat > 0.08 ? hot[Math.min(HB - 1, (heat * HB) | 0)] : paths[Math.min(NB - 1, (Math.sqrt(limb) * lit * NB) | 0)];
        if (r < 1.4 * dpr) p.rect(sx - r, sy - r, 2 * r, 2 * r);
        else { p.moveTo(sx + r, sy); p.arc(sx, sy, r, 0, Math.PI * 2); }
      }
      ctx.fillStyle = C.land;
      for (let b = 0; b < NB; b++) {
        ctx.globalAlpha = fade * (0.14 + 0.86 * ((b + 0.5) / NB));
        ctx.fill(paths[b]);
      }
      ctx.fillStyle = C.accent;
      for (let b = 0; b < HB; b++) {
        ctx.globalAlpha = fade * (0.5 + 0.5 * ((b + 0.5) / HB));
        ctx.fill(hot[b]);
      }
      ctx.globalAlpha = 1;
    }

    // 地面上的一个圈 (球面上等距的一圈点投影过来, 所以离边缘近会被压扁, 有立体感)
    function ringPath(v, radius, V) {
      const u = norm(cross(v, Math.abs(v[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0])), w = cross(v, u);
      const cr = Math.cos(radius * RAD), sr = Math.sin(radius * RAD);
      const path = new Path2D();
      let pen = false, any = false;
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const p = [v[0] * cr + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * sr, v[1] * cr + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * sr, v[2] * cr + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * sr];
        const q = proj(p, 0.001, V);
        if (q.Z > V.hz) { pen ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y); pen = any = true; } else pen = false;
      }
      return any ? path : null;
    }
    function drawLocks(V, now) {
      ctx.globalCompositeOperation = "lighter";
      for (const L of locks) {
        const k = L.still ? 1 : clamp((now - L.t0) / 500, 0, 1);
        // 准星: 一圈虚线慢慢转, 锁定时从大收到小
        const rr = L.ring * (1 + 1.6 * (1 - EASE.outExpo(k)));
        const ring = ringPath(L.v, rr, V);
        if (ring) {
          ctx.strokeStyle = alpha(C.accent, 0.9 * k);
          ctx.lineWidth = 1.6 * dpr;
          ctx.setLineDash([7 * dpr, 5 * dpr]);
          ctx.lineDashOffset = reduced ? 0 : -now / 60;
          ctx.stroke(ring);
          ctx.setLineDash([]);
        }
        // 往外扩的三道波纹
        if (!L.still) {
          for (let i = 0; i < 3; i++) {
            const t = (now - L.t0 - i * 260) / 1400;
            if (t <= 0 || t >= 1) continue;
            const wave = ringPath(L.v, L.ring + L.radius * 1.3 * EASE.outQuart(t), V);
            if (!wave) continue;
            ctx.strokeStyle = alpha(C.accent, 0.55 * (1 - t));
            ctx.lineWidth = 1.2 * dpr;
            ctx.stroke(wave);
          }
        }
        // 光柱: 从地面往上
        const a = proj(L.v, 0, V), b = proj(L.v, 0.06 * k, V);
        if (a.visible) {
          const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          g.addColorStop(0, alpha(C.accent, 0.95));
          g.addColorStop(1, alpha(C.accent, 0));
          ctx.strokeStyle = g;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          const glow = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 14 * dpr);
          glow.addColorStop(0, alpha(C.accent, 0.9 * k));
          glow.addColorStop(1, alpha(C.accent, 0));
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(a.x, a.y, 14 * dpr, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // 航线: 大圆弧抬离地面 (越远抬越高), 头部一颗亮点拖着尾巴画过去; 画完留一条淡线, 上面有光点来回流
    function drawArcs(V, now) {
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (const A of arcs) {
        const p = A.dur ? EASE.inOutCubic(clamp((now - A.t0) / A.dur, 0, 1)) : 1;
        const N = A.pts.length - 1, head = p * N;
        const q = A.pts.map((v, i) => (i <= head + 1 ? proj(v, A.lift[i], V) : null));
        for (let i = 0; i < Math.min(N, Math.ceil(head)); i++) {
          const a = q[i], b = q[i + 1];
          if (!a || !b || !a.visible || !b.visible) continue;
          const t = i / Math.max(1, head);   // 0 尾 -> 1 头
          const tail = p < 1 ? 0.25 + 0.75 * t : 0.55;
          ctx.strokeStyle = alpha(C.accent, 0.16 * tail);
          ctx.lineWidth = 7 * dpr;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.strokeStyle = alpha(C.accent, 0.95 * tail);
          ctx.lineWidth = 1.7 * dpr;
          ctx.stroke();
        }
        // 亮点: 画的时候在头上, 画完之后沿线流动
        const at = p < 1 ? head : reduced ? -1 : (((now - A.t0 - A.dur) / 1800) % 1) * N;
        if (at >= 0) {
          const i = Math.min(N - 1, Math.floor(at)), f = at - i;
          const a = proj(A.pts[i], A.lift[i], V), b = proj(A.pts[i + 1], A.lift[i + 1], V);
          if (a.visible) {
            const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
            const g = ctx.createRadialGradient(x, y, 0, x, y, 16 * dpr);
            g.addColorStop(0, alpha(C.land, 0.95));
            g.addColorStop(0.25, alpha(C.accent, 0.6));
            g.addColorStop(1, alpha(C.accent, 0));
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(x, y, 16 * dpr, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }

    function step(now) {
      if (tween) {
        const k = clamp((now - tween.t0) / tween.ms, 0, 1);
        const er = tween.rot(k), ed = tween.dist(k);
        Object.assign(cam, toLatLon(slerp(tween.from.v, tween.to.v, er)));
        cam.dist = tween.from.dist + (tween.to.dist - tween.from.dist) * ed + tween.hump * Math.sin(Math.PI * ed);
        cam.cy = tween.from.cy + (tween.to.cy - tween.from.cy) * ed;
        if (k >= 1) { const t = tween; tween = null; t.done(); }
      } else if (drift && last) {
        cam.lon += drift * ((now - last) / 1000);
      }
      last = now;
    }

    function frame(now) {
      raf = 0;
      if (dead || !canvas.isConnected) return destroy();
      raf = requestAnimationFrame(frame);
      if (!W || !H) return;
      step(now);
      const V = camera();
      view = V;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (opts.bare) {
        ctx.clearRect(0, 0, W, H);
      } else {
        ctx.fillStyle = C.space;
        ctx.fillRect(0, 0, W, H);
        if (!stars) stars = starfield();
        const sx = (((-cam.lon * 3 * dpr) % W) + W) % W, sy = (((cam.lat * 1.5 * dpr) % H) + H) % H;
        ctx.globalAlpha = clamp((V.D - 1.15) / 1.2, 0.25, 1);
        ctx.drawImage(stars, sx - W, sy); ctx.drawImage(stars, sx, sy);
        ctx.drawImage(stars, sx - W, sy - H); ctx.drawImage(stars, sx, sy - H);
        ctx.globalAlpha = 1;
      }
      drawSphere(V);
      drawGraticule(V);
      // 选密度档: 让画面中心的点距落在 6 CSS 像素以上; 跨档时两档交叉淡变
      const pxPerDeg = (V.K / (V.D - 1)) * RAD;
      const L = clamp(Math.log2((pxPerDeg * STEPS[0]) / (6.5 * dpr)), 0, STEPS.length - 1);
      const lo = Math.floor(L), frac = L - lo, blend = lo < STEPS.length - 1 ? clamp((frac - 0.65) / 0.35, 0, 1) : 0;
      drawDots(grid(STEPS[lo]), 1 - blend, STEPS[lo], V, now);
      if (blend > 0) drawDots(grid(STEPS[lo + 1]), blend, STEPS[lo + 1], V, now);
      drawAtmosphere(V);
      drawArcs(V, now);
      drawLocks(V, now);
      if (opts.onFrame) opts.onFrame(api);
    }

    function destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      if (tween) { const t = tween; tween = null; t.done(); }
    }

    const api = {
      set(v) {
        tween = null;
        Object.assign(cam, v);
      },
      get cam() { return { ...cam }; },
      // 运镜。ms = 0 或减少动效: 直接到位
      flyTo(to, ms = 1600, o = {}) {
        if (tween) { const t = tween; tween = null; t.done(); }
        const target = { lat: to.lat ?? cam.lat, lon: to.lon ?? cam.lon, dist: to.dist ?? cam.dist, cy: to.cy ?? cam.cy };
        if (!ms || reduced || dead) { Object.assign(cam, target); return Promise.resolve(); }
        return new Promise((done) => {
          tween = { t0: performance.now(), ms, done, hump: o.hump || 0,
            rot: EASE[o.rot] || EASE.inOutCubic, dist: EASE[o.dist] || EASE.inOutCubic,
            from: { v: vec(cam.lat, cam.lon), dist: cam.dist, cy: cam.cy },
            to: { v: vec(target.lat, target.lon), dist: target.dist, cy: target.cy } };
        });
      },
      drift(degPerSec) { drift = reduced ? 0 : degPerSec; },
      // 锁定: 那一片陆地的点亮成强调色 (一圈光往外扩), 准星收拢, 地面立起光柱
      lock(lat, lon, o = {}) {
        const L = { v: vec(lat, lon), lat, lon, t0: performance.now(), still: reduced || !!o.still, radius: o.radius || 5, ring: o.ring || 1.4 };
        locks.push(L);
        return L;
      },
      clearLocks() { locks.length = 0; },
      arc(a, b, ms = 1200) {
        const A = vec(a.lat, a.lon), B = vec(b.lat, b.lon);
        const span = Math.acos(clamp(dot3(A, B), -1, 1));
        const N = 64, pts = [], lift = [];
        for (let i = 0; i <= N; i++) {
          pts.push(norm(slerp(A, B, i / N)));
          lift.push((0.02 + span * 0.12) * Math.sin((Math.PI * i) / N));
        }
        const arc = { pts, lift, t0: performance.now(), dur: reduced ? 0 : ms };
        arcs.push(arc);
        return new Promise((r) => (arc.dur ? setTimeout(r, ms) : r()));
      },
      clearArcs() { arcs.length = 0; },
      // 经纬度 (+ 离地高度, 单位 = 地球半径) -> CSS 像素; 在球背面或被挡住时 visible = false
      project(lat, lon, alt = 0) {
        if (!view) return { x: 0, y: 0, visible: false };
        const q = proj(vec(lat, lon), alt, view);
        return { x: q.x / dpr, y: q.y / dpr, visible: q.visible };
      },
      // 镜头看向 at (球心高度 cy) 时, 让 points 都落进 box (画面比例 {x0, x1, y0, y1}) 的最近距离: 拿真投影二分
      fit(at, points, box, cy = cam.cy) {
        const save = { ...cam };
        const inside = (D) => {
          Object.assign(cam, { lat: at.lat, lon: at.lon, dist: D, cy });
          const V = camera();
          return points.every((p) => {
            const q = proj(vec(p.lat, p.lon), 0, V);
            return q.visible && q.x >= box.x0 * W && q.x <= box.x1 * W && q.y >= box.y0 * H && q.y <= box.y1 * H;
          });
        };
        let lo = 1.05, hi = 8;
        if (inside(hi)) {
          for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inside(mid)) hi = mid; else lo = mid; }
        }
        Object.assign(cam, save);
        return hi;
      },
      destroy,
    };
    raf = requestAnimationFrame(frame);
    return api;
  }

  window.Globe = { create, prewarm, angle, midpoint };
})();
