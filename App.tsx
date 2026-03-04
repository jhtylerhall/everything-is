import { Audio } from 'expo-av';
import { GLView } from 'expo-gl';
import { StatusBar } from 'expo-status-bar';
import { Renderer } from 'expo-three';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as THREE from 'three';

type Screen = 'menu' | 'game' | 'gameover';

type RollAnim = {
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  axis: THREE.Vector3;
  pivot: THREE.Vector3;
  elapsed: number;
  duration: number;
};

type Gate = {
  id: string;
  axis: 'x' | 'z';
  at: number;
  gapCenter: number;
  gapWidth: number;
  clearance: number;
  triggerX: number;
  triggerZ: number;
  triggerAxis: 'x' | 'z';
  triggerMaxHalfY: number;
  tip: string;
};

type GateDoorVisual = {
  door: THREE.Mesh;
  beam?: THREE.Mesh;
  completionArrow?: THREE.Mesh;
  closedY: number;
  openY: number;
  openness: number;
  targetOpenness: number;
  indicators: THREE.Mesh[];
};

type FaceKey = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const BUILD_TAG = 'world-align-29';

const FLOOR_Y = 0.01;
const ARENA_HALF = 20;
const GRID_STEP = 0.5;
const MARKER_SNAP_RADIUS = 0.92;
const BOUNDARY_MARGIN = 0.5;
const GATE_THICKNESS = 0.8;
const GATE_HEIGHT = 3.4;
const RAIL_HEIGHT = 0.42;
const RAIL_THICKNESS = 0.18;
const BLOCK_SIZE = { x: 1.45, y: 0.9, z: 2.25 };
const HALF = {
  x: BLOCK_SIZE.x / 2,
  y: BLOCK_SIZE.y / 2,
  z: BLOCK_SIZE.z / 2,
};

const GATES: Gate[] = [
  {
    id: 'gate-1',
    axis: 'z',
    at: -4.0,
    gapCenter: 0.0,
    gapWidth: 2.0,
    clearance: 1.18,
    triggerX: -2.0,
    triggerZ: -1.0,
    triggerAxis: 'z',
    triggerMaxHalfY: 0.52,
    tip: 'Intro: one-flip setup.',
  },
  {
    id: 'gate-2',
    axis: 'z',
    at: -9.0,
    gapCenter: 2.5,
    gapWidth: 2.3,
    clearance: 1.35,
    triggerX: 1.0,
    triggerZ: -6.5,
    triggerAxis: 'x',
    triggerMaxHalfY: 0.72,
    tip: 'Orientation shift: long-side X.',
  },
  {
    id: 'gate-3',
    axis: 'x',
    at: 5.8,
    gapCenter: -10.2,
    gapWidth: 1.6,
    clearance: 1.3,
    triggerX: 3.8,
    triggerZ: -9.8,
    triggerAxis: 'z',
    triggerMaxHalfY: 0.62,
    tip: 'Tighter landing chain.',
  },
  {
    id: 'gate-4',
    axis: 'z',
    at: -14.0,
    gapCenter: 7.0,
    gapWidth: 1.5,
    clearance: 1.28,
    triggerX: 6.6,
    triggerZ: -12.2,
    triggerAxis: 'x',
    triggerMaxHalfY: 0.6,
    tip: 'Late-mid orientation precision.',
  },
  {
    id: 'gate-5',
    axis: 'x',
    at: 11.5,
    gapCenter: -16.2,
    gapWidth: 1.4,
    clearance: 1.25,
    triggerX: 9.0,
    triggerZ: -15.0,
    triggerAxis: 'z',
    triggerMaxHalfY: 0.58,
    tip: 'Punishing chain, low tolerance.',
  },
  {
    id: 'gate-6',
    axis: 'z',
    at: -18.0,
    gapCenter: 10.5,
    gapWidth: 1.35,
    clearance: 1.2,
    triggerX: 10.2,
    triggerZ: -17.2,
    triggerAxis: 'x',
    triggerMaxHalfY: 0.56,
    tip: 'Final conversion gate.',
  },
];

let splooshAudioContext: any = null;
let splooshSound: Audio.Sound | null = null;
let splooshLoadPromise: Promise<void> | null = null;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function snapToGrid(v: number) {
  return Math.round(v / GRID_STEP) * GRID_STEP;
}

function snapYawTo90(deg: number) {
  return Math.round(deg / 90) * 90;
}

function localDownFaceKey(q: THREE.Quaternion): FaceKey {
  const inv = q.clone().invert();
  const localDown = new THREE.Vector3(0, -1, 0).applyQuaternion(inv);
  if (Math.abs(localDown.x) >= Math.abs(localDown.y) && Math.abs(localDown.x) >= Math.abs(localDown.z)) {
    return localDown.x >= 0 ? 'px' : 'nx';
  }
  if (Math.abs(localDown.y) >= Math.abs(localDown.x) && Math.abs(localDown.y) >= Math.abs(localDown.z)) {
    return localDown.y >= 0 ? 'py' : 'ny';
  }
  return localDown.z >= 0 ? 'pz' : 'nz';
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function playSplooshWebFallback(intensity = 1) {
  try {
    const globalAny = globalThis as any;
    const AudioCtx = globalAny.AudioContext || globalAny.webkitAudioContext;
    if (!AudioCtx) return;

    if (!splooshAudioContext) splooshAudioContext = new AudioCtx();
    const ctx: any = splooshAudioContext;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime as number;
    const len = Math.floor(ctx.sampleRate * 0.09);

    const noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const falloff = 1 - i / len;
      data[i] = (Math.random() * 2 - 1) * falloff;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(980 * intensity, now);
    filter.frequency.exponentialRampToValueAtTime(170, now + 0.14);

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.exponentialRampToValueAtTime(0.34 * intensity, now + 0.012);
    g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    noise.connect(filter);
    filter.connect(g1);
    g1.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.16);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(176, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.16);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.exponentialRampToValueAtTime(0.11 * intensity, now + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    osc.connect(g2);
    g2.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch {
    // no-op
  }
}

async function ensureSplooshLoaded() {
  if (splooshSound) return;
  if (!splooshLoadPromise) {
    splooshLoadPromise = (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });

        const loaded = await Audio.Sound.createAsync(
          require('./assets/sounds/cheese-sploosh.wav'),
          { shouldPlay: false, volume: 0.9 }
        );
        splooshSound = loaded.sound;
      } catch {
        splooshSound = null;
      }
    })();
  }

  await splooshLoadPromise;
}

function playSploosh(intensity = 1) {
  const rate = clamp(0.9 + intensity * 0.16, 0.82, 1.4);
  const volume = clamp(0.26 + intensity * 0.3, 0.18, 1);

  void (async () => {
    try {
      await ensureSplooshLoaded();
      if (splooshSound) {
        await splooshSound.replayAsync({ rate, shouldCorrectPitch: true, volume });
        return;
      }
    } catch {
      // fallback below
    }

    playSplooshWebFallback(intensity);
  })();
}

