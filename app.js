import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
gsap.registerPlugin(ScrollTrigger);

document.body.classList.add("is-loading");
let motionPaused = false;

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }

/* -------------------------------------------------------------------------- */
/* Cinematic event horizon                                                     */
/* -------------------------------------------------------------------------- */
const intro = document.querySelector("#intro");
const wormholeCanvas = document.querySelector("#wormhole");
let wormholeCleanup = () => {};
let introTimeline;

function createWormhole() {
  const renderer = new THREE.WebGLRenderer({ canvas: wormholeCanvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uTime: { value: 0 },
    uTravel: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2(0, 0) }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    depthTest: false,
    vertexShader: `
      void main(){ gl_Position = vec4(position, 1.0); }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uTravel;
      uniform vec2 uResolution;
      uniform vec2 uPointer;

      float hash21(vec2 p){
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x), mix(hash21(i + vec2(0,1)), hash21(i + 1.0), f.x), f.y);
      }
      float fbm(vec2 p){
        float n = 0.0, a = .5;
        mat2 r = mat2(.8, -.6, .6, .8);
        for(int i=0;i<5;i++){ n += a * noise(p); p = r * p * 2.03 + 7.13; a *= .48; }
        return n;
      }
      vec3 palette(float t){
        vec3 a = vec3(.11,.07,.045), b = vec3(.72,.34,.16), c = vec3(1.0,.65,.35), d = vec3(.1,.18,.22);
        return a + b*cos(6.28318*(c*t+d));
      }
      void main(){
        vec2 frag = gl_FragCoord.xy;
        vec2 uv = (2.0 * frag - uResolution.xy) / min(uResolution.x, uResolution.y);
        uv -= uPointer * .035;
        float time = uTime * .18 + uTravel * 2.8;
        float r = length(uv);
        float a = atan(uv.y, uv.x);

        // Gravitational lensing bends the background harder near the horizon.
        float lens = .17 / max(r, .055);
        vec2 warped = vec2(a / 6.28318 + lens, 1.0 / max(r, .025) + time);
        vec3 col = vec3(.0015, .003, .008);

        // Warped deep-space star field.
        vec2 starGrid = vec2(a * 12.0, 1.0 / max(r,.03) * 2.2 + time * 3.0);
        vec2 cell = floor(starGrid);
        vec2 local = fract(starGrid) - .5;
        float starSeed = hash21(cell);
        float star = smoothstep(.048, 0.0, length(local)) * step(.968, starSeed);
        star *= smoothstep(.12, .34, r) * (1.0 + uTravel * 2.5);
        col += star * mix(vec3(.35,.65,1.0), vec3(1.0,.52,.16), starSeed) * 4.0;

        // Turbulent accretion flow, Doppler-bright on one side.
        float turbulence = fbm(vec2(a * 2.1 - time * .22, 1.5 / max(r,.08) + time));
        float disk = exp(-pow(abs(r - .255 - (turbulence-.5)*.035) * 20.0, 1.4));
        float doppler = .55 + .75 * smoothstep(-1.0, 1.0, cos(a - .35));
        col += palette(turbulence + a*.08 + time*.08) * disk * doppler * 2.2;

        // Photon ring and hot inner rim.
        float photon = exp(-abs(r - .168) * 115.0);
        float hot = exp(-abs(r - .205) * 42.0) * (.35 + turbulence);
        col += vec3(1.0,.43,.10) * photon * 4.2;
        col += vec3(.22,.72,.86) * hot * .35;

        // Volumetric tunnel streams appear as travel accelerates.
        float streams = pow(max(0.0, sin(warped.y * 2.1 + fbm(warped*2.0)*5.0)), 10.0);
        streams *= smoothstep(.16,.9,r) * uTravel;
        col += mix(vec3(.08,.32,.42), vec3(1.0,.25,.04), turbulence) * streams * 1.6;

        // The black throat stays truly black.
        float throat = smoothstep(.15, .105, r);
        col *= 1.0 - throat;
        col += vec3(.006,.012,.018) * smoothstep(.12, .04, r);

        float vignette = 1.0 - smoothstep(.55, 1.45, r);
        col *= .35 + .65 * vignette;
        col *= 1.0 + uTravel * .38;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.25, .65, .35);
  composer.addPass(bloom);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    uniforms.uResolution.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  }
  function pointer(event) {
    uniforms.uPointer.value.set(event.clientX / innerWidth - .5, .5 - event.clientY / innerHeight);
  }
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", pointer, { passive: true });

  let raf = 0;
  let lastFrame = performance.now();
  function render(now = performance.now()) {
    const delta = Math.min((now - lastFrame) / 1000, .04);
    lastFrame = now;
    if (!motionPaused) uniforms.uTime.value += delta;
    composer.render();
    raf = requestAnimationFrame(render);
  }
  render();

  wormholeCleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", pointer);
    material.dispose();
    renderer.dispose();
    composer.dispose();
  };
  return uniforms;
}

function heroEntrance() {
  gsap.timeline()
    .from(".site-header", { y: -30, opacity: 0, duration: .7 })
    .from("h1 .line b", { yPercent: 115, duration: 1.05, stagger: .1, ease: "power4.out" }, "-=.35")
    .from(".hero-kicker,.hero-lede,.hero-actions", { y: 22, opacity: 0, duration: .75, stagger: .09, ease: "power3.out" }, "-=.6")
    .to(".portrait-stage", { opacity: 1, y: 0, filter: "blur(0px)", duration: 1.1, ease: "power3.out" }, "-=.9");
}

function closeIntro(immediate = false) {
  if (!intro || intro.dataset.closed) return;
  intro.dataset.closed = "true";
  introTimeline?.kill();
  sessionStorage.setItem("portfolio-intro-seen", "1");
  const done = () => {
    wormholeCleanup();
    intro.remove();
    document.body.classList.remove("is-loading");
    heroEntrance();
    ScrollTrigger.refresh();
  };
  if (immediate) { done(); return; }
  gsap.to(intro, { opacity: 0, scale: 1.08, duration: .7, ease: "power3.inOut", onComplete: done });
}

if (reduced || sessionStorage.getItem("portfolio-intro-seen")) {
  intro.remove();
  document.body.classList.remove("is-loading");
  heroEntrance();
} else {
  const wormhole = createWormhole();
  const counter = { value: 0 };
  introTimeline = gsap.timeline({ onComplete: () => closeIntro(false) })
    .to(counter, { value: 100, duration: 4.2, ease: "power2.inOut", onUpdate: () => {
      const value = Math.round(counter.value);
      const statusCounter = document.querySelector(".intro-status b");
      if (statusCounter) statusCounter.textContent = String(value).padStart(2, "0");
    }})
    .to(".intro-meter span", { width: "100%", duration: 4.2, ease: "power2.inOut" }, 0)
    .to(wormhole.uTravel, { value: 1, duration: 4.2, ease: "power3.in" }, 0)
    .to(".intro-copy", { opacity: 0, y: -30, duration: .55, ease: "power2.in" }, 3.6)
    .to("#wormhole", { filter: "brightness(4)", duration: .28 }, 4.02);
  document.querySelector(".intro-skip").addEventListener("click", () => closeIntro(false));
}

/* -------------------------------------------------------------------------- */
/* Ambient universe                                                            */
/* -------------------------------------------------------------------------- */
function createCosmos() {
  const canvas = document.querySelector("#cosmos");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1 : 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, .1, 100);
  camera.position.z = 8;
  const count = coarse ? 650 : 1500;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const colorA = new THREE.Color(0x7abfff), colorB = new THREE.Color(0xff7b30);
  for (let i = 0; i < count; i++) {
    const radius = 4 + Math.random() * 14;
    const angle = Math.random() * Math.PI * 2;
    positions[i*3] = Math.cos(angle) * radius;
    positions[i*3+1] = (Math.random() - .5) * 13;
    positions[i*3+2] = (Math.random() - .5) * 16;
    const c = colorA.clone().lerp(colorB, Math.random());
    colors.set([c.r, c.g, c.b], i*3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: coarse ? .022 : .028, transparent: true, opacity: .62, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const stars = new THREE.Points(geometry, material);
  scene.add(stars);

  let tx = 0, ty = 0, raf = 0;
  function pointer(event) { tx = (event.clientX / innerWidth - .5) * .2; ty = (event.clientY / innerHeight - .5) * .12; }
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function render(time) {
    if (!motionPaused) {
      stars.rotation.y = time * .000018 + tx;
      stars.rotation.x += (ty - stars.rotation.x) * .02;
      stars.position.y = -scrollY * .0005;
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(render);
  }
  resize(); render(0);
  window.addEventListener("resize", resize);
  if (!coarse) window.addEventListener("pointermove", pointer, { passive: true });
  return () => { cancelAnimationFrame(raf); geometry.dispose(); material.dispose(); renderer.dispose(); };
}
if (!reduced) createCosmos();

/* -------------------------------------------------------------------------- */
/* Portrait particles: local scatter + spring reassembly                       */
/* -------------------------------------------------------------------------- */
function createPortraitParticles() {
  if (reduced) return;
  const canvas = document.querySelector("#portrait-particles");
  const image = document.querySelector(".portrait-stage > img");
  const context = canvas.getContext("2d", { alpha: true });
  const pointer = { x: -999, y: -999, active: false };
  let particles = [], raf = 0, width = 0, height = 0, dpr = 1;

  function build() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = Math.min(devicePixelRatio, coarse ? 1 : 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sample = document.createElement("canvas");
    sample.width = width; sample.height = height;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const boxRatio = width / height;
    let sw = image.naturalWidth, sh = image.naturalHeight, sx = 0, sy = 0;
    if (imageRatio > boxRatio) { sw = image.naturalHeight * boxRatio; sx = (image.naturalWidth - sw) / 2; }
    else { sh = image.naturalWidth / boxRatio; sy = (image.naturalHeight - sh) / 2; }
    sampleContext.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
    const pixels = sampleContext.getImageData(0, 0, width, height).data;
    const gap = coarse ? 7 : Math.max(4, Math.round(width / 105));
    particles = [];
    for (let y = 0; y < height; y += gap) {
      for (let x = 0; x < width; x += gap) {
        const i = (Math.floor(y) * width + Math.floor(x)) * 4;
        const brightness = (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
        if (brightness < 9) continue;
        particles.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, size: gap * .55, color: `rgb(${pixels[i]},${pixels[i+1]},${pixels[i+2]})` });
      }
    }
  }

  function move(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
  }
  function leave() { pointer.active = false; }
  function render() {
    context.clearRect(0, 0, width, height);
    const radius = Math.max(48, width * .17);
    for (const p of particles) {
      if (!motionPaused && pointer.active) {
        const dx = p.x - pointer.x, dy = p.y - pointer.y;
        const distance = Math.sqrt(dx*dx + dy*dy) || 1;
        if (distance < radius) {
          const force = (1 - distance / radius) * 2.3;
          p.vx += (dx / distance) * force + (Math.random() - .5) * .4;
          p.vy += (dy / distance) * force + (Math.random() - .5) * .4;
        }
      }
      p.vx += (p.ox - p.x) * .035;
      p.vy += (p.oy - p.y) * .035;
      p.vx *= .88; p.vy *= .88;
      p.x += p.vx; p.y += p.vy;
      context.fillStyle = p.color;
      context.globalAlpha = .82;
      context.fillRect(p.x, p.y, p.size, p.size);
    }
    context.globalAlpha = 1;
    raf = requestAnimationFrame(render);
  }

  const init = () => { build(); render(); };
  if (image.complete) init(); else image.addEventListener("load", init, { once: true });
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(build, 180); });
  window.addEventListener("pointermove", move, { passive: true });
  canvas.addEventListener("pointerleave", leave);
  return () => cancelAnimationFrame(raf);
}
createPortraitParticles();

/* -------------------------------------------------------------------------- */
/* Scroll choreography                                                         */
/* -------------------------------------------------------------------------- */
let lenis;
if (!reduced) {
  lenis = new window.Lenis({ lerp: .075, smoothWheel: true, wheelMultiplier: .9 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(time => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

if (!reduced) {
  ScrollTrigger.batch(".reveal:not(.portrait-stage)", {
    start: "top 86%",
    once: true,
    onEnter: batch => gsap.to(batch, { opacity: 1, y: 0, filter: "blur(0px)", duration: 1, stagger: .12, ease: "power3.out", overwrite: true })
  });

  gsap.to(".about-image img", { yPercent: -8, ease: "none", scrollTrigger: { trigger: ".about-image", start: "top bottom", end: "bottom top", scrub: 1 } });
  gsap.to(".capabilities", { xPercent: -22, ease: "none", scrollTrigger: { trigger: ".capabilities", start: "top bottom", end: "bottom top", scrub: 1 } });

  document.querySelectorAll(".stat").forEach(stat => {
    const strong = stat.querySelector("strong");
    const target = Number(stat.dataset.value);
    const suffix = stat.dataset.suffix;
    const counter = { value: 0 };
    gsap.to(counter, { value: target, duration: 1.8, ease: "power2.out", scrollTrigger: { trigger: stat, start: "top 82%", once: true }, onUpdate: () => { strong.textContent = Math.round(counter.value) + suffix; } });
    gsap.to(stat.querySelector(".stat-orbit"), { rotation: 180, ease: "none", scrollTrigger: { trigger: stat, start: "top bottom", end: "bottom top", scrub: 1 } });
  });

  const cards = [...document.querySelectorAll(".cloud-card")];
  const progressBar = document.querySelector(".project-progress b");
  ScrollTrigger.create({
    trigger: ".projects",
    start: "top top",
    end: "bottom bottom",
    scrub: true,
    onUpdate: ({ progress }) => {
      progressBar.style.width = `${progress * 100}%`;
      cards.forEach((card, index) => {
        const local = progress * cards.length - index;
        let y, rotation, scale = 1, opacity = 1;
        if (local < 0) { y = 110; rotation = index % 2 ? -5 : 5; opacity = 0; }
        else if (local < .2) { const t = 1 - Math.pow(1 - local / .2, 3); y = lerp(110, 0, t); rotation = lerp(index % 2 ? -5 : 5, index % 2 ? -1 : 1, t); opacity = t; }
        else if (local < .78) { y = 0; rotation = index % 2 ? -1 : 1; }
        else { const t = clamp((local - .78) / .22); y = lerp(0, -115, t); rotation = lerp(index % 2 ? -1 : 1, index % 2 ? 5 : -5, t); scale = lerp(1, .9, t); opacity = 1 - t; }
        card.style.transform = `translate3d(0, ${y}vh, 0) rotate(${rotation}deg) scale(${scale})`;
        card.style.opacity = opacity;
        card.style.pointerEvents = local >= .1 && local < .84 ? "auto" : "none";
      });
    }
  });
} else {
  document.querySelectorAll(".reveal").forEach(element => { element.style.opacity = 1; element.style.transform = "none"; element.style.filter = "none"; });
  document.body.classList.remove("is-loading");
}

/* -------------------------------------------------------------------------- */
/* Navigation, pointer polish, and controls                                    */
/* -------------------------------------------------------------------------- */
const sections = [...document.querySelectorAll(".chapter")];
const chapterLinks = [...document.querySelectorAll(".chapter-nav a")];
const observer = new IntersectionObserver(entries => {
  const visible = entries.filter(entry => entry.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  chapterLinks.forEach(link => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
}, { threshold: [.25, .45, .7] });
sections.forEach(section => observer.observe(section));

if (!coarse) {
  const cursor = document.querySelector(".cursor");
  const cursorX = gsap.quickTo(cursor, "x", { duration: .15, ease: "power3" });
  const cursorY = gsap.quickTo(cursor, "y", { duration: .15, ease: "power3" });
  window.addEventListener("pointermove", event => { cursorX(event.clientX); cursorY(event.clientY); }, { passive: true });
  document.querySelectorAll("a,button,.portrait-stage").forEach(element => {
    element.addEventListener("pointerenter", () => cursor.classList.add("active"));
    element.addEventListener("pointerleave", () => cursor.classList.remove("active"));
  });
  document.querySelectorAll(".magnetic").forEach(element => {
    const moveX = gsap.quickTo(element, "x", { duration: .45, ease: "power3" });
    const moveY = gsap.quickTo(element, "y", { duration: .45, ease: "power3" });
    element.addEventListener("pointermove", event => {
      const rect = element.getBoundingClientRect();
      moveX((event.clientX - rect.left - rect.width / 2) * .22);
      moveY((event.clientY - rect.top - rect.height / 2) * .22);
    });
    element.addEventListener("pointerleave", () => { moveX(0); moveY(0); });
  });
}

const motionToggle = document.querySelector(".motion-toggle");
motionToggle.addEventListener("click", () => {
  motionPaused = !motionPaused;
  motionToggle.setAttribute("aria-pressed", String(motionPaused));
  motionToggle.setAttribute("aria-label", motionPaused ? "Resume ambient motion" : "Pause ambient motion");
  document.documentElement.classList.toggle("motion-paused", motionPaused);
  if (lenis) motionPaused ? lenis.stop() : lenis.start();
});

window.addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
