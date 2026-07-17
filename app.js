import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const canAnimate = Boolean(gsap && ScrollTrigger);

if (canAnimate) gsap.registerPlugin(ScrollTrigger);

let motionPaused = false;
let lenis;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function removeLoadingState() {
  document.body.classList.remove("is-loading");
}

function revealStaticContent() {
  document.querySelectorAll(".reveal").forEach((element) => {
    element.style.opacity = "1";
    element.style.filter = "none";
    element.style.transform = "none";
  });
}

/* -------------------------------------------------------------------------- */
/* Cinematic event horizon                                                     */
/* -------------------------------------------------------------------------- */
const intro = document.querySelector("#intro");
const wormholeCanvas = document.querySelector("#wormhole");
let wormholeCleanup = () => {};
let introTimeline;

function createWormhole() {
  const renderer = new THREE.WebGLRenderer({
    canvas: wormholeCanvas,
    antialias: false,
    powerPreference: coarse ? "low-power" : "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1 : 1.65));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

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
    vertexShader: "void main(){ gl_Position = vec4(position, 1.0); }",
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uTravel;
      uniform vec2 uResolution;
      uniform vec2 uPointer;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x),
          f.y
        );
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p = turn * p * 2.03 + 7.13;
          amplitude *= 0.48;
        }
        return value;
      }

      vec3 chromePalette(float t) {
        vec3 cold = vec3(0.09, 0.55, 0.48);
        vec3 ice = vec3(0.56, 1.0, 0.91);
        vec3 steel = vec3(0.18, 0.25, 0.27);
        return mix(steel, mix(cold, ice, smoothstep(0.3, 0.86, t)), t);
      }

      void main() {
        vec2 frag = gl_FragCoord.xy;
        vec2 uv = (2.0 * frag - uResolution.xy) / min(uResolution.x, uResolution.y);
        uv -= uPointer * 0.035;
        float radius = length(uv);
        float angle = atan(uv.y, uv.x);
        float time = uTime * 0.17 + uTravel * 2.9;
        float inverseRadius = 1.0 / max(radius, 0.025);
        vec3 color = vec3(0.001, 0.003, 0.004);

        // Deep stars bend into arcs as they approach the gravitational lens.
        vec2 starSpace = vec2(angle * 14.0, inverseRadius * 2.1 + time * 3.5);
        vec2 starCell = floor(starSpace);
        vec2 starLocal = fract(starSpace) - 0.5;
        float seed = hash21(starCell);
        float star = smoothstep(0.05, 0.0, length(starLocal)) * step(0.966, seed);
        star *= smoothstep(0.12, 0.46, radius) * (0.65 + uTravel * 2.8);
        color += star * mix(vec3(0.35, 0.65, 1.0), vec3(0.66, 1.0, 0.88), seed) * 3.5;

        // Layered turbulence creates the accretion flow.
        float turbulence = fbm(vec2(angle * 2.15 - time * 0.24, inverseRadius * 1.38 + time));
        float diskWarp = (turbulence - 0.5) * 0.038;
        float disk = exp(-pow(abs(radius - 0.265 - diskWarp) * 20.0, 1.45));
        float doppler = 0.45 + 0.82 * smoothstep(-1.0, 1.0, cos(angle - 0.42));
        color += chromePalette(turbulence) * disk * doppler * 2.25;

        // Thin photon rings sell the depth of the black throat.
        float photonRing = exp(-abs(radius - 0.167) * 125.0);
        float hotRim = exp(-abs(radius - 0.205) * 46.0) * (0.3 + turbulence);
        color += vec3(0.72, 1.0, 0.93) * photonRing * 4.0;
        color += vec3(0.15, 0.75, 0.67) * hotRim * 0.8;

        // Travel stretches matter into a volumetric tunnel.
        vec2 tunnelSpace = vec2(angle / 6.28318 + 0.16 / max(radius, 0.055), inverseRadius + time);
        float streams = pow(max(0.0, sin(tunnelSpace.y * 2.15 + fbm(tunnelSpace * 2.0) * 5.2)), 11.0);
        streams *= smoothstep(0.17, 0.92, radius) * uTravel;
        color += mix(vec3(0.04, 0.25, 0.28), vec3(0.45, 1.0, 0.83), turbulence) * streams * 1.7;

        // Preserve a genuinely black event horizon.
        float throat = smoothstep(0.155, 0.103, radius);
        color *= 1.0 - throat;
        color += vec3(0.002, 0.006, 0.007) * smoothstep(0.12, 0.045, radius);

        float vignette = 1.0 - smoothstep(0.55, 1.5, radius);
        color *= 0.28 + 0.72 * vignette;
        color *= 1.0 + uTravel * 0.38;
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(plane);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), coarse ? .72 : 1.12, .62, .42));

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    uniforms.uResolution.value.set(width * renderer.getPixelRatio(), height * renderer.getPixelRatio());
  }

  function pointer(event) {
    uniforms.uPointer.value.set(event.clientX / innerWidth - .5, .5 - event.clientY / innerHeight);
  }

  resize();
  window.addEventListener("resize", resize);
  if (!coarse) window.addEventListener("pointermove", pointer, { passive: true });

  let raf = 0;
  let previous = performance.now();
  function render(now = performance.now()) {
    const delta = Math.min((now - previous) / 1000, .04);
    previous = now;
    if (!motionPaused && !document.hidden) uniforms.uTime.value += delta;
    composer.render();
    raf = requestAnimationFrame(render);
  }
  render();

  wormholeCleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", pointer);
    plane.geometry.dispose();
    material.dispose();
    composer.dispose();
    renderer.dispose();
  };

  return uniforms;
}