function supportRadius(q: THREE.Quaternion, dir: THREE.Vector3) {
  const ux = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const uy = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const uz = new THREE.Vector3(0, 0, 1).applyQuaternion(q);

  return (
    Math.abs(dir.dot(ux)) * HALF.x +
    Math.abs(dir.dot(uy)) * HALF.y +
    Math.abs(dir.dot(uz)) * HALF.z
  );
}

function blockHalfExtents(q: THREE.Quaternion) {
  return {
    x: supportRadius(q, new THREE.Vector3(1, 0, 0)),
    y: supportRadius(q, new THREE.Vector3(0, 1, 0)),
    z: supportRadius(q, new THREE.Vector3(0, 0, 1)),
  };
}

function pseudo(n: number) {
  const x = Math.sin(n * 91.173 + 0.77) * 43758.5453;
  return x - Math.floor(x);
}

function restingCenterY(q: THREE.Quaternion) {
  return FLOOR_Y + supportRadius(q, new THREE.Vector3(0, 1, 0));
}

function quantizeToCardinalXZ(v: THREE.Vector3) {
  const d = v.clone().setY(0);
  if (d.lengthSq() < 1e-6) return new THREE.Vector3(1, 0, 0);

  if (Math.abs(d.x) >= Math.abs(d.z)) {
    return new THREE.Vector3(Math.sign(d.x) || 1, 0, 0);
  }
  return new THREE.Vector3(0, 0, Math.sign(d.z) || 1);
}

function buildOrthogonalQuats() {
  const out: THREE.Quaternion[] = [new THREE.Quaternion()];
  const queue: THREE.Quaternion[] = [out[0].clone()];

  const steps = [
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
  ];

  while (queue.length) {
    const current = queue.shift()!;
    for (const step of steps) {
      const next = current.clone().multiply(step).normalize();
      const exists = out.some((q) => Math.abs(q.dot(next)) > 0.9999);
      if (!exists) {
        out.push(next.clone());
        queue.push(next);
      }
    }
  }

  return out;
}

const ORTHO_QUATS = buildOrthogonalQuats();

