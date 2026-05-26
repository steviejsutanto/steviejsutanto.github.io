const state = {
  works: [],
  activeWorkId: null,
  soundEnabled: false,
  bgAudio: null,
  spatialSources: new Map(),
  pointerInsideStage: false,
  audioPoint: { x: 50, y: 50 },
  activeBg: "a",
  activeBgImage: "",
  bgRequestId: 0,
  bgTarget: 0.18,
  raf: null,
  portfolioVisible: false
};

const selectors = {
  soundToggle: document.querySelector("#soundToggle"),
  stage: document.querySelector("#constellationStage"),
  bgA: document.querySelector(".constellation-bg.bg-a"),
  bgB: document.querySelector(".constellation-bg.bg-b"),
  lines: document.querySelector("#constellationLines"),
  preview: document.querySelector("#workPreview"),
  worksSection: document.querySelector("#works")
};

init();

async function init() {
  try {
    state.works = await loadWorks();
    renderConstellation();
    renderLines();
    setPreview(state.works[0], false);
    setupConstellationPointer();
    setupAudio();
    setupScrollAudio();
    window.addEventListener("resize", debounce(renderLines, 120));
  } catch (error) {
    selectors.preview.innerHTML = `
      <p class="preview-label">Manifest unavailable</p>
      <h3>Works could not load</h3>
      <p>${escapeHtml(error.message)}</p>
    `;
  }
}

async function loadWorks() {
  if (Array.isArray(window.PORTFOLIO_WORKS)) {
    return window.PORTFOLIO_WORKS;
  }
  const response = await fetch("portfolio/works.json");
  if (!response.ok) {
    throw new Error(`Could not load works manifest: ${response.status}`);
  }
  return response.json();
}

function setupAudio() {
  const bgWork = state.works.find((work) => work.id === "my-computers-interpretation-of-falling" && work.excerptSrc)
    || state.works.find((work) => work.excerptSrc);
  if (bgWork) {
    state.bgAudio = new Audio(bgWork.excerptSrc);
    state.bgAudio.loop = true;
    state.bgAudio.preload = "auto";
    state.bgAudio.volume = 0;
  }

  state.works.forEach((work) => {
    if (!work.excerptSrc) {
      return;
    }
    const audio = new Audio(work.excerptSrc);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0;
    state.spatialSources.set(work.id, {
      audio,
      work,
      target: 0,
      failed: false
    });
  });

  selectors.soundToggle.addEventListener("click", async () => {
    state.soundEnabled = !state.soundEnabled;
    document.body.classList.toggle("sound-on", state.soundEnabled);
    selectors.soundToggle.setAttribute("aria-pressed", String(state.soundEnabled));
    selectors.soundToggle.setAttribute("aria-label", state.soundEnabled ? "Turn sound off" : "Turn sound on");

    if (state.soundEnabled) {
      if (state.bgAudio) {
        state.bgAudio.play().catch(() => {
          state.bgTarget = 0;
        });
      }
      await startSpatialSources();
      state.bgTarget = state.portfolioVisible ? 0.01 : 0.18;
      updateSpatialTargets();
      startGainLoop();
    } else {
      state.bgTarget = 0;
      fadeSpatialAudio();
    }
  });
}

async function startSpatialSources() {
  const starters = [];
  state.spatialSources.forEach((source) => {
    if (source.failed || !source.audio.paused) {
      return;
    }
    source.audio.volume = 0;
    starters.push(source.audio.play().catch(() => {
      source.failed = true;
      source.target = 0;
    }));
  });
  await Promise.allSettled(starters);
}

function setupScrollAudio() {
  const observer = new IntersectionObserver(
    ([entry]) => {
      state.portfolioVisible = entry.isIntersecting;
      if (state.soundEnabled) {
        state.bgTarget = entry.isIntersecting ? 0.01 : 0.18;
        if (entry.isIntersecting) {
          updateSpatialTargets();
        } else {
          fadeSpatialAudio();
        }
        startGainLoop();
      }
    },
    { threshold: 0.34 }
  );
  observer.observe(selectors.worksSection);
}

