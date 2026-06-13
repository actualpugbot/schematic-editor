import { useEffect, useRef } from 'react';
import { getCachedBlockThumbnail, createBlockThumbnail } from '../lib/blockThumbnails';
import type { BlockThumbnailLayer } from '../lib/blockThumbnails';
import { alwaysMaterialSpriteStateKey } from '../lib/materialSpriteOverrides';
import { materialSpriteUrlForStateKey } from '../lib/materialSprites';

export interface CelebrationMaterial {
  stateKey: string;
  color: number;
  thumbnailLayers?: BlockThumbnailLayer[];
}

interface Props {
  materials: CelebrationMaterial[];
  onDone: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotSpeed: number;
  size: number;
  alpha: number;
  decay: number;
  img: HTMLImageElement;
  grav: number;
}

interface Shell {
  x: number;
  y: number;
  vy: number;
  trail: Array<{ x: number; y: number }>;
  exploded: boolean;
  img: HTMLImageElement;
}

const ANIMATION_SPEED = 0.9;
const TIMING_SCALE = 1.1;
const TOTAL_DURATION = 9020;
const FADE_START = 7590;

export function ShoppingCelebration({ materials, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      window.removeEventListener('resize', resize);
      return;
    }
    window.addEventListener('resize', resize);

    // Collect images — prefer cached, kick off loads for any missing
    const seenUrls = new Set<string>();
    const imgElements: HTMLImageElement[] = [];
    const readyImages: HTMLImageElement[] = [];
    let hasSeededImages = false;
    let seedLoadedImages: (() => void) | null = null;

    const addUrl = (url: string) => {
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      const img = new Image();
      img.onload = () => {
        readyImages.push(img);
        if (!hasSeededImages) {
          hasSeededImages = true;
          seedLoadedImages?.();
        }
      };
      img.src = url;
      if (img.complete && img.naturalWidth > 0) {
        readyImages.push(img);
      }
      imgElements.push(img);
    };

    const spriteUrl = (m: CelebrationMaterial): string | null => {
      const spriteStateKey = alwaysMaterialSpriteStateKey(m.stateKey);
      return spriteStateKey ? materialSpriteUrlForStateKey(spriteStateKey) : null;
    };

    for (const m of materials) {
      const url = spriteUrl(m) ?? getCachedBlockThumbnail(m.stateKey, m.color, m.thumbnailLayers);
      if (url) addUrl(url);
    }

    // Kick off async loads for any not yet cached (they'll slot in as they resolve)
    if (imgElements.length < materials.length) {
      void Promise.allSettled(
        materials
          .filter((m) => !spriteUrl(m) && !getCachedBlockThumbnail(m.stateKey, m.color, m.thumbnailLayers))
          .slice(0, 30)
          .map((m) => createBlockThumbnail(m.stateKey, m.color, m.thumbnailLayers).then((url) => {
            if (url) addUrl(url);
          })),
      );
    }

    const pickImg = (): HTMLImageElement | null => {
      if (readyImages.length === 0) return null;
      return readyImages[Math.floor(Math.random() * readyImages.length)];
    };

    const particles: Particle[] = [];
    const shells: Shell[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    const spawnConfetti = (count: number) => {
      for (let i = 0; i < count; i++) {
        const img = pickImg();
        if (!img) continue;
        particles.push({
          x: Math.random() * canvas.width,
          y: -20 - Math.random() * canvas.height * 0.35,
          vx: (Math.random() - 0.5) * 2.5 * ANIMATION_SPEED,
          vy: (1.5 + Math.random() * 3) * ANIMATION_SPEED,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.13 * ANIMATION_SPEED,
          size: 13 + Math.random() * 13,
          alpha: 0.85 + Math.random() * 0.15,
          decay: (0.0008 + Math.random() * 0.0012) / TIMING_SCALE,
          img,
          grav: (0.022 + Math.random() * 0.022) * ANIMATION_SPEED,
        });
      }
    };

    const launchShell = () => {
      const img = pickImg();
      if (!img) return;
      shells.push({
        x: canvas.width * (0.12 + Math.random() * 0.76),
        y: canvas.height + 10,
        vy: -(canvas.height * 0.013 + Math.random() * canvas.height * 0.006) * ANIMATION_SPEED,
        trail: [],
        exploded: false,
        img,
      });
    };

    const explodeShell = (shell: Shell) => {
      const count = 28 + Math.floor(Math.random() * 22);
      for (let i = 0; i < count; i++) {
        const img = pickImg() ?? shell.img;
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const speed = (2 + Math.random() * 6) * ANIMATION_SPEED;
        particles.push({
          x: shell.x,
          y: shell.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.5,
          rotation: Math.random() * Math.PI * 2,
          rotSpeed: (Math.random() - 0.5) * 0.22 * ANIMATION_SPEED,
          size: 11 + Math.random() * 13,
          alpha: 1,
          decay: (0.0055 + Math.random() * 0.0065) / TIMING_SCALE,
          img,
          grav: (0.065 + Math.random() * 0.045) * ANIMATION_SPEED,
        });
      }
    };

    seedLoadedImages = () => spawnConfetti(90);
    if (readyImages.length > 0) {
      hasSeededImages = true;
      seedLoadedImages();
    }

    const shellSchedule = [120, 450, 850, 1300, 1800, 2350, 2950, 3500].map((time) => time * TIMING_SCALE);
    for (const t of shellSchedule) timers.push(setTimeout(launchShell, t));

    timers.push(setTimeout(() => spawnConfetti(45), 600 * TIMING_SCALE));
    timers.push(setTimeout(() => spawnConfetti(45), 1600 * TIMING_SCALE));
    timers.push(setTimeout(() => spawnConfetti(35), 2700 * TIMING_SCALE));

    const startTime = performance.now();
    let raf: number;
    let finished = false;

    const frame = (now: number) => {
      if (finished) return;
      const elapsed = now - startTime;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const globalFade = elapsed > FADE_START
        ? Math.max(0, 1 - (elapsed - FADE_START) / (TOTAL_DURATION - FADE_START))
        : 1;

      // Shells
      for (let i = shells.length - 1; i >= 0; i--) {
        const s = shells[i];
        if (s.exploded) { shells.splice(i, 1); continue; }

        s.trail.push({ x: s.x, y: s.y });
        if (s.trail.length > 14) s.trail.shift();

        s.y += s.vy;
        s.vy += 0.18 * ANIMATION_SPEED;

        if (s.vy >= 0) {
          s.exploded = true;
          explodeShell(s);
          shells.splice(i, 1);
          continue;
        }

        for (let j = 0; j < s.trail.length; j++) {
          const pt = s.trail[j];
          const a = (j / s.trail.length) * 0.75 * globalFade;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.fillStyle = '#fffde0';
          ctx.shadowBlur = 7;
          ctx.shadowColor = '#ffe87a';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.grav;
        p.vx *= 0.986;
        p.rotation += p.rotSpeed;
        p.alpha -= p.decay;

        if (p.alpha <= 0 || p.y > canvas.height + 50) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.min(p.alpha * globalFade, 1);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.drawImage(p.img, -p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }

      if (elapsed >= TOTAL_DURATION && particles.length === 0) {
        finished = true;
        onDoneRef.current();
        return;
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    const autoEnd = setTimeout(() => {
      finished = true;
      onDoneRef.current();
    }, TOTAL_DURATION + 1200);

    return () => {
      finished = true;
      cancelAnimationFrame(raf);
      clearTimeout(autoEnd);
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', resize);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  return (
    <canvas
      ref={canvasRef}
      onClick={() => onDoneRef.current()}
      title="Click to dismiss"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 1000,
        cursor: 'pointer',
      }}
    />
  );
}