function snapToOrthogonalQuat(q: THREE.Quaternion) {
  let best = ORTHO_QUATS[0];
  let bestDot = -1;
  for (const candidate of ORTHO_QUATS) {
    const d = Math.abs(candidate.dot(q));
    if (d > bestDot) {
      bestDot = d;
      best = candidate;
    }
  }
  return best.clone();
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');

  return (
    <SafeAreaView style={styles.safe}>
      {screen === 'menu' && <MainMenu onStart={() => setScreen('game')} />}
      {screen === 'game' && <CubeLab onBack={() => setScreen('menu')} onGameOver={() => setScreen('gameover')} />}
      {screen === 'gameover' && <GameOverScreen onRestart={() => setScreen('game')} onMenu={() => setScreen('menu')} />}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

function MainMenu({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.menuWrap}>
      <View style={styles.menuOrbA} />
      <View style={styles.menuOrbB} />

      <Text style={styles.title}>Josh’s Block</Text>

      <Pressable style={styles.menuButtonPrimary} onPress={onStart}>
        <Text style={styles.menuButtonPrimaryText}>Start</Text>
      </Pressable>
    </View>
  );
}

function GameOverScreen({ onRestart, onMenu }: { onRestart: () => void; onMenu: () => void }) {
  return (
    <View style={styles.menuWrap}>
      <Text style={styles.title}>You’re just a block of cream cheese.</Text>
      <Pressable style={styles.menuButtonPrimary} onPress={onRestart}>
        <Text style={styles.menuButtonPrimaryText}>Restart</Text>
      </Pressable>
      <Pressable style={styles.menuButtonGhost} onPress={onMenu}>
        <Text style={styles.menuButtonGhostText}>Menu</Text>
      </Pressable>
    </View>
  );
}

function CubeLab({ onBack, onGameOver }: { onBack: () => void; onGameOver: () => void }) {
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const blockRef = useRef<THREE.Mesh | null>(null);
  const shadowRef = useRef<THREE.Mesh | null>(null);
  const gateDoorRefs = useRef<Record<string, GateDoorVisual>>({});
  const gateTriggerRefs = useRef<Record<string, THREE.Object3D>>({});
  const gateTriggerPosRefs = useRef<Record<string, { x: number; z: number }>>({});
  const activatedGatesRef = useRef<Set<string>>(new Set());
  const phoneFaceSetRef = useRef<Set<FaceKey>>(new Set());
  const phoneFaceOverlaysRef = useRef<Record<FaceKey, THREE.Mesh | null>>({ px: null, nx: null, py: null, ny: null, pz: null, nz: null });
  const hpRef = useRef(100);
  const rafRef = useRef<number | null>(null);

  const blockStateRef = useRef({
    pos: new THREE.Vector3(0, HALF.y + FLOOR_Y, 0),
    quat: new THREE.Quaternion(),
  });

  const rollRef = useRef<RollAnim | null>(null);
  const cameraTargetRef = useRef({ yaw: 8, pitch: 28 });
  const cameraStateRef = useRef({ yaw: 8, pitch: 28 });
  const cameraFollowRef = useRef({ x: 0, z: 0, y: HALF.y + FLOOR_Y });
  const cameraSnapRef = useRef<{ startYaw: number; endYaw: number; elapsed: number; duration: number } | null>(null);
  const pendingTurnRef = useRef(0);

  const gestureModeRef = useRef<'move' | 'camera' | null>(null);
  const lastGestureRef = useRef({ dx: 0, dy: 0 });

  const [hud, setHud] = useState({ speed: '0.00', cam: '8°', axis: 'Z', face: 'N', gate: '0/6', target: 'G1', hp: '100', form: '0/6' });
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHudRef = useRef(0);
  const prevPosForSpeedRef = useRef(new THREE.Vector3(0, HALF.y + FLOOR_Y, 0));
  const lastTsRef = useRef(0);

  const showToast = useCallback((text: string, ms = 1100) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), ms);
  }, []);

  const queueCameraTurn = useCallback((dir: -1 | 1) => {
    pendingTurnRef.current += dir;
  }, []);

  const phoneFaceOrder: FaceKey[] = ['pz', 'nz', 'px', 'nx', 'py', 'ny'];

  const tryRoll = useCallback((dirWorld: THREE.Vector3) => {
    if (rollRef.current) return;

    const d = quantizeToCardinalXZ(dirWorld);

    const state = blockStateRef.current;
    const q0 = state.quat.clone();
    const c0 = state.pos.clone();

    const up = new THREE.Vector3(0, 1, 0);
    const axis = new THREE.Vector3().crossVectors(up, d).normalize();
    if (axis.lengthSq() < 1e-5) return;

    const rUp = supportRadius(q0, up);
    const rDir = supportRadius(q0, d);
    const pivot = c0.clone().addScaledVector(d, rDir).addScaledVector(up, -rUp);

    const rot90 = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2);
    const testPos = c0.clone().sub(pivot).applyQuaternion(rot90).add(pivot);
    const testQuat = rot90.clone().multiply(q0).normalize();

    testPos.x = snapToGrid(testPos.x);
    testPos.z = snapToGrid(testPos.z);
    testPos.y = restingCenterY(testQuat);

    const ext = blockHalfExtents(testQuat);
    if (
      Math.abs(testPos.x) + ext.x > ARENA_HALF - BOUNDARY_MARGIN ||
      Math.abs(testPos.z) + ext.z > ARENA_HALF - BOUNDARY_MARGIN
    ) {
      showToast('Boundary reached: city blocks this edge.');
      playSploosh(0.55);
      return;
    }

    for (const gate of GATES) {
      if (activatedGatesRef.current.has(gate.id)) continue;

      const intersectsWall =
        gate.axis === 'z'
          ? Math.abs(testPos.z - gate.at) <= GATE_THICKNESS * 0.5 + ext.z
          : Math.abs(testPos.x - gate.at) <= GATE_THICKNESS * 0.5 + ext.x;

      if (!intersectsWall) continue;

      showToast(gate.tip);
      playSploosh(0.58);
      return;
    }

    rollRef.current = {
      fromPos: c0,
      fromQuat: q0,
      axis,
      pivot,
      elapsed: 0,
      duration: 0.16,
    };

    playSploosh(0.88);
  }, [showToast]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderGrant: () => {
          // Movement only. Camera rotation is handled by explicit on-screen buttons.
          gestureModeRef.current = 'move';
          lastGestureRef.current = { dx: 0, dy: 0 };
        },
        onPanResponderMove: () => {
          // no-op: movement resolves on release via swipe direction
        },
        onPanResponderRelease: (_, g) => {
          if (gestureModeRef.current === 'move') {
            const dx = g.dx;
            const dy = g.dy;
            if (Math.hypot(dx, dy) > 16) {
              const yaw = THREE.MathUtils.degToRad(cameraStateRef.current.yaw);
              const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
              const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

              if (Math.abs(dx) > Math.abs(dy)) {
                tryRoll(dx > 0 ? right : right.clone().multiplyScalar(-1));
              } else {
                // Inverted vertical movement: swipe up rolls "down" / toward camera.
                tryRoll(dy < 0 ? fwd.clone().multiplyScalar(-1) : fwd);
              }
            }
          }

          gestureModeRef.current = null;
          lastGestureRef.current = { dx: 0, dy: 0 };
        },
        onPanResponderTerminate: () => {
          gestureModeRef.current = null;
          lastGestureRef.current = { dx: 0, dy: 0 };
        },
      }),
    [tryRoll]
  );

  useEffect(() => {
    void ensureSplooshLoaded();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (
        key === 'a' ||
        key === 'd' ||
        key === 'w' ||
        key === 's' ||
        key === ' ' ||
        key === 'arrowleft' ||
        key === 'arrowright' ||
        key === 'arrowup' ||
        key === 'arrowdown'
      ) {
        event.preventDefault();
      }

      const yaw = THREE.MathUtils.degToRad(cameraStateRef.current.yaw);
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

      if (key === 'a') return void tryRoll(right.clone().multiplyScalar(-1));
      if (key === 'd') return void tryRoll(right);
      if (key === 'w') return void tryRoll(fwd.clone().multiplyScalar(-1));
      if (key === 's' || key === ' ') return void tryRoll(fwd);

      if (key === 'arrowleft') cameraTargetRef.current.yaw = snapYawTo90(cameraTargetRef.current.yaw - 90);
      if (key === 'arrowright') cameraTargetRef.current.yaw = snapYawTo90(cameraTargetRef.current.yaw + 90);
      if (key === 'arrowup') cameraTargetRef.current.pitch = clamp(cameraTargetRef.current.pitch - 4, 18, 38);
      if (key === 'arrowdown') cameraTargetRef.current.pitch = clamp(cameraTargetRef.current.pitch + 4, 18, 38);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tryRoll]);

  const onContextCreate = async (gl: any) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const renderer = new Renderer({ gl }) as any;
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x08152a, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x08152a, 11, 35);

    const camera = new THREE.PerspectiveCamera(
      64,
      gl.drawingBufferWidth / gl.drawingBufferHeight,
      0.1,
      120
    );

    const hemi = new THREE.HemisphereLight(0xc8deff, 0x0f2042, 0.9);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2db, 1.3);
    key.position.set(7, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.width = 1024;
    key.shadow.mapSize.height = 1024;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    scene.add(key);

    const rim = new THREE.PointLight(0x73a8ff, 0.62, 36);
    rim.position.set(-8, 4, -7);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 36),
      new THREE.MeshStandardMaterial({ color: 0x1b2f53, roughness: 0.94, metalness: 0.03 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(54, 54, 0x7fa6db, 0x35588c);
    grid.position.y = FLOOR_Y;
    const gm = grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.3;
    scene.add(grid);

    const boundaryMat = new THREE.MeshStandardMaterial({ color: 0x44566f, roughness: 0.9 });
    const boundaryTopMat = new THREE.MeshStandardMaterial({ color: 0x6f86a8, roughness: 0.55 });

    const wallThickness = RAIL_THICKNESS;
    const wallHeight = RAIL_HEIGHT;

    const northSouthGeo = new THREE.BoxGeometry(ARENA_HALF * 2 + wallThickness, wallHeight, wallThickness);
    const eastWestGeo = new THREE.BoxGeometry(wallThickness, wallHeight, ARENA_HALF * 2 + wallThickness);

    const wallNorth = new THREE.Mesh(northSouthGeo, boundaryMat);
    wallNorth.position.set(0, wallHeight * 0.5, -ARENA_HALF - wallThickness * 0.5);
    wallNorth.castShadow = true;
    wallNorth.receiveShadow = true;
    scene.add(wallNorth);

    const wallSouth = wallNorth.clone();
    wallSouth.position.z = ARENA_HALF + wallThickness * 0.5;
    scene.add(wallSouth);

    const wallEast = new THREE.Mesh(eastWestGeo, boundaryMat);
    wallEast.position.set(ARENA_HALF + wallThickness * 0.5, wallHeight * 0.5, 0);
    wallEast.castShadow = true;
    wallEast.receiveShadow = true;
    scene.add(wallEast);

    const wallWest = wallEast.clone();
    wallWest.position.x = -ARENA_HALF - wallThickness * 0.5;
    scene.add(wallWest);

    // Big buildings around edges to define world bounds clearly.
    const bGeo = new THREE.BoxGeometry(1.6, 1, 1.6);
    for (let i = -6; i <= 6; i++) {
      const z = i * 2.1;
      const hA = 5 + pseudo(i + 11) * 7;
      const hB = 5 + pseudo(i + 37) * 7;

      const bA = new THREE.Mesh(
        bGeo,
        i % 2 === 0 ? boundaryMat : boundaryTopMat
      );
      bA.scale.set(1, hA, 1);
      bA.position.set(-ARENA_HALF - 2.2, hA * 0.5, z);
      bA.castShadow = true;
      bA.receiveShadow = true;
      scene.add(bA);

      const bB = new THREE.Mesh(
        bGeo,
        i % 2 === 0 ? boundaryTopMat : boundaryMat
      );
      bB.scale.set(1, hB, 1);
      bB.position.set(ARENA_HALF + 2.2, hB * 0.5, z);
      bB.castShadow = true;
      bB.receiveShadow = true;
      scene.add(bB);
    }

    // Alignment puzzle gates + floor indicators that unlock each gate.
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x6f7f93, roughness: 0.78, metalness: 0.2 });
    const gateBeamMat = new THREE.MeshStandardMaterial({ color: 0xc9a86b, roughness: 0.45, metalness: 0.38 });
    const gateDoorMat = new THREE.MeshStandardMaterial({
      color: 0x2f3b4f,
      roughness: 0.55,
      metalness: 0.4,
      emissive: 0x4b1e1e,
      emissiveIntensity: 0.2,
    });
    const triggerInactiveMat = new THREE.MeshStandardMaterial({ color: 0x6f5a39, roughness: 0.65 });
    const triggerOutlineMat = new THREE.MeshStandardMaterial({ color: 0x39a8ff, roughness: 0.42, metalness: 0.08 });

    gateDoorRefs.current = {};
    gateTriggerRefs.current = {};
    gateTriggerPosRefs.current = {};
    activatedGatesRef.current = new Set();
    phoneFaceSetRef.current = new Set();
    hpRef.current = 100;

    // Expanded second-level play plaza for better flow after Gate 1.
    const level2Pad = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.14, 14),
      new THREE.MeshStandardMaterial({ color: 0x21385c, roughness: 0.72, metalness: 0.1 })
    );
    level2Pad.position.set(4.2, FLOOR_Y + 0.07, -11.8);
    level2Pad.receiveShadow = true;
    scene.add(level2Pad);

    const level2Inset = new THREE.Mesh(
      new THREE.BoxGeometry(15, 0.04, 11),
      new THREE.MeshStandardMaterial({ color: 0x2d5384, roughness: 0.4, metalness: 0.18, emissive: 0x0d1d34, emissiveIntensity: 0.45 })
    );
    level2Inset.position.set(4.2, FLOOR_Y + 0.1, -11.8);
    level2Inset.receiveShadow = true;
    scene.add(level2Inset);

    const makeGateIndicators = (x: number, z: number, alongX: boolean) => {
      const left = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.34, 14),
        new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0x651818, emissiveIntensity: 0.75, roughness: 0.3 })
      );
      const right = left.clone();
      if (alongX) {
        left.position.set(x - 0.42, 0.2, z);
        right.position.set(x + 0.42, 0.2, z);
      } else {
        left.position.set(x, 0.2, z - 0.42);
        right.position.set(x, 0.2, z + 0.42);
      }
      scene.add(left);
      scene.add(right);
      return [left, right];
    };

    const makeCompletionArrow = (x: number, z: number, axis: 'x' | 'z') => {
      const shape = new THREE.Shape();
      shape.moveTo(-0.42, -0.12);
      shape.lineTo(0.05, -0.12);
      shape.lineTo(0.05, -0.24);
      shape.lineTo(0.42, 0);
      shape.lineTo(0.05, 0.24);
      shape.lineTo(0.05, 0.12);
      shape.lineTo(-0.42, 0.12);
      shape.closePath();

      const arrow = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshStandardMaterial({ color: 0x3ddc84, emissive: 0x1a7a4b, emissiveIntensity: 0.85, roughness: 0.35 })
      );
      arrow.rotation.x = -Math.PI / 2;
      if (axis === 'z') arrow.rotation.z = Math.PI / 2;
      arrow.position.set(x, FLOOR_Y + 0.04, z);
      arrow.visible = false;
      arrow.castShadow = false;
      arrow.receiveShadow = false;
      scene.add(arrow);
      return arrow;
    };

    for (const gate of GATES) {
      const halfWorld = ARENA_HALF;

      if (gate.axis === 'z') {
        const gapMin = gate.gapCenter - gate.gapWidth * 0.5;
        const gapMax = gate.gapCenter + gate.gapWidth * 0.5;

        const leftW = Math.max(0, gapMin - -halfWorld);
        if (leftW > 0.04) {
          const left = new THREE.Mesh(
            new THREE.BoxGeometry(leftW, RAIL_HEIGHT, GATE_THICKNESS),
            gateMat
          );
          left.position.set((-halfWorld + gapMin) * 0.5, RAIL_HEIGHT * 0.5, gate.at);
          left.castShadow = true;
          left.receiveShadow = true;
          scene.add(left);
        }

        const rightW = Math.max(0, halfWorld - gapMax);
        if (rightW > 0.04) {
          const right = new THREE.Mesh(
            new THREE.BoxGeometry(rightW, RAIL_HEIGHT, GATE_THICKNESS),
            gateMat
          );
          right.position.set((gapMax + halfWorld) * 0.5, RAIL_HEIGHT * 0.5, gate.at);
          right.castShadow = true;
          right.receiveShadow = true;
          scene.add(right);
        }

        const topH = 0.1;
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(gate.gapWidth, topH, GATE_THICKNESS * 0.46),
          gateBeamMat
        );
        beam.position.set(gate.gapCenter, RAIL_HEIGHT * 0.5, gate.at);
        beam.castShadow = true;
        beam.receiveShadow = true;
        scene.add(beam);

        const door = new THREE.Mesh(
          new THREE.BoxGeometry(gate.gapWidth, gate.clearance, GATE_THICKNESS * 0.94),
          gateDoorMat.clone()
        );
        door.position.set(gate.gapCenter, gate.clearance * 0.5, gate.at);
        door.castShadow = true;
        door.receiveShadow = true;
        scene.add(door);
        gateDoorRefs.current[gate.id] = {
          door,
          beam,
          completionArrow: gate.id === 'gate-2' ? makeCompletionArrow(gate.gapCenter, gate.at, gate.axis) : undefined,
          closedY: gate.clearance * 0.5,
          openY: -gate.clearance * 0.72,
          openness: 0,
          targetOpenness: 0,
          indicators: makeGateIndicators(gate.gapCenter, gate.at, true),
        };
      } else {
        const gapMin = gate.gapCenter - gate.gapWidth * 0.5;
        const gapMax = gate.gapCenter + gate.gapWidth * 0.5;

        const nearW = Math.max(0, gapMin - -halfWorld);
        if (nearW > 0.04) {
          const near = new THREE.Mesh(
            new THREE.BoxGeometry(GATE_THICKNESS, RAIL_HEIGHT, nearW),
            gateMat
          );
          near.position.set(gate.at, RAIL_HEIGHT * 0.5, (-halfWorld + gapMin) * 0.5);
          near.castShadow = true;
          near.receiveShadow = true;
          scene.add(near);
        }

        const farW = Math.max(0, halfWorld - gapMax);
        if (farW > 0.04) {
          const far = new THREE.Mesh(
            new THREE.BoxGeometry(GATE_THICKNESS, RAIL_HEIGHT, farW),
            gateMat
          );
          far.position.set(gate.at, RAIL_HEIGHT * 0.5, (gapMax + halfWorld) * 0.5);
          far.castShadow = true;
          far.receiveShadow = true;
          scene.add(far);
        }

        const topH = 0.1;
        const beam = new THREE.Mesh(
          new THREE.BoxGeometry(GATE_THICKNESS * 0.46, topH, gate.gapWidth),
          gateBeamMat
        );
        beam.position.set(gate.at, RAIL_HEIGHT * 0.5, gate.gapCenter);
        beam.castShadow = true;
        beam.receiveShadow = true;
        scene.add(beam);

        const door = new THREE.Mesh(
          new THREE.BoxGeometry(GATE_THICKNESS * 0.94, gate.clearance, gate.gapWidth),
          gateDoorMat.clone()
        );
        door.position.set(gate.at, gate.clearance * 0.5, gate.gapCenter);
        door.castShadow = true;
        door.receiveShadow = true;
        scene.add(door);
        gateDoorRefs.current[gate.id] = {
          door,
          beam,
          completionArrow: gate.id === 'gate-2' ? makeCompletionArrow(gate.at, gate.gapCenter, gate.axis) : undefined,
          closedY: gate.clearance * 0.5,
          openY: -gate.clearance * 0.72,
          openness: 0,
          targetOpenness: 0,
          indicators: makeGateIndicators(gate.at, gate.gapCenter, false),
        };
      }

      // Marker matches required block footprint (orientation only; either facing direction is valid).
      const footprintX = gate.triggerAxis === 'x' ? BLOCK_SIZE.z : BLOCK_SIZE.x;
      const footprintZ = gate.triggerAxis === 'x' ? BLOCK_SIZE.x : BLOCK_SIZE.z;

      const triggerBase = new THREE.Mesh(
        new THREE.BoxGeometry(footprintX, 0.08, footprintZ),
        triggerInactiveMat.clone()
      );
      triggerBase.position.set(gate.triggerX, FLOOR_Y + 0.04, gate.triggerZ);
      triggerBase.castShadow = false;
      triggerBase.receiveShadow = true;

      const triggerOutline = new THREE.Mesh(
        new THREE.BoxGeometry(footprintX + 0.12, 0.03, footprintZ + 0.12),
        triggerOutlineMat.clone()
      );
      triggerOutline.position.set(gate.triggerX, FLOOR_Y + 0.095, gate.triggerZ);
      triggerOutline.castShadow = false;
      triggerOutline.receiveShadow = true;

      // Ground silhouette should match required footprint exactly (filled rectangle), plus elevated beacon.
      const silhouetteFill = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.2, footprintX - 0.06), 0.02, Math.max(0.2, footprintZ - 0.06)),
        new THREE.MeshStandardMaterial({
          color: gate.id === 'gate-2' ? 0x76dcff : 0x4ac6ff,
          emissive: gate.id === 'gate-2' ? 0x2a86b4 : 0x1d6387,
          emissiveIntensity: gate.id === 'gate-2' ? 0.92 : 0.72,
          transparent: true,
          opacity: gate.id === 'gate-2' ? 0.62 : 0.48,
          roughness: 0.2,
          metalness: 0.12,
        })
      );
      silhouetteFill.position.set(gate.triggerX, FLOOR_Y + 0.16, gate.triggerZ);
      silhouetteFill.castShadow = false;
      silhouetteFill.receiveShadow = false;
      silhouetteFill.userData.preserveColor = true;

      const silhouetteEdge = new THREE.Mesh(
        new THREE.BoxGeometry(footprintX + 0.08, 0.024, footprintZ + 0.08),
        new THREE.MeshStandardMaterial({
          color: 0x9fe8ff,
          emissive: 0x2f8fb8,
          emissiveIntensity: 0.9,
          roughness: 0.24,
          metalness: 0.2,
        })
      );
      silhouetteEdge.position.set(gate.triggerX, FLOOR_Y + 0.165, gate.triggerZ);
      silhouetteEdge.castShadow = false;
      silhouetteEdge.receiveShadow = false;
      silhouetteEdge.userData.preserveColor = true;

      const silhouetteGhost = new THREE.Mesh(
        new THREE.BoxGeometry(footprintX + 0.04, 0.02, footprintZ + 0.04),
        new THREE.MeshStandardMaterial({
          color: 0x8fe3ff,
          emissive: 0x3f99c6,
          emissiveIntensity: gate.id === 'gate-1' ? 0.35 : 0.6,
          transparent: true,
          opacity: gate.id === 'gate-1' ? 0.14 : 0.24,
          roughness: 0.2,
          metalness: 0.1,
        })
      );
      silhouetteGhost.position.set(
        gate.triggerX,
        FLOOR_Y + (gate.id === 'gate-1' ? 1.2 : gate.id === 'gate-2' ? 2.55 : 2.2),
        gate.triggerZ
      );
      silhouetteGhost.castShadow = false;
      silhouetteGhost.receiveShadow = false;
      silhouetteGhost.userData.preserveColor = true;

      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.16, gate.id === 'gate-2' ? 4.8 : 3.6, 10, 1, true),
        new THREE.MeshStandardMaterial({
          color: gate.id === 'gate-2' ? 0x8ee7ff : 0x66cbff,
          emissive: gate.id === 'gate-2' ? 0x2f9dcc : 0x1d6b96,
          emissiveIntensity: gate.id === 'gate-2' ? 0.95 : 0.55,
          transparent: true,
          opacity: gate.id === 'gate-2' ? 0.42 : 0.28,
          roughness: 0.2,
          metalness: 0.1,
          side: THREE.DoubleSide,
        })
      );
      beacon.position.set(gate.triggerX, FLOOR_Y + (gate.id === 'gate-2' ? 2.45 : 1.85), gate.triggerZ);
      beacon.castShadow = false;
      beacon.receiveShadow = false;
      beacon.userData.preserveColor = true;

      const triggerGroup = new THREE.Group();
      triggerGroup.add(triggerBase);
      triggerGroup.add(triggerOutline);
      triggerGroup.add(silhouetteEdge);
      triggerGroup.add(silhouetteFill);
      triggerGroup.add(silhouetteGhost);
      triggerGroup.add(beacon);
      scene.add(triggerGroup);
      gateTriggerRefs.current[gate.id] = triggerGroup;
      gateTriggerPosRefs.current[gate.id] = { x: gate.triggerX, z: gate.triggerZ };
    }

    // Phone destination marker in world.
    const phone = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.8, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x0f1523, roughness: 0.35, metalness: 0.12 })
    );
    phone.position.set(13.8, 1.0, -18.4);
    phone.castShadow = true;
    phone.receiveShadow = true;
    scene.add(phone);

    const phoneGlow = new THREE.PointLight(0x6fb1ff, 0.7, 8);
    phoneGlow.position.set(13.8, 1.9, -18.4);
    scene.add(phoneGlow);

    const blockMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe7ddd1,
      roughness: 0.4,
      metalness: 0.08,
      clearcoat: 0.82,
      clearcoatRoughness: 0.18,
      sheen: 0.55,
      sheenColor: new THREE.Color(0xf7f3eb),
      specularIntensity: 0.62,
    });

    const block = new THREE.Mesh(
      new THREE.BoxGeometry(BLOCK_SIZE.x, BLOCK_SIZE.y, BLOCK_SIZE.z),
      blockMaterial
    );
    block.castShadow = true;
    block.receiveShadow = false;

    // Front-face identifier so orientation intent is always obvious.
    const frontStamp = new THREE.Mesh(
      new THREE.PlaneGeometry(BLOCK_SIZE.x * 0.48, BLOCK_SIZE.y * 0.34),
      new THREE.MeshStandardMaterial({
        color: 0xff7a48,
        emissive: 0x552515,
        emissiveIntensity: 0.34,
        roughness: 0.4,
        metalness: 0.02,
      })
    );
    frontStamp.position.set(0, 0.02, HALF.z + 0.002);
    block.add(frontStamp);

    const frontArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.24, 3),
      new THREE.MeshStandardMaterial({ color: 0xffa05f, emissive: 0x4a240f, emissiveIntensity: 0.28 })
    );
    frontArrow.position.set(0, HALF.y + 0.07, HALF.z * 0.22);
    frontArrow.rotation.x = Math.PI / 2;
    block.add(frontArrow);

    // Cream cheese wrapper accents (foil seam + blue print strips).
    const foilBand = new THREE.Mesh(
      new THREE.BoxGeometry(BLOCK_SIZE.x * 0.98, BLOCK_SIZE.y * 0.36, BLOCK_SIZE.z * 0.98),
      new THREE.MeshPhysicalMaterial({
        color: 0xd8d4cf,
        roughness: 0.28,
        metalness: 0.55,
        clearcoat: 0.9,
        clearcoatRoughness: 0.12,
      })
    );
    foilBand.position.set(0, HALF.y * 0.37, 0);
    block.add(foilBand);

    const printMat = new THREE.MeshStandardMaterial({ color: 0xd8d5cf, emissive: 0x4b4844, emissiveIntensity: 0.06 });
    const printTop = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK_SIZE.x * 0.68, BLOCK_SIZE.z * 0.2), printMat);
    printTop.rotation.x = -Math.PI / 2;
    printTop.position.set(0, HALF.y + 0.002, 0);
    block.add(printTop);

    const makePhoneOverlay = (key: FaceKey) => {
      const m = new THREE.MeshStandardMaterial({
        color: 0x111418,
        roughness: 0.2,
        metalness: 0.25,
        emissive: 0x050608,
        emissiveIntensity: 0.2,
      });
      const pad = 0.06;
      let mesh: THREE.Mesh;
      if (key === 'px' || key === 'nx') mesh = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK_SIZE.z - pad, BLOCK_SIZE.y - pad), m);
      else if (key === 'py' || key === 'ny') mesh = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK_SIZE.x - pad, BLOCK_SIZE.z - pad), m);
      else mesh = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK_SIZE.x - pad, BLOCK_SIZE.y - pad), m);

      if (key === 'px') {
        mesh.position.set(HALF.x + 0.002, 0, 0);
        mesh.rotation.y = -Math.PI / 2;
      } else if (key === 'nx') {
        mesh.position.set(-HALF.x - 0.002, 0, 0);
        mesh.rotation.y = Math.PI / 2;
      } else if (key === 'py') {
        mesh.position.set(0, HALF.y + 0.002, 0);
        mesh.rotation.x = -Math.PI / 2;
      } else if (key === 'ny') {
        mesh.position.set(0, -HALF.y - 0.002, 0);
        mesh.rotation.x = Math.PI / 2;
      } else if (key === 'pz') {
        mesh.position.set(0, 0, HALF.z + 0.002);
      } else {
        mesh.position.set(0, 0, -HALF.z - 0.002);
        mesh.rotation.y = Math.PI;
      }

      mesh.visible = false;
      block.add(mesh);
      return mesh;
    };

    phoneFaceOverlaysRef.current = {
      px: makePhoneOverlay('px'),
      nx: makePhoneOverlay('nx'),
      py: makePhoneOverlay('py'),
      ny: makePhoneOverlay('ny'),
      pz: makePhoneOverlay('pz'),
      nz: makePhoneOverlay('nz'),
    };

    const state = blockStateRef.current;
    block.position.copy(state.pos);
    block.quaternion.copy(state.quat);
    scene.add(block);

    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(HALF.x, HALF.z) * 0.92, 36),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24 })
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(state.pos.x, FLOOR_Y, state.pos.z);
    scene.add(contactShadow);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    blockRef.current = block;
    shadowRef.current = contactShadow;

    const animate = (ts: number) => {
      const r = rendererRef.current;
      const s = sceneRef.current;
      const c = cameraRef.current;
      const cubeMesh = blockRef.current;
      const contact = shadowRef.current;
      if (!r || !s || !c || !cubeMesh || !contact) return;

      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.033, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      const stateNow = blockStateRef.current;
      const roll = rollRef.current;

      if (roll) {
        roll.elapsed += dt;
        const t = clamp(roll.elapsed / roll.duration, 0, 1);
        const eased = easeInOut(t);

        const qDelta = new THREE.Quaternion().setFromAxisAngle(roll.axis, eased * Math.PI * 0.5);

        stateNow.pos.copy(roll.fromPos).sub(roll.pivot).applyQuaternion(qDelta).add(roll.pivot);
        stateNow.quat.copy(qDelta).multiply(roll.fromQuat).normalize();

        if (t >= 1) {
          stateNow.quat.copy(snapToOrthogonalQuat(stateNow.quat));
          stateNow.pos.x = snapToGrid(stateNow.pos.x);
          stateNow.pos.z = snapToGrid(stateNow.pos.z);
          stateNow.pos.y = restingCenterY(stateNow.quat);
          stateNow.pos.x = clamp(stateNow.pos.x, -ARENA_HALF, ARENA_HALF);
          stateNow.pos.z = clamp(stateNow.pos.z, -ARENA_HALF, ARENA_HALF);

          const downFace = localDownFaceKey(stateNow.quat);
          if (phoneFaceSetRef.current.has(downFace)) {
            const damage = 10 + phoneFaceSetRef.current.size * 2;
            hpRef.current = Math.max(0, hpRef.current - damage);
            playSploosh(1.05);
            if (hpRef.current <= 0) {
              onGameOver();
              return;
            }
          }

          rollRef.current = null;
        }
      }

      // Static markers: difficulty now ramps via orientation pathing, not moving platforms.
      for (const gate of GATES) {
        const trigger = gateTriggerRefs.current[gate.id];
        if (!trigger) continue;
        trigger.position.set(0, 0, 0);
        gateTriggerPosRefs.current[gate.id] = { x: gate.triggerX, z: gate.triggerZ };
      }

      if (!rollRef.current) {
        const ext = blockHalfExtents(stateNow.quat);
        const horizontalAxis: 'x' | 'z' = ext.x >= ext.z ? 'x' : 'z';

        for (const gate of GATES) {
          if (activatedGatesRef.current.has(gate.id)) continue;

          const triggerPos = gateTriggerPosRefs.current[gate.id] ?? { x: gate.triggerX, z: gate.triggerZ };
          const dx = stateNow.pos.x - triggerPos.x;
          const dz = stateNow.pos.z - triggerPos.z;
          const markerDist = Math.hypot(dx, dz);

          const proximityRadius = gate.id === 'gate-1' ? 0.88 : gate.id === 'gate-2' ? 0.9 : 0.92;
          if (markerDist > proximityRadius) continue;

          const orientationOk = horizontalAxis === gate.triggerAxis;
          const heightOk = ext.y <= gate.triggerMaxHalfY + (gate.id === 'gate-3' ? 0.06 : 0);

          // Strict flush checks with tiny moving-platform leniency for FP jitter.
          const baseAxisTol = gate.id === 'gate-1' ? 0.12 : gate.id === 'gate-2' ? 0.14 : 0.16;
          const movingJitterAllowance = gate.id === 'gate-1' ? 0 : 0.015;
          const axisTol = baseAxisTol + movingJitterAllowance;
          const positionOk = Math.abs(dx) <= axisTol && Math.abs(dz) <= axisTol;

          if (orientationOk && heightOk && positionOk) {
            // Lock flush to marker center on success, including moving gates.
            stateNow.pos.x = triggerPos.x;
            stateNow.pos.z = triggerPos.z;
            stateNow.pos.y = restingCenterY(stateNow.quat);

            activatedGatesRef.current.add(gate.id);

            const doorVisual = gateDoorRefs.current[gate.id];
            if (doorVisual) {
              doorVisual.targetOpenness = 1;
              if (gate.id === 'gate-2') {
                for (const indicator of doorVisual.indicators) indicator.visible = false;
                if (doorVisual.completionArrow) doorVisual.completionArrow.visible = true;
              }
            }

            const trigger = gateTriggerRefs.current[gate.id];
            if (trigger) {
              trigger.traverse((node) => {
                const mesh = node as THREE.Mesh;
                const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
                if (!mat || !('color' in mat)) return;
                mat.color.setHex(0x3fbf78);
                mat.emissive = new THREE.Color(0x1e7a4a);
                mat.emissiveIntensity = 0.55;
              });
            }

            const nextFace = phoneFaceOrder.find((f) => !phoneFaceSetRef.current.has(f));
            if (nextFace) {
              phoneFaceSetRef.current.add(nextFace);
              const overlay = phoneFaceOverlaysRef.current[nextFace];
              if (overlay) overlay.visible = true;
            }

            const gateIdx = GATES.findIndex((g) => g.id === gate.id);
            const nextGate = gateIdx >= 0 ? GATES[gateIdx + 1] : undefined;
            const nextTarget = nextGate
              ? gateTriggerPosRefs.current[nextGate.id]
              : { x: 13.8, z: -18.4 };

            if (nextTarget) {
              const toX = nextTarget.x - stateNow.pos.x;
              const toZ = nextTarget.z - stateNow.pos.z;
              const targetYaw = snapYawTo90(THREE.MathUtils.radToDeg(Math.atan2(toX, toZ)));
              cameraSnapRef.current = {
                startYaw: cameraStateRef.current.yaw,
                endYaw: targetYaw,
                elapsed: 0,
                duration: 0.36,
              };
              cameraTargetRef.current.pitch = nextGate ? 24 : 22;
            }

            playSploosh(0.95);
          } else {
            showToast(
              `${gate.id.toUpperCase()}: match marker shape + stay low (front can face either way)`
            );
          }
        }
      }

      for (const doorVisual of Object.values(gateDoorRefs.current)) {
        doorVisual.openness = lerp(
          doorVisual.openness,
          doorVisual.targetOpenness,
          Math.min(1, dt * 7.5)
        );
        const openness = clamp(doorVisual.openness, 0, 1);
        doorVisual.door.position.y = lerp(doorVisual.closedY, doorVisual.openY, openness);

        const doorMat = doorVisual.door.material as THREE.MeshStandardMaterial;
        doorMat.emissive = new THREE.Color().setRGB(
          lerp(0.32, 0.06, openness),
          lerp(0.12, 0.42, openness),
          lerp(0.12, 0.22, openness)
        );
        doorMat.emissiveIntensity = lerp(0.26, 0.7, openness);

        if (doorVisual.beam) {
          const beamMat = doorVisual.beam.material as THREE.MeshStandardMaterial;
          beamMat.transparent = true;
          beamMat.opacity = lerp(1, 0, openness);
          beamMat.emissive = new THREE.Color().setRGB(lerp(0.15, 0, openness), lerp(0.1, 0, openness), lerp(0.04, 0, openness));
          beamMat.emissiveIntensity = lerp(0.2, 0, openness);
          doorVisual.beam.visible = openness < 0.98;
        }

        for (const indicator of doorVisual.indicators) {
          const im = indicator.material as THREE.MeshStandardMaterial;
          im.color = new THREE.Color().setRGB(
            lerp(1.0, 0.2, openness),
            lerp(0.3, 0.95, openness),
            lerp(0.3, 0.45, openness)
          );
          im.emissive = new THREE.Color().setRGB(
            lerp(0.4, 0.06, openness),
            lerp(0.06, 0.38, openness),
            lerp(0.06, 0.14, openness)
          );
          im.emissiveIntensity = lerp(0.82, 1.1, openness);
        }
      }

      cubeMesh.position.copy(stateNow.pos);
      cubeMesh.quaternion.copy(stateNow.quat);

      contact.position.set(stateNow.pos.x, FLOOR_Y, stateNow.pos.z);
      const shadowScale = rollRef.current ? 1.08 : 1;
      contact.scale.set(shadowScale, shadowScale, 1);
      (contact.material as THREE.MeshBasicMaterial).opacity = rollRef.current ? 0.2 : 0.26;

      const cameraTarget = cameraTargetRef.current;
      const cameraState = cameraStateRef.current;
      const follow = cameraFollowRef.current;

      if (!cameraSnapRef.current && pendingTurnRef.current !== 0) {
        const step = pendingTurnRef.current > 0 ? 1 : -1;
        pendingTurnRef.current -= step;
        cameraSnapRef.current = {
          startYaw: cameraState.yaw,
          endYaw: cameraState.yaw + step * 90,
          elapsed: 0,
          duration: 0.22,
        };
      }

      const activeSnap = cameraSnapRef.current;
      if (activeSnap) {
        activeSnap.elapsed += dt;
        const t = clamp(activeSnap.elapsed / activeSnap.duration, 0, 1);
        const eased = easeInOut(t);
        const yawNow = lerp(activeSnap.startYaw, activeSnap.endYaw, eased);

        cameraState.yaw = yawNow;
        cameraTarget.yaw = yawNow;

        if (t >= 1) {
          cameraState.yaw = activeSnap.endYaw;
          cameraTarget.yaw = activeSnap.endYaw;
          cameraSnapRef.current = null;
        }
      } else {
        cameraState.yaw = lerp(cameraState.yaw, cameraTarget.yaw, Math.min(1, dt * 16));
      }

      cameraState.pitch = lerp(cameraState.pitch, cameraTarget.pitch, Math.min(1, dt * 16));

      follow.x = lerp(follow.x, stateNow.pos.x, Math.min(1, dt * 16));
      follow.z = lerp(follow.z, stateNow.pos.z, Math.min(1, dt * 16));
      follow.y = lerp(follow.y, stateNow.pos.y, Math.min(1, dt * 16));

      const yaw = THREE.MathUtils.degToRad(cameraState.yaw);
      const pitch = THREE.MathUtils.degToRad(cameraState.pitch);

      const boundRadius = Math.sqrt(HALF.x * HALF.x + HALF.y * HALF.y + HALF.z * HALF.z);
      const vFov = THREE.MathUtils.degToRad(c.fov);
      const aspect = c.aspect || (gl.drawingBufferWidth / gl.drawingBufferHeight);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

      const fitDistance =
        Math.max(
          boundRadius / Math.tan(vFov / 2),
          boundRadius / Math.tan(Math.max(0.18, hFov / 2))
        ) * 1.72;

      const radius = Math.max(9.8, fitDistance);

      const cx = follow.x + Math.sin(yaw) * Math.cos(pitch) * radius;
      const cy = follow.y + 1.6 + Math.sin(pitch) * radius * 0.74;
      const cz = follow.z + Math.cos(yaw) * Math.cos(pitch) * radius;

      c.position.set(cx, cy, cz);
      c.lookAt(follow.x, follow.y, follow.z);

      const drawW = gl.drawingBufferWidth;
      const drawH = gl.drawingBufferHeight;
      const nextAspect = drawW / drawH;
      if (Math.abs(c.aspect - nextAspect) > 0.0001) {
        c.aspect = nextAspect;
        c.updateProjectionMatrix();
      }
      r.setViewport(0, 0, drawW, drawH);

      r.render(s, c);
      gl.endFrameEXP();

      if (ts - lastHudRef.current > 120) {
        const prev = prevPosForSpeedRef.current;
        const dist = prev.distanceTo(stateNow.pos);
        prev.copy(stateNow.pos);
        const approxSpeed = dist / Math.max(0.001, dt);

        const extNow = blockHalfExtents(stateNow.quat);
        const axisNow: 'X' | 'Z' = extNow.x >= extNow.z ? 'X' : 'Z';

        const front = quantizeToCardinalXZ(new THREE.Vector3(0, 0, 1).applyQuaternion(stateNow.quat));
        const face =
          Math.abs(front.x) > Math.abs(front.z)
            ? front.x > 0
              ? 'E'
              : 'W'
            : front.z > 0
              ? 'S'
              : 'N';

        lastHudRef.current = ts;
        const nextGate = GATES.find((g) => !activatedGatesRef.current.has(g.id));
        setHud({
          speed: approxSpeed.toFixed(2),
          cam: `${((Math.round(cameraState.yaw) % 360) + 360) % 360}°`,
          axis: axisNow,
          face,
          gate: `${activatedGatesRef.current.size}/${GATES.length}`,
          target: nextGate ? nextGate.id.toUpperCase().replace('-', '') : 'PHONE',
          hp: `${hpRef.current}`,
          form: `${phoneFaceSetRef.current.size}/6`,
        });
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      rafRef.current = null;
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      blockRef.current = null;
      shadowRef.current = null;
      gateDoorRefs.current = {};
      gateTriggerRefs.current = {};
      gateTriggerPosRefs.current = {};
      activatedGatesRef.current = new Set();
      phoneFaceSetRef.current = new Set();
      phoneFaceOverlaysRef.current = { px: null, nx: null, py: null, ny: null, pz: null, nz: null };
      hpRef.current = 100;
      cameraSnapRef.current = null;
      pendingTurnRef.current = 0;
    };
  }, []);

  return (
    <View style={styles.gameWrap}>
      <View style={styles.hudTop}>
        <Pressable onPress={onBack} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>Menu</Text>
        </Pressable>

        <View style={styles.hudRight}>
          <HudChip label="HP" value={hud.hp} />
          <HudChip label="Target" value={hud.target} />
          <HudChip label="Form" value={hud.form} />
        </View>
      </View>


      <View style={styles.world}>
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />

        <View style={styles.touchOverlay} {...panResponder.panHandlers}>
          <View style={styles.moveZoneHint} />
        </View>

        <View pointerEvents="box-none" style={styles.cameraControlsRow}>
          <Pressable style={styles.cameraRotateButton} onPress={() => queueCameraTurn(-1)}>
            <Text style={styles.cameraRotateButtonText}>⟲</Text>
          </Pressable>
          <Pressable style={styles.cameraRotateButton} onPress={() => queueCameraTurn(1)}>
            <Text style={styles.cameraRotateButtonText}>⟳</Text>
          </Pressable>
        </View>

        {toast.length > 0 && (
          <View style={styles.toastWrap}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function HudChip({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.hudChip}>
      <Text style={styles.hudChipLabel}>{label}</Text>
      <Text style={styles.hudChipValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#060d1b' },

  menuWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a1226',
    padding: 24,
    gap: 14,
    overflow: 'hidden',
  },
  menuOrbA: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: '#1b3560',
    opacity: 0.42,
    left: -120,
    top: -150,
  },
  menuOrbB: {
    position: 'absolute',
    width: 440,
    height: 440,
    borderRadius: 220,
    backgroundColor: '#12335d',
    opacity: 0.32,
    right: -120,
    bottom: -130,
  },
  kicker: {
    color: '#7ec4ff',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  title: {
    color: '#f3f6ff',
    fontSize: 40,
    fontWeight: '900',
    textAlign: 'center',
  },
  copyCenter: {
    color: '#b7c4df',
    textAlign: 'center',
    maxWidth: 560,
    lineHeight: 22,
  },
  menuButtonPrimary: {
    marginTop: 8,
    backgroundColor: '#6ed1ff',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#98e2ff',
  },
  menuButtonPrimaryText: { color: '#061220', fontWeight: '800', fontSize: 18 },
  menuButtonGhost: {
    backgroundColor: 'transparent',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#40618f',
  },
  menuButtonGhostText: { color: '#d7e8ff', fontWeight: '700', fontSize: 16 },

  gameWrap: { flex: 1, backgroundColor: '#060d1b', padding: 10 },
  hudTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
    gap: 8,
  },
  objectiveRow: { marginBottom: 6, paddingHorizontal: 2 },
  objective: { color: '#d5e9ff', fontWeight: '800', letterSpacing: 0.25 },
  smallButton: {
    backgroundColor: '#12213a',
    borderWidth: 1,
    borderColor: '#294063',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallButtonText: { color: '#d6e6ff', fontWeight: '700' },
  hudRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hudChip: {
    backgroundColor: '#12213a',
    borderWidth: 1,
    borderColor: '#273f63',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minWidth: 66,
  },
  hudChipLabel: {
    color: '#8fb1dd',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  hudChipValue: {
    color: '#eaf5ff',
    fontSize: 13,
    fontWeight: '800',
  },

  world: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f3258',
    backgroundColor: '#0e1c38',
  },
  touchOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  moveZoneHint: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  cameraControlsRow: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraRotateButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(9, 20, 37, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(142, 177, 224, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraRotateButtonText: {
    color: '#d6e9ff',
    fontWeight: '900',
    fontSize: 30,
    lineHeight: 34,
  },
  toastWrap: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(8, 19, 36, 0.86)',
    borderWidth: 1,
    borderColor: 'rgba(172, 201, 244, 0.4)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toastText: {
    color: '#e4f0ff',
    fontWeight: '800',
    fontSize: 12,
  },
});
