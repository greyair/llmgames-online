// Layout adapter only. Choreography, effect interpolation, and sprite queues come from upstream.js.
import {
  $,
  EffectScene,
  Sprite,
  BattleMoveAnims,
  BattleOtherAnims,
  BattleStatusAnims,
  BattleEffects,
} from "./upstream.js";

let ready;

export function preloadEffects() {
  return (ready ??= Promise.all(
    [...new Set(Object.values(BattleEffects).flatMap((e) => (e.url ? [e.url] : [])))].map(
      (url) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(`Cannot load Showdown effect ${url}`));
          image.src = url;
        }),
    ),
  ).then(() => {}));
}

export function playEffect(stage, cue, bottomSeat) {
  const rect = stage.getBoundingClientRect();

  const scaleX = rect.width / 640,
    scaleY = rect.height / 360;

  const layer = document.createElement("div");
  layer.className = "showdown-animation-layer";
  Object.assign(layer.style, {
    width: "640px",
    height: "360px",
    transform: `scale(${scaleX},${scaleY})`,
  });
  stage.append(layer);
  const scene = new EffectScene();
  scene.animating = true;
  scene.$fx = $('<div class="showdown-fx" />').appendTo(layer);
  scene.$bgEffect = $('<div class="showdown-background-effects" />').prependTo(layer);
  scene.$bg = $('<div class="showdown-shaking-background" />').prependTo(layer);
  scene.$delay = $("<div />");
  scene.startAnimations();
  const accents = [];

  const animate = (element, frames, options) => {
    const animation = element.animate(frames, options);
    accents.push(animation);

    return animation;
  };

  const centers = new Map();
  const hidden = [];
  const sprites = new Map();

  for (const actor of stage.querySelectorAll("[data-pokemon-seat]")) {
    const image = actor.querySelector("img");

    if (!image) continue;
    const box = image.getBoundingClientRect();
    const seat = actor.dataset.pokemonSeat;
    const z = seat === bottomSeat ? 0 : 200;
    const perspective = z === 0 ? 1.5 : 1;
    const cx = (box.x + box.width / 2 - rect.x) / scaleX;
    const cy = (box.y + box.height / 2 - rect.y) / scaleY;
    centers.set(seat, { x: cx, y: cy });

    const pos = {
      x: (cx - 210 - (220 * z) / 200) / perspective,
      y: (245 - (110 * z) / 200 - cy) / perspective,
      z,
      display: "block",
    };

    const sprite = new Sprite(
      {
        url: image.currentSrc || image.src,
        w: box.width / scaleX / perspective,
        h: box.height / scaleY / perspective,
        pixelated: true,
      },
      pos,
      scene,
    );

    sprite.isFrontSprite = seat !== bottomSeat;
    sprite.leftof = (offset) => sprite.x + (sprite.isFrontSprite ? 1 : -1) * offset;
    sprite.behind = (offset) => sprite.z + (sprite.isFrontSprite ? 1 : -1) * offset;
    sprite.$el
      .css({ transform: image.style.transform, imageRendering: "pixelated", objectFit: "contain" })
      .appendTo(layer);
    hidden.push([image, image.style.visibility]);
    image.style.visibility = "hidden";
    sprites.set(seat, sprite);
  }

  let cancelled = false;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;

    for (const animation of accents) animation.cancel();
    $(layer).find("*").stop(true, false);
    scene.$delay.stop(true, false);

    for (const [image, visibility] of hidden) image.style.visibility = visibility;
    layer.remove();
  };

  try {
    const actor = sprites.get(cue.actor);
    let target = sprites.get(cue.target) || actor;

    if (!actor) {
      cancel();

      return { finished: Promise.resolve(), cancel };
    }

    if (cue.missed && target !== actor) {
      const real = target;
      target = new Sprite(null, { x: real.x + 60, y: real.y + 30, z: real.z }, scene);
      target.isMissedPokemon = true;
      target.leftof = (offset) => target.x + (real.isFrontSprite ? 1 : -1) * offset;
      target.behind = (offset) => target.z + (real.isFrontSprite ? 1 : -1) * offset;
    }

    // These accents follow actual protocol cues, so misses never get a hit reaction.
    if (cue.kind === "hit" || cue.kind === "heal") {
      const center = centers.get(cue.actor);
      const halo = document.createElement("div");
      halo.className = `poke-impact-accent poke-impact-accent--${cue.kind}`;
      Object.assign(halo.style, { left: `${center.x}px`, top: `${center.y}px` });
      layer.append(halo);
      animate(
        halo,
        [
          { transform: "translate(-50%,-50%) scale(.35)", opacity: 0 },
          { transform: "translate(-50%,-50%) scale(.85)", opacity: 0.85, offset: 0.2 },
          { transform: "translate(-50%,-50%) scale(1.65)", opacity: 0 },
        ],
        { duration: 420, easing: "ease-out", fill: "both" },
      );

      if (cue.kind === "hit") {
        animate(
          actor.$el[0],
          [
            { translate: "0 0", filter: "brightness(1)" },
            {
              translate: cue.actor === bottomSeat ? "-7px 3px" : "7px -3px",
              filter: "brightness(1.8)",
              offset: 0.18,
            },
            { translate: "3px 0", filter: "brightness(.85)", offset: 0.4 },
            { translate: "-2px 0", filter: "brightness(1)", offset: 0.65 },
            { translate: "0 0", filter: "brightness(1)" },
          ],
          { duration: 360, easing: "ease-out" },
        );
      }
    }

    if (cue.kind === "move") {
      const animation = BattleMoveAnims[cue.moveId];

      if (!animation) throw new Error(`No upstream animation for ${cue.moveId}`);

      if (cue.animationPhase === "prepare")
        (animation.prepareAnim || BattleOtherAnims.selfstatus.anim)(scene, [actor, target]);
      else animation.anim(scene, [actor, target]);
    } else if (cue.kind === "hit") {
      BattleOtherAnims.hitmark.anim(scene, [actor]);
    } else if (cue.kind === "heal") {
      BattleOtherAnims.heal.anim(scene, [actor]);
    } else if (cue.kind === "status") {
      (
        BattleStatusAnims[cue.condition === "tox" ? "psn" : cue.condition] ||
        BattleOtherAnims.lightstatus
      ).anim(scene, [actor]);
    }

    for (const sprite of sprites.values()) scene.waitFor(sprite.$el);
    scene.waitFor(scene.$bg);
    scene.waitFor(scene.$bgEffect.find("*"));

    const finished = new Promise((resolve) => {
      const queue = scene.finishAnimations();

      if (queue) queue.then(resolve);
      else resolve();
    });

    return {
      finished: Promise.all([
        finished,
        ...accents.map((animation) => animation.finished.catch(() => {})),
      ])
        .then(() => {})
        .finally(cancel),
      cancel,
    };
  } catch (error) {
    cancel();
    throw error;
  }
}
