/*
 * Interactive star field.
 *
 * Three parallax layers of stars drawn on a single canvas that sits behind
 * the whole page. The pointer moves the layers, brightens nearby stars and
 * draws faint links between them; shooting stars cross the frame now and then.
 *
 * Everything degrades safely: no pointer (touch) means no parallax, and
 * prefers-reduced-motion renders one static frame and stops.
 */

const LAYERS = [
  // depth: how strongly the layer reacts to the pointer and to scrolling.
  { depth: 0.14, size: [0.5, 1.1], alpha: [0.25, 0.5], share: 0.5 },
  { depth: 0.34, size: [0.8, 1.7], alpha: [0.4, 0.75], share: 0.33 },
  { depth: 0.62, size: [1.2, 2.4], alpha: [0.6, 1.0], share: 0.17 },
];

// Real starlight runs warm-white to amber, with a few blue-white giants.
const STAR_TINTS = [
  '247, 242, 230',
  '255, 226, 178',
  '255, 248, 234',
  '255, 205, 158',
  '212, 224, 236',
];

const LINK_RADIUS = 130;
const POINTER_PUSH_RADIUS = 150;
const DENSITY = 1 / 8200; // stars per CSS pixel of viewport area
const MAX_STARS = 460;

const random = (min, max) => min + Math.random() * (max - min);

