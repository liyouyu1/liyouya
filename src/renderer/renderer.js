const root = document.getElementById("petRoot");
const stage = document.getElementById("petStage");
const petImage = document.getElementById("petImage");
const speechBubble = document.getElementById("speechBubble");

const MOTION_DURATION = 720;
const ACTIVE_WANDER_MIN = 8000;
const ACTIVE_WANDER_MAX = 18000;

let state = null;
let dragState = null;
let speechTimer = null;
let idleTimer = null;
let wanderTimer = null;

function petAssetPath(file) {
  return `../../assets/pets/${encodeURIComponent(file)}`;
}

function setSpeech(text) {
  clearTimeout(speechTimer);

  if (!text) {
    speechBubble.hidden = true;
    speechBubble.textContent = "";
    return;
  }

  speechBubble.textContent = text;
  speechBubble.hidden = false;
  speechTimer = setTimeout(() => setSpeech(""), 2600);
}

function setState(nextState) {
  state = nextState;
  const currentPet = state.currentPet;

  root.style.setProperty("--pet-size", `${state.size.petSize}px`);
  root.classList.toggle("active", state.mode === "active");
  root.classList.toggle("quiet", state.mode !== "active");
  petImage.src = petAssetPath(currentPet.file);
  petImage.alt = currentPet.name;
  stage.setAttribute("aria-label", currentPet.name);
  scheduleActiveWander();
}

function applyAction(action = {}) {
  if (!action.motion && !action.emotion && !action.say) {
    return;
  }

  root.dataset.emotion = action.emotion || "idle";
  if (action.say) {
    setSpeech(action.say);
  }

  if (action.motion && action.motion !== "idle") {
    root.classList.remove("motion-bounce", "motion-squish", "motion-hop", "motion-shake", "motion-sleep");
    void root.offsetWidth;
    root.classList.add(`motion-${action.motion}`);
    setTimeout(() => {
      root.classList.remove(`motion-${action.motion}`);
    }, MOTION_DURATION);
  }

  if (state && state.mode === "active" && action.motion === "hop") {
    animateWindowHop(randomBetween(-140, 140), randomBetween(-90, 50));
  }
}

function randomBetween(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

function animateWindowHop(dx, dy) {
  const duration = 420;
  const startedAt = performance.now();
  let lastX = 0;
  let lastY = 0;

  function step(now) {
    const t = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const currentX = dx * eased;
    const currentY = dy * eased - Math.sin(t * Math.PI) * 18;

    window.catcake.moveWindowBy(currentX - lastX, currentY - lastY);
    lastX = currentX;
    lastY = currentY;

    if (t < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

function scheduleIdleTick() {
  clearInterval(idleTimer);
  idleTimer = setInterval(async () => {
    const action = await window.catcake.sendEvent({ type: "idleTick" });
    applyAction(action);
  }, 9000);
}

function scheduleActiveWander() {
  clearTimeout(wanderTimer);

  if (!state || state.mode !== "active") {
    return;
  }

  wanderTimer = setTimeout(async () => {
    const action = await window.catcake.sendEvent({ type: "idleTick" });
    applyAction(action);
    scheduleActiveWander();
  }, randomBetween(ACTIVE_WANDER_MIN, ACTIVE_WANDER_MAX));
}

function eventPoint(event) {
  return {
    x: event.screenX,
    y: event.screenY
  };
}

stage.addEventListener("pointerdown", async event => {
  if (event.button !== 0) {
    return;
  }

  const point = eventPoint(event);
  dragState = {
    startX: point.x,
    startY: point.y,
    lastX: point.x,
    lastY: point.y,
    moved: false
  };
  stage.setPointerCapture(event.pointerId);
});

stage.addEventListener("pointermove", async event => {
  if (!dragState) {
    return;
  }

  const point = eventPoint(event);
  const dx = point.x - dragState.lastX;
  const dy = point.y - dragState.lastY;
  const totalX = point.x - dragState.startX;
  const totalY = point.y - dragState.startY;

  if (Math.abs(totalX) + Math.abs(totalY) > 4) {
    dragState.moved = true;
  }

  if (dragState.moved) {
    await window.catcake.moveWindowBy(dx, dy);
  }

  dragState.lastX = point.x;
  dragState.lastY = point.y;
});

stage.addEventListener("pointerup", async event => {
  if (!dragState) {
    return;
  }

  const wasDrag = dragState.moved;
  dragState = null;
  stage.releasePointerCapture(event.pointerId);

  const action = await window.catcake.sendEvent({ type: wasDrag ? "dragEnd" : "click" });
  applyAction(action);
});

stage.addEventListener("keydown", async event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const action = await window.catcake.sendEvent({ type: "click" });
    applyAction(action);
  }
});

window.addEventListener("contextmenu", event => {
  event.preventDefault();
  window.catcake.showMenu();
});

window.addEventListener("beforeunload", () => {
  clearInterval(idleTimer);
  clearTimeout(wanderTimer);
});

window.catcake.onStateChanged(setState);
window.catcake.onAgentAction(applyAction);
window.catcake.onCustomSizeRequested(async size => {
  const input = window.prompt(`输入猫猫糕大小（${size.min}-${size.max}px）`, String(size.current));

  if (input === null) {
    return;
  }

  const nextSize = Number(input.trim());
  if (!Number.isFinite(nextSize)) {
    return;
  }

  const nextState = await window.catcake.setPetSize(nextSize);
  setState(nextState);
});

window.catcake.getState().then(nextState => {
  setState(nextState);
  scheduleIdleTick();
});
