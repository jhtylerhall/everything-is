import { Audio } from 'expo-av';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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

type Screen = 'menu' | 'settings' | 'game';
type Lane = -2 | -1 | 0 | 1 | 2;

type PlatformTile = {
  id: number;
  gx: number;
  gz: number;
  h: number;
  w: number;
  d: number;
};

type Star = {
  id: number;
  x: number;
  y: number;
  z: number;
  size: number;
  twinkle: number;
};

type Trail = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
};

type MoveAnim = {
  fromGx: number;
  fromGz: number;
  toGx: number;
  toGz: number;
  fromH: number;
  toH: number;
  dx: number;
  dz: number;
  t: number;
  duration: number;
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const TILE_SPACING = 2.45;
const PLAYER_HALF = 0.56;
const PLATFORM_THICKNESS = 0.28;

const GRAVITY = 20.5;
const JUMP_VELOCITY = 8.2;

const TRAIL_COLORS = ['#fff8ef', '#faedd9', '#eddab7', '#e3c18a'];

let splooshAudioContext: any = null;
let splooshSound: Audio.Sound | null = null;
let splooshLoadPromise: Promise<void> | null = null;

function seeded(n: number) {
  const x = Math.sin(n * 127.13 + 0.77) * 43758.5453;
  return x - Math.floor(x);
}

function clampNumber(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function clampLane(n: number): Lane {
  if (n <= -2) return -2;
  if (n === -1) return -1;
  if (n === 0) return 0;
  if (n === 1) return 1;
  return 2;
}

function easeInOut(t: number) {
  if (t < 0.5) return 2 * t * t;
  return 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function tileKey(gx: number, gz: number) {
  return `${gx},${gz}`;
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
          { shouldPlay: false, volume: 0.8 }
        );

        splooshSound = loaded.sound;
      } catch {
        splooshSound = null;
      }
    })();
  }

  await splooshLoadPromise;
}

function playSplooshWebFallback(intensity = 1) {
  try {
    const globalAny = globalThis as any;
    const AudioCtx = globalAny.AudioContext || globalAny.webkitAudioContext;
    if (!AudioCtx) return;

    if (!splooshAudioContext) {
      splooshAudioContext = new AudioCtx();
    }

    const ctx: any = splooshAudioContext;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime as number;

    const len = Math.floor(ctx.sampleRate * 0.1);
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
    filter.frequency.setValueAtTime(960 * intensity, now);
    filter.frequency.exponentialRampToValueAtTime(190, now + 0.14);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.33 * intensity, now + 0.011);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.16);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.16);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.exponentialRampToValueAtTime(0.12 * intensity, now + 0.012);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch {
    // noop on platforms without Web Audio
  }
}

function playSploosh(intensity = 1) {
  const rate = clampNumber(0.9 + intensity * 0.18, 0.84, 1.42);
  const volume = clampNumber(0.32 + intensity * 0.28, 0.2, 1);

  void (async () => {
    try {
      await ensureSplooshLoaded();
      if (splooshSound) {
        await splooshSound.replayAsync({
          rate,
          shouldCorrectPitch: true,
          volume,
        });
        return;
      }
    } catch {
      // fallback below
    }

    playSplooshWebFallback(intensity);
  })();
}

function buildLevel() {
  const map = new Map<string, PlatformTile>();
  const tiles: PlatformTile[] = [];
  let id = 1;

  const addTile = (gx: number, gz: number, h: number) => {
    const key = tileKey(gx, gz);
    const existing = map.get(key);
    if (existing) {
      if (h > existing.h) existing.h = h;
      return existing;
    }

    const tile: PlatformTile = {
      id: id++,
      gx,
      gz,
      h,
      w: 0.9 + seeded(gx * 4.1 + gz * 1.8 + 13) * 0.18,
      d: 0.9 + seeded(gx * 2.2 + gz * 3.7 + 29) * 0.2,
    };

    map.set(key, tile);
    tiles.push(tile);
    return tile;
  };

  // Start plateau so player never drops on boot
  for (let gx = -2; gx <= 2; gx++) {
    for (let gz = -2; gz <= 2; gz++) {
      addTile(gx, gz, 0);
    }
  }

  // Ascending spiral-ish exploration route
  const dirs: Array<{ dx: number; dz: number }> = [
    { dx: 1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: -1 },
  ];

  let gx = 0;
  let gz = 0;
  let h = 0;
  let dirIdx = 0;
  let segmentLength = 3;
  let segmentStep = 0;
  let turns = 0;

  const path: PlatformTile[] = [];

  for (let i = 1; i <= 72; i++) {
    gx += dirs[dirIdx].dx;
    gz += dirs[dirIdx].dz;

    if (i % 2 === 0) {
      h += 0.15 + seeded(i * 3.7) * 0.08;
    }
    if (i % 10 === 0) {
      h += 0.11;
    }

    const main = addTile(gx, gz, h);
    path.push(main);

    // Add side supports / alternate footholds
    if (i % 3 === 0) {
      const leftDir = dirs[(dirIdx + 1) % 4];
      addTile(gx + leftDir.dx, gz + leftDir.dz, Math.max(0, h - 0.14 - seeded(i) * 0.08));
    }
    if (i % 5 === 0) {
      const rightDir = dirs[(dirIdx + 3) % 4];
      addTile(gx + rightDir.dx, gz + rightDir.dz, Math.max(0, h - 0.2 - seeded(i * 1.9) * 0.1));
    }

    segmentStep++;
    if (segmentStep >= segmentLength) {
      segmentStep = 0;
      dirIdx = (dirIdx + 1) % 4;
      turns++;
      if (turns % 2 === 0) {
        segmentLength = Math.min(6, segmentLength + 1);
      }
    }
  }

  const goal = path[path.length - 1];
  return { map, tiles, goal };
}

