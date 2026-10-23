import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** Isolated review scene; this candidate is never loaded by the main companion. */
export async function mountPetModelPreview(host: HTMLElement, signal: AbortSignal) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
  camera.position.set(0, 0.97, 3.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.86, 0); controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 1.4; controls.maxDistance = 5;
  controls.minPolarAngle = Math.PI * 0.3; controls.maxPolarAngle = Math.PI * 0.6;
  controls.autoRotateSpeed = 0.7; controls.update(); controls.saveState();
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const lightMap = pmrem.fromScene(environment, 0.04);
  scene.environment = lightMap.texture; scene.environmentIntensity = 0.75;
  environment.dispose(); pmrem.dispose();
  const key = new THREE.DirectionalLight(0xfff1e5, 1.5); key.position.set(-2, 4, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe2ebff, 0.5); fill.position.set(3, 2, 1); scene.add(fill);
  let model: THREE.Group | undefined, mixer: THREE.AnimationMixer | undefined;
  let frame = 0, disposed = false, lastTime = performance.now();
  const resources = { geometry: new Set<THREE.BufferGeometry>(), materials: new Set<THREE.Material>(), textures: new Set<THREE.Texture>() };
  const disposeModel = () => {
    model?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      resources.geometry.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.textures.add(value);
      }
    });
    resources.geometry.forEach((geometry) => geometry.dispose());
    resources.materials.forEach((material) => material.dispose());
    resources.textures.forEach((texture) => texture.dispose());
  };
  const resize = () => {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const tick = (now: number) => {
    if (disposed || document.hidden) return;
    frame = requestAnimationFrame(tick);
    const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
    if (!reducedMotion.matches) mixer?.update(dt);
    controls.update(dt); renderer.render(scene, camera);
    host.dataset.rendered = "true";
    host.dataset.viewAngle = controls.getAzimuthalAngle().toFixed(3);
  };
  const resume = () => {
    cancelAnimationFrame(frame);
    if (!document.hidden && !disposed) { lastTime = performance.now(); frame = requestAnimationFrame(tick); }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
    document.removeEventListener("visibilitychange", resume);
    mixer?.stopAllAction(); if (model) mixer?.uncacheRoot(model);
    disposeModel(); lightMap.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const response = await fetch("/pets/candidates/lin-yue-candidate.glb", { signal });
    if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
    const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
    model = gltf.scene;
    if (disposed) { disposeModel(); throw new DOMException("Preview closed", "AbortError"); }
    const bounds = new THREE.Box3().setFromObject(model);
    const height = bounds.max.y - bounds.min.y;
    const scale = 1.65 / height;
    model.scale.setScalar(scale); model.position.y = -bounds.min.y * scale;
    scene.add(model);
    mixer = new THREE.AnimationMixer(model);
    const idle = gltf.animations.find((clip) => clip.name === "idle");
    if (idle) { mixer.clipAction(idle).play(); mixer.update(0); }
    document.addEventListener("visibilitychange", resume); resume();
    host.dataset.modelReady = "true";
    return {
      dispose,
      setAutoRotate(value: boolean) { controls.autoRotate = value; },
      front() {
        // Flush pending drag momentum before resetting; reset() alone retains that momentum.
        const damping = controls.enableDamping;
        controls.enableDamping = false; controls.update(); controls.reset(); controls.enableDamping = damping;
      },
    };
  } catch (error) { dispose(); throw error; }
}