function heroEntrance() {
  if (!canAnimate || reduced) {
    revealStaticContent();
    return;
  }

  gsap.timeline()
    .from(".site-header", { y: -22, opacity: 0, duration: .65, ease: "power3.out" })
    .from(".title-line b", { yPercent: 110, duration: .95, stagger: .085, ease: "power4.out" }, "-=.25")
    .from(".hero-kicker,.hero-lede,.hero-actions,.hero-facts", { y: 18, opacity: 0, duration: .68, stagger: .075, ease: "power3.out" }, "-=.55")
    .to(".portrait-lab", { opacity: 1, y: 0, filter: "blur(0px)", duration: 1, ease: "power3.out" }, "-=.75");
}

function closeIntro(immediate = false) {
  if (!intro || intro.dataset.closed) return;
  intro.dataset.closed = "true";
  introTimeline?.kill();

  try {
    sessionStorage.setItem("alf-intro-seen", "1");
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }

  const finish = () => {
    wormholeCleanup();
    intro.remove();
    removeLoadingState();
    heroEntrance();
    if (canAnimate) ScrollTrigger.refresh();
  };

  if (immediate || !canAnimate) {
    finish();
    return;
  }

  gsap.to(intro, { opacity: 0, scale: 1.06, duration: .58, ease: "power3.inOut", onComplete: finish });
}

let introSeen = false;
try {
  introSeen = Boolean(sessionStorage.getItem("alf-intro-seen"));
} catch {
  introSeen = false;
}

if (!intro || reduced || !canAnimate || introSeen) {
  intro?.remove();
  removeLoadingState();
  heroEntrance();
} else {
  try {
    const wormhole = createWormhole();
    const counter = { value: 0 };
    introTimeline = gsap.timeline({ onComplete: () => closeIntro(false) })
      .to(counter, {
        value: 100,
        duration: 2.85,
        ease: "power2.inOut",
        onUpdate: () => {
          const display = document.querySelector(".intro-status b");
          if (display) display.textContent = `${Math.round(counter.value).toString().padStart(2, "0")}%`;
        }
      })
      .to(".intro-progress i", { width: "100%", duration: 2.85, ease: "power2.inOut" }, 0)
      .to(wormhole.uTravel, { value: 1, duration: 2.85, ease: "power3.in" }, 0)
      .to(".intro-copy", { opacity: 0, y: -20, duration: .42, ease: "power2.in" }, 2.38)
      .to("#wormhole", { filter: "brightness(3.2)", duration: .22 }, 2.68);
    document.querySelector(".intro-skip")?.addEventListener("click", () => closeIntro(false));
  } catch (error) {
    console.warn("WebGL intro unavailable; continuing with the portfolio.", error);
    closeIntro(true);
  }
}

