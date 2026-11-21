import type { AnimationPreset } from '../types';

export const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: '4k-horizontal-kinetic',
    title: '4K Horizontal · Kinetic Grid',
    titleBn: '4K হরিজন্টাল · কাইনেটিক গ্রিড',
    subtitle: '3840 × 2160 · 16:9 · 4.0s',
    subtitleBn: '3840 × 2160 · 16:9 · 4.0 সেকেন্ড',
    category: '4k-horizontal',
    width: 3840,
    height: 2160,
    durationSeconds: 4,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 3840px;
    height: 2160px;
    overflow: hidden;
    background: #07090e;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    color: #f8fafc;
  }
  .stage {
    position: relative;
    width: 3840px;
    height: 2160px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at 22% 28%, #162447 0%, #07090e 58%);
  }
  .grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, rgba(148,163,184,0.08) 2px, transparent 2px),
      linear-gradient(to bottom, rgba(148,163,184,0.08) 2px, transparent 2px);
    background-size: 240px 240px;
    animation: gridDrift 4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .beam {
    position: absolute;
    width: 1400px;
    height: 1400px;
    border-radius: 999px;
    background: radial-gradient(circle, rgba(59,130,246,0.28) 0%, transparent 68%);
    filter: blur(80px);
    animation: beamOrbit 4s ease-in-out forwards;
  }
  .card {
    position: relative;
    z-index: 2;
    width: 2400px;
    padding: 160px 180px;
    border: 3px solid rgba(255,255,255,0.12);
    background: rgba(12, 16, 26, 0.78);
    backdrop-filter: blur(24px);
    border-radius: 48px;
    animation: cardRise 1.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .kicker {
    font-size: 46px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: #60a5fa;
    margin-bottom: 48px;
    opacity: 0;
    animation: fadeUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.4s forwards;
  }
  .headline {
    font-size: 196px;
    font-weight: 700;
    line-height: 1.02;
    letter-spacing: -0.03em;
    opacity: 0;
    animation: fadeUp 1.1s cubic-bezier(0.16, 1, 0.3, 1) 0.7s forwards;
  }
  .bar-track {
    margin-top: 110px;
    width: 100%;
    height: 18px;
    border-radius: 99px;
    background: rgba(255,255,255,0.1);
    overflow: hidden;
  }
  .bar-fill {
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #38bdf8);
    transform-origin: left;
    transform: scaleX(0);
    animation: progressSweep 3.4s cubic-bezier(0.22, 1, 0.36, 1) 0.6s forwards;
  }
  @keyframes gridDrift {
    from { transform: scale(1.12) translateY(60px); opacity: 0.25; }
    to { transform: scale(1) translateY(0); opacity: 1; }
  }
  @keyframes beamOrbit {
    0% { transform: translate(-700px, -250px) scale(0.85); }
    50% { transform: translate(550px, 180px) scale(1.15); }
    100% { transform: translate(200px, -120px) scale(1); }
  }
  @keyframes cardRise {
    from { transform: translateY(90px) scale(0.96); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }
  @keyframes fadeUp {
    from { transform: translateY(50px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes progressSweep {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="grid"></div>
    <div class="beam"></div>
    <div class="card">
      <div class="kicker">Ultra High Definition · 3840 × 2160</div>
      <h1 class="headline">Precision Motion<br/>Mastered in HTML.</h1>
      <div class="bar-track"><div class="bar-fill"></div></div>
    </div>
  </div>
</body>
</html>`,
  },
  {
    id: '4k-vertical-reel',
    title: '4K Vertical · Portrait Reel',
    titleBn: '4K ভার্টিক্যাল · পোর্ট্রেট রিল',
    subtitle: '2160 × 3840 · 9:16 · 4.0s',
    subtitleBn: '2160 × 3840 · 9:16 · 4.0 সেকেন্ড',
    category: '4k-vertical',
    width: 2160,
    height: 3840,
    durationSeconds: 4,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 2160px;
    height: 3840px;
    overflow: hidden;
    background: #090b10;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    color: #f8fafc;
  }
  .canvas {
    position: relative;
    width: 2160px;
    height: 3840px;
    padding: 220px 180px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: linear-gradient(165deg, #0f172a 0%, #06070a 55%, #111827 100%);
  }
  .ring {
    position: absolute;
    left: 50%;
    top: 46%;
    width: 1480px;
    height: 1480px;
    margin-left: -740px;
    margin-top: -740px;
    border-radius: 999px;
    border: 4px solid rgba(59, 130, 246, 0.35);
    animation: ringExpand 4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .ring-inner {
    position: absolute;
    left: 50%;
    top: 46%;
    width: 960px;
    height: 960px;
    margin-left: -480px;
    margin-top: -480px;
    border-radius: 999px;
    background: radial-gradient(circle, rgba(37, 99, 235, 0.45), transparent 70%);
    animation: pulseCore 2s ease-in-out 2 alternate forwards;
  }
  .top-tag {
    position: relative;
    font-size: 48px;
    letter-spacing: 0.2em;
    color: #93c5fd;
    text-transform: uppercase;
    opacity: 0;
    animation: slideDown 1s ease-out 0.2s forwards;
  }
  .center-title {
    position: relative;
    font-size: 210px;
    font-weight: 700;
    line-height: 1.04;
    letter-spacing: -0.03em;
    opacity: 0;
    animation: revealText 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.7s forwards;
  }
  .bottom-meter {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 80px;
    border-top: 3px solid rgba(255,255,255,0.14);
    font-size: 52px;
    color: #cbd5e1;
    opacity: 0;
    animation: revealText 1s ease-out 1.4s forwards;
  }
  @keyframes ringExpand {
    from { transform: scale(0.45) rotate(-35deg); opacity: 0; }
    to { transform: scale(1) rotate(0deg); opacity: 1; }
  }
  @keyframes pulseCore {
    from { transform: scale(0.85); opacity: 0.6; }
    to { transform: scale(1.15); opacity: 1; }
  }
  @keyframes slideDown {
    from { transform: translateY(-60px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes revealText {
    from { transform: translateY(80px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
</head>
<body>
  <div class="canvas">
    <div class="ring"></div>
    <div class="ring-inner"></div>
    <div class="top-tag">Vertical Cinema · 2160 × 3840</div>
    <h1 class="center-title">Built for<br/>9:16<br/>4K Reels.</h1>
    <div class="bottom-meter">
      <span>FrameForge Master</span>
      <span>60–120 Mbps</span>
    </div>
  </div>
</body>
</html>`,
  },
  {
    id: 'ultrawide-cinema',
    title: 'Ultrawide 21:9 · Horizon',
    titleBn: 'আল্ট্রাওয়াইড 21:9 · সিনেমা হরাইজন',
    subtitle: '3440 × 1440 · 21:9 · 5.0s',
    subtitleBn: '3440 × 1440 · 21:9 · 5.0 সেকেন্ড',
    category: 'ultrawide',
    width: 3440,
    height: 1440,
    durationSeconds: 5,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 3440px;
    height: 1440px;
    overflow: hidden;
    background: #06080c;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    color: #f8fafc;
  }
  .scene {
    position: relative;
    width: 3440px;
    height: 1440px;
    display: flex;
    align-items: center;
    padding: 0 260px;
    background: linear-gradient(120deg, #06080c 0%, #0f172a 50%, #06080c 100%);
  }
  .horizon-line {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 4px;
    background: linear-gradient(90deg, transparent, #3b82f6, #60a5fa, transparent);
    transform: scaleX(0);
    animation: drawLine 2.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .content {
    position: relative;
    z-index: 2;
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .title {
    font-size: 184px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.02;
    opacity: 0;
    animation: slideLeft 1.4s cubic-bezier(0.16, 1, 0.3, 1) 0.8s forwards;
  }
  .spec {
    text-align: right;
    font-size: 48px;
    color: #94a3b8;
    line-height: 1.5;
    opacity: 0;
    animation: slideRight 1.4s cubic-bezier(0.16, 1, 0.3, 1) 1.4s forwards;
  }
  .spec strong {
    display: block;
    color: #f8fafc;
    font-size: 72px;
  }
  @keyframes drawLine {
    from { transform: scaleX(0); opacity: 0; }
    to { transform: scaleX(1); opacity: 0.7; }
  }
  @keyframes slideLeft {
    from { transform: translateX(-140px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideRight {
    from { transform: translateX(140px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
</style>
</head>
<body>
  <div class="scene">
    <div class="horizon-line"></div>
    <div class="content">
      <h1 class="title">Ultrawide<br/>21:9 Cinema</h1>
      <div class="spec">
        <strong>3440 × 1440</strong>
        Native Aspect Ratio · 5.0s Sequence
      </div>
    </div>
  </div>
</body>
</html>`,
  },
  {
    id: 'super-ultrawide-ribbon',
    title: 'Super Ultrawide 32:9 · Ribbon',
    titleBn: 'সুপার আল্ট্রাওয়াইড 32:9 · প্যানোরামিক রিবন',
    subtitle: '5120 × 1440 · 32:9 · 6.0s',
    subtitleBn: '5120 × 1440 · 32:9 · 6.0 সেকেন্ড',
    category: 'super-ultrawide',
    width: 5120,
    height: 1440,
    durationSeconds: 6,
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 5120px;
    height: 1440px;
    overflow: hidden;
    background: #07090d;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    color: #f8fafc;
  }
  .stage {
    position: relative;
    width: 5120px;
    height: 1440px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 320px;
    background: radial-gradient(ellipse at 50% 50%, #172554 0%, #07090d 72%);
  }
  .sweep-track {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .sweep-pill {
    position: absolute;
    top: 50%;
    left: -1200px;
    width: 1200px;
    height: 16px;
    margin-top: -8px;
    background: linear-gradient(90deg, transparent, #60a5fa, #ffffff, transparent);
    animation: panSweep 6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  .panel {
    position: relative;
    z-index: 2;
    padding: 96px 128px;
    border: 3px solid rgba(255,255,255,0.14);
    border-radius: 36px;
    background: rgba(10, 14, 24, 0.72);
    opacity: 0;
    animation: panelIn 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .panel.two { animation-delay: 0.7s; }
  .panel.three { animation-delay: 1.4s; }
  .label {
    font-size: 40px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #60a5fa;
    margin-bottom: 24px;
  }
  .value {
    font-size: 136px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  @keyframes panSweep {
    from { transform: translateX(0); }
    to { transform: translateX(7600px); }
  }
  @keyframes panelIn {
    from { transform: translateY(70px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="sweep-track"><div class="sweep-pill"></div></div>
    <div class="panel one">
      <div class="label">Format</div>
      <div class="value">32:9 Dual-QHD</div>
    </div>
    <div class="panel two">
      <div class="label">Resolution</div>
      <div class="value">5120 × 1440</div>
    </div>
    <div class="panel three">
      <div class="label">Timeline</div>
      <div class="value">6.00 Seconds</div>
    </div>
  </div>
</body>
</html>`,
  },
];