function startGainLoop() {
  if (state.raf) {
    return;
  }
  const tick = () => {
    const bgDone = rampVolume(state.bgAudio, state.bgTarget, 0.018);
    const spatialDone = rampSpatialVolumes();
    if (bgDone && spatialDone) {
      state.raf = null;
      if (!state.soundEnabled) {
        pauseSpatialSources();
        if (state.bgAudio && !state.bgAudio.paused) {
          state.bgAudio.pause();
        }
      }
      return;
    }
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

function rampSpatialVolumes() {
  let done = true;
  state.spatialSources.forEach((source) => {
    const target = state.soundEnabled && !source.failed ? source.target : 0;
    const sourceDone = rampVolume(source.audio, target, 0.018);
    if (!sourceDone) {
      done = false;
    }
  });
  return done;
}

function rampVolume(audio, target, step) {
  if (!audio) {
    return true;
  }
  const next = audio.volume + Math.sign(target - audio.volume) * step;
  if (Math.abs(target - audio.volume) <= step) {
    audio.volume = target;
    return true;
  }
  audio.volume = clamp(next, 0, 1);
  return false;
}

function pauseSpatialSources() {
  state.spatialSources.forEach((source) => {
    source.target = 0;
    source.audio.pause();
  });
}

function renderConstellation() {
  const nodes = document.createDocumentFragment();
  state.works.forEach((work) => {
    const hasFullWorkLink = Boolean(work.primaryLink);
    const node = document.createElement(hasFullWorkLink ? "a" : "button");
    node.className = "work-node";
    if (hasFullWorkLink) {
      node.href = work.primaryLink;
      node.target = "_blank";
      node.rel = "noopener";
    } else {
      node.type = "button";
    }
    node.dataset.id = work.id;
    node.style.setProperty("--x", work.position.x);
    node.style.setProperty("--y", work.position.y);
    node.style.setProperty("--z", work.position.z);
    node.style.setProperty("--z-index", Math.round(work.position.z * 20));
    node.setAttribute(
      "aria-label",
      hasFullWorkLink
        ? `${work.title}, ${work.year}. Open full work in a new tab.`
        : `${work.title}, ${work.year}. Select this work for listening.`
    );
    node.innerHTML = `<span>${escapeHtml(work.title)}</span>`;

    node.addEventListener("mouseenter", () => activateWork(work));
    node.addEventListener("focus", () => activateWork(work));
    node.addEventListener("blur", () => deactivateWork());

    nodes.appendChild(node);
  });
  selectors.stage.appendChild(nodes);
}

function setupConstellationPointer() {
  selectors.stage.addEventListener("pointermove", (event) => {
    const point = getStagePoint(event);
    state.pointerInsideStage = true;
    state.audioPoint = point;
    const nearest = findNearestWork(point);
    if (nearest) {
      setActiveWork(nearest);
    }
    updateSpatialTargets();
  });

  selectors.stage.addEventListener("pointerleave", () => {
    state.pointerInsideStage = false;
    document.querySelectorAll(".work-node").forEach((node) => node.classList.remove("is-active"));
    fadeSpatialAudio();
  });
}

function renderLines() {
  const rect = selectors.stage.getBoundingClientRect();
  const activeWorks = state.works;
  const activeIds = new Set(activeWorks.map((work) => work.id));
  const lines = [];
  const seen = new Set();

  activeWorks.forEach((work) => {
    (work.similarity || []).forEach((targetId) => {
      if (!activeIds.has(targetId)) {
        return;
      }
      const key = [work.id, targetId].sort().join(":");
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const target = state.works.find((candidate) => candidate.id === targetId);
      if (!target) {
        return;
      }
      const x1 = (work.position.x / 100) * rect.width;
      const y1 = (work.position.y / 100) * rect.height;
      const x2 = (target.position.x / 100) * rect.width;
      const y2 = (target.position.y / 100) * rect.height;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.hypot(dx, dy) || 1;
      const curve = Math.min(42, Math.max(16, distance * 0.12));
      const direction = key.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 === 0 ? 1 : -1;
      const cx = (x1 + x2) / 2 + (-dy / distance) * curve * direction;
      const cy = (y1 + y2) / 2 + (dx / distance) * curve * direction;
      lines.push(`
        <path
          d="M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}"
        />
      `);
    });
  });

  selectors.lines.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  selectors.lines.innerHTML = lines.join("");
}

function activateWork(work) {
  state.pointerInsideStage = true;
  state.audioPoint = {
    x: work.position.x,
    y: work.position.y
  };
  setActiveWork(work);
  updateSpatialTargets();
}

function setActiveWork(work) {
  state.activeWorkId = work.id;
  document.querySelectorAll(".work-node").forEach((node) => {
    node.classList.toggle("is-active", node.dataset.id === work.id);
  });
  setPreview(work, true);
}

function deactivateWork() {
  state.activeWorkId = null;
  state.pointerInsideStage = false;
  document.querySelectorAll(".work-node").forEach((node) => node.classList.remove("is-active"));
  fadeSpatialAudio();
}

function setPreview(work, includeImage) {
  setConstellationBackground(work.imageSrc || "");
  selectors.preview.innerHTML = `
    <p class="detail-line">
      <span>${work.year}</span>
      <strong>${escapeHtml(work.title)}</strong>
      <span>${escapeHtml(work.instrumentation)}</span>
    </p>
  `;
}

function setConstellationBackground(imageSrc) {
  if (!selectors.bgA || !selectors.bgB) {
    return;
  }

  const src = imageSrc || "";
  if (state.activeBgImage === src) {
    return;
  }

  const requestId = ++state.bgRequestId;
  const applyBackground = () => {
    if (requestId !== state.bgRequestId) {
      return;
    }

    const next = state.activeBg === "a" ? selectors.bgB : selectors.bgA;
    const current = state.activeBg === "a" ? selectors.bgA : selectors.bgB;
    next.style.setProperty("--work-image", cssUrl(src));
    next.classList.add("is-active");
    current.classList.remove("is-active");
    state.activeBg = state.activeBg === "a" ? "b" : "a";
    state.activeBgImage = src;
  };

  if (!src) {
    applyBackground();
    return;
  }

  const image = new Image();
  image.onload = applyBackground;
  image.onerror = applyBackground;
  image.src = src;
}

function updateSpatialTargets() {
  if (!state.soundEnabled || !state.pointerInsideStage || !state.portfolioVisible) {
    fadeSpatialAudio();
    return;
  }

  const weights = getSpatialWeights(state.audioPoint);
  state.spatialSources.forEach((source, workId) => {
    source.target = weights.get(workId) || 0;
  });
  state.bgTarget = 0.01;
  startGainLoop();
}

function fadeSpatialAudio() {
  state.spatialSources.forEach((source) => {
    source.target = 0;
  });
  if (state.soundEnabled) {
    state.bgTarget = state.portfolioVisible ? 0.035 : 0.18;
  }
  startGainLoop();
}

function getSpatialWeights(point) {
  const rect = selectors.stage.getBoundingClientRect();
  const soloWork = findSoloWork(point, rect);
  const rawWeights = new Map();

  if (soloWork && state.spatialSources.has(soloWork.id)) {
    state.spatialSources.forEach((_source, workId) => {
      rawWeights.set(workId, workId === soloWork.id ? 0.68 : 0);
    });
    return rawWeights;
  }

  let total = 0;

  state.spatialSources.forEach((source, workId) => {
    if (source.failed) {
      return;
    }
    const distance = getWorkDistance(point, source.work, rect);
    const coreRadius = getAudioCoreRadius(source.work, rect);
    const radius = getAudioRadius(source.work, rect);
    const blendDistance = Math.max(0, distance - coreRadius);
    const blendRadius = Math.max(1, radius - coreRadius);
    const proximity = clamp(1 - blendDistance / blendRadius, 0, 1);
    const weight = proximity * proximity * proximity;
    rawWeights.set(workId, weight);
    total += weight;
  });

  if (total === 0) {
    return rawWeights;
  }

  const maxMixVolume = 0.68;
  rawWeights.forEach((weight, workId) => {
    rawWeights.set(workId, (weight / total) * maxMixVolume);
  });
  return rawWeights;
}

function getStagePoint(event) {
  const rect = selectors.stage.getBoundingClientRect();
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100)
  };
}