/* -------------------------------------------------------------------------- */
/* Ambient universe                                                            */
/* -------------------------------------------------------------------------- */
function createCosmos() {
  const canvas = document.querySelector("#cosmos");
  if (!canvas || reduced) return;

  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1 : 1.35));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 1, .1, 100);
    camera.position.z = 8;

    const count = coarse ? 360 : 1050;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cold = new THREE.Color(0x8bffe7);
    const steel = new THREE.Color(0x6f8793);

    for (let index = 0; index < count; index += 1) {
      const radius = 3.8 + Math.random() * 14;
      const angle = Math.random() * Math.PI * 2;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = (Math.random() - .5) * 13;
      positions[index * 3 + 2] = (Math.random() - .5) * 16;
      const color = steel.clone().lerp(cold, Math.random() * .75);
      colors.set([color.r, color.g, color.b], index * 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: coarse ? .018 : .024,
      transparent: true,
      opacity: .5,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const field = new THREE.Points(geometry, material);
    scene.add(field);

    let targetX = 0;
    let targetY = 0;
    let raf = 0;

    function pointer(event) {
      targetX = (event.clientX / innerWidth - .5) * .16;
      targetY = (event.clientY / innerHeight - .5) * .1;
    }

    function resize() {
      renderer.setSize(innerWidth, innerHeight, false);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    }

    function render(time = 0) {
      if (!motionPaused && !document.hidden) {
        field.rotation.y += (targetX + time * .000012 - field.rotation.y) * .018;
        field.rotation.x += (targetY - field.rotation.x) * .018;
        field.position.y = -window.scrollY * .00035;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    }

    resize();
    render();
    window.addEventListener("resize", resize);
    if (!coarse) window.addEventListener("pointermove", pointer, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", pointer);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  } catch (error) {
    console.warn("Ambient WebGL unavailable.", error);
  }
}

createCosmos();

/* -------------------------------------------------------------------------- */
/* Chrome reactor behind the portrait                                          */
/* -------------------------------------------------------------------------- */
function createReactor() {
  const canvas = document.querySelector("#reactor");
  const stage = document.querySelector(".portrait-lab");
  if (!canvas || !stage || reduced) return;

  try {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !coarse, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1 : 1.45));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 100);
    camera.position.set(0, 0, 7);

    const group = new THREE.Group();
    scene.add(group);

    const segments = coarse ? 64 : 128;
    const chrome = new THREE.MeshPhysicalMaterial({
      color: 0x596463,
      metalness: .95,
      roughness: .17,
      clearcoat: 1,
      clearcoatRoughness: .12,
      emissive: 0x07110f,
      emissiveIntensity: .45
    });
    const darkChrome = new THREE.MeshPhysicalMaterial({
      color: 0x111617,
      metalness: .96,
      roughness: .22,
      clearcoat: .9,
      emissive: 0x06100e,
      emissiveIntensity: .32
    });

    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.35, .075, 16, segments), chrome);
    outerRing.rotation.x = 1.1;
    outerRing.rotation.y = .32;
    group.add(outerRing);

    const middleRing = new THREE.Mesh(new THREE.TorusGeometry(1.82, .035, 12, segments), darkChrome);
    middleRing.rotation.x = .38;
    middleRing.rotation.y = 1.05;
    group.add(middleRing);

    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(1.36, .022, 10, segments), chrome);
    innerRing.rotation.x = 1.55;
    innerRing.rotation.z = .4;
    group.add(innerRing);

    const nodes = new THREE.Group();
    const nodeGeometry = new THREE.SphereGeometry(.07, coarse ? 8 : 14, coarse ? 8 : 14);
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0x8bffe7, toneMapped: false });
    for (let index = 0; index < 7; index += 1) {
      const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
      const angle = (index / 7) * Math.PI * 2;
      node.position.set(Math.cos(angle) * 2.35, Math.sin(angle) * 2.35, 0);
      nodes.add(node);
    }
    nodes.rotation.copy(outerRing.rotation);
    group.add(nodes);

    scene.add(new THREE.AmbientLight(0x9bc3bd, .55));
    const key = new THREE.PointLight(0x8bffe7, 18, 12);
    key.position.set(3, 2, 4);
    scene.add(key);
    const rim = new THREE.PointLight(0x6b87ff, 10, 10);
    rim.position.set(-3, -1, 2);
    scene.add(rim);
    const white = new THREE.PointLight(0xffffff, 12, 10);
    white.position.set(0, 4, 3);
    scene.add(white);

    let pointerX = 0;
    let pointerY = 0;
    let active = true;
    let raf = 0;
    let previous = 0;

    function pointer(event) {
      const rect = stage.getBoundingClientRect();
      pointerX = clamp((event.clientX - rect.left) / rect.width - .5, -.5, .5);
      pointerY = clamp((event.clientY - rect.top) / rect.height - .5, -.5, .5);
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function render(time = 0) {
      if (active && !motionPaused && !document.hidden && time - previous > (coarse ? 32 : 15)) {
        previous = time;
        group.rotation.y += .0022;
        outerRing.rotation.z += .0014;
        middleRing.rotation.z -= .002;
        innerRing.rotation.y += .0026;
        nodes.rotation.z = outerRing.rotation.z;
        group.rotation.x += (pointerY * .18 - group.rotation.x) * .025;
        group.rotation.z += (-pointerX * .15 - group.rotation.z) * .025;
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(render);
    }

    const observer = new IntersectionObserver(([entry]) => {
      active = entry.isIntersecting;
      if (active) renderer.render(scene, camera);
    }, { rootMargin: "20%" });

    observer.observe(stage);
    resize();
    renderer.render(scene, camera);
    render();
    window.addEventListener("resize", resize);
    if (!coarse) stage.addEventListener("pointermove", pointer, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      stage.removeEventListener("pointermove", pointer);
      outerRing.geometry.dispose();
      middleRing.geometry.dispose();
      innerRing.geometry.dispose();
      nodeGeometry.dispose();
      chrome.dispose();
      darkChrome.dispose();
      nodeMaterial.dispose();
      renderer.dispose();
    };
  } catch (error) {
    console.warn("Portrait reactor unavailable.", error);
  }
}

