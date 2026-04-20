'use strict';

// Global simulation state
const state = {
  laserActive: false,
  laserType: 'three',
  pumpPower: 0,
  angle: 15,
  n1: 1.62,
  n2: 1.46,
  bend: 0,
  time: 0,
  electrons: [],
  photons: []
};

// Grab all the DOM elements we need
const simCanvas    = document.getElementById('sim-canvas');
const ctx          = simCanvas.getContext('2d');
const energyCanvas = document.getElementById('energy-canvas');
const ectx         = energyCanvas.getContext('2d');
const modal        = document.getElementById('laser-modal');
const laserTrigger = document.getElementById('laser-trigger');
const closeModal   = document.getElementById('close-modal');
const activateBtn  = document.getElementById('activate-laser');
const inversionMsg = document.getElementById('inversion-msg');
const statusText   = document.getElementById('status-text');
const tirBadge     = document.getElementById('tir-badge');
const leakBadge    = document.getElementById('leak-badge');
const outputBar    = document.getElementById('output-bar');

// Inputs
const popupPump  = document.getElementById('popup-pump');
const pumpVal    = document.getElementById('pump-val');
const ctrlPump   = document.getElementById('ctrl-pump');
const ctrlPumpV  = document.getElementById('ctrl-pump-val');
const ctrlAngle  = document.getElementById('ctrl-angle');
const ctrlAngleV = document.getElementById('ctrl-angle-val');
const ctrlN1     = document.getElementById('ctrl-n1');
const ctrlN1V    = document.getElementById('ctrl-n1-val');
const ctrlN2     = document.getElementById('ctrl-n2');
const ctrlN2V    = document.getElementById('ctrl-n2-val');
const ctrlBend   = document.getElementById('ctrl-bend');
const ctrlBendV  = document.getElementById('ctrl-bend-val');

// Display readouts
const dispNA    = document.getElementById('disp-na');
const dispAcc   = document.getElementById('disp-acc');
const dispCrit  = document.getElementById('disp-crit');
const dispAtten = document.getElementById('disp-atten');
const dispOut   = document.getElementById('disp-out');

// Keep the canvas sized to its container
function resizeSim() {
  const rect = simCanvas.parentElement.getBoundingClientRect();
  simCanvas.width  = rect.width;
  simCanvas.height = rect.height;
}
window.addEventListener('resize', resizeSim);
resizeSim();

// Work out all the physics values from current state
function computePhysics() {
  const { n1, n2, angle, bend } = state;

  // n1 has to be bigger than n2 for the fiber to actually guide light
  const guided    = n1 > n2;
  const NAval     = guided ? Math.sqrt(Math.max(0, n1*n1 - n2*n2)) : 0;
  const accAngle  = guided ? Math.asin(Math.min(NAval, 1)) * 180 / Math.PI : 0;
  const critAngle = guided ? Math.asin(Math.min(n2/n1, 1)) * 180 / Math.PI : 90;

  // Check whether the incoming angle is inside the acceptance cone
  const inNA = state.laserActive && (angle <= accAngle) && guided;

  // Simple bend-loss model — 0 to 15 dB/km depending on bend amount
  const bendAtten  = (bend / 100) * 15;
  const baseAtten  = 0.2;
  const totalAtten = baseAtten + bendAtten;

  // Exponential decay over 1 km of fiber; drops to 5% if outside NA
  const rawIntensity = state.laserActive
    ? Math.exp(-totalAtten / 10) * (inNA ? 1 : 0.05)
    : 0;
  const outIntensity = Math.min(100, rawIntensity * 100);

  return { NAval, accAngle, critAngle, inNA, totalAtten, outIntensity, guided };
}

// Returns the bezier control points for the fiber path
function getFiberPath(W, H) {
  const bendFactor = state.bend / 100;
  const startX = W * 0.28;
  const endX   = W * 0.96;
  const midY   = H * 0.5;
  const cp1x   = W * 0.5;
  const cp1y   = midY - bendFactor * H * 0.32;
  const cp2x   = W * 0.72;
  const cp2y   = midY + bendFactor * H * 0.32;
  return { startX, endX, midY, cp1x, cp1y, cp2x, cp2y };
}

