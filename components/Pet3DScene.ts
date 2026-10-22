// 桌宠的 three.js 场景：一朵蓬松的白云，随 mood 飘动/弹跳/着急抖动。
// 纯 vanilla three（不引 react-three-fiber），由 PetWidget 动态 import，
// 只有桌宠可见时才会加载 three 本体。
import * as THREE from "three";

export type Pet3DMood = "idle" | "busy" | "waiting";

export type PetSceneHandle = {
  /** 每帧由 React 侧同步当前状态。 */
  setMood: (mood: Pet3DMood) => void;
  /** 绕竖轴旋转（滚轮控制），单位为弧度增量。 */
  rotate: (delta: number) => void;
  /** 被戳了一下：触发开心蹦跳。 */
  poke: () => void;
  /** 双击：原地转一圈卖萌。 */
  spin: () => void;
  /** 眼神跟随目标，-1..1 归一化坐标。 */
  setLook: (x: number, y: number) => void;
  /** 长时间无互动：打瞌睡。 */
  setSleepy: (sleepy: boolean) => void;
  dispose: () => void;
};

export type PetSceneOptions = {
  /** 转回正面时触发一次，用于打招呼气泡。 */
  onGreet?: () => void;
};

export function mountPetScene(host: HTMLElement, options?: PetSceneOptions): PetSceneHandle {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth || 120, host.clientHeight || 120);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 1.1, 7);
  camera.lookAt(0, 0.5, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(3, 5, 4);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xbcd0ff, 1.2);
  rimLight.position.set(-4, 2, -3);
  scene.add(rimLight);

  // 卡通着色：三阶明暗，云朵看起来像软团子。
  const gradient = new Uint8Array([110, 180, 255]);
  const gradientMap = new THREE.DataTexture(gradient, gradient.length, 1, THREE.RedFormat);
  gradientMap.needsUpdate = true;
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  const puffMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap });
  // 描边：同几何体稍微放大、只渲染背面。
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0xaebfd2, side: THREE.BackSide });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x3a4356 });
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xffb6c1, transparent: true, opacity: 0.85 });

  const group = new THREE.Group();

  // 内置白云：平底 + 三圆顶的经典卡通云，剪影要有起伏才像云。
  const cloudGroup = new THREE.Group();
  // 四朵球的底部都对齐在 y = -0.7，形成平底；顶部两个小球拼出鼓包。
  const puffSpecs: Array<[number, number, number, number]> = [
    [0, 0.25, 0, 0.95],
    [-0.8, -0.05, 0.05, 0.65],
    [0.8, -0.05, 0, 0.66],
    [-0.42, 0.5, 0.3, 0.55],
    [0.48, 0.55, -0.05, 0.55],
  ];
  for (const [x, y, z, r] of puffSpecs) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), puffMat);
    puff.position.set(x, y, z);
    const outline = new THREE.Mesh(puff.geometry, outlineMat);
    outline.scale.setScalar(1.05);
    puff.add(outline);
    cloudGroup.add(puff);
  }
  group.add(cloudGroup);

  // 脸：装进独立子组，方便眼神跟随鼠标整体平移。
  const faceGroup = new THREE.Group();
  const eyeGeo = new THREE.SphereGeometry(0.14, 16, 12);
  const eyeL = new THREE.Mesh(eyeGeo, darkMat);
  eyeL.position.set(-0.27, 0.06, 0.84);
  const eyeR = new THREE.Mesh(eyeGeo, darkMat);
  eyeR.position.set(0.27, 0.06, 0.84);
  // 眼睛里的白色高光（一大一小），瞬间有神。
  const glintGeo = new THREE.SphereGeometry(0.045, 10, 8);
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const glintL = new THREE.Mesh(glintGeo, glintMat);
  glintL.position.set(-0.33, 0.12, 0.94);
  const glintR = new THREE.Mesh(glintGeo, glintMat);
  glintR.position.set(0.21, 0.11, 0.95);
  const glintGeo2 = new THREE.SphereGeometry(0.022, 8, 6);
  const glintL2 = new THREE.Mesh(glintGeo2, glintMat);
  glintL2.position.set(-0.22, 0.02, 0.94);
  const glintR2 = new THREE.Mesh(glintGeo2, glintMat);
  glintR2.position.set(0.32, 0, 0.94);
  const blushGeo = new THREE.SphereGeometry(0.14, 12, 10);
  const blushL = new THREE.Mesh(blushGeo, blushMat);
  blushL.position.set(-0.58, -0.14, 0.66);
  blushL.scale.set(1, 0.55, 0.25);
  const blushR = new THREE.Mesh(blushGeo, blushMat);
  blushR.position.set(0.58, -0.14, 0.66);
  blushR.scale.set(1, 0.55, 0.25);
  // 开口笑：压扁的下半球，比弧线更像在笑。
  const mouth = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    darkMat,
  );
  mouth.position.set(0, -0.1, 0.87);
  mouth.scale.set(1, 0.75, 0.35);
  faceGroup.add(eyeL, eyeR, glintL, glintR, glintL2, glintR2, blushL, blushR, mouth);
  group.add(faceGroup);

  scene.add(group);

  let mood: Pet3DMood = "idle";
  let raf = 0;
  let blinkAt = 2.2;
  let blinkUntil = 0;
  const startedAt = performance.now();
  let pokeAt = -Infinity; // 上次被戳的时刻
  let spinStart: number | null = null; // 转圈动画的开始时刻
  let spinFrom = 0; // 转圈前的朝向
  let lookX = 0; // 眼神跟随目标（-1..1）
  let lookY = 0;
  let sleepy = false;
  let lastInteractAt = performance.now(); // 最后一次被摆弄的时刻
  let greetPending = false; // 被转过且还没回过正面

  const tick = () => {
    const t = (performance.now() - startedAt) / 1000;
    // 眨眼：每 2~4 秒随机眨一次，持续 0.14 秒。
    if (t >= blinkAt) {
      blinkUntil = t + 0.14;
      blinkAt = t + 2 + Math.random() * 2;
    }
    const blinking = t < blinkUntil;
    const eyeScale = blinking || sleepy ? 0.08 : 1;

    if (mood === "busy") {
      // 运行中：小碎步飘上飘下。
      group.position.y = Math.abs(Math.sin(t * 4)) * 0.3;
      group.position.x = 0;
      group.rotation.z = Math.sin(t * 4) * 0.04;
    } else if (mood === "waiting") {
      // 等输入：原地着急地左右摇摆 + 大幅上下飘。
      group.position.y = Math.abs(Math.sin(t * 6)) * 0.5;
      group.position.x = Math.sin(t * 14) * 0.06;
      group.rotation.z = Math.sin(t * 14) * 0.06;
    } else {
      // 空闲：缓慢飘浮（瞌睡时更慢更浅），朝向只由用户滚轮控制，不自动转。
      group.position.y = Math.sin(t * 1.2) * (sleepy ? 0.035 : 0.08);
      group.position.x = 0;
      group.rotation.z = Math.sin(t * 0.8) * 0.03;
    }
    group.scale.set(1, 1, 1);
    eyeL.scale.y = eyeScale;
    eyeR.scale.y = eyeScale;
    glintL.visible = !blinking;
    glintR.visible = !blinking;

    // 眼神跟随：整张脸朝鼠标方向轻微偏移。
    faceGroup.position.x = lookX * 0.12;
    faceGroup.position.y = lookY * 0.08;

    // 被戳：开心地蹦一下（0.6 秒包络），带压扁拉伸。
    const sincePoke = (performance.now() - pokeAt) / 1000;
    if (sincePoke >= 0 && sincePoke < 0.6) {
      const p = Math.sin((sincePoke / 0.6) * Math.PI);
      group.position.y += p * 0.5;
      group.scale.y *= 1 + p * 0.08;
      group.scale.x *= 1 - p * 0.05;
    }

    // 双击转圈：0.9 秒缓动转一整圈。
    if (spinStart !== null) {
      const p = (performance.now() - spinStart) / 900;
      if (p >= 1) {
        group.rotation.y = spinFrom + Math.PI * 2;
        spinStart = null;
      } else {
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        group.rotation.y = spinFrom + eased * Math.PI * 2;
      }
    }

    // 被转过且 15 秒没动静：自己慢慢转回正面，回来后打个招呼。
    const awayFromFront = Math.min(
      Math.abs(((group.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)),
      Math.abs(Math.PI * 2 - (((group.rotation.y % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))),
    );
    if (!sleepy && awayFromFront > 0.05 && performance.now() - lastInteractAt > 15000) {
      const target = Math.round(group.rotation.y / (Math.PI * 2)) * Math.PI * 2;
      group.rotation.y += (target - group.rotation.y) * 0.06;
      if (Math.abs(target - group.rotation.y) < 0.02) {
        group.rotation.y = target;
        if (greetPending) {
          greetPending = false;
          options?.onGreet?.();
        }
      }
    }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    setMood(next) {
      mood = next;
    },
    rotate(delta) {
      group.rotation.y += delta;
      lastInteractAt = performance.now();
      greetPending = true;
    },
    poke() {
      pokeAt = performance.now();
    },
    spin() {
      spinFrom = group.rotation.y;
      spinStart = performance.now();
    },
    setLook(x, y) {
      lookX = x;
      lookY = y;
      lastInteractAt = performance.now();
    },
    setSleepy(next) {
      sleepy = next;
    },
    dispose() {
      cancelAnimationFrame(raf);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