createReactor();

/* -------------------------------------------------------------------------- */
/* Portrait particles: local scatter and spring reassembly                     */
/* -------------------------------------------------------------------------- */
function createPortraitParticles() {
  if (reduced || coarse) return;

  const canvas = document.querySelector("#portrait-particles");
  const image = document.querySelector(".portrait-frame > img");
  if (!canvas || !image) return;

  const context = canvas.getContext("2d", { alpha: true });
  const pointer = { x: -999, y: -999, active: false };
  let particles = [];
  let raf = 0;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let resizeTimer;

  function build() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio, 1.45);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sample = document.createElement("canvas");
    sample.width = width;
    sample.height = height;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const frameRatio = width / height;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (imageRatio > frameRatio) {
      sourceWidth = image.naturalHeight * frameRatio;
      sourceX = (image.naturalWidth - sourceWidth) / 2;
    } else {
      sourceHeight = image.naturalWidth / frameRatio;
      sourceY = (image.naturalHeight - sourceHeight) / 2;
    }

    sampleContext.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    const pixels = sampleContext.getImageData(0, 0, width, height).data;
    const gap = Math.max(4, Math.round(width / 94));
    const nextParticles = [];

    for (let y = 0; y < height; y += gap) {
      for (let x = 0; x < width; x += gap) {
        const pixelIndex = (Math.floor(y) * width + Math.floor(x)) * 4;
        const red = pixels[pixelIndex];
        const green = pixels[pixelIndex + 1];
        const blue = pixels[pixelIndex + 2];
        const alpha = pixels[pixelIndex + 3];
        const brightness = (red + green + blue) / 3;
        if (alpha < 90 || brightness < 8) continue;

        nextParticles.push({
          x,
          y,
          originX: x,
          originY: y,
          velocityX: 0,
          velocityY: 0,
          size: Math.max(1.1, gap * .54),
          color: `rgb(${red}, ${green}, ${blue})`
        });
      }
    }

    particles = nextParticles;
  }

  function move(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= rect.width && pointer.y <= rect.height;
  }

  function leave() {
    pointer.active = false;
  }

  function render() {
    context.clearRect(0, 0, width, height);
    const radius = Math.max(54, width * .2);

    for (const particle of particles) {
      if (!motionPaused && pointer.active) {
        const deltaX = particle.x - pointer.x;
        const deltaY = particle.y - pointer.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
        if (distance < radius) {
          const force = (1 - distance / radius) * 2.35;
          particle.velocityX += (deltaX / distance) * force + (Math.random() - .5) * .28;
          particle.velocityY += (deltaY / distance) * force + (Math.random() - .5) * .28;
        }
      }

      particle.velocityX += (particle.originX - particle.x) * .034;
      particle.velocityY += (particle.originY - particle.y) * .034;
      particle.velocityX *= .875;
      particle.velocityY *= .875;
      particle.x += particle.velocityX;
      particle.y += particle.velocityY;

      context.globalAlpha = .86;
      context.fillStyle = particle.color;
      context.fillRect(particle.x, particle.y, particle.size, particle.size);
    }

    context.globalAlpha = 1;
    raf = requestAnimationFrame(render);
  }

  function init() {
    build();
    render();
  }

  if (image.complete && image.naturalWidth) init();
  else image.addEventListener("load", init, { once: true });

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 180);
  });
  window.addEventListener("pointermove", move, { passive: true });
  canvas.addEventListener("pointerleave", leave);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerleave", leave);
  };
}

createPortraitParticles();