export function createStarfield(canvas) {
  const context = canvas.getContext('2d', { alpha: true });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(pointer: fine)');

  let width = 0;
  let height = 0;
  let stars = [];
  let shootingStars = [];
  let frame = null;
  let lastTime = 0;
  let nextShootingStar = 2500;

  // Pointer position, and the smoothed value actually used for drawing.
  const pointer = { x: -9999, y: -9999, active: false };
  const eased = { x: 0, y: 0 };
  let scrollShift = 0;

  function makeStar(layerIndex) {
    const layer = LAYERS[layerIndex];

    return {
      layer: layerIndex,
      x: Math.random() * width,
      y: Math.random() * height,
      // Offsets caused by the pointer wake; they always spring back to zero.
      dx: 0,
      dy: 0,
      radius: random(layer.size[0], layer.size[1]),
      baseAlpha: random(layer.alpha[0], layer.alpha[1]),
      twinkleSpeed: random(0.4, 1.6),
      twinklePhase: Math.random() * Math.PI * 2,
      drift: random(-0.012, 0.012),
      tint: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)],
    };
  }

  function build() {
    const target = Math.min(MAX_STARS, Math.round(width * height * DENSITY));
    stars = [];

    LAYERS.forEach((layer, index) => {
      const count = Math.round(target * layer.share);
      for (let i = 0; i < count; i += 1) stars.push(makeStar(index));
    });
  }

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    width = canvas.clientWidth;
    height = canvas.clientHeight;

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    build();
  }

  function drawShootingStars(delta) {
    nextShootingStar -= delta;

    if (nextShootingStar <= 0 && shootingStars.length < 2) {
      const fromLeft = Math.random() > 0.35;

      shootingStars.push({
        x: fromLeft ? random(-100, width * 0.5) : random(width * 0.5, width + 100),
        y: random(-60, height * 0.45),
        vx: (fromLeft ? 1 : -1) * random(0.42, 0.72),
        vy: random(0.16, 0.34),
        life: 0,
        span: random(900, 1500),
        length: random(90, 190),
      });

      nextShootingStar = random(5200, 13000);
    }

    shootingStars = shootingStars.filter((shot) => {
      shot.life += delta;
      shot.x += shot.vx * delta;
      shot.y += shot.vy * delta;

      if (shot.life > shot.span) return false;

      // Fade in over the first fifth of the life, then fade out.
      const progress = shot.life / shot.span;
      const alpha = Math.sin(progress * Math.PI) * 0.9;

      const tailX = shot.x - shot.vx * shot.length;
      const tailY = shot.y - shot.vy * shot.length;

      const gradient = context.createLinearGradient(shot.x, shot.y, tailX, tailY);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      gradient.addColorStop(0.35, `rgba(255, 214, 150, ${alpha * 0.4})`);
      gradient.addColorStop(1, 'rgba(255, 214, 150, 0)');

      context.strokeStyle = gradient;
      context.lineWidth = 1.5;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(shot.x, shot.y);
      context.lineTo(tailX, tailY);
      context.stroke();

      return true;
    });
  }

  function render(time) {
    const delta = Math.min(time - lastTime || 16, 48);
    lastTime = time;

    // Smooth the pointer so the parallax glides instead of snapping.
    eased.x += (pointer.x - eased.x) * 0.06;
    eased.y += (pointer.y - eased.y) * 0.06;

    const offsetX = pointer.active ? (eased.x - width / 2) / width : 0;
    const offsetY = pointer.active ? (eased.y - height / 2) / height : 0;

    context.clearRect(0, 0, width, height);

    const near = [];

    for (const star of stars) {
      const layer = LAYERS[star.layer];

      // Wrap around instead of letting the slow drift empty the canvas.
      star.x += star.drift * delta * (0.4 + layer.depth);
      if (star.x < -4) star.x = width + 4;
      if (star.x > width + 4) star.x = -4;

      star.dx *= 0.92;
      star.dy *= 0.92;

      const px =
        star.x + star.dx - offsetX * 46 * layer.depth;
      const py =
        star.y + star.dy - offsetY * 46 * layer.depth - scrollShift * layer.depth;

      // Vertical wrap keeps the field full while the page scrolls.
      const y = ((py % height) + height) % height;

      star.twinklePhase += star.twinkleSpeed * delta * 0.0016;
      const twinkle = 0.72 + Math.sin(star.twinklePhase) * 0.28;

      let alpha = star.baseAlpha * twinkle;
      let radius = star.radius;

      if (pointer.active) {
        const distanceX = px - eased.x;
        const distanceY = y - eased.y;
        const distance = Math.hypot(distanceX, distanceY);

        if (distance < POINTER_PUSH_RADIUS) {
          const force = (1 - distance / POINTER_PUSH_RADIUS) ** 2;

          alpha = Math.min(1, alpha + force * 0.65);
          radius += force * 1.1;

          if (distance > 0.001) {
            star.dx += (distanceX / distance) * force * 0.5;
            star.dy += (distanceY / distance) * force * 0.5;
          }

          if (star.layer > 0 && near.length < 40) near.push({ x: px, y });
        }
      }

      context.beginPath();
      context.fillStyle = `rgba(${star.tint}, ${alpha.toFixed(3)})`;
      context.arc(px, y, radius, 0, Math.PI * 2);
      context.fill();

      // Only the brightest, largest stars get a halo — cheap and effective.
      if (radius > 1.9) {
        context.beginPath();
        context.fillStyle = `rgba(${star.tint}, ${(alpha * 0.12).toFixed(3)})`;
        context.arc(px, y, radius * 3.2, 0, Math.PI * 2);
        context.fill();
      }
    }

    // Constellation links, drawn only between stars already near the pointer.
    for (let i = 0; i < near.length; i += 1) {
      for (let j = i + 1; j < near.length; j += 1) {
        const distance = Math.hypot(near[i].x - near[j].x, near[i].y - near[j].y);
        if (distance > LINK_RADIUS) continue;

        context.strokeStyle = `rgba(224, 163, 60, ${(
          (1 - distance / LINK_RADIUS) * 0.22
        ).toFixed(3)})`;
        context.lineWidth = 0.6;
        context.beginPath();
        context.moveTo(near[i].x, near[i].y);
        context.lineTo(near[j].x, near[j].y);
        context.stroke();
      }
    }

    drawShootingStars(delta);

    frame = requestAnimationFrame(render);
  }

  function renderStatic() {
    context.clearRect(0, 0, width, height);

    for (const star of stars) {
      context.beginPath();
      context.fillStyle = `rgba(${star.tint}, ${star.baseAlpha.toFixed(3)})`;
      context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  function start() {
    if (frame !== null) return;

    if (reduceMotion.matches) {
      renderStatic();
      return;
    }

    lastTime = performance.now();
    frame = requestAnimationFrame(render);
  }

  function stop() {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  }

  function onPointerMove(event) {
    if (!finePointer.matches) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  }

  function onPointerLeave() {
    pointer.active = false;
    pointer.x = width / 2;
    pointer.y = height / 2;
  }

  function onScroll() {
    // Damped so a long page does not shear the field apart.
    scrollShift = window.scrollY * 0.12;
  }

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (reduceMotion.matches) renderStatic();
    }, 150);
  }

  resize();
  onPointerLeave();
  start();

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  reduceMotion.addEventListener('change', () => {
    stop();
    start();
  });

  return { start, stop, resize };
}
