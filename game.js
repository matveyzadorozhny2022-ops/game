(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const hitCanvas = document.createElement('canvas');
  const hitCtx = hitCanvas.getContext('2d');

  const menu = document.getElementById('menu');
  const gameScreen = document.getElementById('gameScreen');
  const resultModal = document.getElementById('resultModal');
  const stakeOptions = document.getElementById('stakeOptions');
  const starTemplate = document.getElementById('starIconTemplate');
  const joystick = document.getElementById('joystick');
  const joystickKnob = document.getElementById('joystickKnob');

  const ui = {
    selectedStakeLabel: document.getElementById('selectedStakeLabel'),
    fundValue: document.getElementById('fundValue'),
    prizeValue: document.getElementById('prizeValue'),
    feeValue: document.getElementById('feeValue'),
    menuBalanceValue: document.getElementById('menuBalanceValue'),
    hudBalance: document.getElementById('hudBalance'),
    hudFund: document.getElementById('hudFund'),
    hudPrize: document.getElementById('hudPrize'),
    territoryLabel: document.getElementById('territoryLabel'),
    captureProgress: document.getElementById('captureProgress'),
    scoreRows: document.getElementById('scoreRows'),
    countdown: document.getElementById('countdown'),
    resultTitle: document.getElementById('resultTitle'),
    resultText: document.getElementById('resultText'),
    resultKicker: document.getElementById('resultKicker'),
    resultPrizeLabel: document.getElementById('resultPrizeLabel'),
    resultPrize: document.getElementById('resultPrize'),
    startButton: document.getElementById('startButton'),
    startError: document.getElementById('startError'),
    pauseButton: document.getElementById('pauseButton'),
    restartButton: document.getElementById('restartButton'),
    matchTimer: document.getElementById('matchTimer'),
    playAgainButton: document.getElementById('playAgainButton'),
    backToMenuButton: document.getElementById('backToMenuButton')
  };

  const START_BALANCE = 100;
  const PLAYER_COUNT = 5;
  const STAKES = [10, 25, 50, 100];
  const WORLD = { w: 2400, h: 3600 };
  const WIN_PERCENT = 92;
  const MATCH_SECONDS = 300;
  const SAMPLE_COLS = 46;
  const SAMPLE_ROWS = 70;
  const palette = ['#12b8ff', '#ff4e95', '#ffb600', '#26d95b', '#935cff'];
  const names = ['Ты', 'Nova', 'Blitz', 'Vega', 'Ghost'];
  const SKIN_ASSET_LIMIT = 40;
  const startPoints = [
    { x: WORLD.w * 0.50, y: WORLD.h * 0.60, vx: 0, vy: -1 },
    { x: WORLD.w * 0.18, y: WORLD.h * 0.17, vx: 1, vy: 0.35 },
    { x: WORLD.w * 0.82, y: WORLD.h * 0.18, vx: -1, vy: 0.25 },
    { x: WORLD.w * 0.20, y: WORLD.h * 0.84, vx: 1, vy: -0.45 },
    { x: WORLD.w * 0.80, y: WORLD.h * 0.82, vx: -1, vy: -0.35 }
  ];

  let selectedStake = STAKES[0];
  let balance = START_BALANCE;
  let players = [];
  let shapes = [];
  let particles = [];
  let skinAssets = [];
  let skinLoadPromise = null;
  let rafId = 0;
  let lastTime = 0;
  let scoreTimer = 0;
  let lastCameraZoom = 1;
  let camera = { x: 0, y: 0, cx: WORLD.w / 2, cy: WORLD.h / 2, w: 800, h: 1200, scale: 1 };
  let game = {
    running: false,
    paused: true,
    ended: false,
    countdownActive: false,
    matchId: 0,
    stakeCharged: false,
    timeLeft: MATCH_SECONDS
  };

  const input = {
    vector: { x: 0, y: -1 },
    active: false,
    keys: new Set(),
    pointerId: null
  };

  function resetBalanceForPageLoad() {
    balance = START_BALANCE;
  }

  function saveBalance() {
    // Пока это демо без сохранений: баланс живёт только в текущей сессии страницы.
    // При каждой перезагрузке init() снова выставляет START_BALANCE = 100.
    balance = Math.max(0, Math.round(balance));
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function distXY(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function normalize(x, y) {
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }
  function angleNorm(x, y) { return Math.atan2(y, x); }
  function rand(min, max) { return min + Math.random() * (max - min); }


  function localAssetUrl(path) {
    return new URL(String(path || '').replace(/^\.\//, ''), document.baseURI).href;
  }

  function preloadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function loadSkinAssets() {
    if (skinLoadPromise) return skinLoadPromise;
    const jobs = [];
    for (let i = 1; i <= SKIN_ASSET_LIMIT; i += 1) {
      const name = `skin${i}.png`;
      const src = localAssetUrl(`assets/${name}`);
      jobs.push(preloadImage(src).then((img) => img ? { name, src, img } : null));
    }
    skinLoadPromise = Promise.all(jobs).then((items) => {
      skinAssets = items.filter(Boolean);
      assignRandomSkins(false);
      updateScores(true);
      draw();
      return skinAssets;
    });
    return skinLoadPromise;
  }

  function pickRandomSkin(used = new Set()) {
    if (!skinAssets.length) return null;
    const unused = skinAssets.filter((skin) => !used.has(skin.name));
    const pool = unused.length ? unused : skinAssets;
    const skin = pool[Math.floor(Math.random() * pool.length)] || null;
    if (skin) used.add(skin.name);
    return skin;
  }

  function assignRandomSkins(force = true) {
    if (!players.length || !skinAssets.length) return;
    const used = new Set();
    for (const player of players) {
      if (!force && player.skin) {
        used.add(player.skin.name);
        continue;
      }
      player.skin = pickRandomSkin(used);
    }
  }

  function withAlpha(hex, alpha) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function cloneStarIcon() {
    return starTemplate.content.firstElementChild.cloneNode(true);
  }

  function injectInlineStars() {
    document.querySelectorAll('.star-inline').forEach((slot) => {
      slot.innerHTML = '';
      slot.appendChild(cloneStarIcon());
    });
  }

  function getPrizeMath() {
    const fund = selectedStake * PLAYER_COUNT;
    const prize = Math.floor(fund * 0.9);
    const fee = fund - prize;
    return { fund, prize, fee };
  }

  function updateMoneyUI() {
    const { fund, prize, fee } = getPrizeMath();
    ui.selectedStakeLabel.textContent = selectedStake;
    ui.fundValue.textContent = fund;
    ui.prizeValue.textContent = prize;
    ui.feeValue.textContent = fee;
    ui.menuBalanceValue.textContent = balance;
    ui.hudBalance.textContent = balance;
    ui.hudFund.textContent = fund;
    ui.hudPrize.textContent = prize;
    ui.resultPrize.textContent = prize;

    const canPlay = balance >= selectedStake;
    ui.startButton.disabled = !canPlay;
    ui.startButton.innerHTML = canPlay ? 'Начать играть <span>→</span>' : 'Не хватает звёзд';
    ui.startError.classList.toggle('danger', !canPlay);
    ui.startError.textContent = canPlay ? 'Тестовый режим · стартовый баланс 100' : `Нужно ${selectedStake} звёзд, на балансе ${balance}`;
  }


  function formatTime(totalSeconds) {
    const safe = Math.max(0, Math.ceil(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function updateTimerUI() {
    if (ui.matchTimer) ui.matchTimer.textContent = formatTime(game.timeLeft ?? MATCH_SECONDS);
  }

  function buildStakeButtons() {
    stakeOptions.innerHTML = '';
    STAKES.forEach((value) => {
      const button = document.createElement('button');
      button.className = `stake-button${value === selectedStake ? ' active' : ''}`;
      button.type = 'button';
      button.setAttribute('aria-pressed', value === selectedStake ? 'true' : 'false');
      button.append(document.createTextNode(value), cloneStarIcon());
      button.addEventListener('click', () => {
        selectedStake = value;
        buildStakeButtons();
        updateMoneyUI();
      });
      stakeOptions.appendChild(button);
    });
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    const vertical = height >= width;
    const visibleW = vertical ? 780 : 1180;
    const visibleH = visibleW * (height / width);
    camera.w = visibleW;
    camera.h = visibleH;
    camera.scale = width / visibleW;
    lastCameraZoom = camera.scale;
    updateCamera(1);
  }

  function makeCirclePath(x, y, r) {
    const path = new Path2D();
    path.arc(x, y, r, 0, Math.PI * 2);
    return path;
  }

  function makePolyPath(points) {
    const path = new Path2D();
    if (!points.length) return path;
    path.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      path.lineTo(p.x, p.y);
    }
    path.closePath();
    return path;
  }

  function makeStrokePath(points, width) {
    const path = new Path2D();
    if (!points.length) return path;
    if (points.length === 1) {
      path.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      return path;
    }
    const radius = width / 2;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * radius;
      const ny = dx / len * radius;
      const seg = new Path2D();
      seg.moveTo(a.x + nx, a.y + ny);
      seg.lineTo(b.x + nx, b.y + ny);
      seg.lineTo(b.x - nx, b.y - ny);
      seg.lineTo(a.x - nx, a.y - ny);
      seg.closePath();
      path.addPath(seg);
    }
    for (const p of points) {
      path.moveTo(p.x + radius, p.y);
      path.arc(p.x, p.y, radius, 0, Math.PI * 2);
    }
    return path;
  }

  function polygonArea(points) {
    if (points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  function addShape(owner, kind, data) {
    let path;
    let area;
    let center;
    if (kind === 'circle') {
      path = makeCirclePath(data.x, data.y, data.r);
      area = Math.PI * data.r * data.r;
      center = { x: data.x, y: data.y };
    } else if (kind === 'trailConnector') {
      path = makeStrokePath(data.points, data.width || 60);
      area = Math.max(1, data.points.length - 1) * (data.width || 60) * 28;
      center = data.points.reduce((acc, p) => ({ x: acc.x + p.x / data.points.length, y: acc.y + p.y / data.points.length }), { x: 0, y: 0 });
    } else {
      path = makePolyPath(data.points);
      area = polygonArea(data.points);
      center = data.points.reduce((acc, p) => ({ x: acc.x + p.x / data.points.length, y: acc.y + p.y / data.points.length }), { x: 0, y: 0 });
    }
    const shape = { owner, kind, path, area, center, born: performance.now() };
    shapes.push(shape);
    const player = players[owner];
    if (player && kind !== 'trailConnector') player.home = center;
    return shape;
  }

  function pointShapeAt(x, y, ownerFilter = null) {
    hitCtx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const shape = shapes[i];
      if (ownerFilter !== null && shape.owner !== ownerFilter) continue;
      const owner = players[shape.owner];
      if (!owner || !owner.alive) continue;
      if (hitCtx.isPointInPath(shape.path, x, y)) return shape;
    }
    return null;
  }

  function pointOwner(x, y) {
    const shape = pointShapeAt(x, y);
    return shape ? shape.owner : -1;
  }

  function isOwnTerritory(player, x = player.x, y = player.y) {
    return pointOwner(x, y) === player.id;
  }

  function nearestOwnCenter(player) {
    let best = player.home || { x: player.x, y: player.y };
    let bestDist = Infinity;
    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const shape = shapes[i];
      if (shape.owner !== player.id) continue;
      const d = distXY(player.x, player.y, shape.center.x, shape.center.y);
      if (d < bestDist) {
        bestDist = d;
        best = shape.center;
      }
    }
    return best;
  }

  function createPlayers() {
    players = startPoints.map((point, id) => {
      const dir = normalize(point.vx, point.vy);
      return {
        id,
        name: names[id],
        color: palette[id],
        x: point.x,
        y: point.y,
        px: point.x,
        py: point.y,
        vx: dir.x,
        vy: dir.y,
        alive: true,
        kills: 0,
        trail: [],
        speed: id === 0 ? 230 : rand(222, 258),
        territoryPercent: 0,
        aiState: 'expand',
        aiTimer: 0,
        aiTarget: { x: point.x + dir.x * 320, y: point.y + dir.y * 320 },
        aiLoopSize: rand(620, 980),
        aiAggro: rand(1.05, 1.75),
        aiBravery: rand(1.05, 1.75),
        home: { x: point.x, y: point.y },
        lastCaptureAt: 0,
        invulnerableUntil: performance.now() + 2600,
        skin: null,
        lastReason: ''
      };
    });
    assignRandomSkins(true);
  }

  function resetWorld() {
    shapes = [];
    particles = [];
    players.forEach((p) => {
      addShape(p.id, 'circle', { x: p.x, y: p.y, r: 150 });
    });
  }

  function chargeStake() {
    if (game.stakeCharged) return true;
    if (balance < selectedStake) {
      updateMoneyUI();
      return false;
    }
    balance -= selectedStake;
    saveBalance();
    game.stakeCharged = true;
    updateMoneyUI();
    return true;
  }

  function resetGame() {
    if (!chargeStake()) return;
    game.matchId += 1;
    game.running = true;
    game.paused = true;
    game.ended = false;
    game.countdownActive = true;
    game.timeLeft = MATCH_SECONDS;
    updateTimerUI();
    scoreTimer = 0;
    lastTime = performance.now();
    input.vector = { x: 0, y: -1 };
    input.active = false;
    createPlayers();
    resetWorld();
    camera.cx = players[0].x;
    camera.cy = players[0].y;
    updateCamera(1);
    updateScores(true);
    draw();
    runCountdown(game.matchId);
  }

  function startNewPaidMatch() {
    game.stakeCharged = false;
    resetGame();
  }

  function runCountdown(matchId) {
    let value = 3;
    ui.countdown.textContent = value;
    ui.countdown.classList.remove('hidden');
    const step = () => {
      if (!game.running || game.ended || matchId !== game.matchId) return;
      value -= 1;
      if (value > 0) {
        ui.countdown.textContent = value;
        setTimeout(step, 560);
      } else {
        ui.countdown.textContent = 'GO';
        setTimeout(() => {
          if (!game.running || game.ended || matchId !== game.matchId) return;
          ui.countdown.classList.add('hidden');
          game.paused = false;
          game.countdownActive = false;
          lastTime = performance.now();
        }, 480);
      }
    };
    setTimeout(step, 560);
  }

  function updateCamera(dt) {
    const player = players[0];
    if (player && player.alive) {
      const lookAhead = 95;
      const targetX = player.x + player.vx * lookAhead;
      const targetY = player.y + player.vy * lookAhead;
      const smooth = clamp(dt * 5.2, 0, 1);
      camera.cx = lerp(camera.cx, targetX, smooth);
      camera.cy = lerp(camera.cy, targetY, smooth);
    }
    camera.x = clamp(camera.cx - camera.w / 2, 0, WORLD.w - camera.w);
    camera.y = clamp(camera.cy - camera.h / 2, 0, WORLD.h - camera.h);
  }

  function recordTrailPoint(player) {
    const last = player.trail[player.trail.length - 1];
    if (!last || distXY(last.x, last.y, player.x, player.y) > 12) {
      player.trail.push({ x: player.x, y: player.y });
      if (player.trail.length > 260) player.trail.shift();
    }
  }

  function closeCapture(player) {
    if (player.trail.length < 5) {
      player.trail.length = 0;
      return;
    }

    // Trail by itself is not enough. In paper.io the area closes through the
    // player's existing territory. If we just connect trail end -> trail start
    // with a straight line, cream-colored "islands" appear between two pieces
    // of the same color. We add an anchor that is guaranteed to be inside the
    // player's current territory, so the new polygon is sewn into the old one.
    const raw = [...player.trail, { x: player.x, y: player.y }];
    const capturePoints = buildCapturePolygon(player, simplifyTrail(raw, 7));
    if (capturePoints.length >= 4) {
      const area = polygonArea(capturePoints);
      if (area > 1800) {
        addShape(player.id, 'poly', { points: capturePoints });
        // Wide invisible connector under the same color. It removes any leftover
        // visual gap when the camera anti-aliases the polygon edge.
        addShape(player.id, 'trailConnector', { points: simplifyTrail(raw, 14), width: 70 });
        player.lastCaptureAt = performance.now();
        spawnCaptureParticles(player, capturePoints);
      }
    }
    player.trail.length = 0;
  }

  function buildCapturePolygon(player, points) {
    const clean = points.filter(Boolean);
    if (clean.length < 3) return clean;

    const first = clean[0];
    const last = clean[clean.length - 1];
    const anchor = captureAnchor(player, first, last);

    // Put one or two anchors through the old owned body. That makes the captured
    // area visually and logically continuous with already owned territory.
    const result = [...clean];
    if (anchor && distXY(anchor.x, anchor.y, last.x, last.y) > 28 && distXY(anchor.x, anchor.y, first.x, first.y) > 28) {
      result.push(anchor);
    }
    return result;
  }

  function captureAnchor(player, first, last) {
    const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    const currentShape = pointShapeAt(player.x, player.y, player.id);
    if (currentShape) return currentShape.center;

    let best = null;
    let bestScore = Infinity;
    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const shape = shapes[i];
      if (shape.owner !== player.id) continue;
      const d1 = distXY(shape.center.x, shape.center.y, first.x, first.y);
      const d2 = distXY(shape.center.x, shape.center.y, last.x, last.y);
      const dm = distXY(shape.center.x, shape.center.y, mid.x, mid.y);
      const score = Math.min(d1, d2) + dm * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = shape.center;
      }
    }
    return best || player.home || { x: player.x, y: player.y };
  }

  function simplifyTrail(points, tolerance) {
    const result = [];
    for (const point of points) {
      const last = result[result.length - 1];
      if (!last || distXY(last.x, last.y, point.x, point.y) >= tolerance) result.push(point);
    }
    return result;
  }

  function spawnCaptureParticles(player, points) {
    const count = Math.min(34, Math.max(8, Math.floor(points.length / 3)));
    for (let i = 0; i < count; i += 1) {
      const p = points[Math.floor(Math.random() * points.length)];
      particles.push({
        x: p.x,
        y: p.y,
        vx: rand(-45, 45),
        vy: rand(-45, 45),
        life: rand(0.38, 0.9),
        maxLife: 0.9,
        color: player.color,
        r: rand(4, 10)
      });
    }
  }

  function updateHuman(player, dt) {
    const v = input.vector;
    const wanted = normalize(v.x, v.y);
    if (input.active || input.keys.size > 0) {
      player.vx = lerp(player.vx, wanted.x, clamp(dt * 10, 0, 1));
      player.vy = lerp(player.vy, wanted.y, clamp(dt * 10, 0, 1));
      const n = normalize(player.vx, player.vy);
      player.vx = n.x;
      player.vy = n.y;
    }
  }

  function updateBot(player, dt) {
    player.aiTimer -= dt;
    const outside = !isOwnTerritory(player);
    const home = nearestOwnCenter(player);
    const homeDistance = distXY(player.x, player.y, home.x, home.y);
    const trailLimit = player.aiLoopSize + player.territoryPercent * 6;
    const trailRisk = player.trail.length > 105 || homeDistance > trailLimit;
    const wallDanger = player.x < 210 || player.x > WORLD.w - 210 || player.y < 210 || player.y > WORLD.h - 210;
    const threat = nearestThreat(player, outside ? 185 : 130);
    const preyTrail = nearestEnemyTrail(player, 820 * player.aiAggro);
    const enemyBody = nearestEnemyBody(player, 720);

    if (preyTrail && preyTrail.distance < 520 && (player.aiBravery > 1.15 || !outside || player.trail.length < 36)) {
      player.aiState = 'attack';
      player.aiTarget = preyTrail.point;
      player.aiTimer = rand(0.20, 0.42);
    } else if (outside && (trailRisk || wallDanger || (threat && threat.distance < 125))) {
      player.aiState = 'return';
      player.aiTarget = home;
      player.aiTimer = rand(0.22, 0.48);
    } else if (!outside && enemyBody && Math.random() < 0.16 * player.aiAggro && player.aiTimer <= 0) {
      player.aiState = 'pressure';
      player.aiTarget = { x: enemyBody.x + rand(-160, 160), y: enemyBody.y + rand(-160, 160) };
      player.aiTimer = rand(0.35, 0.72);
    } else if (player.aiTimer <= 0 || distance(player, player.aiTarget) < 92) {
      player.aiState = 'expand';
      player.aiTarget = chooseExpandTarget(player);
      player.aiTimer = rand(0.75, 1.35);
    }

    let tx = player.aiTarget.x;
    let ty = player.aiTarget.y;

    const margin = 175;
    let avoidX = 0;
    let avoidY = 0;
    if (player.x < margin) avoidX += 1.35;
    if (player.x > WORLD.w - margin) avoidX -= 1.35;
    if (player.y < margin) avoidY += 1.35;
    if (player.y > WORLD.h - margin) avoidY -= 1.35;
    if (threat && threat.distance < 150 && player.aiState !== 'attack') {
      avoidX += (player.x - threat.x) / Math.max(1, threat.distance) * 1.8;
      avoidY += (player.y - threat.y) / Math.max(1, threat.distance) * 1.8;
    }

    let desired = normalize(tx - player.x, ty - player.y);
    desired = normalize(desired.x + avoidX, desired.y + avoidY);

    const turn = player.aiState === 'return' ? 8.4 : player.aiState === 'attack' ? 9.4 : player.aiState === 'pressure' ? 7.2 : 5.6;
    player.vx = lerp(player.vx, desired.x, clamp(dt * turn, 0, 1));
    player.vy = lerp(player.vy, desired.y, clamp(dt * turn, 0, 1));
    const n = normalize(player.vx, player.vy);
    player.vx = n.x;
    player.vy = n.y;
  }

  function chooseExpandTarget(player) {
    const home = nearestOwnCenter(player);
    const baseAngle = angleNorm(player.x - home.x, player.y - home.y);
    const swing = rand(-1.15, 1.15);
    const radius = player.aiState === 'return' ? rand(260, 390) : rand(680, 1160);
    const angle = baseAngle + swing + rand(-0.45, 0.45);
    let x = home.x + Math.cos(angle) * radius;
    let y = home.y + Math.sin(angle) * radius;

    const enemy = nearestEnemyBody(player, 540);
    if (enemy && Math.random() < 0.68 * player.aiAggro) {
      x = enemy.x + rand(-120, 120);
      y = enemy.y + rand(-120, 120);
    }
    return { x: clamp(x, 130, WORLD.w - 130), y: clamp(y, 130, WORLD.h - 130) };
  }

  function nearestEnemyBody(player, maxDistance) {
    let best = null;
    let bestDist = maxDistance;
    for (const other of players) {
      if (!other.alive || other.id === player.id) continue;
      const d = distance(player, other);
      if (d < bestDist) {
        best = other;
        bestDist = d;
      }
    }
    return best;
  }

  function nearestEnemyTrail(player, maxDistance) {
    let best = null;
    let bestDist = maxDistance;
    for (const other of players) {
      if (!other.alive || other.id === player.id || other.trail.length < 2) continue;
      for (let i = 1; i < other.trail.length; i += 2) {
        const a = other.trail[i - 1];
        const b = other.trail[i];
        const projection = closestPointOnSegment(player.x, player.y, a.x, a.y, b.x, b.y);
        const d = distXY(player.x, player.y, projection.x, projection.y);
        if (d < bestDist) {
          bestDist = d;
          best = { player: other, point: projection, distance: d };
        }
      }
    }
    return best;
  }

  function nearestThreat(player, maxDistance) {
    let best = null;
    let bestDist = maxDistance;
    for (const other of players) {
      if (!other.alive || other.id === player.id) continue;
      const d = distance(player, other);
      if (d < bestDist && other.trail.length > 3) {
        best = other;
        bestDist = d;
      }
    }
    if (!best) return null;
    return { x: best.x, y: best.y, distance: bestDist };
  }

  function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
    return { x: ax + dx * t, y: ay + dy * t };
  }

  function distanceToSegment(px, py, ax, ay, bx, by) {
    const p = closestPointOnSegment(px, py, ax, ay, bx, by);
    return distXY(px, py, p.x, p.y);
  }

  function updatePlayers(dt) {
    for (const player of players) {
      if (!player.alive) continue;
      player.px = player.x;
      player.py = player.y;
      if (player.id === 0) updateHuman(player, dt);
      else updateBot(player, dt);

      const speedBoost = player.aiState === 'attack' ? 1.05 : player.aiState === 'return' ? 1.08 : 1;
      player.x += player.vx * player.speed * speedBoost * dt;
      player.y += player.vy * player.speed * speedBoost * dt;
      bounceFromWalls(player);

      const nowOwn = isOwnTerritory(player);
      if (nowOwn) {
        if (player.trail.length > 3) closeCapture(player);
      } else {
        if (!player.trail.length) player.trail.push({ x: player.px, y: player.py });
        recordTrailPoint(player);
      }
    }

    checkTrailKills();
  }

  function bounceFromWalls(player) {
    const pad = 26;
    let bounced = false;
    if (player.x < pad) { player.x = pad; player.vx = Math.abs(player.vx); bounced = true; }
    if (player.x > WORLD.w - pad) { player.x = WORLD.w - pad; player.vx = -Math.abs(player.vx); bounced = true; }
    if (player.y < pad) { player.y = pad; player.vy = Math.abs(player.vy); bounced = true; }
    if (player.y > WORLD.h - pad) { player.y = WORLD.h - pad; player.vy = -Math.abs(player.vy); bounced = true; }
    if (bounced && player.id !== 0) {
      player.aiTarget = nearestOwnCenter(player);
      player.aiState = 'return';
      player.aiTimer = 0.15;
    }
    const n = normalize(player.vx, player.vy);
    player.vx = n.x;
    player.vy = n.y;
  }

  function checkTrailKills() {
    for (const hunter of players) {
      if (!hunter.alive) continue;
      for (const victim of players) {
        if (!victim.alive || victim.trail.length < 4) continue;
        if (hunter.id === victim.id) continue;
        for (let i = 1; i < victim.trail.length; i += 1) {
          const a = victim.trail[i - 1];
          const b = victim.trail[i];
          const d = distanceToSegment(hunter.x, hunter.y, a.x, a.y, b.x, b.y);
          if (d < 18) {
            eliminatePlayer(victim, hunter, 'Хвост перерезан');
            break;
          }
        }
      }
    }
  }

  function eliminatePlayer(victim, killer, reason) {
    if (!victim.alive || performance.now() < victim.invulnerableUntil) return;
    victim.alive = false;
    victim.trail.length = 0;
    victim.lastReason = reason;
    if (killer && killer.id !== victim.id) killer.kills += 1;
    shapes = shapes.filter((shape) => shape.owner !== victim.id);
    for (let i = 0; i < 28; i += 1) {
      particles.push({
        x: victim.x,
        y: victim.y,
        vx: rand(-160, 160),
        vy: rand(-160, 160),
        life: rand(0.45, 0.95),
        maxLife: 0.95,
        color: victim.color,
        r: rand(4, 12)
      });
    }
    updateScores(true);
    if (victim.id === 0) endMatch(false, killer ? `${killer.name} перерезал твой след.` : 'Ты проиграл.');
    else if (players[0]?.alive && players.filter((p) => p.id !== 0 && p.alive).length === 0) endMatch(true, 'Ты уничтожил всех 4 ботов.');
  }

  function updateParticles(dt) {
    particles = particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.97;
      p.vy *= 0.97;
      return p.life > 0;
    });
  }

  function updateScores(force = false) {
    const counts = new Array(PLAYER_COUNT).fill(0);
    for (let y = 0; y < SAMPLE_ROWS; y += 1) {
      for (let x = 0; x < SAMPLE_COLS; x += 1) {
        const wx = (x + 0.5) / SAMPLE_COLS * WORLD.w;
        const wy = (y + 0.5) / SAMPLE_ROWS * WORLD.h;
        const owner = pointOwner(wx, wy);
        if (owner >= 0) counts[owner] += 1;
      }
    }
    const total = SAMPLE_COLS * SAMPLE_ROWS;
    players.forEach((player) => {
      player.territoryPercent = player.alive ? (counts[player.id] / total) * 100 : 0;
    });
    const me = players[0];
    if (me) {
      const percent = Math.min(100, me.territoryPercent);
      ui.territoryLabel.textContent = `${percent.toFixed(1)}%`;
      ui.captureProgress.style.width = `${clamp((percent / WIN_PERCENT) * 100, 0, 100)}%`;
      if (!game.ended && me.alive && percent >= WIN_PERCENT) endMatch(true, 'Ты захватил карту и удержал самую большую территорию.');
    }

    if (force || scoreTimer <= 0) {
      const sorted = [...players].sort((a, b) => b.territoryPercent - a.territoryPercent);
      ui.scoreRows.innerHTML = '';
      sorted.forEach((player) => {
        const row = document.createElement('div');
        row.className = `score-row${player.alive ? '' : ' dead'}`;
        const skinIcon = player.skin
          ? `<span class="player-skin" style="border-color:${player.color}"><img src="${player.skin.src}" alt=""></span>`
          : `<span class="color-dot" style="background:${player.color}"></span>`;
        row.innerHTML = `
          <span class="player-name">${skinIcon}<span>${player.name}</span></span>
          <b>${player.alive ? player.territoryPercent.toFixed(0) : '×'}%</b>`;
        ui.scoreRows.appendChild(row);
      });
    }
  }


  function finishByTime() {
    updateScores(true);
    const alive = players.filter((p) => p.alive);
    const leader = [...alive].sort((a, b) => b.territoryPercent - a.territoryPercent)[0];
    const me = players[0];
    if (!me || !me.alive) {
      endMatch(false, 'Время вышло, но тебя уже выбили.');
      return;
    }
    if (leader && leader.id === 0) {
      endMatch(true, '5 минут вышли. У тебя самая большая территория на карте.');
    } else {
      endMatch(false, `5 минут вышли. Больше территории удержал ${leader ? leader.name : 'бот'}.`);
    }
  }

  function endMatch(won, message) {
    if (game.ended) return;
    game.ended = true;
    game.running = false;
    game.paused = true;
    cancelAnimationFrame(rafId);
    const { prize } = getPrizeMath();
    if (won) {
      balance += prize;
      saveBalance();
    }
    updateMoneyUI();
    ui.resultKicker.textContent = won ? 'Победа' : 'Поражение';
    ui.resultTitle.textContent = won ? 'Ты забрал фонд!' : 'Тебя выбили';
    ui.resultText.textContent = won ? `${message} На баланс начислено ${prize} тестовых звёзд.` : `${message} Ставка сгорела, попробуй ещё раз.`;
    ui.resultPrizeLabel.textContent = won ? 'Начислено' : 'Приз не получен';
    ui.resultPrize.textContent = won ? prize : 0;
    resultModal.classList.remove('hidden');
    ui.playAgainButton.disabled = balance < selectedStake;
  }

  function gameLoop(now) {
    rafId = requestAnimationFrame(gameLoop);
    const dt = clamp((now - lastTime) / 1000 || 0, 0, 0.035);
    lastTime = now;
    resizeCanvas();
    if (game.running && !game.paused && !game.ended) {
      game.timeLeft = Math.max(0, game.timeLeft - dt);
      updateTimerUI();
      updatePlayers(dt);
      updateCamera(dt);
      updateParticles(dt);
      scoreTimer -= dt;
      if (scoreTimer <= 0) {
        updateScores(true);
        scoreTimer = 0.42;
      }
      if (!game.ended && game.timeLeft <= 0) finishByTime();
    }
    draw();
  }

  function drawWorldBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, WORLD.h);
    g.addColorStop(0, '#fffbe5');
    g.addColorStop(0.48, '#fff4aa');
    g.addColorStop(1, '#ffe06b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 26; i += 1) {
      const x = (i * 577) % WORLD.w;
      const y = (i * 941) % WORLD.h;
      ctx.beginPath();
      ctx.ellipse(x, y, 130 + (i % 5) * 34, 80 + (i % 4) * 22, i * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(13,11,4,.12)';
    ctx.lineWidth = 22;
    ctx.lineJoin = 'round';
    ctx.strokeRect(11, 11, WORLD.w - 22, WORLD.h - 22);
    ctx.strokeStyle = 'rgba(13,11,4,.05)';
    ctx.lineWidth = 4;
    for (let y = 320; y < WORLD.h; y += 320) {
      ctx.beginPath();
      ctx.moveTo(80, y + Math.sin(y) * 12);
      ctx.bezierCurveTo(WORLD.w * 0.28, y - 80, WORLD.w * 0.62, y + 80, WORLD.w - 80, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTerritory() {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (const shape of shapes) {
      const player = players[shape.owner];
      if (!player || !player.alive) continue;
      ctx.fillStyle = player.color;
      ctx.strokeStyle = player.color;
      ctx.lineWidth = shape.kind === 'circle' ? 22 : shape.kind === 'trailConnector' ? 28 : 24;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.fill(shape.path);
      // Stroke тем же цветом, без прозрачности: он склеивает антиалиасные края
      // между кусками одной территории и убирает видимые швы соединения.
      ctx.stroke(shape.path);
    }
    ctx.restore();
  }

  function drawTrails() {
    for (const player of players) {
      if (!player.alive || player.trail.length < 2) continue;
      ctx.save();
      ctx.lineWidth = 23;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = player.color;
      ctx.shadowColor = 'rgba(13,11,4,.18)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(player.trail[0].x, player.trail[0].y);
      for (let i = 1; i < player.trail.length; i += 1) {
        ctx.lineTo(player.trail[i].x, player.trail[i].y);
      }
      ctx.lineTo(player.x, player.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawFallbackPlayer(player, angle) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(angle);
    ctx.shadowColor = 'rgba(13,11,4,.25)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = player.color;
    ctx.strokeStyle = '#0d0b04';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(30, 0);
    ctx.bezierCurveTo(13, -27, -25, -24, -31, 0);
    ctx.bezierCurveTo(-25, 24, 13, 27, 30, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(8, -7, 5.2, 0, Math.PI * 2);
    ctx.arc(8, 7, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSkinPlayer(player, angle) {
    const skin = player.skin;
    if (!skin || !skin.img || !skin.img.complete || !skin.img.naturalWidth) {
      drawFallbackPlayer(player, angle);
      return;
    }

    // Маленький носик показывает направление движения, а сам skin остаётся
    // ровным: так любые skin1.png, skin2.png и т.д. не выглядят перевёрнутыми.
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(angle);
    ctx.shadowColor = 'rgba(13,11,4,.18)';
    ctx.shadowBlur = 9;
    ctx.fillStyle = player.color;
    ctx.strokeStyle = '#0d0b04';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(43, 0);
    ctx.lineTo(23, -13);
    ctx.lineTo(23, 13);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.shadowColor = 'rgba(13,11,4,.28)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0d0b04';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 29, 0, Math.PI * 2);
    ctx.clip();
    const size = 64;
    ctx.drawImage(skin.img, -size / 2, -size / 2, size, size);
    ctx.restore();
    ctx.lineWidth = 5;
    ctx.strokeStyle = player.color;
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayers() {
    for (const player of players) {
      if (!player.alive) continue;
      const angle = Math.atan2(player.vy, player.vx);
      drawSkinPlayer(player, angle);

      ctx.save();
      ctx.font = '900 35px Nunito, Rubik, system-ui';
      ctx.textAlign = 'center';
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#0d0b04';
      ctx.fillStyle = player.id === 0 ? '#0d0b04' : player.color;
      ctx.strokeText(player.name, player.x, player.y - 48);
      ctx.fillText(player.name, player.x, player.y - 48);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#0d0b04';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.65 + (1 - a) * 0.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawMinimap() {
    const cssW = canvas.clientWidth;
    const mapW = Math.min(104, cssW * 0.23);
    const mapH = mapW * WORLD.h / WORLD.w;
    const x = cssW - mapW - 12;
    const y = canvas.clientHeight - mapH - 14;
    if (cssW < 360) return;

    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.fillStyle = 'rgba(255,251,214,.78)';
    ctx.strokeStyle = '#0d0b04';
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, mapW, mapH, 12);
    ctx.fill();
    ctx.stroke();
    const sx = mapW / WORLD.w;
    const sy = mapH / WORLD.h;
    for (const player of players) {
      if (!player.alive) continue;
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(x + player.x * sx, y + player.y * sy, player.id === 0 ? 4.8 : 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(13,11,4,.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + camera.x * sx, y + camera.y * sy, camera.w * sx, camera.h * sy);
    ctx.restore();
  }

  function roundRect(context, x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function draw() {
    resizeCanvas();
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    ctx.save();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.restore();

    ctx.save();
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);
    drawWorldBackground();
    drawTerritory();
    drawTrails();
    drawParticles();
    drawPlayers();
    ctx.restore();

    drawMinimap();
  }

  function handleJoystickStart(event) {
    if (input.pointerId !== null) return;
    input.pointerId = event.pointerId;
    joystick.setPointerCapture?.(event.pointerId);
    joystick.classList.add('active');
    input.active = true;
    handleJoystickMove(event);
  }

  function handleJoystickMove(event) {
    if (input.pointerId !== event.pointerId) return;
    const rect = joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const max = rect.width * 0.31;
    const len = Math.hypot(dx, dy);
    const scale = len > max ? max / len : 1;
    const kx = dx * scale;
    const ky = dy * scale;
    joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    if (len > 8) input.vector = normalize(dx, dy);
    input.active = true;
    event.preventDefault();
  }

  function handleJoystickEnd(event) {
    if (input.pointerId !== event.pointerId) return;
    input.pointerId = null;
    input.active = input.keys.size > 0;
    joystick.classList.remove('active');
    joystickKnob.style.transform = 'translate(0, 0)';
  }

  function updateKeyVector() {
    let x = 0;
    let y = 0;
    if (input.keys.has('ArrowLeft') || input.keys.has('KeyA')) x -= 1;
    if (input.keys.has('ArrowRight') || input.keys.has('KeyD')) x += 1;
    if (input.keys.has('ArrowUp') || input.keys.has('KeyW')) y -= 1;
    if (input.keys.has('ArrowDown') || input.keys.has('KeyS')) y += 1;
    if (x || y) {
      input.vector = normalize(x, y);
      input.active = true;
    } else {
      input.active = input.pointerId !== null;
    }
  }

  function openGame() {
    if (balance < selectedStake) {
      updateMoneyUI();
      return;
    }
    menu.classList.add('hidden');
    resultModal.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    resizeCanvas();
    startNewPaidMatch();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(gameLoop);
  }

  function backToMenu() {
    game.running = false;
    game.paused = true;
    game.ended = true;
    cancelAnimationFrame(rafId);
    ui.countdown.classList.add('hidden');
    resultModal.classList.add('hidden');
    gameScreen.classList.add('hidden');
    menu.classList.remove('hidden');
    updateMoneyUI();
    draw();
  }

  function initEvents() {
    ui.startButton.addEventListener('click', openGame);
    ui.playAgainButton.addEventListener('click', () => {
      if (balance < selectedStake) {
        backToMenu();
        return;
      }
      resultModal.classList.add('hidden');
      game.stakeCharged = false;
      resetGame();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(gameLoop);
    });
    ui.backToMenuButton.addEventListener('click', backToMenu);
    ui.restartButton.addEventListener('click', backToMenu);
    ui.pauseButton.addEventListener('click', () => {
      if (!game.running || game.ended || game.countdownActive) return;
      game.paused = !game.paused;
      ui.pauseButton.textContent = game.paused ? '▶' : 'II';
      if (!game.paused) lastTime = performance.now();
    });

    joystick.addEventListener('pointerdown', handleJoystickStart, { passive: false });
    joystick.addEventListener('pointermove', handleJoystickMove, { passive: false });
    joystick.addEventListener('pointerup', handleJoystickEnd);
    joystick.addEventListener('pointercancel', handleJoystickEnd);

    window.addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(event.code)) {
        input.keys.add(event.code);
        updateKeyVector();
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', (event) => {
      input.keys.delete(event.code);
      updateKeyVector();
    });
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));
  }

  function init() {
    resetBalanceForPageLoad();
    injectInlineStars();
    buildStakeButtons();
    updateMoneyUI();
    initEvents();
    loadSkinAssets();
    createPlayers();
    resetWorld();
    resizeCanvas();
    draw();
  }

  init();
})();
