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

type Screen = 'menu' | 'game';

type Particle = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const ARENA_HALF = 8.2;
const CUBE_HALF = 0.86;
const IMPULSE_BASE = 6.6;

const TRAIL_COLORS = ['#fff8ef', '#f6e8cf', '#f0dcb8', '#e6c792'];

let splooshAudioContext: any = null;
let splooshSound: Audio.Sound | null = null;
let splooshLoadPromise: Promise<void> | null = null;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
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
    filter.frequency.setValueAtTime(1000 * intensity, now);
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
    // ignore if unavailable
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
          { shouldPlay: false, volume: 0.84 }
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
  const rate = clamp(0.9 + intensity * 0.17, 0.8, 1.45);
  const volume = clamp(0.28 + intensity * 0.28, 0.2, 1);

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

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');

  return (
    <SafeAreaView style={styles.safe}>
      {screen === 'menu' && <MainMenu onStart={() => setScreen('game')} />}
      {screen === 'game' && <CubeSandbox onBack={() => setScreen('menu')} />}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

function MainMenu({ onStart }: { onStart: () => void }) {
  return (
    <View style={styles.menuWrap}>
      <View style={styles.menuOrbA} />
      <View style={styles.menuOrbB} />

      <Text style={styles.kicker}>CREAM CHEESE MATERIAL LAB</Text>
      <Text style={styles.title}>Hyperreal Cube Sandbox</Text>
      <Text style={styles.copyCenter}>No platforms. Just polish.</Text>
      <Text style={styles.copyCenter}>Phone: swipe to shove and rotate camera.</Text>
      <Text style={styles.copyCenter}>Desktop: WASD + Space.</Text>

      <Pressable style={styles.menuButtonPrimary} onPress={onStart}>
        <Text style={styles.menuButtonPrimaryText}>Start Run</Text>
      </Pressable>
    </View>
  );
}

function CubeSandbox({ onBack }: { onBack: () => void }) {
  const cubePosRef = useRef({ x: 0, z: 0 });
  const cubeVelRef = useRef({ x: 0, z: 0 });

  const cubeRotRef = useRef({ x: 8, y: 18, z: 0 });
  const cubeAngVelRef = useRef({ x: 0, y: 0, z: 0 });

  const squishRef = useRef(1);
  const sparkleRef = useRef(0);

  const cameraYawRef = useRef(24);
  const cameraPitchRef = useRef(23);
  const cameraYawKickRef = useRef(0);

  const gestureModeRef = useRef<'move' | 'camera' | null>(null);
  const gestureLastRef = useRef({ dx: 0, dy: 0 });

  const trailRef = useRef<Particle[]>([]);
  const nextTrailIdRef = useRef(1);

  const toastRef = useRef({ text: 'Swipe and feel the cube', life: 2.4 });

  const lastTsRef = useRef(0);
  const [, forceRender] = useState(0);

  const floorPoints = useMemo(() => {
    const points: Array<{ x: number; z: number; parity: number }> = [];
    for (let gx = -11; gx <= 11; gx++) {
      for (let gz = -11; gz <= 11; gz++) {
        points.push({ x: gx * 0.9, z: gz * 0.9, parity: Math.abs(gx + gz) % 2 });
      }
    }
    return points;
  }, []);

  useEffect(() => {
    void ensureSplooshLoaded();
  }, []);

  const spawnTrail = (count: number, energy: number, sx: number, sy: number) => {
    for (let i = 0; i < count; i++) {
      trailRef.current.push({
        id: nextTrailIdRef.current++,
        x: sx + (Math.random() - 0.5) * 28,
        y: sy + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 2.5 * energy,
        vy: (-0.8 - Math.random() * 1.8) * energy,
        life: 0.36 + Math.random() * 0.36,
        size: 3 + Math.random() * 5,
        color: TRAIL_COLORS[Math.floor(Math.random() * TRAIL_COLORS.length)],
      });
    }

    if (trailRef.current.length > 320) {
      trailRef.current.splice(0, trailRef.current.length - 320);
    }
  };

  const showToast = (text: string, life = 1.0) => {
    toastRef.current = { text, life };
  };

  const applyImpulse = (sx: number, sy: number, magnitude: number) => {
    const len = Math.hypot(sx, sy);
    if (len < 1) return;

    const nx = sx / len;
    const ny = sy / len;

    const yawRad = (cameraYawRef.current * Math.PI) / 180;

    const right = { x: Math.cos(yawRad), z: -Math.sin(yawRad) };
    const forward = { x: Math.sin(yawRad), z: Math.cos(yawRad) };

    const world = {
      x: right.x * nx + forward.x * ny,
      z: right.z * nx + forward.z * ny,
    };

    const impulse = IMPULSE_BASE * magnitude;

    cubeVelRef.current.x += world.x * impulse;
    cubeVelRef.current.z += world.z * impulse;

    cubeAngVelRef.current.x += world.z * impulse * 1.9;
    cubeAngVelRef.current.z += -world.x * impulse * 1.9;
    cubeAngVelRef.current.y += world.x * 0.7;

    squishRef.current = clamp(0.9 + magnitude * 0.2, 0.82, 1.3);
    sparkleRef.current = clamp(sparkleRef.current + 0.35 * magnitude, 0, 1.4);

    playSploosh(0.72 + magnitude * 0.36);
    showToast('Cream momentum', 0.46);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderGrant: (evt) => {
          const x = evt.nativeEvent.locationX;
          gestureModeRef.current = x > SCREEN_WIDTH * 0.54 ? 'camera' : 'move';
          gestureLastRef.current = { dx: 0, dy: 0 };
        },
        onPanResponderMove: (_, g) => {
          if (gestureModeRef.current !== 'camera') return;

          const ddx = g.dx - gestureLastRef.current.dx;
          const ddy = g.dy - gestureLastRef.current.dy;
          gestureLastRef.current = { dx: g.dx, dy: g.dy };

          cameraYawRef.current = clamp(cameraYawRef.current + ddx * 0.43, -140, 140);
          cameraPitchRef.current = clamp(cameraPitchRef.current - ddy * 0.25, 8, 56);
          forceRender((n) => (n + 1) % 1000000);
        },
        onPanResponderRelease: (_, g) => {
          if (gestureModeRef.current === 'move') {
            const dx = g.dx;
            const dy = g.dy;

            const dist = Math.hypot(dx, dy);
            if (dist > 18) {
              const mag = clamp(dist / 210, 0.45, 1.65);
              applyImpulse(dx, -dy, mag);
            }

            if (dy < -28 && Math.abs(dy) > Math.abs(dx) * 1.12) {
              cubeVelRef.current.x += Math.sin((cameraYawRef.current * Math.PI) / 180) * 3.8;
              cubeVelRef.current.z += Math.cos((cameraYawRef.current * Math.PI) / 180) * 3.8;
              cubeAngVelRef.current.x += 2.4;
              playSploosh(1.08);
              showToast('Up-swipe burst', 0.62);
            }
          }

          gestureModeRef.current = null;
          gestureLastRef.current = { dx: 0, dy: 0 };
        },
        onPanResponderTerminate: () => {
          gestureModeRef.current = null;
          gestureLastRef.current = { dx: 0, dy: 0 };
        },
      }),
    []
  );

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
        applyImpulse(-1, 0, 0.86);
        return;
      }

      if (key === 'd' || key === 'arrowright') {
        applyImpulse(1, 0, 0.86);
        return;
      }

      if (key === 'w') {
        cameraPitchRef.current = clamp(cameraPitchRef.current - 4, 8, 56);
        forceRender((n) => (n + 1) % 1000000);
        return;
      }

      if (key === 's' || key === 'arrowdown') {
        cameraPitchRef.current = clamp(cameraPitchRef.current + 4, 8, 56);
        forceRender((n) => (n + 1) % 1000000);
        return;
      }

      if (key === ' ') {
        applyImpulse(0, 1, 1.2);
      }

      if (key === 'arrowup') {
        applyImpulse(0, 1, 0.95);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    let raf = 0;

    const tick = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.033, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      const pos = cubePosRef.current;
      const vel = cubeVelRef.current;
      const rot = cubeRotRef.current;
      const ang = cubeAngVelRef.current;

      pos.x += vel.x * dt;
      pos.z += vel.z * dt;

      const speed = Math.hypot(vel.x, vel.z);

      vel.x *= Math.exp(-dt * 2.85);
      vel.z *= Math.exp(-dt * 2.85);

      if (pos.x > ARENA_HALF) {
        pos.x = ARENA_HALF;
        vel.x *= -0.38;
        ang.z += 2.4;
        playSploosh(0.68);
      }
      if (pos.x < -ARENA_HALF) {
        pos.x = -ARENA_HALF;
        vel.x *= -0.38;
        ang.z -= 2.4;
        playSploosh(0.68);
      }
      if (pos.z > ARENA_HALF) {
        pos.z = ARENA_HALF;
        vel.z *= -0.38;
        ang.x += 2.4;
        playSploosh(0.68);
      }
      if (pos.z < -ARENA_HALF) {
        pos.z = -ARENA_HALF;
        vel.z *= -0.38;
        ang.x -= 2.4;
        playSploosh(0.68);
      }

      ang.x += vel.z * dt * 3.4;
      ang.z += -vel.x * dt * 3.4;
      ang.y += (vel.x * 0.22 - vel.z * 0.17) * dt;

      ang.x *= Math.exp(-dt * 2.05);
      ang.y *= Math.exp(-dt * 2.45);
      ang.z *= Math.exp(-dt * 2.05);

      rot.x += ang.x * dt * 60;
      rot.y += ang.y * dt * 60;
      rot.z += ang.z * dt * 60;

      squishRef.current = lerp(squishRef.current, 1, Math.min(1, dt * 6.4));
      sparkleRef.current = Math.max(0, sparkleRef.current - dt * 1.1);

      cameraYawKickRef.current *= Math.exp(-dt * 3.1);

      // Ambient cream specks while moving
      if (speed > 0.32 && Math.random() < 0.33) {
        trailRef.current.push({
          id: nextTrailIdRef.current++,
          x: SCREEN_WIDTH / 2 + (Math.random() - 0.5) * 50,
          y: 520 + (Math.random() - 0.5) * 14,
          vx: (Math.random() - 0.5) * 1.6,
          vy: -1 - Math.random() * 1.1,
          life: 0.26 + Math.random() * 0.3,
          size: 2 + Math.random() * 3,
          color: TRAIL_COLORS[Math.floor(Math.random() * TRAIL_COLORS.length)],
        });
      }

      const nextTrail: Particle[] = [];
      for (const p of trailRef.current) {
        p.x += p.vx * 88 * dt;
        p.y += p.vy * 88 * dt;
        p.vy += 3.4 * dt;
        p.vx *= 0.986;
        p.life -= dt;
        if (p.life > 0) nextTrail.push(p);
      }
      trailRef.current = nextTrail;

      if (toastRef.current.life > 0) {
        toastRef.current.life = Math.max(0, toastRef.current.life - dt);
      }

      forceRender((n) => (n + 1) % 1000000);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pos = cubePosRef.current;
  const vel = cubeVelRef.current;
  const rot = cubeRotRef.current;

  const speed = Math.hypot(vel.x, vel.z);

  const cameraYaw = cameraYawRef.current + cameraYawKickRef.current + Math.sin(lastTsRef.current * 0.0012) * 1.7;
  const cameraPitch = cameraPitchRef.current;

  const yawRad = (cameraYaw * Math.PI) / 180;
  const pitchRad = (cameraPitch * Math.PI) / 180;

  const camDistance = 6.55;
  const camX = pos.x - Math.sin(yawRad) * camDistance;
  const camZ = pos.z - Math.cos(yawRad) * camDistance;
  const camY = 2.15 + cameraPitch * 0.018;

  const project = (wx: number, wy: number, wz: number) => {
    const rx = wx - camX;
    const ry = wy - camY;
    const rz = wz - camZ;

    const x1 = rx * Math.cos(yawRad) - rz * Math.sin(yawRad);
    const z1 = rx * Math.sin(yawRad) + rz * Math.cos(yawRad);

    const y2 = ry * Math.cos(pitchRad) - z1 * Math.sin(pitchRad);
    const z2 = ry * Math.sin(pitchRad) + z1 * Math.cos(pitchRad);

    if (z2 <= 0.22) return null;

    const depth = 1 / (0.86 + z2 * 0.11);
    const x = SCREEN_WIDTH / 2 + x1 * 164 * depth;
    const y = SCREEN_HEIGHT * 0.52 - y2 * 42 * depth;

    return { x, y, depth, z2 };
  };

  const floorRenders = floorPoints
    .map((pt) => {
      const p = project(pt.x, 0, pt.z);
      if (!p || p.z2 > 120) return null;
      return { ...pt, p };
    })
    .filter((v): v is { x: number; z: number; parity: number; p: NonNullable<ReturnType<typeof project>> } => !!v)
    .sort((a, b) => b.p.z2 - a.p.z2);

  const cubeProjection = project(pos.x, CUBE_HALF, pos.z);
  const shadowProjection = project(pos.x, 0.01, pos.z);

  const cubeSize = cubeProjection ? clamp(132 * cubeProjection.depth * 1.56, 78, 170) : 120;

  const polishPulse = 0.52 + 0.48 * Math.sin(lastTsRef.current * 0.0024 + sparkleRef.current * 2.1);
  const rimGlow = clamp(0.18 + speed * 0.22 + sparkleRef.current * 0.2, 0.18, 0.82);

  const toastOpacity = Math.min(1, toastRef.current.life * 1.45);

  return (
    <View style={styles.gameWrap}>
      <View style={styles.hudTop}>
        <Pressable onPress={onBack} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>Menu</Text>
        </Pressable>

        <View style={styles.hudRight}>
          <HudChip label="Speed" value={speed.toFixed(2)} />
          <HudChip label="Cam" value={`${Math.round(cameraYaw)}°`} />
        </View>
      </View>

      <View style={styles.objectiveRow}>
        <Text style={styles.objective}>Satisfying cream-cheese cube movement and rotation.</Text>
      </View>

      <View style={styles.world} {...panResponder.panHandlers}>
        <View style={styles.skyGlowA} />
        <View style={styles.skyGlowB} />
        <View style={styles.vignetteTop} />

        {floorRenders.map((tile, idx) => {
          const size = clamp(18 * tile.p.depth, 2.2, 24);
          return (
            <View
              key={`f-${idx}`}
              style={[
                styles.floorDot,
                {
                  left: tile.p.x - size / 2,
                  top: tile.p.y - size / 2,
                  width: size,
                  height: size,
                  borderRadius: size * 0.28,
                  backgroundColor: tile.parity ? 'rgba(193,210,234,0.25)' : 'rgba(157,181,217,0.19)',
                  borderColor: tile.parity ? 'rgba(222,236,255,0.2)' : 'rgba(174,199,236,0.16)',
                  opacity: 0.24 + tile.p.depth * 0.6,
                },
              ]}
            />
          );
        })}

        {shadowProjection && (
          <View
            style={[
              styles.playerShadow,
              {
                left: shadowProjection.x - cubeSize * 0.35,
                top: shadowProjection.y + cubeSize * 0.34,
                width: cubeSize * 0.7,
                height: cubeSize * 0.22,
                borderRadius: cubeSize,
                opacity: 0.2 + polishPulse * 0.14,
              },
            ]}
          />
        )}

        {cubeProjection && (
          <View
            style={[
              styles.playerBody,
              {
                left: cubeProjection.x - cubeSize / 2,
                top: cubeProjection.y - cubeSize * 0.92,
                width: cubeSize,
                height: cubeSize,
                borderRadius: 16 * (cubeSize / 96),
                borderColor: `rgba(255, 238, 194, ${0.52 + rimGlow * 0.4})`,
                shadowOpacity: clamp(0.2 + rimGlow * 0.6, 0.2, 0.75),
                transform: [
                  { perspective: 920 },
                  { rotateY: `${rot.y}deg` },
                  { rotateX: `${rot.x}deg` },
                  { rotateZ: `${rot.z}deg` },
                  { scaleX: 1 / squishRef.current },
                  { scaleY: squishRef.current },
                ],
              },
            ]}
          >
            <View style={[styles.playerTopGloss, { opacity: 0.62 + polishPulse * 0.25 }]} />
            <View style={styles.playerSpecular} />
            <View style={styles.playerFaceDark} />
            <View style={styles.playerMarbleA} />
            <View style={styles.playerMarbleB} />
            <View style={[styles.playerRim, { opacity: 0.28 + rimGlow * 0.42 }]} />
          </View>
        )}

        {trailRef.current.map((particle) => (
          <View
            key={`trail-${particle.id}`}
            style={[
              styles.trail,
              {
                left: particle.x - particle.size / 2,
                top: particle.y - particle.size / 2,
                width: particle.size,
                height: particle.size,
                backgroundColor: particle.color,
                opacity: Math.max(0, particle.life * 1.6),
              },
            ]}
          />
        ))}

        <View style={styles.tutorialWrap}>
          <Text style={styles.tutorialText}>Phone: left-zone swipe to shove · right-zone swipe to orbit camera</Text>
          <Text style={styles.tutorialText}>Desktop: A/D shove · W/S camera pitch · Space forward burst</Text>
        </View>

        {toastRef.current.life > 0 && (
          <View style={[styles.toast, { opacity: toastOpacity, transform: [{ translateY: (1 - toastOpacity) * 12 }] }]}>
            <Text style={styles.toastText}>{toastRef.current.text}</Text>
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

  floorDot: {
    position: 'absolute',
    borderWidth: 1,
  },

  playerShadow: {
    position: 'absolute',
    backgroundColor: '#03070f',
  },
  playerBody: {
    position: 'absolute',
    backgroundColor: '#f5efe0',
    borderWidth: 2,
    overflow: 'hidden',
    shadowColor: '#ffe8b0',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 22,
  },
  playerTopGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '42%',
    backgroundColor: '#fff9ee',
  },
  playerSpecular: {
    position: 'absolute',
    left: '12%',
    top: '11%',
    width: '34%',
    height: '15%',
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  playerFaceDark: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '18%',
    backgroundColor: '#e5d5bc',
  },
  playerMarbleA: {
    position: 'absolute',
    left: '16%',
    top: '36%',
    width: '22%',
    height: '9%',
    borderRadius: 10,
    backgroundColor: 'rgba(228,201,157,0.55)',
  },
  playerMarbleB: {
    position: 'absolute',
    left: '37%',
    top: '56%',
    width: '18%',
    height: '8%',
    borderRadius: 10,
    backgroundColor: 'rgba(228,201,157,0.42)',
  },
  playerRim: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: '#fff2cf',
  },

  trail: {
    position: 'absolute',
    borderRadius: 999,
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
    top: 72,
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
});