// Standard cubic bezier interpolation
function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

// Sample the fiber path into an array of {x, y, t} points
function getFiberPoints(W, H, count = 120) {
  const fp  = getFiberPath(W, H);
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = bezierPoint(t, fp.startX, fp.cp1x, fp.cp2x, fp.endX);
    const y = bezierPoint(t, fp.midY,   fp.cp1y, fp.cp2y, fp.midY);
    pts.push({ x, y, t });
  }
  return pts;
}

function drawSim() {
  const W    = simCanvas.width;
  const H    = simCanvas.height;
  const phys = computePhysics();

  ctx.clearRect(0, 0, W, H);

  // Background grid
  ctx.strokeStyle = 'rgba(74,98,122,0.18)';
  ctx.lineWidth   = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const fp = getFiberPath(W, H);

  // Core and cladding radii scale with NA so you can see the difference
  const NA      = Math.sqrt(Math.max(0, state.n1*state.n1 - state.n2*state.n2));
  const normNA  = Math.min(NA / 0.7, 1);
  const coreR   = 18 + normNA * 22;   // grows from 18 to 40 px
  const claddR  = coreR + 14;

  // Draw cladding
  ctx.save();
  ctx.lineWidth   = claddR * 2;
  ctx.strokeStyle = phys.guided ? 'rgba(52,73,94,0.85)' : 'rgba(30,30,60,0.95)';
  ctx.shadowBlur  = 0;
  ctx.beginPath();
  ctx.moveTo(fp.startX, fp.midY);
  ctx.bezierCurveTo(fp.cp1x, fp.cp1y, fp.cp2x, fp.cp2y, fp.endX, fp.midY);
  ctx.stroke();

  // Punch out a slightly larger border so it looks clean against the background
  ctx.lineWidth                = claddR * 2 + 2;
  ctx.strokeStyle              = 'rgba(26,26,26,0.6)';
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(fp.startX, fp.midY);
  ctx.bezierCurveTo(fp.cp1x, fp.cp1y, fp.cp2x, fp.cp2y, fp.endX, fp.midY);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // Cladding fill
  ctx.save();
  ctx.lineWidth   = claddR * 2;
  ctx.strokeStyle = phys.guided ? 'rgba(63,85,109,0.9)' : 'rgba(40,40,80,0.95)';
  ctx.beginPath();
  ctx.moveTo(fp.startX, fp.midY);
  ctx.bezierCurveTo(fp.cp1x, fp.cp1y, fp.cp2x, fp.cp2y, fp.endX, fp.midY);
  ctx.stroke();
  ctx.restore();

  // Core
  ctx.save();
  ctx.lineWidth   = coreR * 2;
  ctx.strokeStyle = `rgba(22,160,133,${phys.guided ? 0.95 : 0.6})`;
  if (state.laserActive && phys.inNA) {
    ctx.shadowBlur  = 18;
    ctx.shadowColor = '#16a085';
  }
  ctx.beginPath();
  ctx.moveTo(fp.startX, fp.midY);
  ctx.bezierCurveTo(fp.cp1x, fp.cp1y, fp.cp2x, fp.cp2y, fp.endX, fp.midY);
  ctx.stroke();
  ctx.restore();

  // Thin line marking the input face
  ctx.save();
  ctx.fillStyle = 'rgba(22,160,133,0.7)';
  ctx.fillRect(fp.startX - 1, fp.midY - claddR, 3, claddR * 2);
  ctx.restore();

  // Laser beam coming in from the left
  if (state.laserActive) {
    const laserX   = 130;
    const laserY   = H / 2;
    const angleRad = state.angle * Math.PI / 180;
    const beamLen  = fp.startX - laserX;

    ctx.save();
    ctx.shadowBlur  = 24;
    ctx.shadowColor = '#e74c3c';
    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.moveTo(laserX, laserY);

    const targetY = fp.midY + Math.tan(angleRad) * beamLen * 0.3;

    if (phys.canEnter) {
      // Beam reaches the fiber face
      ctx.lineTo(fp.startX, targetY);
    } else {
      // Stop just short of the fiber to show it can't enter
      const stopX   = fp.startX - 20;
      const stopLen = stopX - laserX;
      const stopY   = laserY + Math.tan(angleRad) * stopLen * 0.3;
      ctx.lineTo(stopX, stopY);
    }

    ctx.stroke();

    // Soft glow pass
    ctx.shadowBlur  = 40;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth   = 10;
    ctx.stroke();
    ctx.restore();
  }

  // Guided rays bouncing along the core (TIR zig-zag)
  if (state.laserActive && phys.inNA) {
    const pts      = getFiberPoints(W, H, 200);
    const rayCount = 3;

    for (let r = 0; r < rayCount; r++) {
      const offset = (r - 1) * 0.35;
      ctx.save();
      ctx.strokeStyle = 'rgba(241,196,15,0.75)';
      ctx.lineWidth   = 1.5;
      ctx.shadowBlur  = 8;
      ctx.shadowColor = '#f1c40f';
      ctx.beginPath();

      const period = 16;
      const phase  = (-state.time * 0.06 + r * 0.4) % 1;

      for (let i = 0; i < pts.length - 1; i++) {
        const p  = pts[i];
        const t  = (i / pts.length - phase + 1) % 1;
        const p2 = pts[Math.min(i + 1, pts.length - 1)];
        const dx = p2.x - p.x;
        const dy = p2.y - p.y;
        const len = Math.sqrt(dx*dx + dy*dy) || 1;

        // Normal vector for the zig-zag displacement
        const nx = -dy / len;
        const ny =  dx / len;

        const zigzag = Math.sin(t * Math.PI * 2 * period + offset) * coreR * 0.7;
        const px = p.x + nx * zigzag;
        const py = p.y + ny * zigzag;

        if (i === 0) ctx.moveTo(px, py);
        else         ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Leaked rays when light escapes the core
  if (state.laserActive && !phys.inNA) {
    const pts       = getFiberPoints(W, H, 60);
    const leakCount = 5;
    ctx.save();

    for (let i = 0; i < leakCount; i++) {
      const idx = Math.floor((i / leakCount) * pts.length * 0.6 + 5);
      if (idx >= pts.length) continue;

      const p  = pts[idx];
      const p2 = pts[Math.min(idx + 1, pts.length - 1)];
      const dx = p2.x - p.x;
      const dy = p2.y - p.y;

      // Spray outward at a slight angle from the tangent
      const tang      = Math.atan2(dy, dx);
      const perpAngle = tang + Math.PI / 2 + (i % 2 === 0 ? 0.4 : -0.4);
      const leakLen   = 35 + i * 8;
      const alpha     = Math.max(0, 0.8 - i * 0.12);

      ctx.strokeStyle = `rgba(52,152,219,${alpha})`;
      ctx.lineWidth   = 1.5;
      ctx.shadowBlur  = 10;
      ctx.shadowColor = '#3498db';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(
        p.x + Math.cos(perpAngle) * leakLen,
        p.y + Math.sin(perpAngle) * leakLen
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // Output glow at the far end
  if (state.laserActive && phys.outIntensity > 5) {
    const alpha = phys.outIntensity / 100;
    const grad  = ctx.createRadialGradient(fp.endX, fp.midY, 0, fp.endX, fp.midY, 50);
    grad.addColorStop(0, `rgba(241,196,15,${alpha * 0.8})`);
    grad.addColorStop(1, 'transparent');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(fp.endX, fp.midY, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // n1 / n2 labels on the fiber
  ctx.save();
  ctx.font      = '10px "Share Tech Mono"';
  ctx.fillStyle = 'rgba(149,165,166,0.7)';
  const midPt   = getFiberPoints(W, H, 10)[5];
  ctx.fillText(`n₁=${state.n1.toFixed(2)}`, midPt.x - 22, midPt.y + 5);
  ctx.fillText(`n₂=${state.n2.toFixed(2)}`, midPt.x - 22, midPt.y + claddR + 14);
  ctx.restore();

  // Acceptance cone shown at the input face
  if (phys.guided) {
    const faceX     = fp.startX;
    const faceY     = fp.midY;
    const coneLen   = 60;
    const halfAngle = phys.accAngle * Math.PI / 180;

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle   = '#16a085';
    ctx.beginPath();
    ctx.moveTo(faceX, faceY);
    ctx.lineTo(faceX - coneLen, faceY - Math.tan(halfAngle) * coneLen);
    ctx.lineTo(faceX - coneLen, faceY + Math.tan(halfAngle) * coneLen);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Dashed border for the cone
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#16a085';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(faceX, faceY);
    ctx.lineTo(faceX - coneLen, faceY - Math.tan(halfAngle) * coneLen);
    ctx.moveTo(faceX, faceY);
    ctx.lineTo(faceX - coneLen, faceY + Math.tan(halfAngle) * coneLen);
    ctx.stroke();
    ctx.restore();
  }

  // Small arc showing the current angle at the fiber face
  if (state.laserActive) {
    const angleRad = state.angle * Math.PI / 180;
    const r        = 35;
    ctx.save();
    ctx.strokeStyle = 'rgba(241,196,15,0.5)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(fp.startX, fp.midY, r, Math.PI - angleRad, Math.PI + angleRad);
    ctx.stroke();
    ctx.fillStyle = 'rgba(241,196,15,0.6)';
    ctx.font      = '9px "Share Tech Mono"';
    ctx.fillText(`${state.angle}°`, fp.startX - r - 28, fp.midY + 3);
    ctx.restore();
  }

  updateHUD(phys);
}

// Update all the readout displays
function updateHUD(phys) {
  dispNA.textContent    = phys.NAval.toFixed(4);
  dispAcc.textContent   = phys.accAngle.toFixed(1) + '°';
  dispCrit.textContent  = phys.critAngle.toFixed(1) + '°';
  dispAtten.textContent = "";
  dispOut.textContent   = phys.outIntensity.toFixed(1) + '%';
  outputBar.style.width = phys.outIntensity + '%';

  if (!state.laserActive) {
    statusText.textContent = '⬤ LASER INACTIVE';
    statusText.style.color = '#95a5a6';
    tirBadge.classList.add('hidden');
    leakBadge.classList.add('hidden');
  } else if (!phys.guided) {
    statusText.textContent = '⚠ n₂ ≥ n₁ — NO GUIDING';
    statusText.style.color = '#e74c3c';
    tirBadge.classList.add('hidden');
    leakBadge.classList.remove('hidden');
  } else if (phys.inNA) {
    statusText.textContent = '✓ TOTAL INTERNAL REFLECTION';
    statusText.style.color = '#16a085';
    tirBadge.classList.remove('hidden');
    leakBadge.classList.add('hidden');
  } else {
    statusText.textContent = '✗ ANGLE > NA — LIGHT LEAKING';
    statusText.style.color = '#e74c3c';
    tirBadge.classList.add('hidden');
    leakBadge.classList.remove('hidden');
  }
}

// Set up the electron dots for the energy diagram
function initElectrons(count = 12) {
  state.electrons = [];
  for (let i = 0; i < count; i++) {
    state.electrons.push({
      x:        40 + Math.random() * 300,
      y:        165,
      vy:       0,
      excited:  false,
      progress: Math.random(),
      id:       i
    });
  }
}
initElectrons();

function drawEnergyDiagram() {
  const W = 380, H = 200;
  ectx.clearRect(0, 0, W, H);

  const isThree   = state.laserType === 'three';
  const pump      = state.pumpPower / 100;
  const threshold = 0.55;
  const inversed  = pump >= threshold;

  // Background
  ectx.fillStyle = '#1a1a1a';
  ectx.fillRect(0, 0, W, H);

  // Energy levels differ between 3-level and 4-level lasers
  const levels = isThree
    ? [
        { y: 165, label: 'Ground (E₀)',     color: '#95a5a6' },
        { y: 90,  label: 'Metastable (E₁)', color: '#f1c40f' },
        { y: 40,  label: 'Pump Band (E₂)',  color: '#e74c3c' }
      ]
    : [
        { y: 170, label: 'Ground (E₀)',       color: '#95a5a6' },
        { y: 120, label: 'Lower Laser (E₁)',  color: '#3498db' },
        { y: 70,  label: 'Upper Laser (E₂)',  color: '#f1c40f' },
        { y: 25,  label: 'Pump Band (E₃)',    color: '#e74c3c' }
      ];

  // Draw each level as a glowing horizontal line
  levels.forEach(lv => {
    ectx.save();
    ectx.strokeStyle = lv.color;
    ectx.lineWidth   = 2;
    ectx.shadowBlur  = 6;
    ectx.shadowColor = lv.color;
    ectx.beginPath();
    ectx.moveTo(20, lv.y);
    ectx.lineTo(W - 100, lv.y);
    ectx.stroke();
    ectx.restore();

    ectx.fillStyle = lv.color;
    ectx.font      = '9px "Share Tech Mono"';
    ectx.fillText(lv.label, W - 95, lv.y + 3);
  });

  const groundY = levels[0].y;
  const topY    = levels[levels.length - 1].y;
  const laserY  = isThree ? levels[1].y : levels[2].y;

  // Animate each electron through the pump/emission cycle
  state.electrons.forEach(el => {
    el.progress += 0.008 * pump;
    if (el.progress > 1) el.progress = 0;

    let ey;
    if (el.progress < 0.3) {
      // Being pumped upward
      const t = el.progress / 0.3;
      ey = groundY - t * (groundY - topY);
    } else if (el.progress < 0.55) {
      // Fast decay from pump band down to metastable level
      const t = (el.progress - 0.3) / 0.25;
      ey = topY + t * (laserY - topY);
    } else if (el.progress < 0.85) {
      // Stimulated emission — drops back to ground
      const t = (el.progress - 0.55) / 0.3;
      ey = laserY + t * (groundY - laserY);
    } else {
      ey = groundY;
    }

    const isUpper = ey < laserY + 10 && ey > topY - 10;
    ectx.save();
    ectx.shadowBlur  = 8;
    ectx.shadowColor = isUpper ? '#f1c40f' : '#e74c3c';
    ectx.fillStyle   = isUpper ? '#f1c40f' : '#e74c3c';
    ectx.beginPath();
    ectx.arc(el.x, ey, 4, 0, Math.PI * 2);
    ectx.fill();
    ectx.restore();

    // Spawn a photon right as the electron starts its downward transition
    const isEmitting = el.progress >= 0.55 && el.progress <= 0.57;
    if (isEmitting && !el.emitted) {
      el.emitted = true;
      state.photons.push({
        x:     el.x,
        y:     ey,
        vx:    3 + Math.random() * 2,
        vy:    (Math.random() - 0.5) * 1.5,
        phase: Math.random() * Math.PI * 2,
        life:  0
      });
    }

    // Reset the emitted flag so it fires again next cycle
    if (el.progress < 0.2) {
      el.emitted = false;
    }
  });

  // Draw each photon as a small traveling wave
  state.photons.forEach((p, i) => {
    p.x += p.vx;
    p.y += p.vy;
    p.life++;

    const length = 30;
    const amp    = 4;

    ectx.save();
    ectx.strokeStyle = 'rgba(231,76,60,0.9)';
    ectx.lineWidth   = 2;
    ectx.shadowBlur  = 10;
    ectx.shadowColor = '#e74c3c';
    ectx.beginPath();

    for (let t = 0; t < length; t++) {
      const waveY = p.y + Math.sin((t * 0.3) + p.phase) * amp;
      const waveX = p.x + t;
      if (t === 0) ectx.moveTo(waveX, waveY);
      else         ectx.lineTo(waveX, waveY);
    }

    ectx.stroke();
    ectx.restore();

    if (p.life > 80) {
      state.photons.splice(i, 1);
    }
  });

  // Highlight the population inversion region
  if (inversed) {
    ectx.save();
    ectx.globalAlpha = 0.15;
    ectx.fillStyle   = '#f1c40f';
    ectx.fillRect(20, topY, W - 120, laserY - topY);
    ectx.restore();
  }

  // Arrow showing pump energy direction
  if (pump > 0.05) {
    const arrowX = 12;
    ectx.save();
    ectx.strokeStyle = `rgba(243,156,18,${pump})`;
    ectx.lineWidth   = 2;
    ectx.shadowBlur  = 8;
    ectx.shadowColor = '#f39c12';
    ectx.beginPath();
    ectx.moveTo(arrowX, groundY - 5);
    ectx.lineTo(arrowX, topY + 5);
    ectx.stroke();

    ectx.fillStyle = `rgba(243,156,18,${pump})`;
    ectx.beginPath();
    ectx.moveTo(arrowX,     topY);
    ectx.lineTo(arrowX - 5, topY + 10);
    ectx.lineTo(arrowX + 5, topY + 10);
    ectx.fill();
    ectx.restore();
  }
}

// Main animation loop
let animId;
function loop() {
  state.time++;
  drawSim();
  if (!modal.classList.contains('hidden')) {
    drawEnergyDiagram();
  }
  animId = requestAnimationFrame(loop);
}
loop();

// Modal open/close
laserTrigger.addEventListener('click', () => {
  modal.classList.remove('hidden');
  popupPump.value        = state.pumpPower;
  pumpVal.textContent    = state.pumpPower + '%';
  updateActivateBtn();
});

closeModal.addEventListener('click', () => {
  modal.classList.add('hidden');
});

modal.addEventListener('click', e => {
  if (e.target === modal) modal.classList.add('hidden');
});

// Laser type radio buttons
document.querySelectorAll('input[name="laser-type"]').forEach(radio => {
  radio.addEventListener('change', e => {
    state.laserType = e.target.value;
  });
});

// Pump slider inside the modal
popupPump.addEventListener('input', e => {
  state.pumpPower       = +e.target.value;
  pumpVal.textContent   = state.pumpPower + '%';
  ctrlPump.value        = state.pumpPower;
  ctrlPumpV.textContent = state.pumpPower + '%';
  updateActivateBtn();
});

function updateActivateBtn() {
  const inversed       = state.pumpPower >= 55;
  activateBtn.disabled = !inversed;
  if (inversed) {
    inversionMsg.classList.remove('hidden');
  } else {
    inversionMsg.classList.add('hidden');
  }
}

activateBtn.addEventListener('click', () => {
  state.laserActive      = true;
  modal.classList.add('hidden');
  ctrlPump.disabled      = false;
  ctrlPump.value         = state.pumpPower;
  ctrlPumpV.textContent  = state.pumpPower + '%';
  statusText.textContent = '✓ LASER ACTIVE';
});

// Control panel sliders
ctrlPump.addEventListener('input', e => {
  state.pumpPower       = +e.target.value;
  ctrlPumpV.textContent = state.pumpPower + '%';
  popupPump.value       = state.pumpPower;
  pumpVal.textContent   = state.pumpPower + '%';
});

ctrlAngle.addEventListener('input', e => {
  state.angle            = +e.target.value;
  ctrlAngleV.textContent = state.angle + '°';
});

ctrlN1.addEventListener('input', e => {
  state.n1            = +e.target.value;
  ctrlN1V.textContent = state.n1.toFixed(2);
  clampN2();
});

ctrlN2.addEventListener('input', e => {
  state.n2            = +e.target.value;
  ctrlN2V.textContent = state.n2.toFixed(2);
});

ctrlBend.addEventListener('input', e => {
  state.bend          = +e.target.value;
  ctrlBendV.textContent = state.bend;
});

// Warn visually if n2 >= n1 (no guiding possible)
function clampN2() {
  ctrlN2V.style.color = state.n2 >= state.n1 ? '#e74c3c' : '#f1c40f';
}