/* -------------------------------------------------------------------------- */
/* Scroll choreography                                                         */
/* -------------------------------------------------------------------------- */
if (!reduced && canAnimate) {
  lenis = new window.Lenis({ lerp: .078, smoothWheel: true, wheelMultiplier: .9 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  ScrollTrigger.batch(".reveal:not(.portrait-lab)", {
    start: "top 88%",
    once: true,
    onEnter: (batch) => {
      gsap.to(batch, {
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
        duration: .9,
        stagger: .09,
        ease: "power3.out",
        overwrite: true
      });
    }
  });

  document.querySelectorAll(".metric[data-value]").forEach((metric) => {
    const display = metric.querySelector("strong");
    const target = Number(metric.dataset.value);
    const suffix = metric.dataset.suffix || "";
    const counter = { value: 0 };
    gsap.to(counter, {
      value: target,
      duration: 1.45,
      ease: "power2.out",
      scrollTrigger: { trigger: metric, start: "top 90%", once: true },
      onUpdate: () => {
        display.textContent = `${Math.round(counter.value)}${suffix}`;
      }
    });
  });

  gsap.to(".profile-image img", {
    yPercent: -7,
    ease: "none",
    scrollTrigger: { trigger: ".profile-image", start: "top bottom", end: "bottom top", scrub: 1 }
  });

  gsap.to(".tool-marquee > div", {
    xPercent: -22,
    ease: "none",
    scrollTrigger: { trigger: ".tool-marquee", start: "top bottom", end: "bottom top", scrub: 1 }
  });

  const projectCards = [...document.querySelectorAll(".project-card")];
  projectCards.forEach((card) => {
    gsap.from(card, {
      y: 70,
      opacity: 0,
      duration: .8,
      ease: "power3.out",
      scrollTrigger: { trigger: card, start: "top 91%", once: true }
    });
  });

  if (window.matchMedia("(min-width: 701px)").matches) {
    projectCards.slice(0, -1).forEach((card, index) => {
      gsap.to(card, {
        scale: .94,
        filter: "brightness(.42) saturate(.7)",
        ease: "none",
        scrollTrigger: {
          trigger: projectCards[index + 1],
          start: "top 86%",
          end: "top 12%",
          scrub: true
        }
      });
    });
  }
} else {
  removeLoadingState();
  revealStaticContent();
}

/* -------------------------------------------------------------------------- */
/* Navigation, cursor, magnetic controls, and motion pause                     */
/* -------------------------------------------------------------------------- */
const sections = [...document.querySelectorAll(".chapter")];
const chapterLinks = [...document.querySelectorAll(".rail-nav a")];
const sectionObserver = new IntersectionObserver((entries) => {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

  if (!visible) return;
  chapterLinks.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`);
  });
}, { threshold: [.2, .42, .68] });

sections.forEach((section) => sectionObserver.observe(section));

if (!coarse && canAnimate) {
  const cursor = document.querySelector(".cursor");
  const cursorX = gsap.quickTo(cursor, "x", { duration: .14, ease: "power3" });
  const cursorY = gsap.quickTo(cursor, "y", { duration: .14, ease: "power3" });

  window.addEventListener("pointermove", (event) => {
    cursorX(event.clientX);
    cursorY(event.clientY);
  }, { passive: true });

  document.querySelectorAll("a,button,.portrait-lab").forEach((element) => {
    element.addEventListener("pointerenter", () => cursor.classList.add("active"));
    element.addEventListener("pointerleave", () => cursor.classList.remove("active"));
  });

  document.querySelectorAll(".magnetic").forEach((element) => {
    const moveX = gsap.quickTo(element, "x", { duration: .42, ease: "power3" });
    const moveY = gsap.quickTo(element, "y", { duration: .42, ease: "power3" });

    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect();
      moveX((event.clientX - rect.left - rect.width / 2) * .2);
      moveY((event.clientY - rect.top - rect.height / 2) * .2);
    });

    element.addEventListener("pointerleave", () => {
      moveX(0);
      moveY(0);
    });
  });
}

const motionToggle = document.querySelector(".motion-toggle");
motionToggle?.addEventListener("click", () => {
  motionPaused = !motionPaused;
  motionToggle.setAttribute("aria-pressed", String(motionPaused));
  motionToggle.setAttribute("aria-label", motionPaused ? "Resume ambient motion" : "Pause ambient motion");
  document.documentElement.classList.toggle("motion-paused", motionPaused);
  if (lenis) {
    if (motionPaused) lenis.stop();
    else lenis.start();
  }
});

window.addEventListener("load", () => {
  if (canAnimate) ScrollTrigger.refresh();
}, { once: true });

// Never leave the document inaccessible if a third-party animation resource fails.
window.setTimeout(() => {
  if (document.body.classList.contains("is-loading") && (!intro || !document.body.contains(intro))) {
    removeLoadingState();
    revealStaticContent();
  }
}, 6000);