function findNearestWork(point) {
  const rect = selectors.stage.getBoundingClientRect();
  return state.works.reduce((nearest, work) => {
    const distance = getWorkDistance(point, work, rect);
    if (!nearest || distance < nearest.distance) {
      return { work, distance };
    }
    return nearest;
  }, null)?.work;
}

function findSoloWork(point, rect) {
  const labelWork = findLabelWork(point);
  if (labelWork) {
    return labelWork;
  }

  const nearest = state.works.reduce((candidate, work) => {
    if (!state.spatialSources.has(work.id)) {
      return candidate;
    }
    const distance = getWorkDistance(point, work, rect);
    const coreRadius = getAudioCoreRadius(work, rect);
    if (distance <= coreRadius && (!candidate || distance < candidate.distance)) {
      return { work, distance };
    }
    return candidate;
  }, null);

  return nearest?.work || null;
}

function findLabelWork(point) {
  if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) {
    return null;
  }

  const labelPadding = 8;
  const nodes = document.querySelectorAll(".work-node");
  for (const node of nodes) {
    if (!state.spatialSources.has(node.dataset.id)) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    const inside =
      point.clientX >= rect.left - labelPadding &&
      point.clientX <= rect.right + labelPadding &&
      point.clientY >= rect.top - labelPadding &&
      point.clientY <= rect.bottom + labelPadding;
    if (inside) {
      return state.works.find((work) => work.id === node.dataset.id) || null;
    }
  }
  return null;
}

function getWorkDistance(point, work, rect) {
  const dx = ((work.position.x - point.x) / 100) * rect.width;
  const dy = ((work.position.y - point.y) / 100) * rect.height;
  return Math.hypot(dx, dy);
}

function getAudioRadius(work, rect) {
  const radius = Number(work.audioRadius) || 32;
  return (clamp(radius, 12, 70) / 100) * Math.min(rect.width, rect.height);
}

function getAudioCoreRadius(work, rect) {
  const requestedCore = ((Number(work.audioCoreRadius) || 9) / 100) * Math.min(rect.width, rect.height);
  const nearestDistance = getNearestWorkDistance(work, rect);
  const nonOverlappingCore = Number.isFinite(nearestDistance) ? nearestDistance * 0.42 : requestedCore;
  return Math.max(18, Math.min(requestedCore, nonOverlappingCore));
}

function getNearestWorkDistance(work, rect) {
  return state.works.reduce((nearest, candidate) => {
    if (candidate.id === work.id || !state.spatialSources.has(candidate.id)) {
      return nearest;
    }
    const dx = ((candidate.position.x - work.position.x) / 100) * rect.width;
    const dy = ((candidate.position.y - work.position.y) / 100) * rect.height;
    return Math.min(nearest, Math.hypot(dx, dy));
  }, Infinity);
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function cssUrl(value) {
  if (!value) {
    return "none";
  }
  return `url("${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
}