const LEVEL = buildLevel();

function rightVectorFromYaw(yawDeg: number) {
  const normalized = ((yawDeg % 360) + 360) % 360;
  const q = ((Math.round(normalized / 90) % 4) + 4) % 4;

  const dirs = [
    { dx: 1, dz: 0 },
    { dx: 0, dz: -1 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
  ];

  return dirs[q];
}

function HudChip({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.hudChip}>
      <Text style={styles.hudChipLabel}>{label}</Text>
      <Text style={styles.hudChipValue}>{value}</Text>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');

  return (
    <SafeAreaView style={styles.safe}>
      {screen === 'menu' && <MainMenu onPlay={() => setScreen('game')} onSettings={() => setScreen('settings')} />}
      {screen === 'settings' && <Settings onBack={() => setScreen('menu')} />}
      {screen === 'game' && <Game onMenu={() => setScreen('menu')} />}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

function MainMenu({ onPlay, onSettings }: { onPlay: () => void; onSettings: () => void }) {
  return (
    <View style={styles.menuWrap}>
      <View style={styles.menuOrbA} />
      <View style={styles.menuOrbB} />

      <Text style={styles.kicker}>PHYSICS EXPLORATION PROTOTYPE</Text>
      <Text style={styles.title}>Cream Cheese → Phone</Text>
      <Text style={styles.copyCenter}>Swipe left/right to topple the block. Swipe up to jump.</Text>
      <Text style={styles.copyCenter}>Use the right side of the screen to look around (yaw + pitch camera).</Text>

      <Pressable style={styles.menuButtonPrimary} onPress={onPlay}>
        <Text style={styles.menuButtonPrimaryText}>Start Run</Text>
      </Pressable>

      <Pressable style={styles.menuButton} onPress={onSettings}>
        <Text style={styles.menuButtonText}>Settings</Text>
      </Pressable>
    </View>
  );
}

function Settings({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.menuWrap}>
      <Text style={styles.subtitle}>Settings (Prototype)</Text>
      <Text style={styles.copyCenter}>Movement zone: left half. Camera zone: right half.</Text>
      <Text style={styles.copyCenter}>Topple controls are intentionally chunky and physical.</Text>

      <Pressable style={styles.menuButton} onPress={onBack}>
        <Text style={styles.menuButtonText}>Back</Text>
      </Pressable>
    </View>
  );
}

function Game({ onMenu }: { onMenu: () => void }) {
  const [won, setWon] = useState(false);
  const [crashed, setCrashed] = useState(false);

  const currentCellRef = useRef({ gx: 0, gz: 0 });
  const moveRef = useRef<MoveAnim | null>(null);

  const jumpOffsetRef = useRef(0);
  const jumpVyRef = useRef(0);
  const groundedRef = useRef(true);
  const jumpAssistRef = useRef(0);

  const scoreBonusRef = useRef(0);
  const streakRef = useRef(1);
  const lastMoveSecRef = useRef(0);
  const highestTileIdRef = useRef(0);

  const cameraYawUserRef = useRef(24);
  const cameraPitchUserRef = useRef(22);
  const cameraYawKickRef = useRef(0);
  const cameraPitchKickRef = useRef(0);

  const toastRef = useRef({ text: '', life: 0 });
  const shakeRef = useRef({ magnitude: 0, life: 0 });

  const trailsRef = useRef<Trail[]>([]);
  const nextTrailIdRef = useRef(1);

  const playerWorldRef = useRef({ x: 0, y: PLAYER_HALF + PLATFORM_THICKNESS, z: 0, baseH: 0 });
  const playerScreenRef = useRef({ x: SCREEN_WIDTH / 2, y: 500 });

  const gestureModeRef = useRef<'move' | 'camera' | null>(null);
  const gestureLastRef = useRef({ dx: 0, dy: 0 });

  const lastTsRef = useRef(0);
  const [, forceRender] = useState(0);

  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: 56 }, (_, i) => ({
        id: i + 1,
        x: seeded(i * 1.7 + 7) * 4.2 - 2.1,
        y: 0.8 + seeded(i * 2.3 + 4) * 2.8,
        z: seeded(i * 3.1 + 9) * 260,
        size: 1.1 + seeded(i * 3.9 + 2) * 2.5,
        twinkle: seeded(i * 2.8 + 11) * Math.PI * 2,
      })),
    []
  );

  const getTile = (gx: number, gz: number) => LEVEL.map.get(tileKey(gx, gz));

  useEffect(() => {
    void ensureSplooshLoaded();
  }, []);

  const showToast = (text: string, life = 0.8) => {
    toastRef.current = { text, life };
  };

  const addShake = (magnitude: number, life: number) => {
    shakeRef.current = {
      magnitude: Math.max(shakeRef.current.magnitude, magnitude),
      life: Math.max(shakeRef.current.life, life),
    };
  };

  const spawnTrail = (count: number, energy: number) => {
    const base = playerScreenRef.current;

    for (let i = 0; i < count; i++) {
      trailsRef.current.push({
        id: nextTrailIdRef.current++,
        x: base.x + (Math.random() - 0.5) * 28,
        y: base.y + (Math.random() - 0.5) * 18,
        vx: (Math.random() - 0.5) * 2.3 * energy,
        vy: (-0.8 - Math.random() * 1.7) * energy,
        life: 0.42 + Math.random() * 0.35,
        size: 3 + Math.random() * 5,
        color: TRAIL_COLORS[Math.floor(Math.random() * TRAIL_COLORS.length)],
      });
    }

    if (trailsRef.current.length > 300) {
      trailsRef.current.splice(0, trailsRef.current.length - 300);
    }
  };

  const resetRun = () => {
    currentCellRef.current = { gx: 0, gz: 0 };
    moveRef.current = null;

    jumpOffsetRef.current = 0;
    jumpVyRef.current = 0;
    groundedRef.current = true;
    jumpAssistRef.current = 0;

    scoreBonusRef.current = 0;
    streakRef.current = 1;
    lastMoveSecRef.current = 0;
    highestTileIdRef.current = 0;

    cameraYawUserRef.current = 24;
    cameraPitchUserRef.current = 22;
    cameraYawKickRef.current = 0;
    cameraPitchKickRef.current = 0;

    toastRef.current = { text: '', life: 0 };
    shakeRef.current = { magnitude: 0, life: 0 };

    trailsRef.current = [];

    setWon(false);
    setCrashed(false);
  };

  const jump = () => {
    if (won || crashed) return;
    if (!groundedRef.current && jumpOffsetRef.current > 0.03) return;

    groundedRef.current = false;
    jumpVyRef.current = JUMP_VELOCITY;
    jumpAssistRef.current = 0.68;

    cameraPitchKickRef.current += 7;
    addShake(1.2, 0.1);
    spawnTrail(10, 1.2);
    playSploosh(1.0);
  };

  const toppleMove = (dir: -1 | 1) => {
    if (won || crashed) return;
    if (moveRef.current) return;

    const current = currentCellRef.current;
    const currentTile = getTile(current.gx, current.gz);
    if (!currentTile) return;

    const right = rightVectorFromYaw(cameraYawUserRef.current);
    const dx = right.dx * dir;
    const dz = right.dz * dir;

    const targetGx = current.gx + dx;
    const targetGz = current.gz + dz;

    const targetTile = getTile(targetGx, targetGz);
    if (!targetTile) {
      showToast('No platform there', 0.65);
      addShake(1, 0.08);
      playSploosh(0.56);
      return;
    }

    const heightDiff = targetTile.h - currentTile.h;
    const canClimb = heightDiff <= 0.42 || jumpAssistRef.current > 0.01 || jumpOffsetRef.current > 0.16;

    if (heightDiff > 1.05 || !canClimb) {
      showToast('Too high. Jump then move.', 0.72);
      addShake(0.95, 0.08);
      playSploosh(0.52);
      return;
    }

    moveRef.current = {
      fromGx: current.gx,
      fromGz: current.gz,
      toGx: targetGx,
      toGz: targetGz,
      fromH: currentTile.h,
      toH: targetTile.h,
      dx,
      dz,
      t: 0,
      duration: 0.24,
    };

    groundedRef.current = false;
    if (heightDiff > 0.42) jumpAssistRef.current = 0;

    const nowSec = lastTsRef.current / 1000;
    if (nowSec - lastMoveSecRef.current < 1.12) {
      streakRef.current = Math.min(9, streakRef.current + 1);
    } else {
      streakRef.current = 1;
    }
    lastMoveSecRef.current = nowSec;

    scoreBonusRef.current += 10 * streakRef.current;

    cameraYawKickRef.current += dir * 24;
    cameraPitchKickRef.current += 1.6;
    addShake(0.85, 0.08);
    spawnTrail(8, 0.85);
    playSploosh(0.74 + streakRef.current * 0.03);
  };

  const onMoveSwipe = (dx: number, dy: number) => {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
      toppleMove(dx > 0 ? 1 : -1);
      return;
    }

    if (dy < -20) {
      jump();
    }
  };

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

      if (key === 'a' || key === 'arrowleft') {
        toppleMove(-1);
        return;
      }

      if (key === 'd' || key === 'arrowright') {
        toppleMove(1);
        return;
      }

      if (key === 'w') {
        cameraPitchUserRef.current = clampNumber(cameraPitchUserRef.current - 4.5, 8, 56);
        forceRender((n) => (n + 1) % 1000000);
        return;
      }

      if (key === 's' || key === 'arrowdown') {
        cameraPitchUserRef.current = clampNumber(cameraPitchUserRef.current + 4.5, 8, 56);
        forceRender((n) => (n + 1) % 1000000);
        return;
      }

      if (key === ' ' || key === 'arrowup') {
        jump();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [won, crashed]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderGrant: (evt) => {
          const x = evt.nativeEvent.locationX;
          gestureModeRef.current = x > SCREEN_WIDTH * 0.52 ? 'camera' : 'move';
          gestureLastRef.current = { dx: 0, dy: 0 };
        },
        onPanResponderMove: (_, g) => {
          if (gestureModeRef.current !== 'camera') return;

          const ddx = g.dx - gestureLastRef.current.dx;
          const ddy = g.dy - gestureLastRef.current.dy;
          gestureLastRef.current = { dx: g.dx, dy: g.dy };

          cameraYawUserRef.current = clampNumber(cameraYawUserRef.current + ddx * 0.42, -110, 110);
          cameraPitchUserRef.current = clampNumber(cameraPitchUserRef.current - ddy * 0.28, 8, 56);

          forceRender((n) => (n + 1) % 1000000);
        },
        onPanResponderRelease: (_, g) => {
          if (gestureModeRef.current === 'move') {
            onMoveSwipe(g.dx, g.dy);
          }
          gestureModeRef.current = null;
          gestureLastRef.current = { dx: 0, dy: 0 };
        },
        onPanResponderTerminate: () => {
          gestureModeRef.current = null;
          gestureLastRef.current = { dx: 0, dy: 0 };
        },
      }),
    [won, crashed]
  );

  useEffect(() => {
    let raf = 0;

    const tick = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.033, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      if (!won && !crashed) {
        if (jumpAssistRef.current > 0) {
          jumpAssistRef.current = Math.max(0, jumpAssistRef.current - dt);
        }

        const move = moveRef.current;
        const cell = currentCellRef.current;
        const tile = getTile(cell.gx, cell.gz);

        let worldGx = cell.gx;
        let worldGz = cell.gz;
        let baseH = tile ? tile.h : 0;

        if (move) {
          move.t += dt / move.duration;
          const t = Math.min(1, move.t);
          const e = easeInOut(t);

          worldGx = lerp(move.fromGx, move.toGx, e);
          worldGz = lerp(move.fromGz, move.toGz, e);
          baseH = lerp(move.fromH, move.toH, e) + Math.sin(Math.PI * e) * 0.16;

          if (t >= 1) {
            currentCellRef.current = { gx: move.toGx, gz: move.toGz };
            moveRef.current = null;

            const landedTile = getTile(move.toGx, move.toGz);
            if (landedTile && landedTile.id > highestTileIdRef.current) {
              highestTileIdRef.current = landedTile.id;
              scoreBonusRef.current += 24;
              showToast(`Height +${landedTile.h.toFixed(1)}`, 0.58);
            }

            addShake(0.9, 0.08);
          }
        }

        const prevJump = jumpOffsetRef.current;

        jumpVyRef.current -= GRAVITY * dt;
        jumpOffsetRef.current += jumpVyRef.current * dt;

        if (jumpOffsetRef.current <= 0) {
          jumpOffsetRef.current = 0;
          if (prevJump > 0.04 && jumpVyRef.current < -2.8) {
            spawnTrail(14, 1.4);
            addShake(2.0, 0.12);
            cameraPitchKickRef.current -= 3.4;
            playSploosh(0.92);
          }

          jumpVyRef.current = 0;
          if (!moveRef.current) groundedRef.current = true;
        } else {
          groundedRef.current = false;
        }

        const worldX = worldGx * TILE_SPACING;
        const worldZ = worldGz * TILE_SPACING;
        const worldY = baseH + PLATFORM_THICKNESS + PLAYER_HALF + jumpOffsetRef.current;

        playerWorldRef.current = { x: worldX, y: worldY, z: worldZ, baseH };

        if (!moveRef.current) {
          const currentTile = getTile(currentCellRef.current.gx, currentCellRef.current.gz);
          if (currentTile && currentTile.id === LEVEL.goal.id && jumpOffsetRef.current < 0.03) {
            setWon(true);
            scoreBonusRef.current += 500;
            showToast('Ascension complete', 1.15);
            spawnTrail(30, 2.0);
            addShake(2.5, 0.2);
            playSploosh(1.2);
          }
        }

        // Ambient trail while moving
        if (Math.random() < (groundedRef.current ? 0.45 : 0.28)) {
          spawnTrail(1, groundedRef.current ? 0.5 : 0.85);
        }
      }

      cameraYawKickRef.current *= Math.exp(-dt * 3.2);
      cameraPitchKickRef.current *= Math.exp(-dt * 3.5);

      // Trail sim
      const nextTrail: Trail[] = [];
      for (const p of trailsRef.current) {
        p.x += p.vx * 88 * dt;
        p.y += p.vy * 90 * dt;
        p.vy += 3.6 * dt;
        p.vx *= 0.986;
        p.life -= dt;
        if (p.life > 0) nextTrail.push(p);
      }
      trailsRef.current = nextTrail;

      if (toastRef.current.life > 0) {
        toastRef.current.life = Math.max(0, toastRef.current.life - dt);
      }

      if (shakeRef.current.life > 0) {
        shakeRef.current.life = Math.max(0, shakeRef.current.life - dt);
        if (shakeRef.current.life === 0) shakeRef.current.magnitude = 0;
      }

      forceRender((n) => (n + 1) % 1000000);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [won, crashed]);

  const move = moveRef.current;
  const moveE = move ? easeInOut(Math.min(1, move.t)) : 0;

  const cameraYaw = clampNumber(
    cameraYawUserRef.current + cameraYawKickRef.current + Math.sin(lastTsRef.current * 0.0018) * 3.8,
    -112,
    112
  );
  const cameraPitch = clampNumber(cameraPitchUserRef.current + cameraPitchKickRef.current, 8, 58);

  const player = playerWorldRef.current;

  const shake = shakeRef.current.life > 0 ? shakeRef.current.magnitude * (shakeRef.current.life / 0.24) : 0;
  const shakeX = Math.sin(lastTsRef.current * 0.048) * shake;
  const shakeY = Math.cos(lastTsRef.current * 0.052) * shake * 0.72;

  const yawRad = (cameraYaw * Math.PI) / 180;
  const pitchRad = (cameraPitch * Math.PI) / 180;

  const camDistance = 7.45;
  const camX = player.x - Math.sin(yawRad) * camDistance;
  const camZ = player.z - Math.cos(yawRad) * camDistance;
  const camY = player.y + 2.15 + cameraPitch * 0.03;

  const project = (wx: number, wy: number, wz: number) => {
    const rx = wx - camX;
    const ry = wy - camY;
    const rz = wz - camZ;

    const x1 = rx * Math.cos(yawRad) - rz * Math.sin(yawRad);
    const z1 = rx * Math.sin(yawRad) + rz * Math.cos(yawRad);

    const y2 = ry * Math.cos(pitchRad) - z1 * Math.sin(pitchRad);
    const z2 = ry * Math.sin(pitchRad) + z1 * Math.cos(pitchRad);

    if (z2 <= 0.2) return null;

    const depth = 1 / (0.8 + z2 * 0.1);
    const x = SCREEN_WIDTH / 2 + x1 * 178 * depth + shakeX;
    const y = 362 - y2 * 58 * depth + shakeY;
    return { x, y, depth, z2 };
  };

  const renderedTiles = LEVEL.tiles
    .map((tile) => {
      const wx = tile.gx * TILE_SPACING;
      const wz = tile.gz * TILE_SPACING;
      const wy = tile.h + PLATFORM_THICKNESS;
      const p = project(wx, wy, wz);
      if (!p) return null;
      if (p.z2 < 0.9 || p.z2 > 120) return null;
      return { tile, p };
    })
    .filter((v): v is { tile: PlatformTile; p: NonNullable<ReturnType<typeof project>> } => !!v)
    .sort((a, b) => b.p.z2 - a.p.z2);

  const loop = LEVEL.goal.gz * TILE_SPACING + 220;
  const renderedStars = stars
    .map((star) => {
      const wrapped = ((star.z - player.z) % loop + loop) % loop;
      const p = project(star.x * 6.5, star.y * 3.5 + 2, player.z + wrapped);
      if (!p || p.z2 > 140) return null;
      return { star, p };
    })
    .filter((v): v is { star: Star; p: NonNullable<ReturnType<typeof project>> } => !!v);

  const goalProjection = project(
    LEVEL.goal.gx * TILE_SPACING,
    LEVEL.goal.h + 1.9,
    LEVEL.goal.gz * TILE_SPACING
  );

  const playerProjection = project(player.x, player.y, player.z);

  if (playerProjection) {
    playerScreenRef.current = { x: playerProjection.x, y: playerProjection.y };
  }

  const playerSize = playerProjection ? clampNumber(84 * playerProjection.depth * 1.22, 48, 96) : 72;

  const toppleRotX = move ? -move.dz * 90 * moveE : 0;
  const toppleRotZ = move ? move.dx * 90 * moveE : 0;

  const playerRotY = clampNumber(cameraYaw * 0.72 + (move ? move.dx * 26 * (1 - moveE) : 0), -95, 95);
  const playerRotX = clampNumber(toppleRotX - jumpVyRef.current * 3, -88, 88);
  const playerRotZ = clampNumber(toppleRotZ + (move ? move.dz * 20 * (1 - moveE) : 0), -88, 88);

  const stretchY = groundedRef.current
    ? 1 - Math.min(0.11, Math.abs(toppleRotZ) * 0.0014)
    : 1.07 + Math.min(0.14, jumpOffsetRef.current * 0.12);
  const stretchX = 1 / stretchY;

  const score = Math.floor((LEVEL.goal.h > 0 ? player.baseH / LEVEL.goal.h : 0) * 900) + scoreBonusRef.current;
  const progress = LEVEL.goal.h > 0 ? clampNumber(player.baseH / LEVEL.goal.h, 0, 1) : 0;

  const toastOpacity = Math.min(1, toastRef.current.life * 1.7);

  return (
    <View style={styles.gameWrap}>
      <View style={styles.hudTop}>
        <Pressable onPress={onMenu} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>Menu</Text>
        </Pressable>

        <View style={styles.hudRight}>
          <HudChip label="Score" value={score} />
          <HudChip label="Flow" value={`x${streakRef.current}`} />
          <HudChip label="Cam" value={`${Math.round(cameraYaw)}°`} />
        </View>
      </View>

      <View style={styles.objectiveRow}>
        <Text style={styles.objective}>Physics climb. Control camera. Become the Phone.</Text>
      </View>

      <View style={styles.world} {...panResponder.panHandlers}>
        <View style={styles.skyGlowA} />
        <View style={styles.skyGlowB} />
        <View style={styles.vignetteTop} />

        {renderedStars.map(({ star, p }) => {
          const twinkle = 0.55 + 0.45 * Math.sin(lastTsRef.current * 0.0032 + star.twinkle);
          return (
            <View
              key={`star-${star.id}`}
              style={[
                styles.star,
                {
                  left: p.x,
                  top: p.y,
                  width: star.size * p.depth,
                  height: star.size * p.depth,
                  opacity: 0.14 + p.depth * 0.58 * twinkle,
                },
              ]}
            />
          );
        })}

        {renderedTiles.map(({ tile, p }) => {
          const width = tile.w * 130 * p.depth;
          const depthPx = tile.d * 56 * p.depth;
          const sideH = (18 + tile.h * 14) * p.depth;

          return (
            <React.Fragment key={`tile-${tile.id}`}>
              <View
                style={[
                  styles.platformGlow,
                  {
                    left: p.x - width * 0.56,
                    top: p.y - depthPx * 0.62,
                    width: width * 1.12,
                    height: depthPx * 1.92,
                    opacity: Math.min(0.62, 0.16 + p.depth * 0.82),
                  },
                ]}
              />
              <View
                style={[
                  styles.platformSide,
                  {
                    left: p.x - width / 2,
                    top: p.y + depthPx * 0.1,
                    width,
                    height: sideH,
                    opacity: 0.4 + p.depth * 0.5,
                  },
                ]}
              />
              <View
                style={[
                  styles.platformTop,
                  {
                    left: p.x - width / 2,
                    top: p.y - depthPx * 0.37,
                    width,
                    height: depthPx,
                    opacity: 0.62 + p.depth * 0.45,
                  },
                ]}
              >
                <View style={styles.platformTopGloss} />
                <View style={styles.platformStripe} />
                <View style={styles.platformStripeSmall} />
              </View>
            </React.Fragment>
          );
        })}

        {goalProjection && (
          <>
            <View
              style={[
                styles.goalHalo,
                {
                  left: goalProjection.x - 130 * goalProjection.depth,
                  top: goalProjection.y - 50 * goalProjection.depth,
                  width: 260 * goalProjection.depth,
                  height: 120 * goalProjection.depth,
                  opacity: Math.min(0.72, goalProjection.depth * 2.8),
                },
              ]}
            />
            <View
              style={[
                styles.goalPhone,
                {
                  left: goalProjection.x - (96 * goalProjection.depth) / 2,
                  top: goalProjection.y - 66 * goalProjection.depth,
                  width: 96 * goalProjection.depth,
                  height: 186 * goalProjection.depth,
                  borderRadius: 20 * goalProjection.depth,
                  opacity: Math.min(1, goalProjection.depth * 4.6),
                },
              ]}
            >
              <View
                style={[
                  styles.goalNotch,
                  {
                    width: 40 * goalProjection.depth,
                    height: 7 * goalProjection.depth,
                    borderRadius: 6 * goalProjection.depth,
                  },
                ]}
              />
            </View>
          </>
        )}

        {Array.from({ length: 9 }).map((_, idx) => {
          const zOffset = ((idx * 13 + (lastTsRef.current * 0.016) % 13) % 36) * TILE_SPACING;
          const side = idx % 2 === 0 ? -8 : 8;
          const p = project(player.x + side, player.y + 1 + (idx % 3) * 0.2, player.z + zOffset);
          if (!p) return null;

          return (
            <View
              key={`streak-${idx}`}
              style={[
                styles.speedStreak,
                {
                  left: p.x - 24 * p.depth,
                  top: p.y,
                  width: 74 * p.depth,
                  opacity: 0.06 + p.depth * 0.22,
                },
              ]}
            />
          );
        })}

        {trailsRef.current.map((trail) => (
          <View
            key={`trail-${trail.id}`}
            style={[
              styles.trail,
              {
                left: trail.x - trail.size / 2,
                top: trail.y - trail.size / 2,
                width: trail.size,
                height: trail.size,
                backgroundColor: trail.color,
                opacity: Math.max(0, trail.life * 1.6),
              },
            ]}
          />
        ))}

        {playerProjection && (
          <View
            style={[
              styles.playerShadow,
              {
                left: playerProjection.x - 44,
                top: playerProjection.y + playerSize * 0.64,
                transform: [
                  { scaleX: Math.max(0.5, 1.14 - jumpOffsetRef.current * 0.15) },
                  { scaleY: Math.max(0.34, 1 - jumpOffsetRef.current * 0.2) },
                ],
                opacity: Math.max(0.07, 0.3 - jumpOffsetRef.current * 0.08),
              },
            ]}
          />
        )}

        {playerProjection && (
          <View
            style={[
              styles.playerBody,
              {
                left: playerProjection.x - playerSize / 2,
                top: playerProjection.y - playerSize * 0.95,
                width: playerSize,
                height: playerSize,
                borderRadius: 14 * (playerSize / 84),
                transform: [
                  { perspective: 840 },
                  { rotateY: `${playerRotY}deg` },
                  { rotateX: `${playerRotX}deg` },
                  { rotateZ: `${playerRotZ}deg` },
                  { scaleX: stretchX },
                  { scaleY: stretchY },
                ],
              },
            ]}
          >
            <View
              style={[
                styles.playerTopGloss,
                {
                  height: 24 * (playerSize / 84),
                  opacity: 0.62 + Math.sin(lastTsRef.current * 0.006 + player.z) * 0.29,
                },
              ]}
            />
            <View style={[styles.playerFace, { width: 12 * (playerSize / 84) }]} />
            <View
              style={[
                styles.playerCreaseA,
                {
                  left: 12 * (playerSize / 84),
                  top: 28 * (playerSize / 84),
                  width: 20 * (playerSize / 84),
                  height: 8 * (playerSize / 84),
                  borderRadius: 8 * (playerSize / 84),
                },
              ]}
            />
            <View
              style={[
                styles.playerCreaseB,
                {
                  left: 33 * (playerSize / 84),
                  top: 44 * (playerSize / 84),
                  width: 16 * (playerSize / 84),
                  height: 7 * (playerSize / 84),
                  borderRadius: 7 * (playerSize / 84),
                },
              ]}
            />
          </View>
        )}

        {highestTileIdRef.current < 3 && !won && !crashed && (
          <View style={styles.tutorialWrap}>
            <Text style={styles.tutorialText}>Phone: swipe ← / → to topple · swipe ↑ to jump</Text>
            <Text style={styles.tutorialText}>Desktop: A/D topple · W/S camera pitch · Space jump</Text>
            <Text style={styles.tutorialText}>Right-side swipe rotates camera look</Text>
          </View>
        )}

        {toastRef.current.life > 0 && (
          <View style={[styles.toast, { opacity: toastOpacity, transform: [{ translateY: (1 - toastOpacity) * 12 }] }]}>
            <Text style={styles.toastText}>{toastRef.current.text}</Text>
          </View>
        )}

        <View style={styles.progressWrap}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </View>

      {(won || crashed) && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>{won ? 'Ascension complete.' : 'Run failed.'}</Text>
          <Text style={styles.overlayCopy}>
            {won
              ? `Final Score ${score} · Flow x${streakRef.current}`
              : 'Try camera-controlled lane alignment and jump-assisted climbs.'}
          </Text>

          <Pressable style={styles.menuButtonPrimary} onPress={resetRun}>
            <Text style={styles.menuButtonPrimaryText}>Run Again</Text>
          </Pressable>
        </View>
      )}
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
    fontSize: 42,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    color: '#f3f6ff',
    fontSize: 28,
    fontWeight: '800',
  },
  copyCenter: {
    color: '#b7c4df',
    textAlign: 'center',
    maxWidth: 560,
    lineHeight: 21,
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
  menuButton: {
    backgroundColor: '#1a2741',
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d3b57',
  },
  menuButtonText: { color: '#d9e6ff', fontWeight: '700', fontSize: 16 },

  gameWrap: { flex: 1, backgroundColor: '#060d1b', padding: 10 },
  hudTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
    gap: 8,
  },
  objectiveRow: {
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  objective: {
    color: '#d5e9ff',
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  smallButton: {
    backgroundColor: '#12213a',
    borderWidth: 1,
    borderColor: '#294063',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallButtonText: { color: '#d6e6ff', fontWeight: '700' },
  hudRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
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
    backgroundColor: '#0f1e3a',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f3258',
  },
  skyGlowA: {
    position: 'absolute',
    left: -120,
    top: -150,
    width: 770,
    height: 420,
    borderRadius: 390,
    backgroundColor: '#193a6f',
    opacity: 0.46,
  },
  skyGlowB: {
    position: 'absolute',
    right: -170,
    top: -130,
    width: 530,
    height: 320,
    borderRadius: 260,
    backgroundColor: '#153764',
    opacity: 0.32,
  },
  vignetteTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 136,
    backgroundColor: 'rgba(2,8,18,0.16)',
  },

  star: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#dff1ff',
  },

  platformGlow: {
    position: 'absolute',
    borderRadius: 14,
    backgroundColor: '#ffd172',
  },
  platformTop: {
    position: 'absolute',
    backgroundColor: '#ffd86e',
    borderWidth: 2,
    borderColor: '#fff0bb',
    borderRadius: 10,
    overflow: 'hidden',
  },
  platformTopGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '42%',
    backgroundColor: 'rgba(255,245,205,0.78)',
  },
  platformStripe: {
    position: 'absolute',
    left: '11%',
    right: '11%',
    top: '56%',
    height: '18%',
    borderRadius: 8,
    backgroundColor: 'rgba(123,60,12,0.34)',
  },
  platformStripeSmall: {
    position: 'absolute',
    left: '17%',
    top: '24%',
    width: '30%',
    height: '12%',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  platformSide: {
    position: 'absolute',
    backgroundColor: '#9d5226',
    borderWidth: 1,
    borderColor: '#d7884f',
    borderRadius: 8,
  },

  goalHalo: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#4d93ff',
  },
  goalPhone: {
    position: 'absolute',
    backgroundColor: '#101828',
    borderWidth: 2,
    borderColor: '#86bcff',
    alignItems: 'center',
    paddingTop: 8,
  },
  goalNotch: {
    backgroundColor: '#1b2d4a',
  },

  speedStreak: {
    position: 'absolute',
    height: 2,
    borderRadius: 2,
    backgroundColor: '#d4e8ff',
  },

  trail: {
    position: 'absolute',
    borderRadius: 999,
  },

  playerShadow: {
    position: 'absolute',
    width: 88,
    height: 24,
    borderRadius: 999,
    backgroundColor: '#01060d',
  },
  playerBody: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 14,
    backgroundColor: '#f5efe0',
    borderWidth: 2,
    borderColor: '#d6c6aa',
    overflow: 'hidden',
  },
  playerTopGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 24,
    backgroundColor: '#fff8ec',
  },
  playerFace: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 12,
    backgroundColor: '#e5d5bc',
  },
  playerCreaseA: {
    position: 'absolute',
    left: 12,
    top: 28,
    width: 20,
    height: 8,
    borderRadius: 8,
    backgroundColor: '#eddcbf',
  },
  playerCreaseB: {
    position: 'absolute',
    left: 33,
    top: 44,
    width: 16,
    height: 7,
    borderRadius: 7,
    backgroundColor: '#ead8b9',
  },

  tutorialWrap: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(4,10,20,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(125,164,212,0.35)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  tutorialText: {
    color: '#d6e9ff',
    fontWeight: '700',
    fontSize: 12,
  },

  toast: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(8,19,36,0.86)',
    borderWidth: 1,
    borderColor: '#3e67a0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toastText: {
    color: '#d9ecff',
    fontWeight: '800',
    letterSpacing: 0.2,
    fontSize: 12,
  },

  progressWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    height: 8,
    borderRadius: 6,
    backgroundColor: '#11213f',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#79d4ff',
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3,8,16,0.74)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 20,
  },
  overlayTitle: {
    color: '#f3f8ff',
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  overlayCopy: {
    color: '#b9cce8',
    fontSize: 16,
    marginBottom: 10,
    textAlign: 'center',
  },
});
